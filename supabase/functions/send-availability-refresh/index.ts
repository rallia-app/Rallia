/**
 * send-availability-refresh Edge Function
 *
 * Sends a weekly "confirm your week" push notification to onboarded users
 * whose availability data has gone stale (>14 days since last_confirmed_at,
 * or never confirmed under the 6-block model). Tapping the push deep-links
 * to the player-availabilities overlay where a no-op "Save" tap refreshes
 * last_confirmed_at — closing the loop.
 *
 * Eligibility comes entirely from get_availability_refresh_eligible_users()
 * (defined in 20260515220200_availability_refresh_cron). The RPC already
 * filters out users nudged in the past 6 days, so this function does not
 * need its own dedup pass.
 *
 * Triggered weekly at Monday 14:00 UTC by pg_cron.
 *
 * ## Response Format
 *
 * Success (200):
 * { "success": true, "notificationsSent": N, "errors": [], "duration_ms": M }
 *
 * Error (500):
 * { "success": false, "error": "...", "duration_ms": M }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { requireSecretApikey } from '../_shared/auth.ts';
import { reportHeartbeat } from '../_shared/heartbeat.ts';

// =============================================================================
// TYPES
// =============================================================================

interface EligibleUserRow {
  user_id: string;
  email: string;
  first_name: string | null;
  preferred_locale: string | null;
  most_recent_confirmed_at: string | null;
}

interface NotificationInput {
  user_id: string;
  type: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  priority: string;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const BATCH_SIZE = 100;

// =============================================================================
// SUPABASE CLIENT
// =============================================================================

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// =============================================================================
// COPY (inline — short enough that a full i18n round-trip per user isn't worth it)
// =============================================================================

function buildCopy(locale: string): { title: string; body: string } {
  if (locale.startsWith('fr')) {
    return {
      title: 'Confirmez votre semaine',
      body: 'Mettez à jour vos disponibilités pour rester visible aux bons joueurs.',
    };
  }
  return {
    title: 'Confirm your week',
    body: 'Refresh your availability so we can suggest matches that actually fit.',
  };
}

// =============================================================================
// CORE
// =============================================================================

async function getEligibleUsers(): Promise<EligibleUserRow[]> {
  const { data, error } = await supabase.rpc('get_availability_refresh_eligible_users');
  if (error) {
    throw new Error(`get_availability_refresh_eligible_users failed: ${error.message}`);
  }
  return (data ?? []) as EligibleUserRow[];
}

function buildNotification(user: EligibleUserRow): NotificationInput {
  const locale = user.preferred_locale ?? 'en-US';
  const copy = buildCopy(locale);

  return {
    user_id: user.user_id,
    type: 'availability_refresh_reminder',
    title: copy.title,
    body: copy.body,
    payload: {
      deeplink: 'rallia://profile/availability',
      mostRecentConfirmedAt: user.most_recent_confirmed_at,
    },
    priority: 'normal',
  };
}

async function sendNotificationsBatch(notifications: NotificationInput[]): Promise<void> {
  if (notifications.length === 0) return;

  const { error } = await supabase.rpc('insert_notifications', {
    p_notifications: notifications,
  });

  if (error) {
    throw new Error(`insert_notifications failed: ${error.message}`);
  }
}

async function markRefreshSent(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;

  const { error } = await supabase
    .from('profile')
    .update({ last_availability_refresh_sent_at: new Date().toISOString() })
    .in('id', userIds);

  if (error) {
    // Notifications already sent — log but don't throw. The dedup window
    // in get_availability_refresh_eligible_users will recover next week if
    // this update silently failed.
    console.error('Failed to mark availability refresh sent:', error);
  }
}

async function processRefreshNotifications(): Promise<{ sent: number; errors: string[] }> {
  const users = await getEligibleUsers();
  console.log(`Found ${users.length} users eligible for availability refresh nudge`);

  if (users.length === 0) {
    return { sent: 0, errors: [] };
  }

  const errors: string[] = [];
  let totalSent = 0;

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);
    const notifications = batch.map(buildNotification);
    const userIds = batch.map(u => u.user_id);

    try {
      await sendNotificationsBatch(notifications);
      await markRefreshSent(userIds);
      totalSent += notifications.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Batch ${i}–${i + batch.length} failed:`, message);
      errors.push(message);
    }
  }

  return { sent: totalSent, errors };
}

// =============================================================================
// HANDLER
// =============================================================================

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

  console.log('Starting availability refresh job...');
  const startTime = Date.now();

  try {
    const result = await processRefreshNotifications();

    const summary = {
      success: true,
      notificationsSent: result.sent,
      errors: result.errors,
      duration_ms: Date.now() - startTime,
    };

    console.log(`Availability refresh job complete: ${result.sent} notifications sent`);

    const httpStatus = result.errors.length > 0 && result.sent === 0 ? 500 : 200;

    if (httpStatus === 200) {
      await reportHeartbeat(Deno.env.get('BETTERSTACK_HEARTBEAT_AVAILABILITY_REFRESH'));
    }

    return new Response(JSON.stringify(summary), {
      status: httpStatus,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Availability refresh job failed:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration_ms: Date.now() - startTime,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
});
