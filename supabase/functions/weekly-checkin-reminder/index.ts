/**
 * weekly-checkin-reminder Edge Function
 *
 * Fires every hour via pg_cron (see 20260521120200_register_checkin_crons.sql).
 * On each tick it asks `players_needing_checkin_reminder()` for players whose
 * rolling check-in is DUE — i.e. they're past their availability_covered_through
 * date — at ~9am their local time, with active availability, and not already
 * reminded within the dedupe window. Each gets one push that deep-links to
 * `rallia://weekly-checkin` so tapping opens the wizard.
 *
 * The targeting + timezone + dedupe logic all live in the RPC (consistent with
 * players_needing_streak_reset), so this function just sends the notifications.
 *
 * ## Response Format
 * Success (200): { "success": true, "notificationsSent": N, "errors": [], "duration_ms": X }
 * Error (500):   { "success": false, "error": "...", "duration_ms": X }
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { requireSecretApikey } from '../_shared/auth.ts';
import { reportHeartbeat } from '../_shared/heartbeat.ts';

// =============================================================================
// CONFIG
// =============================================================================

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

/**
 * Build the "Time to check in 🐿️" notification payload. Localized via the
 * player's preferred_locale; matches the home availability banner copy.
 */
function buildNotification(player: EligiblePlayer): NotificationInput {
  const isFr = player.preferred_locale?.startsWith('fr');
  const title = isFr ? "C'est l'heure de ton check-in 🐿️" : 'Time to check in 🐿️';
  const body = isFr
    ? 'Fixe ton objectif et confirme tes dispos pour les prochains jours.'
    : "Set your goal and confirm when you're free over the next few days.";

  return {
    user_id: player.player_id,
    // Valid notification_type_enum value. The old 'weekly_checkin_reminder'
    // was NOT a member of the enum, so the previous reminder silently no-op'd.
    type: 'availability_refresh_reminder',
    target_id: null,
    title,
    body,
    payload: {
      deepLink: 'rallia://weekly-checkin',
    },
    priority: 'default',
  };
}

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Players whose rolling check-in is due this tick. All targeting (past
 * coverage + ~9am local + active availability + dedupe) is done in the RPC.
 */
async function fetchEligiblePlayers(): Promise<EligiblePlayer[]> {
  const { data, error } = await supabase.rpc('players_needing_checkin_reminder');
  if (error) {
    console.error('players_needing_checkin_reminder RPC failed', error);
    throw error;
  }
  return (data ?? []) as EligiblePlayer[];
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

  const notifications = eligible.map(buildNotification);
  let sent = 0;
  for (let i = 0; i < notifications.length; i += BATCH_SIZE) {
    const slice = notifications.slice(i, i + BATCH_SIZE);
    try {
      await sendNotificationsBatch(slice);
      sent += slice.length;
    } catch (err) {
      errors.push(`batch ${i}: ${err}`);
    }
  }

  return { sent, errors };
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
        error: 'Internal server error',
        duration_ms: Date.now() - startTime,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
