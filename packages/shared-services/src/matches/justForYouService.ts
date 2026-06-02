/**
 * Just-for-you service
 *
 * Single-round-trip wrapper around the `get_just_for_you` RPC. Replaces the
 * legacy `composeJustForYou` orchestration (matches via `getNearbyMatches`,
 * suggestions via `getTopSuggestions`, JS scoring + dedup) with one call.
 *
 * Anon callers (no `playerId`) don't hit this RPC — it requires `p_caller_id`
 * for its caller-scoped scoring CTEs (effective rating, history, blocked, busy
 * slots), which an anon user has nothing to fill. They route to
 * `getNearbyPublicMatches` instead: a matches-only, caller-independent
 * `get_nearby_public_matches` RPC (ranked by proximity + urgency + spots-left)
 * that also keeps the heavy `get_match_suggestions_anon` pool off the
 * signed-out path entirely.
 */
import { supabase } from '../supabase';
import type {
  ComposeJustForYouInput,
  ComposeJustForYouResult,
  JustForYouItem,
} from './justForYouComposer';
import type { Scorable } from './matchScoring';
import type { SlotSuggestion, SuggestionSlot } from './suggestionService';

/**
 * Row shape returned by the `get_just_for_you` RPC. The RPC returns each row
 * with either `match_payload` populated (kind='match') or `suggestion_payload`
 * populated (kind='suggestion'), never both.
 */
interface JustForYouRpcRow {
  kind: 'match' | 'suggestion';
  score: number;
  match_payload: Record<string, unknown> | null;
  suggestion_payload: Record<string, unknown> | null;
  player_compatibility: number | null;
  facility_affinity: number | null;
  score_history: number | null;
}

/**
 * SlotSuggestion's `slot.datetime` and `slot.endDatetime` are typed as `Date`,
 * but the RPC returns them as ISO timestamptz strings. Coerce on the way in so
 * downstream consumers (SuggestionCard, useSuggestionInviteHandler) see the
 * same shape the legacy composer produced.
 */
function hydrateSuggestion(payload: Record<string, unknown>): SlotSuggestion {
  const slot = payload.slot as { datetime: string; endDatetime: string; bookingUrl: string | null };
  const hydratedSlot: SuggestionSlot = {
    datetime: new Date(slot.datetime),
    endDatetime: new Date(slot.endDatetime),
    bookingUrl: slot.bookingUrl,
  };
  return { ...(payload as unknown as SlotSuggestion), slot: hydratedSlot };
}

export async function getJustForYou(
  input: ComposeJustForYouInput
): Promise<ComposeJustForYouResult> {
  // Anon: this RPC needs a caller ID for its scoring CTEs. Signed-out gets a
  // matches-only, caller-independent pool via `get_nearby_public_matches`.
  if (!input.playerId) {
    return getNearbyPublicMatches(input);
  }

  const { data, error } = await supabase.rpc('get_just_for_you', {
    p_caller_id: input.playerId,
    p_sport_id: input.sportId,
    p_latitude: input.latitude,
    p_longitude: input.longitude,
    p_max_distance_km: input.maxDistanceKm,
    p_user_gender: input.userGender ?? null,
    p_limit: input.matchLimit ?? 5,
    // Matches-only carousel: skip the suggestion pool entirely (no opponent
    // scan / slot fan-out / bookability work). Suggestions remain available via
    // the dedicated "Browse suggestions" sheet. Mirrors the signed-out path.
    p_include_suggestions: false,
  });

  if (input.signal?.aborted) {
    // Throw rather than returning empty — React Query treats AbortError
    // specially and won't write the empty payload to cache. Important now
    // that this query is persisted: a cached `{items: []}` would leave
    // the user staring at the empty-state card until the next refetch.
    throw new DOMException('Aborted', 'AbortError');
  }
  if (error) {
    throw error;
  }

  const rows = (data ?? []) as JustForYouRpcRow[];

  const items: JustForYouItem[] = [];
  const matches: Scorable[] = [];
  const suggestions: SlotSuggestion[] = [];

  rows.forEach((row, index) => {
    if (row.kind === 'match' && row.match_payload) {
      const match = row.match_payload as unknown as Scorable;
      items.push({ kind: 'match', score: Number(row.score), data: match });
      matches.push(match);
    } else if (row.kind === 'suggestion' && row.suggestion_payload) {
      const suggestion = hydrateSuggestion(row.suggestion_payload);
      // Rank is 1-indexed and reflects position in the merged top-N
      // (mirrors pickTopGlobal's behavior in suggestionService.ts).
      suggestion.rank = index + 1;
      items.push({ kind: 'suggestion', score: Number(row.score), data: suggestion });
      suggestions.push(suggestion);
    }
  });

  return { items, matches, suggestions };
}

/**
 * Signed-out "Nearby" carousel pool. One call to the `get_nearby_public_matches`
 * RPC — top `matchLimit` joinable public matches near the point for the sport,
 * ranked server-side (proximity + urgency + spots-left) and returned as full
 * MatchWithDetails JSONB so the carousel and detail sheet render with no
 * follow-up fetch.
 *
 * Matches-only by design: anon users can't act on invite-suggestions without
 * signing in, and dropping the suggestion pool keeps `get_match_suggestions_anon`
 * — the worst-performing anon RPC — off the signed-out path. Replaces the legacy
 * `composeJustForYou` anon orchestration (search_matches_nearby + match-detail
 * SELECT + JS scoring + suggestion merge).
 */
export async function getNearbyPublicMatches(
  input: ComposeJustForYouInput
): Promise<ComposeJustForYouResult> {
  const builder = supabase.rpc('get_nearby_public_matches', {
    p_sport_id: input.sportId,
    p_latitude: input.latitude,
    p_longitude: input.longitude,
    p_max_distance_km: input.maxDistanceKm,
    p_user_gender: input.userGender ?? null,
    p_limit: input.matchLimit ?? 5,
  });
  if (input.signal) builder.abortSignal(input.signal);
  const { data, error } = await builder;

  if (input.signal?.aborted) {
    // Throw rather than returning empty — React Query treats AbortError
    // specially and won't write the empty payload to the (persisted) cache.
    throw new DOMException('Aborted', 'AbortError');
  }
  if (error) {
    throw error;
  }

  const rows = (data ?? []) as { score: number; match_payload: Record<string, unknown> }[];

  const items: JustForYouItem[] = [];
  const matches: Scorable[] = [];
  for (const row of rows) {
    const match = row.match_payload as unknown as Scorable;
    items.push({ kind: 'match', score: Number(row.score), data: match });
    matches.push(match);
  }

  // Matches-only: no suggestion pool on the signed-out path.
  return { items, matches, suggestions: [] };
}
