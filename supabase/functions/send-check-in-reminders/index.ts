/**
 * send-check-in-reminders Edge Function
 *
 * Sends "check-in available" notifications to joined participants
 * ~10 minutes before a match starts.
 *
 * Triggered at :05, :20, :35, :50 by pg_cron — exactly 10 minutes before
 * each possible match start time (:00, :15, :30, :45).
 *
 * ## Response Format
 *
 * Success (200):
 * {
 *   "success": true,
 *   "notificationsSent": 5,
 *   "errors": [],
 *   "duration_ms": 1234
 * }
 *
 * Error (500):
 * {
 *   "success": false,
 *   "error": "Error message",
 *   "duration_ms": 100
 * }
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// =============================================================================
// TYPES
// =============================================================================

interface ParticipantForReminder {
  participant_id: string;
  player_id: string;
  match_id: string;
  match_date: string;
  start_time: string;
  sport_name: string;
  format: string;
  timezone: string;
  location_name: string | null;
}

interface NotificationInput {
  user_id: string;
  type: string;
  target_id: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  priority: string;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

// 2-minute buffer on each side of the 10-minute target
const BUFFER_MINUTES = 2;

// Check-in reminder: matches starting 10 minutes from now (with 2 min buffer)
// Window: 8–12 minutes from now
const WINDOW_START_MINUTES = 10 + BUFFER_MINUTES; // 12 min from now
const WINDOW_END_MINUTES = 10 - BUFFER_MINUTES; // 8 min from now

// Batch size for processing
const BATCH_SIZE = 100;

// =============================================================================
// SUPABASE CLIENT
// =============================================================================

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get user's preferred locale
 */
async function getUserLocale(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data } = await supabase
    .from('profile')
    .select('preferred_locale')
    .eq('id', userId)
    .single();

  return data?.preferred_locale || 'en-US';
}

/**
 * Format start time for display (e.g. "2:30 PM")
 */
function formatStartTime(startTime: string, locale: string): string {
  const [hours, minutes] = startTime.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);

  return date.toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: !locale.startsWith('fr'),
  });
}

/**
 * Build notification input for a participant
 */
async function buildNotificationInput(
  participant: ParticipantForReminder
): Promise<NotificationInput | null> {
  const locale = await getUserLocale(supabase, participant.player_id);

  const sportName = participant.sport_name.toLowerCase();
  const locationName = participant.location_name || '';
  const timeDisplay = formatStartTime(participant.start_time, locale);

  let title: string;
  let body: string;

  if (locale.startsWith('fr')) {
    title = "C'est presque l'heure!";
    body = "Rendez-vous au terrain et enregistrez-vous dans l'app";
  } else {
    title = 'Almost game time!';
    body = 'Head to the court and check in on the app';
  }

  return {
    user_id: participant.player_id,
    type: 'match_check_in_available',
    target_id: participant.match_id,
    title,
    body,
    payload: {
      matchId: participant.match_id,
      sportName,
      locationName,
      timeUntil: '10 minutes',
      matchDate: participant.match_date,
      startTime: participant.start_time,
      format: participant.format,
    },
    priority: 'urgent',
  };
}

/**
 * Get participants needing check-in reminder notification
 */
async function getParticipantsForReminder(): Promise<ParticipantForReminder[]> {
  const now = new Date();

  // Matches starting 8–12 minutes from now
  const windowStart = new Date(now.getTime() + WINDOW_END_MINUTES * 60 * 1000);
  const windowEnd = new Date(now.getTime() + WINDOW_START_MINUTES * 60 * 1000);

  const { data, error } = await supabase.rpc('get_participants_for_check_in_reminder', {
    p_window_start: windowStart.toISOString(),
    p_window_end: windowEnd.toISOString(),
  });

  if (error) {
    console.error('Failed to get participants for check-in reminder:', error);
    throw new Error(`Failed to query participants: ${error.message}`);
  }

  return (data || []) as ParticipantForReminder[];
}

/**
 * Send notifications in batch
 */
async function sendNotificationsBatch(notifications: NotificationInput[]): Promise<void> {
  if (notifications.length === 0) return;

  const { error } = await supabase.rpc('insert_notifications', {
    p_notifications: notifications,
  });

  if (error) {
    console.error('Failed to insert notifications:', error);
    throw new Error(`Failed to insert notifications: ${error.message}`);
  }
}

/**
 * Mark check-in reminders as sent
 */
async function markRemindersSent(participantIds: string[]): Promise<void> {
  if (participantIds.length === 0) return;

  const { error } = await supabase.rpc('mark_check_in_reminder_sent', {
    p_participant_ids: participantIds,
  });

  if (error) {
    console.error('Failed to mark check-in reminder sent:', error);
    // Don't throw - notifications were sent, just tracking failed
  }
}

/**
 * Process check-in reminder notifications
 */
async function processNotifications(): Promise<{ sent: number; errors: string[] }> {
  const participants = await getParticipantsForReminder();
  console.log(`Found ${participants.length} participants for check-in reminder notification`);

  if (participants.length === 0) {
    return { sent: 0, errors: [] };
  }

  const notifications: NotificationInput[] = [];
  const participantIds: string[] = [];
  const errors: string[] = [];

  // Build notifications in batches
  for (let i = 0; i < participants.length; i += BATCH_SIZE) {
    const batch = participants.slice(i, i + BATCH_SIZE);

    for (const participant of batch) {
      try {
        const notification = await buildNotificationInput(participant);
        if (notification) {
          notifications.push(notification);
          participantIds.push(participant.participant_id);
        }
      } catch (error) {
        const errorMsg = `Failed to build notification for participant ${participant.participant_id}: ${error}`;
        console.error(errorMsg);
        errors.push(errorMsg);
      }
    }
  }

  // Send all notifications
  if (notifications.length > 0) {
    try {
      await sendNotificationsBatch(notifications);
      await markRemindersSent(participantIds);
      console.log(`Sent ${notifications.length} check-in reminder notifications`);
    } catch (error) {
      const errorMsg = `Failed to send notifications batch: ${error}`;
      console.error(errorMsg);
      errors.push(errorMsg);
      return { sent: 0, errors };
    }
  }

  return { sent: notifications.length, errors };
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

Deno.serve(async req => {
  // Handle CORS preflight
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

  // Bearer auth with anon key (staging/prod). When no key is configured (e.g. local --no-verify-jwt), skip validation.
  const expectedAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (expectedAnonKey) {
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    if (!token || token !== expectedAnonKey) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  console.log('Starting check-in reminder job...');
  const startTime = Date.now();

  try {
    const result = await processNotifications();

    const summary = {
      success: true,
      notificationsSent: result.sent,
      errors: result.errors,
      duration_ms: Date.now() - startTime,
    };

    console.log(`Check-in reminder job complete: ${result.sent} notifications sent`);

    const httpStatus = result.errors.length > 0 && result.sent === 0 ? 500 : 200;

    return new Response(JSON.stringify(summary), {
      status: httpStatus,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Check-in reminder job failed:', error);

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
