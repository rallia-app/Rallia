/**
 * "Just for you" composer (Deno port)
 *
 * IMPORTANT: keep in sync with `packages/shared-services/src/matches/justForYouComposer.ts`.
 * The Home carousel and the daily digest MUST produce identical content for
 * the same caller — that's the parity guarantee. Diverging the logic across
 * the two surfaces would be a silent product bug (user sees X on Home, Y in
 * email, can't reconcile).
 *
 * Why a copy: Deno can't import from the TypeScript monorepo path aliases
 * used by React Native, so we keep a parallel Deno-friendly version here that
 * uses the SupabaseClient passed in by the edge function.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  scoreNearbyMatch,
  maxCostInBatch,
  type Scorable,
  type MatchScoringPreferences,
} from './matchScoring.ts';

export interface ComposeJustForYouInput {
  supabase: SupabaseClient;
  playerId: string;
  sportId: string;
  latitude: number;
  longitude: number;
  maxDistanceKm: number;
  userGender?: string | null;
  scoringPreferences: MatchScoringPreferences;
  excludeUserIds?: string[];
  /** Total number of items to return (matches + suggestion padding). Default 5. */
  matchLimit?: number;
}

/** Slim suggestion shape — mirrors `SlotSuggestion` from the mobile service. */
export interface ComposedSuggestion {
  opponentId: string;
  opponentFirstName: string;
  opponentLastName: string;
  opponentRatingLabel: string | null;
  opponentReputationTier: string | null;
  opponentBadgeStatus: string | null;
  facilityId: string;
  facilityName: string;
  facilityCity: string;
  matchDate: string;
  startTime: string;
  endTime: string;
  matchupScore: number;
}

export interface ComposeJustForYouResult {
  matches: Scorable[];
  suggestions: ComposedSuggestion[];
}

const DEFAULT_LIMIT = 5;
/** Pool size before scoring + dedup. Generous so the cap is never the bottleneck. */
const MATCH_POOL_SIZE = 30;

/** Active-participation statuses that disqualify a match. */
const INVOLVED_STATUSES = new Set(['joined', 'requested', 'pending', 'waitlisted']);

interface NearbyMatchRow {
  match_id: string;
  distance_meters: number;
}

interface MatchDetailRow {
  id: string;
  match_date: string;
  start_time: string;
  end_time: string;
  format: string | null;
  duration: string | null;
  join_mode: string | null;
  player_expectation: string | null;
  preferred_opponent_gender: string | null;
  is_court_free: boolean | null;
  estimated_cost: number | null;
  court_status: string | null;
  facility_id: string | null;
  created_by: string;
  // Supabase-js types nested foreign-key selects as either array or single.
  sport: Array<{ name: string }> | { name: string } | null;
  facility: Array<{ name: string; city: string }> | { name: string; city: string } | null;
  min_rating_score?: { value: number | null } | null;
  participants?: Array<{
    status: string | null;
    player_id: string | null;
    player?: { sport_certification_status?: string | null } | null;
  }> | null;
}

function pickFirst<T>(value: T[] | T | null | undefined): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

interface DigestSuggestionRow {
  opponent_id: string;
  opponent_first_name: string;
  opponent_last_name: string;
  opponent_rating_label: string | null;
  opponent_badge_status: string | null;
  opponent_reputation_tier: string | null;
  facility_id: string;
  facility_name: string;
  facility_city: string;
  match_date: string;
  start_time: string;
  end_time: string;
  matchup_score: number;
}

export async function composeJustForYou(
  input: ComposeJustForYouInput
): Promise<ComposeJustForYouResult> {
  const {
    supabase,
    playerId,
    sportId,
    latitude,
    longitude,
    maxDistanceKm,
    scoringPreferences,
    excludeUserIds,
    matchLimit = DEFAULT_LIMIT,
  } = input;

  // ── 1. Match pool (IDs + distances) ──────────────────────────────────
  const { data: nearby, error: nearbyErr } = await supabase.rpc('search_matches_nearby', {
    p_latitude: latitude,
    p_longitude: longitude,
    p_max_distance_km: maxDistanceKm,
    p_sport_id: sportId,
    p_limit: MATCH_POOL_SIZE,
    p_offset: 0,
    p_user_gender: input.userGender ?? null,
  });

  if (nearbyErr || !nearby || nearby.length === 0) {
    if (nearbyErr) {
      console.warn(`[composeJustForYou] search_matches_nearby error: ${nearbyErr.message}`);
    }
    // No matches — fall through to suggestion-only padding
    return composeSuggestionsOnly(supabase, playerId, sportId, matchLimit);
  }

  const rows = nearby as NearbyMatchRow[];
  const distanceById = new Map(rows.map(r => [r.match_id, r.distance_meters]));

  // ── 2. Hydrate match details ─────────────────────────────────────────
  const { data: details, error: detailErr } = await supabase
    .from('match')
    .select(
      'id, match_date, start_time, end_time, format, duration, join_mode, player_expectation, preferred_opponent_gender, is_court_free, estimated_cost, court_status, facility_id, created_by, sport:sport_id(name), facility:facility_id(name, city), min_rating_score:min_rating_score_id(value), participants:match_participant(status, player_id, player:player_id(sport_certification_status))'
    )
    .in(
      'id',
      rows.map(r => r.match_id)
    );

  if (detailErr || !details) {
    if (detailErr) {
      console.warn(`[composeJustForYou] match detail fetch error: ${detailErr.message}`);
    }
    return composeSuggestionsOnly(supabase, playerId, sportId, matchLimit);
  }

  const detailRows = details as unknown as MatchDetailRow[];
  const exclusionSet = new Set(excludeUserIds ?? []);

  // ── 3. Filter exclusions + shape into Scorable ───────────────────────
  const candidates: Scorable[] = [];
  for (const m of detailRows) {
    if (exclusionSet.has(m.created_by)) continue;
    if (
      exclusionSet.size > 0 &&
      m.participants?.some(
        p =>
          p.player_id &&
          exclusionSet.has(p.player_id) &&
          p.status != null &&
          INVOLVED_STATUSES.has(p.status)
      )
    ) {
      continue;
    }

    const sportRow = pickFirst(m.sport);
    const facilityRow = pickFirst(m.facility);

    candidates.push({
      id: m.id,
      facility_id: m.facility_id,
      format: m.format,
      duration: m.duration,
      match_date: m.match_date,
      start_time: m.start_time,
      estimated_cost: m.estimated_cost,
      is_court_free: m.is_court_free,
      court_status: m.court_status,
      player_expectation: m.player_expectation,
      preferred_opponent_gender: m.preferred_opponent_gender,
      distance_meters: distanceById.get(m.id) ?? null,
      min_rating_score: m.min_rating_score ?? null,
      participants:
        m.participants?.map(p => ({
          status: p.status,
          player_id: p.player_id,
          player: p.player
            ? { sportCertificationStatus: p.player.sport_certification_status ?? null }
            : null,
        })) ?? null,
      // Extras carried for downstream rendering — not used by the scorer.
      end_time: m.end_time,
      join_mode: m.join_mode,
      sport: sportRow ? { name: sportRow.name } : null,
      facility: facilityRow ? { name: facilityRow.name, city: facilityRow.city } : null,
    });
  }

  // ── 4. Score and take top-N ──────────────────────────────────────────
  const maxCost = maxCostInBatch(candidates);
  const topMatches = candidates
    .map(match => ({ match, score: scoreNearbyMatch(match, scoringPreferences, maxCost) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, matchLimit)
    .map(s => s.match);

  // ── 5. Pad with suggestions if under cap ─────────────────────────────
  const padCount = Math.max(0, matchLimit - topMatches.length);
  if (padCount === 0) {
    return { matches: topMatches, suggestions: [] };
  }

  const suggestions = await fetchTopSuggestions(supabase, playerId, sportId, padCount);
  return { matches: topMatches, suggestions };
}

async function fetchTopSuggestions(
  supabase: SupabaseClient,
  playerId: string,
  sportId: string,
  limit: number
): Promise<ComposedSuggestion[]> {
  const { data, error } = await supabase.rpc('get_morning_digest_suggestions', {
    p_player_id: playerId,
    p_sport_id: sportId,
    p_limit: limit,
  });
  if (error) {
    console.warn(`[composeJustForYou] get_morning_digest_suggestions error: ${error.message}`);
    return [];
  }
  return ((data ?? []) as DigestSuggestionRow[]).map(row => ({
    opponentId: row.opponent_id,
    opponentFirstName: row.opponent_first_name,
    opponentLastName: row.opponent_last_name,
    opponentRatingLabel: row.opponent_rating_label,
    opponentReputationTier: row.opponent_reputation_tier,
    opponentBadgeStatus: row.opponent_badge_status,
    facilityId: row.facility_id,
    facilityName: row.facility_name,
    facilityCity: row.facility_city,
    matchDate: row.match_date,
    startTime: row.start_time,
    endTime: row.end_time,
    matchupScore: Number(row.matchup_score),
  }));
}

async function composeSuggestionsOnly(
  supabase: SupabaseClient,
  playerId: string,
  sportId: string,
  matchLimit: number
): Promise<ComposeJustForYouResult> {
  const suggestions = await fetchTopSuggestions(supabase, playerId, sportId, matchLimit);
  return { matches: [], suggestions };
}
