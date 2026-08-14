/**
 * Push Notification Service
 * Handles Expo push notification registration and token management.
 */

import { supabase } from '../supabase';

/**
 * Outcome of a token registration attempt.
 *
 * `missing_player_row` is a real, common case: the player row is created during
 * onboarding, so registration fired at auth time can land before it exists.
 * PostgREST reports a zero-row UPDATE as a success, so callers must branch on
 * this rather than on `error`.
 */
export type PushTokenRegistrationResult =
  | { status: 'registered' }
  | { status: 'missing_player_row' };

/**
 * Register a push token for a user
 * This stores the Expo push token in the player table
 */
export async function registerPushToken(
  userId: string,
  expoPushToken: string
): Promise<PushTokenRegistrationResult> {
  const { data, error } = await supabase
    .from('player')
    .update({
      expo_push_token: expoPushToken,
      push_notifications_enabled: true,
    })
    .eq('id', userId)
    .select('id');

  if (error) {
    throw new Error(`Failed to register push token: ${error.message}`);
  }

  return data && data.length > 0 ? { status: 'registered' } : { status: 'missing_player_row' };
}

/**
 * Unregister push token for a user (on logout or opt-out)
 */
export async function unregisterPushToken(userId: string): Promise<void> {
  const { error } = await supabase
    .from('player')
    .update({
      expo_push_token: null,
      push_notifications_enabled: false,
    })
    .eq('id', userId);

  if (error) {
    throw new Error(`Failed to unregister push token: ${error.message}`);
  }
}

/**
 * Get push token for a user
 */
export async function getPushToken(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('player')
    .select('expo_push_token, push_notifications_enabled')
    .eq('id', userId)
    .single();

  if (error) {
    throw new Error(`Failed to get push token: ${error.message}`);
  }

  // Return null if push is disabled
  if (!data?.push_notifications_enabled) {
    return null;
  }

  return data?.expo_push_token ?? null;
}

/**
 * Enable or disable push notifications globally for a user
 */
export async function setPushNotificationsEnabled(userId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from('player')
    .update({ push_notifications_enabled: enabled })
    .eq('id', userId);

  if (error) {
    throw new Error(`Failed to set push notifications enabled: ${error.message}`);
  }
}

/**
 * Check if push notifications are enabled for a user
 */
export async function isPushNotificationsEnabled(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('player')
    .select('push_notifications_enabled')
    .eq('id', userId)
    .single();

  if (error) {
    return false;
  }

  return data?.push_notifications_enabled ?? false;
}

/**
 * Push service object for grouped exports
 */
export const pushService = {
  registerPushToken,
  unregisterPushToken,
  getPushToken,
  setPushNotificationsEnabled,
  isPushNotificationsEnabled,
};

export default pushService;
