/**
 * send-feedback-reminders Edge Function
 *
 * Automated feedback notification system that:
 * 1. Sends initial feedback requests 1 hour after match end
 * 2. Sends reminder notifications 24 hours after match end (for those who haven't completed feedback)
 *
 * Triggered hourly by pg_cron
 *
 * ## Response Format
 *
 * Success (200):
 * {
 *   "success": true,
 *   "initialNotificationsSent": 5,
 *   "reminderNotificationsSent": 3,
 *   "totalNotificationsSent": 8,
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

interface ParticipantForNotification {
  participant_id: string;
  player_id: string;
  match_id: string;
  match_date: string;
  start_time: string;
  end_time: string | null;
  sport_name: string;
  format: string;
  timezone: string;
}

interface OpponentInfo {
  player_id: string;
  first_name: string | null;
  display_name: string | null;
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

interface ProcessingResult {
  initialNotificationsSent: number;
  reminderNotificationsSent: number;
  errors: string[];
}

// =============================================================================
// CONFIGURATION
// =============================================================================

// Buffer in minutes added to each edge of the window to avoid missing matches between cron runs
const BUFFER_MINUTES = 5;

// Initial notification: games that ended 1–2 hours ago (with buffer)
const INITIAL_WINDOW_START_MINUTES = 2 * 60 + BUFFER_MINUTES; // 125 min ago
const INITIAL_WINDOW_END_MINUTES = 1 * 60 - BUFFER_MINUTES; // 55 min ago

// Reminder notification: games that ended 24–25 hours ago (with buffer)
const REMINDER_WINDOW_START_MINUTES = 25 * 60 + BUFFER_MINUTES; // 1505 min ago
const REMINDER_WINDOW_END_MINUTES = 24 * 60 - BUFFER_MINUTES; // 1435 min ago

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
 * Format opponent names for notification body
 * Singles: "John"
 * Doubles: "John, Jane, and Mike"
 */
function formatOpponentNames(names: string[], locale: string = 'en-US'): string {
  if (names.length === 0) return 'your opponents';
  if (names.length === 1) return names[0];

  // For 2+ names: "John, Jane, and Mike" or "John et Jane" for French
  const lastIndex = names.length - 1;
  const allButLast = names.slice(0, lastIndex).join(', ');
  const conjunction = locale.startsWith('fr') ? ' et ' : ' and ';
  return `${allButLast}${conjunction}${names[lastIndex]}`;
}

/**
 * Get display name for an opponent
 */
function getOpponentDisplayName(opponent: OpponentInfo): string {
  return opponent.first_name || opponent.display_name || 'Player';
}

/**
 * Format date for notification payload
 */
function formatMatchDate(matchDate: string): string {
  const date = new Date(matchDate);
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

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
 * Get opponents for a participant in a match
 */
async function getOpponentsForParticipant(
  matchId: string,
  playerId: string
): Promise<OpponentInfo[]> {
  const { data, error } = await supabase.rpc('get_opponents_for_notification', {
    p_match_id: matchId,
    p_player_id: playerId,
  });

  if (error) {
    console.error(`Failed to get opponents for match ${matchId}:`, error);
    return [];
  }

  return (data || []) as OpponentInfo[];
}

/**
 * Build notification input for a participant
 */
async function buildNotificationInput(
  participant: ParticipantForNotification,
  notificationType: 'feedback_request' | 'feedback_reminder'
): Promise<NotificationInput | null> {
  // Get opponents
  const opponents = await getOpponentsForParticipant(participant.match_id, participant.player_id);

  if (opponents.length === 0) {
    console.warn(`No opponents found for participant ${participant.participant_id}`);
    return null;
  }

  // Get user's locale for formatting
  const locale = await getUserLocale(supabase, participant.player_id);

  // Format opponent names
  const opponentNames = opponents.map(getOpponentDisplayName);
  const formattedOpponentNames = formatOpponentNames(opponentNames, locale);

  // Format sport name (lowercase)
  const sportName = participant.sport_name.toLowerCase();

  // Build title and body based on notification type
  let title: string;
  let body: string;

  if (notificationType === 'feedback_request') {
    title = 'How was your game?';
    body = `Submit your score and rate your ${sportName} match with ${formattedOpponentNames} while it's fresh!`;
  } else {
    title = 'You have a match to close out';
    body = `Your ${sportName} score and rating with ${formattedOpponentNames} are still pending — complete them before the window closes.`;
  }

  // French translations if needed
  if (locale.startsWith('fr')) {
    if (notificationType === 'feedback_request') {
      title = 'Comment était votre partie?';
      body = `Soumettez votre score et évaluez votre partie de ${sportName} avec ${formattedOpponentNames} pendant que c'est frais!`;
    } else {
      title = 'Une partie à clôturer';
      body = `Votre score et évaluation de ${sportName} avec ${formattedOpponentNames} sont toujours en attente — clôturez-les avant la fermeture.`;
    }
  }

  return {
    user_id: participant.player_id,
    type: notificationType,
    target_id: participant.match_id,
    title,
    body,
    payload: {
      matchId: participant.match_id,
      sportName,
      opponentNames: formattedOpponentNames,
      matchDate: formatMatchDate(participant.match_date),
      format: participant.format,
    },
    priority: 'normal',
  };
}

/**
 * Get participants needing initial feedback notification
 */
async function getParticipantsForInitialNotification(): Promise<ParticipantForNotification[]> {
  const now = new Date();

  // Games that ended 1–2 hours ago (with 5 min buffer on each side)
  const cutoffStart = new Date(now.getTime() - INITIAL_WINDOW_START_MINUTES * 60 * 1000);
  const cutoffEnd = new Date(now.getTime() - INITIAL_WINDOW_END_MINUTES * 60 * 1000);

  const { data, error } = await supabase.rpc('get_participants_for_initial_feedback_notification', {
    p_cutoff_start: cutoffStart.toISOString(),
    p_cutoff_end: cutoffEnd.toISOString(),
  });

  if (error) {
    console.error('Failed to get participants for initial notification:', error);
    throw new Error(`Failed to query participants: ${error.message}`);
  }

  return (data || []) as ParticipantForNotification[];
}

/**
 * Get participants needing feedback reminder
 */
async function getParticipantsForReminder(): Promise<ParticipantForNotification[]> {
  const now = new Date();

  // Games that ended 24–25 hours ago (with 5 min buffer on each side)
  const cutoffStart = new Date(now.getTime() - REMINDER_WINDOW_START_MINUTES * 60 * 1000);
  const cutoffEnd = new Date(now.getTime() - REMINDER_WINDOW_END_MINUTES * 60 * 1000);

  const { data, error } = await supabase.rpc('get_participants_for_feedback_reminder', {
    p_cutoff_start: cutoffStart.toISOString(),
    p_cutoff_end: cutoffEnd.toISOString(),
  });

  if (error) {
    console.error('Failed to get participants for reminder:', error);
    throw new Error(`Failed to query participants: ${error.message}`);
  }

  return (data || []) as ParticipantForNotification[];
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
 * Mark initial notifications as sent
 */
async function markInitialNotificationsSent(participantIds: string[]): Promise<void> {
  if (participantIds.length === 0) return;

  const { error } = await supabase.rpc('mark_initial_feedback_notifications_sent', {
    p_participant_ids: participantIds,
  });

  if (error) {
    console.error('Failed to mark initial notifications sent:', error);
    // Don't throw - notifications were sent, just tracking failed
  }
}

/**
 * Mark reminder notifications as sent
 */
async function markRemindersSent(participantIds: string[]): Promise<void> {
  if (participantIds.length === 0) return;

  const { error } = await supabase.rpc('mark_feedback_reminders_sent', {
    p_participant_ids: participantIds,
  });

  if (error) {
    console.error('Failed to mark reminders sent:', error);
    // Don't throw - notifications were sent, just tracking failed
  }
}

/**
 * Process initial feedback notifications
 */
async function processInitialNotifications(): Promise<{ sent: number; errors: string[] }> {
  const participants = await getParticipantsForInitialNotification();
  console.log(`Found ${participants.length} participants for initial notification`);

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
        const notification = await buildNotificationInput(participant, 'feedback_request');
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
      await markInitialNotificationsSent(participantIds);
      console.log(`Sent ${notifications.length} initial feedback notifications`);
    } catch (error) {
      const errorMsg = `Failed to send initial notifications batch: ${error}`;
      console.error(errorMsg);
      errors.push(errorMsg);
      return { sent: 0, errors };
    }
  }

  return { sent: notifications.length, errors };
}

/**
 * Process reminder notifications
 */
async function processReminderNotifications(): Promise<{ sent: number; errors: string[] }> {
  const participants = await getParticipantsForReminder();
  console.log(`Found ${participants.length} participants for reminder notification`);

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
        const notification = await buildNotificationInput(participant, 'feedback_reminder');
        if (notification) {
          notifications.push(notification);
          participantIds.push(participant.participant_id);
        }
      } catch (error) {
        const errorMsg = `Failed to build reminder for participant ${participant.participant_id}: ${error}`;
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
      console.log(`Sent ${notifications.length} feedback reminder notifications`);
    } catch (error) {
      const errorMsg = `Failed to send reminder notifications batch: ${error}`;
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

  console.log('Starting feedback reminder job...');
  const startTime = Date.now();

  try {
    // Process both notification types in parallel
    const [initialResult, reminderResult] = await Promise.all([
      processInitialNotifications(),
      processReminderNotifications(),
    ]);

    const result: ProcessingResult = {
      initialNotificationsSent: initialResult.sent,
      reminderNotificationsSent: reminderResult.sent,
      errors: [...initialResult.errors, ...reminderResult.errors],
    };

    const summary = {
      success: true,
      ...result,
      totalNotificationsSent: result.initialNotificationsSent + result.reminderNotificationsSent,
      duration_ms: Date.now() - startTime,
    };

    console.log(
      `Feedback reminder job complete: ${result.initialNotificationsSent} initial, ${result.reminderNotificationsSent} reminders`
    );

    // Return error status if there were errors but some succeeded
    const httpStatus = result.errors.length > 0 && summary.totalNotificationsSent === 0 ? 500 : 200;

    return new Response(JSON.stringify(summary), {
      status: httpStatus,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Feedback reminder job failed:', error);

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
