/**
 * send-morning-digest Edge Function
 *
 * Sends a personalized morning digest email to all onboarded users who have:
 *   - A known location (for nearby match lookup)
 *   - At least one sport configured
 *   - Not yet received today's digest
 *
 * Each email contains:
 *   - Up to 3 upcoming public matches near the user (next 7 days)
 *   - Up to 3 matchup suggestions (scored opponents)
 *
 * Users with zero matches AND zero suggestions are skipped (no empty emails).
 *
 * Triggered daily at 12:00 UTC (8 AM ET summer) via pg_cron.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

import { reportHeartbeat } from '../_shared/heartbeat.ts';

import { renderMorningDigestEmail, type DigestMatch, type DigestSuggestion } from './template.ts';

// =============================================================================
// CONFIGURATION
// =============================================================================

const MAX_MATCHES = 3;
const MAX_SUGGESTIONS = 3;
const MATCHES_FETCH_LIMIT = MAX_MATCHES * 3; // fetch extra to account for dedup across sports

// =============================================================================
// TYPES
// =============================================================================

interface DigestUserRow {
  user_id: string;
  email: string;
  first_name: string | null;
  preferred_locale: string | null;
  lat: number;
  lng: number;
  max_travel_distance_km: number;
  sport_id: string;
  sport_name: string;
}

interface DigestUser {
  userId: string;
  email: string;
  firstName: string | null;
  locale: string;
  lat: number;
  lng: number;
  maxTravelKm: number;
  sports: Array<{ sportId: string; sportName: string }>;
}

interface PublicMatchRow {
  match_id: string;
  distance_meters: number;
}

interface MatchDetailRow {
  id: string;
  match_date: string;
  start_time: string;
  end_time: string;
  format: string;
  join_mode: string;
  player_expectation: string | null;
  is_court_free: boolean;
  estimated_cost: number | null;
  court_status: string | null;
  sport: { name: string } | null;
  facility: { name: string; city: string } | null;
  participants: Array<{ status: string }> | null;
}

interface SuggestionRow {
  opponent_id: string;
  opponent_first_name: string;
  opponent_last_name: string;
  opponent_rating_label: string | null;
  opponent_badge_status: string | null;
  opponent_reputation_tier: string | null;
  facility_name: string;
  facility_city: string;
  overlapping_days_periods: Array<{ day: string; period: string }> | null;
  matchup_score: number;
}

// =============================================================================
// DATA FETCHING
// =============================================================================

async function getEligibleUsers(supabase: SupabaseClient): Promise<DigestUser[]> {
  const { data, error } = await supabase.rpc('get_morning_digest_eligible_users');
  if (error) throw new Error(`get_morning_digest_eligible_users failed: ${error.message}`);

  const rows = (data ?? []) as DigestUserRow[];
  const userMap = new Map<string, DigestUser>();

  for (const row of rows) {
    if (!userMap.has(row.user_id)) {
      userMap.set(row.user_id, {
        userId: row.user_id,
        email: row.email,
        firstName: row.first_name,
        locale: row.preferred_locale ?? 'en-US',
        lat: row.lat,
        lng: row.lng,
        maxTravelKm: row.max_travel_distance_km,
        sports: [],
      });
    }
    userMap.get(row.user_id).sports.push({
      sportId: row.sport_id,
      sportName: row.sport_name,
    });
  }

  return Array.from(userMap.values());
}

async function getPublicMatchesForUser(
  supabase: SupabaseClient,
  user: DigestUser
): Promise<DigestMatch[]> {
  const matchIds: string[] = [];
  const seenIds = new Set<string>();
  const distanceMap = new Map<string, number>(); // match_id → distance_meters

  for (const sport of user.sports) {
    const { data, error } = await supabase.rpc('search_public_matches', {
      p_latitude: user.lat,
      p_longitude: user.lng,
      p_max_distance_km: user.maxTravelKm,
      p_sport_id: sport.sportId,
      p_date_range: 'week',
      p_limit: MATCHES_FETCH_LIMIT,
      p_offset: 0,
    });

    if (error) {
      console.warn(
        `[digest] search_public_matches error for user ${user.userId} sport ${sport.sportId}: ${error.message}`
      );
      continue;
    }

    for (const row of (data ?? []) as PublicMatchRow[]) {
      if (!seenIds.has(row.match_id)) {
        seenIds.add(row.match_id);
        matchIds.push(row.match_id);
        distanceMap.set(row.match_id, row.distance_meters);
      }
    }
  }

  if (matchIds.length === 0) return [];

  const { data: details, error: detailError } = await supabase
    .from('match')
    .select(
      'id, match_date, start_time, end_time, format, join_mode, player_expectation, is_court_free, estimated_cost, court_status, sport:sport_id(name), facility:facility_id(name, city), participants:match_participant(status)'
    )
    .in('id', matchIds)
    .order('match_date', { ascending: true })
    .order('start_time', { ascending: true })
    .limit(MAX_MATCHES);

  if (detailError) {
    console.warn(
      `[digest] match detail fetch failed for user ${user.userId}: ${detailError.message}`
    );
    return [];
  }

  return ((details ?? []) as MatchDetailRow[]).map(m => {
    const format = (m.format as 'singles' | 'doubles') ?? 'singles';
    const totalSpots = format === 'doubles' ? 4 : 2;
    const joinedCount = (m.participants ?? []).filter(p => p.status === 'joined').length;
    const distMeters = distanceMap.get(m.id);
    const distKm = distMeters != null ? Math.round(distMeters / 100) / 10 : null;
    return {
      id: m.id,
      match_date: m.match_date,
      start_time: m.start_time,
      end_time: m.end_time,
      sport_name: m.sport?.name ?? 'Sport',
      facility_name: m.facility?.name ?? '',
      facility_city: m.facility?.city ?? '',
      format,
      join_mode: (m.join_mode as 'direct' | 'request') ?? 'direct',
      player_expectation: m.player_expectation as 'casual' | 'competitive' | 'both' | null,
      is_court_free: m.is_court_free ?? false,
      estimated_cost: m.estimated_cost,
      court_status: m.court_status,
      joined_count: joinedCount,
      total_spots: totalSpots,
      distance_km: distKm,
    };
  });
}

async function getSuggestionsForUser(
  supabase: SupabaseClient,
  user: DigestUser
): Promise<DigestSuggestion[]> {
  const suggestionMap = new Map<string, DigestSuggestion & { score: number }>();

  for (const sport of user.sports) {
    const { data, error } = await supabase.rpc('get_match_suggestions_scored', {
      p_player_id: user.userId,
      p_sport_id: sport.sportId,
      p_limit: MAX_SUGGESTIONS,
    });

    if (error) {
      console.warn(
        `[digest] get_match_suggestions_scored error for user ${user.userId} sport ${sport.sportId}: ${error.message}`
      );
      continue;
    }

    for (const row of (data ?? []) as SuggestionRow[]) {
      if (!suggestionMap.has(row.opponent_id)) {
        suggestionMap.set(row.opponent_id, {
          opponent_id: row.opponent_id,
          opponent_first_name: row.opponent_first_name,
          opponent_last_name: row.opponent_last_name,
          opponent_rating_label: row.opponent_rating_label,
          opponent_reputation_tier: row.opponent_reputation_tier,
          sport_name: sport.sportName,
          facility_name: row.facility_name,
          facility_city: row.facility_city,
          overlapping_days_periods: row.overlapping_days_periods ?? [],
          score: Number(row.matchup_score),
        });
      }
    }
  }

  return Array.from(suggestionMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUGGESTIONS)
    .map(({ score: _score, ...s }) => s);
}

// =============================================================================
// EMAIL SENDING
// =============================================================================

async function sendDigestEmail(
  resend: Resend,
  fromEmail: string,
  user: DigestUser,
  matches: DigestMatch[],
  suggestions: DigestSuggestion[],
  appUrl: string
): Promise<boolean> {
  const { subject, html } = renderMorningDigestEmail({
    firstName: user.firstName,
    locale: user.locale,
    matches,
    suggestions,
    appUrl,
  });

  const { error } = await resend.emails.send({
    from: fromEmail,
    to: user.email,
    subject,
    html,
  });

  if (error) {
    console.error(`[digest] Resend error for user ${user.userId}: ${error.message}`);
    return false;
  }

  return true;
}

// =============================================================================
// MAIN PROCESSING
// =============================================================================

async function processDigests(
  supabase: SupabaseClient,
  resend: Resend,
  fromEmail: string,
  appUrl: string
): Promise<{ sent: number; skipped: number; errors: string[] }> {
  const users = await getEligibleUsers(supabase);
  console.log(
    `[digest] Found ${users.length} eligible user-sport combinations → ${new Set(users.map(u => u.userId)).size} users`
  );

  const sentUserIds: string[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (const user of users) {
    try {
      const [matches, suggestions] = await Promise.all([
        getPublicMatchesForUser(supabase, user),
        getSuggestionsForUser(supabase, user),
      ]);

      if (matches.length === 0 && suggestions.length === 0) {
        skipped++;
        continue;
      }

      const sent = await sendDigestEmail(resend, fromEmail, user, matches, suggestions, appUrl);
      if (sent) {
        sentUserIds.push(user.userId);
        console.log(
          `[digest] Sent to ${user.email} (${matches.length} matches, ${suggestions.length} suggestions)`
        );
      } else {
        errors.push(`Failed to send to user ${user.userId}`);
      }
    } catch (err) {
      const msg = `Error processing user ${user.userId}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[digest] ${msg}`);
      errors.push(msg);
    }
  }

  // Batch-mark sent users so they're excluded from tomorrow's initial query
  if (sentUserIds.length > 0) {
    const { error: updateError } = await supabase
      .from('profile')
      .update({ last_morning_digest_sent_at: new Date().toISOString() })
      .in('id', sentUserIds);

    if (updateError) {
      console.error(
        `[digest] Failed to update last_morning_digest_sent_at: ${updateError.message}`
      );
      // Non-fatal: worst case users get a duplicate tomorrow, which the date check will prevent
    }
  }

  return { sent: sentUserIds.length, skipped, errors };
}

// =============================================================================
// ENTRY POINT
// =============================================================================

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const resendApiKey = Deno.env.get('RESEND_API_KEY');
const fromEmail = Deno.env.get('FROM_EMAIL');
const appUrl =
  Deno.env.get('NEXT_PUBLIC_BASE_URL') ??
  Deno.env.get('NEXT_PUBLIC_SITE_URL') ??
  'https://rallia.app';

if (!resendApiKey) throw new Error('RESEND_API_KEY is required');
if (!fromEmail) throw new Error('FROM_EMAIL is required');

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const resend = new Resend(resendApiKey);

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  const expectedAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (expectedAnonKey) {
    const token = req.headers
      .get('Authorization')
      ?.replace(/^Bearer\s+/i, '')
      .trim();
    if (!token || token !== expectedAnonKey) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  console.log('[digest] Morning digest job started');
  const startTime = Date.now();

  try {
    const result = await processDigests(supabase, resend, fromEmail, appUrl);

    const summary = {
      success: true,
      emailsSent: result.sent,
      usersSkipped: result.skipped,
      errors: result.errors,
      duration_ms: Date.now() - startTime,
    };

    console.log(
      `[digest] Done: ${result.sent} sent, ${result.skipped} skipped, ${result.errors.length} errors`
    );

    const httpStatus = result.errors.length > 0 && result.sent === 0 ? 500 : 200;

    if (httpStatus === 200) {
      await reportHeartbeat(Deno.env.get('BETTERSTACK_HEARTBEAT_MORNING_DIGEST'));
    }

    return new Response(JSON.stringify(summary), {
      status: httpStatus,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[digest] Fatal error:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        duration_ms: Date.now() - startTime,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
