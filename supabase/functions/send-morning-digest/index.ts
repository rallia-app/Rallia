/**
 * send-morning-digest Edge Function
 *
 * Sends a personalized morning digest email to onboarded users with:
 *   - A known location and at least one sport configured
 *   - Today's digest not yet sent
 *   - email_status = 'ok' (no hard bounces or spam complaints)
 *   - Has not opted out of morning_digest via notification_preference
 *
 * The email shows a single chronologically-sorted feed of up to 6 cards
 * mixing real upcoming public matches and matchup suggestions (each with a
 * concrete picked slot via `get_morning_digest_suggestions`). Users with no
 * relevant content are skipped; their `last_morning_digest_sent_at` is left
 * untouched so they remain eligible for the next run.
 *
 * Triggered daily at 12:00 UTC via pg_cron.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { SignJWT } from 'https://esm.sh/jose@5';

import { reportHeartbeat } from '../_shared/heartbeat.ts';

import {
  renderMorningDigestEmail,
  type DigestFeedItem,
  type DigestMatch,
  type DigestSuggestion,
} from './template.ts';

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Total cards in the unified feed (matches + suggestions interleaved). */
const MAX_FEED = 6;
/** Per-sport upper bound on suggestions returned by the new RPC. */
const MAX_SUGGESTIONS_PER_SPORT = 3;
/** Per-sport upper bound on matches; we fetch a bit extra for cross-sport dedup. */
const MATCHES_FETCH_LIMIT = MAX_FEED * 3;

/** Bounded concurrency for the per-user processing loop (S1). */
const USER_CONCURRENCY = 10;
/** Soft deadline; we stop dispatching new users when crossed (S2). */
const MAX_RUN_MS = 240_000;

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
  created_by: string;
  // Supabase-js types nested foreign-key selects as arrays, not single objects.
  sport: Array<{ name: string }> | { name: string } | null;
  facility: Array<{ name: string; city: string }> | { name: string; city: string } | null;
  participants: Array<{ status: string; player_id: string }> | null;
}

/** Active-participation statuses that should disqualify a match from the
 *  digest (the user is already in some way committed). Mirrors the mobile
 *  PublicMatches client-side filter. */
const INVOLVED_STATUSES = new Set(['joined', 'requested', 'pending', 'waitlisted']);

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
  const distanceMap = new Map<string, number>();

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
      'id, match_date, start_time, end_time, format, join_mode, player_expectation, is_court_free, estimated_cost, court_status, created_by, sport:sport_id(name), facility:facility_id(name, city), participants:match_participant(status, player_id)'
    )
    .in('id', matchIds)
    .order('match_date', { ascending: true })
    .order('start_time', { ascending: true });

  if (detailError) {
    console.warn(
      `[digest] match detail fetch failed for user ${user.userId}: ${detailError.message}`
    );
    return [];
  }

  const rows = (details ?? []) as unknown as MatchDetailRow[];
  const out: DigestMatch[] = [];
  for (const m of rows) {
    // Skip matches the user can't act on:
    //   1. They created it (don't email someone their own match).
    //   2. They're already involved (joined/requested/pending/waitlisted).
    //   3. The match is full (no joinable spots).
    if (m.created_by === user.userId) continue;
    const userInvolved = (m.participants ?? []).some(
      p => p.player_id === user.userId && p.status != null && INVOLVED_STATUSES.has(p.status)
    );
    if (userInvolved) continue;

    const format = (m.format as 'singles' | 'doubles') ?? 'singles';
    const totalSpots = format === 'doubles' ? 4 : 2;
    const joinedCount = (m.participants ?? []).filter(p => p.status === 'joined').length;
    if (joinedCount >= totalSpots) continue;

    const distMeters = distanceMap.get(m.id);
    const distKm = distMeters != null ? Math.round(distMeters / 100) / 10 : null;
    const sportRow = pickFirst(m.sport);
    const facilityRow = pickFirst(m.facility);
    out.push({
      id: m.id,
      match_date: m.match_date,
      start_time: m.start_time,
      end_time: m.end_time,
      sport_name: sportRow?.name ?? 'Sport',
      facility_name: facilityRow?.name ?? '',
      facility_city: facilityRow?.city ?? '',
      format,
      join_mode: (m.join_mode as 'direct' | 'request') ?? 'direct',
      player_expectation: m.player_expectation as 'casual' | 'competitive' | 'both' | null,
      is_court_free: m.is_court_free ?? false,
      estimated_cost: m.estimated_cost,
      court_status: m.court_status,
      joined_count: joinedCount,
      total_spots: totalSpots,
      distance_km: distKm,
    });
  }
  return out;
}

async function getSuggestionsForUser(
  supabase: SupabaseClient,
  user: DigestUser
): Promise<DigestSuggestion[]> {
  const suggestionMap = new Map<string, DigestSuggestion & { score: number }>();

  for (const sport of user.sports) {
    const { data, error } = await supabase.rpc('get_morning_digest_suggestions', {
      p_player_id: user.userId,
      p_sport_id: sport.sportId,
      p_limit: MAX_SUGGESTIONS_PER_SPORT,
    });

    if (error) {
      console.warn(
        `[digest] get_morning_digest_suggestions error for user ${user.userId} sport ${sport.sportId}: ${error.message}`
      );
      continue;
    }

    for (const row of (data ?? []) as DigestSuggestionRow[]) {
      // Cross-sport dedup: keep the highest-scored slot per opponent.
      const existing = suggestionMap.get(row.opponent_id);
      const score = Number(row.matchup_score);
      if (!existing || score > existing.score) {
        suggestionMap.set(row.opponent_id, {
          opponent_id: row.opponent_id,
          opponent_first_name: row.opponent_first_name,
          opponent_last_name: row.opponent_last_name,
          opponent_rating_label: row.opponent_rating_label,
          opponent_reputation_tier: row.opponent_reputation_tier,
          opponent_badge_status: row.opponent_badge_status,
          sport_id: sport.sportId,
          sport_name: sport.sportName,
          facility_id: row.facility_id,
          facility_name: row.facility_name,
          facility_city: row.facility_city,
          match_date: row.match_date,
          start_time: row.start_time,
          end_time: row.end_time,
          score,
        });
      }
    }
  }

  return Array.from(suggestionMap.values()).map(({ score: _score, ...s }) => s);
}

// =============================================================================
// FEED ASSEMBLY
// =============================================================================

function buildFeed(matches: DigestMatch[], suggestions: DigestSuggestion[]): DigestFeedItem[] {
  const items: DigestFeedItem[] = [];

  for (const match of matches) {
    const sortTime = Date.parse(`${match.match_date}T${match.start_time}`);
    if (!Number.isFinite(sortTime)) continue;
    items.push({ kind: 'match', sortTime, data: match });
  }
  for (const suggestion of suggestions) {
    const sortTime = Date.parse(`${suggestion.match_date}T${suggestion.start_time}`);
    if (!Number.isFinite(sortTime)) continue;
    items.push({ kind: 'suggestion', sortTime, data: suggestion });
  }

  items.sort((a, b) => a.sortTime - b.sortTime);
  return items.slice(0, MAX_FEED);
}

// =============================================================================
// UNSUBSCRIBE TOKEN
// =============================================================================

const ENC = new TextEncoder();

async function buildUnsubscribeUrl(
  appUrl: string,
  userId: string,
  jwtSecret: string
): Promise<string> {
  const token = await new SignJWT({ aud: 'morning_digest_unsub' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(ENC.encode(jwtSecret));
  return `${appUrl}/api/digest/unsubscribe?token=${encodeURIComponent(token)}`;
}

// =============================================================================
// EMAIL SENDING
// =============================================================================

interface SendResult {
  ok: boolean;
  resendId?: string;
  error?: string;
}

async function sendDigestEmail(
  resend: Resend,
  fromEmail: string,
  user: DigestUser,
  feed: DigestFeedItem[],
  appUrl: string,
  unsubscribeUrl: string
): Promise<SendResult> {
  const { subject, html } = renderMorningDigestEmail({
    firstName: user.firstName,
    locale: user.locale,
    feed,
    appUrl,
    unsubscribeUrl,
  });

  const { data, error } = await resend.emails.send({
    from: fromEmail,
    to: user.email,
    subject,
    html,
    headers: {
      // RFC 8058 one-click unsubscribe — Gmail / Apple Mail surface this in
      // the message header so users opt out without leaving the inbox.
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, resendId: data?.id };
}

// =============================================================================
// CONCURRENCY HELPER
// =============================================================================

/**
 * Bounded parallel-map. Runs `fn` for every item in `items` with at most
 * `concurrency` in flight at once. Returns once all settle. Each item is
 * processed in its own try/catch — handler errors don't abort the pool.
 */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(concurrency, items.length); w++) {
    workers.push(
      (async () => {
        while (true) {
          const i = cursor++;
          if (i >= items.length) return;
          await fn(items[i], i);
        }
      })()
    );
  }
  await Promise.all(workers);
}

// =============================================================================
// MAIN PROCESSING
// =============================================================================

interface ProcessSummary {
  emailsSent: number;
  emailsSkippedNoContent: number;
  errors: string[];
  deferredUsers: number;
  durationMs: number;
  p95UserMs: number;
}

async function processDigests(
  supabase: SupabaseClient,
  resend: Resend,
  fromEmail: string,
  appUrl: string,
  jwtSecret: string,
  startTime: number
): Promise<ProcessSummary> {
  const users = await getEligibleUsers(supabase);
  console.log(
    `[digest] Found ${users.length} eligible user-sport combinations → ${
      new Set(users.map(u => u.userId)).size
    } users`
  );

  let emailsSent = 0;
  let emailsSkippedNoContent = 0;
  let deferredUsers = 0;
  const errors: string[] = [];
  const userTimings: number[] = [];

  let stopDispatching = false;

  await runWithConcurrency(users, USER_CONCURRENCY, async user => {
    if (stopDispatching) {
      deferredUsers++;
      return;
    }
    if (Date.now() - startTime > MAX_RUN_MS) {
      stopDispatching = true;
      deferredUsers++;
      return;
    }

    const userStart = Date.now();
    try {
      const [matches, suggestions] = await Promise.all([
        getPublicMatchesForUser(supabase, user),
        getSuggestionsForUser(supabase, user),
      ]);

      const feed = buildFeed(matches, suggestions);

      // Hard skip when there's nothing relevant to send. Don't bump
      // last_morning_digest_sent_at so the user stays eligible for tomorrow.
      if (feed.length === 0) {
        emailsSkippedNoContent++;
        console.log(`[digest] Skip ${user.userId}: no relevant content`);
        return;
      }

      const unsubscribeUrl = await buildUnsubscribeUrl(appUrl, user.userId, jwtSecret);
      const result = await sendDigestEmail(resend, fromEmail, user, feed, appUrl, unsubscribeUrl);

      if (!result.ok) {
        errors.push(`Resend failed for user ${user.userId}: ${result.error}`);
        console.error(`[digest] Resend error for user ${user.userId}: ${result.error}`);
        return;
      }

      // Per-user idempotency: stamp the timestamp AND log the send before
      // counting as successful. If the function dies mid-batch, the next run
      // skips already-sent users.
      const sentAt = new Date().toISOString();
      const updates = await Promise.all([
        supabase
          .from('profile')
          .update({ last_morning_digest_sent_at: sentAt })
          .eq('id', user.userId),
        result.resendId
          ? supabase.from('digest_send_log').insert({
              user_id: user.userId,
              sent_at: sentAt,
              resend_id: result.resendId,
              feed_size: feed.length,
              status: 'sent',
            })
          : Promise.resolve({ error: null }),
      ]);
      const updateError = updates[0].error || updates[1].error;
      if (updateError) {
        // Non-fatal — the email already went out. Worst case the user gets a
        // duplicate tomorrow, which the date check on the next run prevents.
        console.warn(
          `[digest] Failed to mark sent for user ${user.userId}: ${updateError.message}`
        );
      }

      emailsSent++;
      console.log(
        `[digest] Sent to ${user.email} (feed=${feed.length}, matches=${matches.length}, suggestions=${suggestions.length})`
      );
    } catch (err) {
      const msg = `Error processing user ${user.userId}: ${
        err instanceof Error ? err.message : String(err)
      }`;
      console.error(`[digest] ${msg}`);
      errors.push(msg);
    } finally {
      userTimings.push(Date.now() - userStart);
    }
  });

  const durationMs = Date.now() - startTime;
  const p95UserMs = percentile(userTimings, 0.95);

  return {
    emailsSent,
    emailsSkippedNoContent,
    errors,
    deferredUsers,
    durationMs,
    p95UserMs,
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

// =============================================================================
// ENTRY POINT
// =============================================================================

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const resendApiKey = Deno.env.get('RESEND_API_KEY');
const fromEmail = Deno.env.get('FROM_EMAIL');
const jwtSecret = Deno.env.get('SUPABASE_JWT_SECRET');
const appUrl =
  Deno.env.get('NEXT_PUBLIC_BASE_URL') ??
  Deno.env.get('NEXT_PUBLIC_SITE_URL') ??
  'https://rallia.app';

if (!resendApiKey) throw new Error('RESEND_API_KEY is required');
if (!fromEmail) throw new Error('FROM_EMAIL is required');
if (!jwtSecret) throw new Error('SUPABASE_JWT_SECRET is required for unsubscribe tokens');

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
    const result = await processDigests(supabase, resend, fromEmail, appUrl, jwtSecret, startTime);

    console.log(
      `[digest] Done: ${result.emailsSent} sent, ${result.emailsSkippedNoContent} skipped (empty feed), ${result.deferredUsers} deferred, ${result.errors.length} errors, ${result.durationMs}ms, p95=${result.p95UserMs}ms`
    );

    const httpStatus = result.errors.length > 0 && result.emailsSent === 0 ? 500 : 200;

    if (httpStatus === 200) {
      await reportHeartbeat(Deno.env.get('BETTERSTACK_HEARTBEAT_MORNING_DIGEST'));
    }

    return new Response(JSON.stringify({ success: httpStatus === 200, ...result }), {
      status: httpStatus,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[digest] Fatal error:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
