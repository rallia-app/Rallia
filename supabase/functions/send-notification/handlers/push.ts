/**
 * Push Handler for Notification Delivery
 * Uses Expo Push Notification API to send push notifications
 */

import type { NotificationRecord, DeliveryResult } from '../types.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Sport emoji mapping for visual context in push notifications
 */
const SPORT_EMOJIS: Record<string, string> = {
  tennis: '🎾',
  pickleball: '',
  badminton: '🏸',
  squash: '🎾',
  padel: '🎾',
  default: '🏃',
};

/**
 * Get emoji for a sport name
 */
function getSportEmoji(sportName?: string): string {
  if (!sportName) return '';
  const normalized = sportName.toLowerCase().trim();
  return SPORT_EMOJIS[normalized] || SPORT_EMOJIS.default;
}

/**
 * Get iOS category identifier for notification actions
 */
function getCategoryId(type: string): string | undefined {
  switch (type) {
    case 'match_invitation':
    case 'match_join_request':
      return 'match_action'; // Can have Accept/Decline actions
    case 'community_join_request':
      return 'community_action'; // Can have Accept/Decline actions
    case 'feedback_request':
      return 'feedback_action'; // Can have Rate action
    case 'new_message':
    case 'chat':
      return 'message_action'; // Can have Reply action
    default:
      return undefined;
  }
}

/**
 * Send a push notification via Expo
 */
export async function sendPush(
  notification: NotificationRecord,
  expoPushToken: string,
  badgeCount?: number
): Promise<DeliveryResult> {
  try {
    // Validate token format
    if (
      !expoPushToken.startsWith('ExponentPushToken[') &&
      !expoPushToken.startsWith('ExpoPushToken[')
    ) {
      return {
        channel: 'push',
        status: 'failed',
        errorMessage: 'Invalid Expo push token format',
      };
    }

    const pushPayload = buildPushPayload(notification, expoPushToken, badgeCount);

    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(pushPayload),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        channel: 'push',
        status: 'failed',
        errorMessage: data?.errors?.[0]?.message || 'Failed to send push notification',
        providerResponse: data,
      };
    }

    // Check for ticket errors
    const ticket = data?.data?.[0];
    if (ticket?.status === 'error') {
      return {
        channel: 'push',
        status: 'failed',
        errorMessage: ticket.message || 'Push ticket error',
        providerResponse: ticket,
      };
    }

    return {
      channel: 'push',
      status: 'success',
      providerResponse: { ticketId: ticket?.id },
    };
  } catch (error) {
    return {
      channel: 'push',
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Build the Expo push notification payload
 */
function buildPushPayload(
  notification: NotificationRecord,
  expoPushToken: string,
  badgeCount?: number
) {
  const { title, body, type, target_id, payload, priority } = notification;

  // Map priority to Expo priority
  const expoPriority = priority === 'urgent' || priority === 'high' ? 'high' : 'normal';

  // Get sport emoji for visual context
  const sportName = payload?.sportName as string | undefined;
  const sportEmoji = getSportEmoji(sportName);

  // Enhance title with sport emoji for match-related notifications
  const enhancedTitle =
    type.startsWith('match_') || type === 'reminder'
      ? sportEmoji
        ? `${sportEmoji} ${title}`
        : title
      : title;

  // Build data payload for deep linking
  const data: Record<string, unknown> = {
    notificationId: notification.id,
    type,
    targetId: target_id,
    ...payload,
  };

  // Determine channel ID for Android based on notification type
  let channelId = 'default';
  if (type.startsWith('match_')) {
    channelId = priority === 'urgent' ? 'match_urgent' : 'match';
  } else if (type === 'new_message' || type === 'chat') {
    channelId = 'messages';
  } else if (type === 'feedback_request') {
    channelId = 'feedback';
  }

  // Get iOS category for notification actions
  const categoryId = getCategoryId(type);

  return {
    to: expoPushToken,
    title: enhancedTitle,
    body: body || undefined,
    data,
    sound: priority === 'urgent' ? 'default' : 'default',
    priority: expoPriority,
    channelId,
    // iOS category for notification actions
    ...(categoryId && { categoryId }),
    // Badge count - set from server-side unread notification count
    ...(badgeCount != null && { badge: badgeCount }),
    // TTL for message expiry (24 hours for normal, 1 hour for urgent)
    ttl: priority === 'urgent' ? 3600 : 86400,
    // Collapse key for grouping similar notifications
    _contentAvailable: true,
    // Mutable content for iOS rich notifications
    mutableContent: true,
  };
}

/**
 * Send push notifications to multiple tokens
 * Uses Expo's batch API for efficiency
 */
export async function sendPushBatch(
  notification: NotificationRecord,
  expoPushTokens: string[],
  badgeCount?: number
): Promise<DeliveryResult[]> {
  if (expoPushTokens.length === 0) {
    return [];
  }

  try {
    // Build payloads for all tokens
    const payloads = expoPushTokens
      .filter(token => token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken['))
      .map(token => buildPushPayload(notification, token, badgeCount));

    if (payloads.length === 0) {
      return expoPushTokens.map(() => ({
        channel: 'push' as const,
        status: 'failed' as const,
        errorMessage: 'Invalid Expo push token format',
      }));
    }

    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payloads),
    });

    const data = await response.json();

    if (!response.ok) {
      return expoPushTokens.map(() => ({
        channel: 'push' as const,
        status: 'failed' as const,
        errorMessage: data?.errors?.[0]?.message || 'Failed to send push notification',
        providerResponse: data,
      }));
    }

    // Map tickets to results
    return (data?.data || []).map((ticket: { status: string; message?: string; id?: string }) => {
      if (ticket.status === 'error') {
        return {
          channel: 'push' as const,
          status: 'failed' as const,
          errorMessage: ticket.message || 'Push ticket error',
          providerResponse: ticket,
        };
      }
      return {
        channel: 'push' as const,
        status: 'success' as const,
        providerResponse: { ticketId: ticket.id },
      };
    });
  } catch (error) {
    return expoPushTokens.map(() => ({
      channel: 'push' as const,
      status: 'failed' as const,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}
