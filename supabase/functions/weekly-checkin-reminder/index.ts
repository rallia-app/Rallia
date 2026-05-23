/**
 * weekly-checkin-reminder Edge Function
 *
 * Fires every hour via pg_cron (see 20260521120200_register_checkin_crons.sql).
 * On each tick, identifies players who:
 *   1. Are currently around 9:00 local time on Monday (their timezone)
 *   2. Have at least one active player_availability row
 *   3. Have no player_weekly_checkin row for the current ISO week
 *   4. Have not received a weekly-checkin-reminder push this week
 *
 * Sends a single notification per eligible player via the existing
 * `insert_notifications` RPC. The notification deep-links to
 * `rallia://weekly-checkin` so tapping opens the wizard modal directly.
 *
 * Idempotency: the existing-notification check guards against duplicate
 * pushes if the cron fires twice in the same hour. Re-running on the same
 * data is a no-op.
 *
 * ## Response Format
 * Success (200):
 *   { "success": true, "notificationsSent": N, "errors": [], "duration_ms": X }
 * Error (500):
 *   { "success": false, "error": "...", "duration_ms": X }
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { requireSecretApikey } from '../_shared/auth.ts';
import { reportHeartbeat } from '../_shared/heartbeat.ts';

// =============================================================================
// CONFIG
// =============================================================================

// We fire at minute :10 of each hour (see cron registration). Players are
// considered "Monday 9am local" if their current local hour is 9 and local
// day-of-week is Monday.
const TARGET_LOCAL_HOUR = 9;
const TARGET_LOCAL_DOW = 1; // Monday (ISO day; Sunday = 0 in JS, ISO = 7)

// Batch size when inserting notifications.
const BATCH_SIZE = 100;

// =============================================================================
// SUPABASE
// =============================================================================

const supabase: SupabaseClient = createClient(
  Deno.env.get('SUPABASE_URL'),
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
);

// =============================================================================
// TYPES
// =============================================================================

interface EligiblePlayer {
  player_id: string;
  preferred_locale: string;
  timezone: string;
}

interface NotificationInput {
  user_id: string;
  type: string;
  target_id: string | null;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  priority: string;
}

// =============================================================================
// HELPERS
// =============================================================================

/** Monday of the current ISO week (UTC). */
function currentWeekStartUtc(): string {
  const now = new Date();
  const day = now.getUTCDay(); // Sun=0, Mon=1, ..., Sat=6
  const diff = day === 0 ? 6 : day - 1; // shift so Monday is 0
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff)
  );
  return monday.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Check if a given timezone is currently at Monday ~9am local time.
 * Uses Intl.DateTimeFormat (Deno-supported) to resolve the player's local
 * day-of-week + hour without any tz library.
 */
function isAtMondayNineAm(tz: string): boolean {
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      hour12: false,
      weekday: 'short',
    });
    const parts = fmt.formatToParts(now);
    const hourPart = parts.find(p => p.type === 'hour')?.value;
    const weekdayPart = parts.find(p => p.type === 'weekday')?.value;
    if (!hourPart || !weekdayPart) return false;
    const hour = parseInt(hourPart, 10);
    return weekdayPart === 'Mon' && hour === TARGET_LOCAL_HOUR;
  } catch {
    // Bad timezone string — fall back to UTC. Skip the player on this tick.
    return false;
  }
}

/**
 * Build the "Time for your weekly check-in 🐿️" notification payload.
 * Localized via the player's preferred_locale; matches the banner copy.
 */
function buildNotification(player: EligiblePlayer): NotificationInput {
  const isFr = player.preferred_locale?.startsWith('fr');
  const title = isFr ? "C'est l'heure du check-in hebdo 🐿️" : 'Time for your weekly check-in 🐿️';
  const body = isFr
    ? 'Fixe ton objectif et confirme tes dispos pour la semaine.'
    : "Set your goal and confirm when you're free this week.";

  return {
    user_id: player.player_id,
    type: 'weekly_checkin_reminder',
    target_id: null,
    title,
    body,
    payload: {
      deepLink: 'rallia://weekly-checkin',
      weekStartDate: currentWeekStartUtc(),
    },
    priority: 'default',
  };
}

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Players who: have active availability + no check-in this week + no
 * weekly-checkin-reminder notification this week.
 *
 * We do this as a single query so we don't N+1 over players. The week-start
 * date filter on `notification.created_at` is approximate (any notification
 * of this type in the last 6 days) — good enough for idempotency.
 */
async function fetchEligiblePlayers(): Promise<EligiblePlayer[]> {
  const weekStart = currentWeekStartUtc();

  const { data, error } = await supabase.from('player').select(
    `
        id,
        timezone,
        profile:profile!inner(preferred_locale)
      `
  );

  if (error) {
    console.error('fetchEligiblePlayers query failed', error);
    throw error;
  }

  // Filter in JS: active availability + no check-in this week + no reminder this week.
  // (Doing this in one SQL would be cleaner; deferring to a dedicated RPC if/when
  // the cron's row count makes the JS filter slow.)
  const candidates = (data ?? []) as Array<{
    id: string;
    timezone: string | null;
    profile: { preferred_locale: string | null }[] | { preferred_locale: string | null } | null;
  }>;

  // Pre-filter by Monday-9am local before any per-player query.
  const atMonday9am = candidates.filter(p => isAtMondayNineAm(p.timezone ?? 'UTC'));
  if (atMonday9am.length === 0) return [];

  // For each candidate, check (a) active availability and (b) no check-in row,
  // (c) no existing reminder notification this week.
  const playerIds = atMonday9am.map(p => p.id);

  const [availRes, checkinRes, notifRes] = await Promise.all([
    supabase
      .from('player_availability')
      .select('player_id')
      .in('player_id', playerIds)
      .eq('is_active', true),
    supabase
      .from('player_weekly_checkin')
      .select('player_id')
      .in('player_id', playerIds)
      .eq('week_start_date', weekStart),
    supabase
      .from('notification')
      .select('user_id')
      .in('user_id', playerIds)
      .eq('type', 'weekly_checkin_reminder')
      .gte('created_at', `${weekStart}T00:00:00Z`),
  ]);

  if (availRes.error) throw availRes.error;
  if (checkinRes.error) throw checkinRes.error;
  if (notifRes.error) throw notifRes.error;

  const hasAvail = new Set(availRes.data?.map(r => r.player_id) ?? []);
  const hasCheckin = new Set(checkinRes.data?.map(r => r.player_id) ?? []);
  const alreadyNotified = new Set(notifRes.data?.map(r => r.user_id) ?? []);

  return atMonday9am
    .filter(p => hasAvail.has(p.id))
    .filter(p => !hasCheckin.has(p.id))
    .filter(p => !alreadyNotified.has(p.id))
    .map(p => {
      const profile = Array.isArray(p.profile) ? p.profile[0] : p.profile;
      return {
        player_id: p.id,
        preferred_locale: profile?.preferred_locale ?? 'en-US',
        timezone: p.timezone ?? 'UTC',
      };
    });
}

// =============================================================================
// NOTIFICATION DISPATCH
// =============================================================================

async function sendNotificationsBatch(notifications: NotificationInput[]): Promise<void> {
  if (notifications.length === 0) return;

  const { error } = await supabase.rpc('insert_notifications', {
    p_notifications: notifications,
  });
  if (error) {
    console.error('insert_notifications failed', error);
    throw new Error(`insert_notifications failed: ${error.message}`);
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function processReminders(): Promise<{ sent: number; errors: string[] }> {
  const errors: string[] = [];
  let eligible: EligiblePlayer[];

  try {
    eligible = await fetchEligiblePlayers();
  } catch (err) {
    return { sent: 0, errors: [`fetchEligiblePlayers: ${err}`] };
  }

  if (eligible.length === 0) {
    console.log('weekly-checkin-reminder: no eligible players this tick');
    return { sent: 0, errors };
  }

  console.log(`weekly-checkin-reminder: ${eligible.length} eligible player(s)`);

  // Batch the inserts.
  const notifications = eligible.map(buildNotification);
  for (let i = 0; i < notifications.length; i += BATCH_SIZE) {
    const slice = notifications.slice(i, i + BATCH_SIZE);
    try {
      await sendNotificationsBatch(slice);
    } catch (err) {
      errors.push(`batch ${i}: ${err}`);
    }
  }

  return { sent: notifications.length - errors.length * BATCH_SIZE, errors };
}

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

  const startTime = Date.now();
  console.log('weekly-checkin-reminder: starting');

  try {
    const result = await processReminders();
    const summary = {
      success: true,
      notificationsSent: result.sent,
      errors: result.errors,
      duration_ms: Date.now() - startTime,
    };

    const status = result.errors.length > 0 && result.sent === 0 ? 500 : 200;
    if (status === 200) {
      await reportHeartbeat(Deno.env.get('BETTERSTACK_HEARTBEAT_WEEKLY_CHECKIN_REMINDER'));
    }

    return new Response(JSON.stringify(summary), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('weekly-checkin-reminder failed', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - startTime,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
