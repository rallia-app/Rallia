/**
 * send-notification Edge Function
 *
 * Unified notification dispatcher that:
 * 1. Checks user preferences for each channel
 * 2. Gets user contact info (email, phone, push token)
 * 3. Sends via enabled channels
 * 4. Logs all delivery attempts
 *
 * Triggered by database trigger on notification INSERT
 */

import { createClient } from '@supabase/supabase-js';
import { sendEmail, sendOrgEmail } from './handlers/email.ts';
import { sendPush } from './handlers/push.ts';
import { sendSms, isValidPhoneNumber } from './handlers/sms.ts';
import type {
  NotificationRecord,
  UserContactInfo,
  NotificationPreference,
  DeliveryChannel,
  DeliveryStatus,
  DeliveryAttemptInsert,
  DeliveryResult,
  OrganizationInfo,
} from './types.ts';
import { DEFAULT_PREFERENCES, isOrgNotification } from './types.ts';

// Initialize Supabase client with service role for full access
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Get organization info from payload
 */
async function getOrganizationInfo(organizationId: string): Promise<OrganizationInfo | null> {
  const { data, error } = await supabase
    .from('organization')
    .select('id, name, email, website')
    .eq('id', organizationId)
    .single();

  if (error) {
    console.error('Failed to fetch organization:', error);
    return null;
  }

  return data as OrganizationInfo;
}

/**
 * Get organization's notification preferences for a type/channel
 */
async function getOrgPreferences(
  organizationId: string,
  notificationType: string
): Promise<Map<DeliveryChannel, boolean>> {
  const { data, error } = await supabase
    .from('organization_notification_preference')
    .select('channel, enabled')
    .eq('organization_id', organizationId)
    .eq('notification_type', notificationType);

  if (error) {
    console.error('Failed to fetch org preferences:', error);
  }

  const prefMap = new Map<DeliveryChannel, boolean>();
  if (data) {
    for (const pref of data as NotificationPreference[]) {
      prefMap.set(pref.channel, pref.enabled);
    }
  }

  return prefMap;
}

/**
 * Get user's explicit notification preferences
 */
async function getUserPreferences(
  userId: string,
  notificationType: string
): Promise<Map<DeliveryChannel, boolean>> {
  const { data, error } = await supabase
    .from('notification_preference')
    .select('channel, enabled')
    .eq('user_id', userId)
    .eq('notification_type', notificationType);

  if (error) {
    console.error('Failed to fetch preferences:', error);
  }

  const prefMap = new Map<DeliveryChannel, boolean>();
  if (data) {
    for (const pref of data as NotificationPreference[]) {
      prefMap.set(pref.channel, pref.enabled);
    }
  }

  return prefMap;
}

/**
 * Determine which channels are enabled for this notification
 */
function getEnabledChannels(
  explicitPrefs: Map<DeliveryChannel, boolean>,
  notificationType: string
): Set<DeliveryChannel> {
  const enabled = new Set<DeliveryChannel>();
  const channels: DeliveryChannel[] = ['email', 'push', 'sms'];
  const defaults = DEFAULT_PREFERENCES[notificationType as keyof typeof DEFAULT_PREFERENCES] ?? {};

  for (const channel of channels) {
    // Explicit preference takes precedence
    if (explicitPrefs.has(channel)) {
      if (explicitPrefs.get(channel)) {
        enabled.add(channel);
      }
    } else {
      // Fall back to default
      if (defaults[channel]) {
        enabled.add(channel);
      }
    }
  }

  return enabled;
}

/**
 * Get user's contact information for delivery
 */
async function getUserContactInfo(userId: string): Promise<UserContactInfo | null> {
  // Get profile for email and phone
  const { data: profile, error: profileError } = await supabase
    .from('profile')
    .select('email, phone, phone_verified, preferred_locale')
    .eq('id', userId)
    .single();

  if (profileError) {
    console.error('Failed to fetch profile:', profileError);
    return null;
  }

  // Get player for push token
  const { data: player, error: playerError } = await supabase
    .from('player')
    .select('expo_push_token, push_notifications_enabled')
    .eq('id', userId)
    .single();

  if (playerError) {
    console.warn('Failed to fetch player (may not exist):', playerError);
  }

  return {
    email: profile?.email ?? null,
    phone: profile?.phone ?? null,
    phone_verified: profile?.phone_verified ?? false,
    expo_push_token: player?.expo_push_token ?? null,
    push_notifications_enabled: player?.push_notifications_enabled ?? false,
    preferred_locale: profile?.preferred_locale ?? 'en-US',
  };
}

/**
 * Log a delivery attempt to the database
 */
async function logDeliveryAttempt(attempt: DeliveryAttemptInsert): Promise<void> {
  const { error } = await supabase.from('delivery_attempt').insert(attempt);

  if (error) {
    console.error('Failed to log delivery attempt:', error);
  }
}

/**
 * Check if a channel has valid contact info
 */
function hasValidContact(
  channel: DeliveryChannel,
  contact: UserContactInfo
): { valid: boolean; reason?: string } {
  switch (channel) {
    case 'email':
      if (!contact.email) {
        return { valid: false, reason: 'No email address' };
      }
      return { valid: true };

    case 'push':
      if (!contact.push_notifications_enabled) {
        return { valid: false, reason: 'Push notifications disabled globally' };
      }
      if (!contact.expo_push_token) {
        return { valid: false, reason: 'No push token registered' };
      }
      return { valid: true };

    case 'sms':
      if (!contact.phone) {
        return { valid: false, reason: 'No phone number' };
      }
      if (!contact.phone_verified) {
        return { valid: false, reason: 'Phone number not verified' };
      }
      if (!isValidPhoneNumber(contact.phone)) {
        return { valid: false, reason: 'Invalid phone number format' };
      }
      return { valid: true };

    default:
      return { valid: false, reason: 'Unknown channel' };
  }
}

/**
 * Send notification via a specific channel
 */
async function sendViaChannel(
  channel: DeliveryChannel,
  notification: NotificationRecord,
  contact: UserContactInfo,
  organization?: OrganizationInfo | null,
): Promise<DeliveryResult> {
  switch (channel) {
    case 'email':
      // Use org-branded email template if this is an org notification
      if (organization && isOrgNotification(notification.type)) {
        return sendOrgEmail(notification, contact.email!, organization, contact.preferred_locale);
      }
      return sendEmail(notification, contact.email!, contact.preferred_locale);

    case 'push':
      return sendPush(notification, contact.expo_push_token!);

    case 'sms':
      return sendSms(notification, contact.phone!);

    default:
      return {
        channel,
        status: 'failed',
        errorMessage: 'Unknown delivery channel',
      };
  }
}

/**
 * Main handler for processing a notification
 */
async function handleNotification(notification: NotificationRecord): Promise<void> {
  const { id: notificationId, user_id: userId, type: notificationType, payload } = notification;
  const channels: DeliveryChannel[] = ['email', 'push', 'sms'];

  console.log(
    `Processing notification ${notificationId} of type ${notificationType} for user ${userId}`
  );

  // Check if this is an organization notification
  const organizationId = payload?.organizationId as string | undefined;
  const isOrgNotif = isOrgNotification(notificationType);
  let organization: OrganizationInfo | null = null;

  // 1. Get preferences - use org preferences for org notifications, else user preferences
  let enabledChannels: Set<DeliveryChannel>;

  if (isOrgNotif && organizationId) {
    console.log(`Organization notification detected, org: ${organizationId}`);

    // Fetch organization info for branded emails
    organization = await getOrganizationInfo(organizationId);

    // Get org-level preferences
    const orgPrefs = await getOrgPreferences(organizationId, notificationType);
    enabledChannels = getEnabledChannels(orgPrefs, notificationType);
  } else {
    // Standard user preferences
    const explicitPrefs = await getUserPreferences(userId, notificationType);
    enabledChannels = getEnabledChannels(explicitPrefs, notificationType);
  }

  console.log(`Enabled channels:`, Array.from(enabledChannels));

  // 2. Get user's contact info
  const contact = await getUserContactInfo(userId);
  if (!contact) {
    console.error(`Could not get contact info for user ${userId}`);
    // Log all channels as failed
    for (const channel of channels) {
      await logDeliveryAttempt({
        notification_id: notificationId,
        attempt_number: 1,
        channel,
        status: 'failed',
        error_message: 'Could not retrieve user contact info',
      });
    }
    return;
  }

  // 3. Process each channel
  let attemptNumber = 1;
  for (const channel of channels) {
    let status: DeliveryStatus;
    let errorMessage: string | null = null;
    let providerResponse: Record<string, unknown> | null = null;

    // Check if channel is enabled by preference
    if (!enabledChannels.has(channel)) {
      status = 'skipped_preference';
      console.log(`Channel ${channel} skipped (disabled by preference)`);
    } else {
      // Check if we have valid contact info for this channel
      const contactCheck = hasValidContact(channel, contact);
      if (!contactCheck.valid) {
        status = 'skipped_missing_contact';
        errorMessage = contactCheck.reason ?? null;
        console.log(`Channel ${channel} skipped (${contactCheck.reason})`);
      } else {
        // Actually send the notification
        console.log(`Sending via ${channel}...`);
        const result = await sendViaChannel(channel, notification, contact, organization);
        status = result.status;
        errorMessage = result.errorMessage ?? null;
        providerResponse = result.providerResponse ?? null;
        console.log(`Channel ${channel} result:`, result.status);
      }
    }

    // Log the delivery attempt
    await logDeliveryAttempt({
      notification_id: notificationId,
      attempt_number: attemptNumber,
      channel,
      status,
      error_message: errorMessage,
      provider_response: providerResponse,
    });

    attemptNumber++;
  }

  console.log(`Finished processing notification ${notificationId}`);
}

// Main Deno server
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
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  try {
    // Parse request body
    const body = await req.json();

    // Handle webhook trigger format from database
    // The trigger sends { type: 'INSERT', table: 'notification', record: {...} }
    let notification: NotificationRecord;

    if (body.type === 'INSERT' && body.record) {
      notification = body.record as NotificationRecord;
    } else if (body.id && body.user_id && body.type) {
      // Direct notification format
      notification = body as NotificationRecord;
    } else {
      return new Response(JSON.stringify({ error: 'Invalid request format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Skip if scheduled for later
    if (notification.scheduled_at) {
      const scheduledTime = new Date(notification.scheduled_at);
      if (scheduledTime > new Date()) {
        return new Response(
          JSON.stringify({
            success: true,
            message: 'Notification scheduled for later delivery',
            scheduled_at: notification.scheduled_at,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // Process the notification
    await handleNotification(notification);

    return new Response(
      JSON.stringify({
        success: true,
        notification_id: notification.id,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error processing notification:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
});
