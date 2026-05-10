/**
 * send-morning-digest Edge Function
 *
 * Sends a personalized morning digest email to onboarded users with:
 *   - A known location and at least one sport configured
 *   - Today's digest not yet sent
 *   - email_status = 'ok' (no hard bounces or spam complaints)
 *   - Has not opted out of morning_digest via notification_preference
 *
 * The email is structured as one section per active sport. Each section has
 * up to 5 cards composed by `composeJustForYou` — the same shared composer
 * the mobile Home "Just for you" carousel uses. Top-scored real matches come
 * first; the tail is padded with suggestions when matches < 5. Users with
 * zero content across all sections are skipped and stay eligible for tomorrow.
 *
 * Triggered daily at 12:00 UTC via pg_cron.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { SignJWT } from 'https://esm.sh/jose@5';

import { requireSecretApikey } from '../_shared/auth.ts';
import { reportHeartbeat } from '../_shared/heartbeat.ts';
import { composeJustForYou, type ComposedSuggestion } from '../_shared/justForYouComposer.ts';
import type { Scorable, MatchScoringPreferences } from '../_shared/matchScoring.ts';

import {
  renderMorningDigestEmail,
  type DigestSection,
  type DigestMatch,
  type DigestSuggestion,
} from './template.ts';

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Per-section cap (matches + suggestion padding). */
const MAX_PER_SECTION = 5;

/** Bounded concurrency for the per-user processing loop. */
const USER_CONCURRENCY = 10;
/** Soft deadline; we stop dispatching new users when crossed. */
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

interface ScoringPrefRow {
  gender: string | null;
  preferred_match_type: string | null;
  preferred_match_duration: string | null;
  rating_value: number | null;
  favorite_facility_ids: string[] | null;
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

/**
 * Fetch scoring preferences for one (player, sport) pair. Inlined here so
 * the digest produces the same ranking as Home's "Just for you" carousel,
 * which uses the full set of MatchScoringPreferences.
 */
async function getScoringPreferences(
  supabase: SupabaseClient,
  userId: string,
  sportId: string
): Promise<MatchScoringPreferences> {
  const [playerRow, sportPrefRow, ratingRow, favoritesRow] = await Promise.all([
    supabase.from('player').select('gender, max_travel_distance').eq('id', userId).maybeSingle(),
    supabase
      .from('player_sport')
      .select('preferred_match_type, preferred_match_duration')
      .eq('player_id', userId)
      .eq('sport_id', sportId)
      .maybeSingle(),
    supabase
      .from('player_rating_score')
      .select('rating_score:rating_score_id(value, rating_system:rating_system_id(sport_id))')
      .eq('player_id', userId)
      .limit(50),
    supabase
      .from('player_favorite_facility')
      .select('facility_id')
      .eq('player_id', userId)
      .eq('sport_id', sportId),
  ]);

  type RatingRow = {
    rating_score:
      | Array<{ value: number | null; rating_system: { sport_id: string } | null }>
      | { value: number | null; rating_system: { sport_id: string } | null }
      | null;
  };
  function pickRatingValue(rows: RatingRow[] | null | undefined): number | null {
    if (!rows) return null;
    for (const r of rows) {
      const rs = Array.isArray(r.rating_score) ? r.rating_score[0] : r.rating_score;
      if (!rs) continue;
      const sys = Array.isArray(rs.rating_system) ? rs.rating_system[0] : rs.rating_system;
      if (sys?.sport_id === sportId && rs.value != null) return rs.value;
    }
    return null;
  }

  return {
    playerGender: playerRow.data?.gender ?? null,
    playerRatingValue: pickRatingValue(ratingRow.data as RatingRow[] | null),
    preferredMatchDuration: sportPrefRow.data?.preferred_match_duration ?? null,
    preferredMatchType: sportPrefRow.data?.preferred_match_type ?? null,
    favoriteFacilityIds: ((favoritesRow.data ?? []) as Array<{ facility_id: string }>).map(
      r => r.facility_id
    ),
    maxTravelDistanceKm: playerRow.data?.max_travel_distance ?? undefined,
  };
}

/**
 * Build one section per active sport for the given user. Calls the shared
 * composer for each sport, converts results into the email-friendly shapes,
 * and skips sports that produced zero content.
 */
async function buildSectionsForUser(
  supabase: SupabaseClient,
  user: DigestUser
): Promise<DigestSection[]> {
  const sections: DigestSection[] = [];

  for (const sport of user.sports) {
    const scoringPreferences = await getScoringPreferences(supabase, user.userId, sport.sportId);

    let composed;
    try {
      composed = await composeJustForYou({
        supabase,
        playerId: user.userId,
        sportId: sport.sportId,
        latitude: user.lat,
        longitude: user.lng,
        maxDistanceKm: user.maxTravelKm,
        userGender: scoringPreferences.playerGender,
        scoringPreferences,
        excludeUserIds: [user.userId],
        matchLimit: MAX_PER_SECTION,
      });
    } catch (err) {
      console.warn(
        `[digest] composer failed for ${user.userId} sport ${sport.sportId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      continue;
    }

    const matchItems = composed.matches.map(m => toDigestMatch(m, sport.sportName));
    const suggestionItems = composed.suggestions.map(s =>
      toDigestSuggestion(s, sport.sportId, sport.sportName)
    );

    if (matchItems.length === 0 && suggestionItems.length === 0) continue;

    sections.push({
      sportId: sport.sportId,
      sportName: sport.sportName,
      items: [
        ...matchItems.map(data => ({ kind: 'match' as const, data })),
        ...suggestionItems.map(data => ({ kind: 'suggestion' as const, data })),
      ],
    });
  }

  return sections;
}

/** Convert a Scorable returned by the composer to the email-friendly shape. */
function toDigestMatch(m: Scorable, sportName: string): DigestMatch {
  const format: 'singles' | 'doubles' = m.format === 'doubles' ? 'doubles' : 'singles';
  const totalSpots = format === 'doubles' ? 4 : 2;
  const joinedCount = m.participants?.filter(p => p.status === 'joined').length ?? 0;
  const distKm = m.distance_meters != null ? Math.round(m.distance_meters / 100) / 10 : null;

  return {
    id: m.id,
    match_date: m.match_date ?? '',
    start_time: m.start_time ?? '',
    end_time: m.end_time ?? '',
    sport_name: m.sport?.name ?? sportName,
    facility_name: m.facility?.name ?? '',
    facility_city: m.facility?.city ?? '',
    format,
    join_mode: (m.join_mode as 'direct' | 'request' | null) ?? 'direct',
    player_expectation: m.player_expectation as 'casual' | 'competitive' | 'both' | null,
    is_court_free: m.is_court_free ?? false,
    estimated_cost: m.estimated_cost,
    court_status: m.court_status,
    joined_count: joinedCount,
    total_spots: totalSpots,
    distance_km: distKm,
  };
}

function toDigestSuggestion(
  s: ComposedSuggestion,
  sportId: string,
  sportName: string
): DigestSuggestion {
  return {
    opponent_id: s.opponentId,
    opponent_first_name: s.opponentFirstName,
    opponent_last_name: s.opponentLastName,
    opponent_rating_label: s.opponentRatingLabel,
    opponent_reputation_tier: s.opponentReputationTier,
    opponent_badge_status: s.opponentBadgeStatus,
    sport_id: sportId,
    sport_name: sportName,
    facility_id: s.facilityId,
    facility_name: s.facilityName,
    facility_city: s.facilityCity,
    match_date: s.matchDate,
    start_time: s.startTime,
    end_time: s.endTime,
  };
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
  sections: DigestSection[],
  appUrl: string,
  unsubscribeUrl: string
): Promise<SendResult> {
  const { subject, html } = renderMorningDigestEmail({
    firstName: user.firstName,
    locale: user.locale,
    sections,
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
      const sections = await buildSectionsForUser(supabase, user);

      // Hard skip when there's nothing relevant to send across any sport. Don't
      // bump last_morning_digest_sent_at so the user stays eligible tomorrow.
      if (sections.length === 0) {
        emailsSkippedNoContent++;
        console.log(`[digest] Skip ${user.userId}: no relevant content`);
        return;
      }

      const unsubscribeUrl = await buildUnsubscribeUrl(appUrl, user.userId, jwtSecret);
      const result = await sendDigestEmail(
        resend,
        fromEmail,
        user,
        sections,
        appUrl,
        unsubscribeUrl
      );

      if (!result.ok) {
        errors.push(`Resend failed for user ${user.userId}: ${result.error}`);
        console.error(`[digest] Resend error for user ${user.userId}: ${result.error}`);
        return;
      }

      // Per-user idempotency: stamp the timestamp AND log the send before
      // counting as successful. If the function dies mid-batch, the next run
      // skips already-sent users.
      const sentAt = new Date().toISOString();
      const totalItems = sections.reduce((acc, s) => acc + s.items.length, 0);
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
              feed_size: totalItems,
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
      const matchTotal = sections.reduce(
        (acc, s) => acc + s.items.filter(i => i.kind === 'match').length,
        0
      );
      const suggestionTotal = sections.reduce(
        (acc, s) => acc + s.items.filter(i => i.kind === 'suggestion').length,
        0
      );
      console.log(
        `[digest] Sent to ${user.email} (sections=${sections.length}, items=${totalItems}, matches=${matchTotal}, suggestions=${suggestionTotal})`
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
const jwtSecret = Deno.env.get('JWT_SECRET') ?? Deno.env.get('SUPABASE_JWT_SECRET');
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

  const authError = requireSecretApikey(req);
  if (authError) return authError;

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
