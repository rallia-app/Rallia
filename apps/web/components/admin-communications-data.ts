/**
 * Shared data, types, and utilities for the admin communications preview page.
 */

import { getTranslations as getLocaleTranslations } from '@rallia/shared-translations';
import type { Locale } from '@rallia/shared-translations';

// ---------------------------------------------------------------------------
// Notification types (mirrors supabase/functions/send-notification/types.ts)
// ---------------------------------------------------------------------------

export type NotificationType =
  | 'match_invitation'
  | 'match_join_request'
  | 'match_join_accepted'
  | 'match_join_rejected'
  | 'match_player_joined'
  | 'match_cancelled'
  | 'match_updated'
  | 'match_starting_soon'
  | 'match_check_in_available'
  | 'match_new_available'
  | 'match_spot_opened'
  | 'nearby_match_available'
  | 'player_kicked'
  | 'player_left'
  | 'new_message'
  | 'chat'
  | 'rating_verified'
  | 'reminder'
  | 'payment'
  | 'support'
  | 'system'
  | 'feedback_request'
  | 'feedback_reminder'
  | 'score_confirmation'
  | 'community_join_request'
  | 'community_join_accepted'
  | 'community_join_rejected'
  | 'reference_request_received'
  | 'reference_request_accepted'
  | 'reference_request_declined'
  | 'booking_created'
  | 'booking_cancelled_by_player'
  | 'booking_modified'
  | 'new_member_joined'
  | 'member_left'
  | 'member_role_changed'
  | 'payment_received'
  | 'payment_failed'
  | 'refund_processed'
  | 'daily_summary'
  | 'weekly_report'
  | 'booking_confirmed'
  | 'booking_reminder'
  | 'booking_cancelled_by_org'
  | 'membership_approved'
  | 'org_announcement';

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type NotificationCategory = 'match' | 'social' | 'organization' | 'system';

export const NOTIFICATION_CATEGORIES: Record<NotificationType, NotificationCategory> = {
  match_invitation: 'match',
  match_join_request: 'match',
  match_join_accepted: 'match',
  match_join_rejected: 'match',
  match_player_joined: 'match',
  match_cancelled: 'match',
  match_updated: 'match',
  match_starting_soon: 'match',
  match_check_in_available: 'match',
  match_new_available: 'match',
  match_spot_opened: 'match',
  nearby_match_available: 'match',
  player_kicked: 'match',
  player_left: 'match',
  new_message: 'social',
  chat: 'social',
  community_join_request: 'social',
  community_join_accepted: 'social',
  community_join_rejected: 'social',
  reference_request_received: 'social',
  reference_request_accepted: 'social',
  reference_request_declined: 'social',
  feedback_request: 'social',
  feedback_reminder: 'social',
  score_confirmation: 'social',
  booking_created: 'organization',
  booking_cancelled_by_player: 'organization',
  booking_modified: 'organization',
  new_member_joined: 'organization',
  member_left: 'organization',
  member_role_changed: 'organization',
  payment_received: 'organization',
  payment_failed: 'organization',
  refund_processed: 'organization',
  daily_summary: 'organization',
  weekly_report: 'organization',
  booking_confirmed: 'organization',
  booking_reminder: 'organization',
  booking_cancelled_by_org: 'organization',
  membership_approved: 'organization',
  org_announcement: 'organization',
  rating_verified: 'system',
  reminder: 'match',
  payment: 'system',
  support: 'system',
  system: 'system',
};

// ---------------------------------------------------------------------------
// Default delivery preferences (mirrors types.ts DEFAULT_PREFERENCES)
// ---------------------------------------------------------------------------

export type DeliveryChannel = 'email' | 'push' | 'sms';

export const DEFAULT_PREFERENCES: Record<NotificationType, Record<DeliveryChannel, boolean>> = {
  match_invitation: { email: true, push: true, sms: false },
  match_join_request: { email: true, push: true, sms: false },
  match_join_accepted: { email: true, push: true, sms: false },
  match_join_rejected: { email: true, push: true, sms: false },
  match_player_joined: { email: false, push: true, sms: false },
  match_cancelled: { email: true, push: true, sms: true },
  match_updated: { email: false, push: true, sms: false },
  match_starting_soon: { email: false, push: true, sms: true },
  match_check_in_available: { email: true, push: true, sms: false },
  match_new_available: { email: false, push: true, sms: false },
  match_spot_opened: { email: false, push: true, sms: false },
  nearby_match_available: { email: false, push: true, sms: false },
  player_kicked: { email: true, push: true, sms: false },
  player_left: { email: false, push: true, sms: false },
  chat: { email: false, push: true, sms: false },
  new_message: { email: false, push: true, sms: false },
  rating_verified: { email: true, push: true, sms: false },
  reminder: { email: false, push: true, sms: false },
  payment: { email: true, push: true, sms: false },
  support: { email: true, push: false, sms: false },
  system: { email: true, push: false, sms: false },
  feedback_request: { email: true, push: true, sms: false },
  feedback_reminder: { email: true, push: true, sms: false },
  score_confirmation: { email: true, push: true, sms: false },
  reference_request_received: { email: false, push: true, sms: false },
  reference_request_accepted: { email: false, push: true, sms: false },
  reference_request_declined: { email: false, push: true, sms: false },
  community_join_request: { email: false, push: true, sms: false },
  community_join_accepted: { email: false, push: true, sms: false },
  community_join_rejected: { email: false, push: true, sms: false },
  booking_created: { email: true, push: false, sms: false },
  booking_cancelled_by_player: { email: true, push: false, sms: false },
  booking_modified: { email: true, push: false, sms: false },
  new_member_joined: { email: true, push: false, sms: false },
  member_left: { email: true, push: false, sms: false },
  member_role_changed: { email: true, push: false, sms: false },
  payment_received: { email: true, push: false, sms: false },
  payment_failed: { email: true, push: false, sms: true },
  refund_processed: { email: true, push: false, sms: false },
  daily_summary: { email: false, push: false, sms: false },
  weekly_report: { email: true, push: false, sms: false },
  booking_confirmed: { email: true, push: false, sms: false },
  booking_reminder: { email: true, push: false, sms: true },
  booking_cancelled_by_org: { email: true, push: false, sms: true },
  membership_approved: { email: true, push: false, sms: false },
  org_announcement: { email: true, push: false, sms: false },
};

// ---------------------------------------------------------------------------
// Email template registry (matches supabase/functions/email-preview TEMPLATES)
// ---------------------------------------------------------------------------

export interface EmailTemplate {
  id: string;
  label: string;
  category: string;
}

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  { id: 'auth_confirmation', label: 'Confirmation', category: 'Auth' },
  { id: 'auth_magic_link', label: 'Magic Link', category: 'Auth' },
  { id: 'invitation_org', label: 'Organization', category: 'Invitation' },
  { id: 'invitation_platform', label: 'Platform', category: 'Invitation' },
  { id: 'notification_generic', label: 'Generic', category: 'Notification' },
  { id: 'match_invitation', label: 'Invitation', category: 'Match' },
  { id: 'match_join_accepted', label: 'Join Accepted', category: 'Match' },
  { id: 'match_cancelled', label: 'Cancelled', category: 'Match' },
  { id: 'match_updated', label: 'Updated', category: 'Match' },
  { id: 'match_starting_soon', label: 'Starting Soon', category: 'Match' },
  { id: 'match_reminder', label: 'Reminder', category: 'Match' },
  { id: 'match_player_joined', label: 'Player Joined', category: 'Match' },
  { id: 'match_new_available', label: 'New Available', category: 'Match' },
  { id: 'org_booking_confirmed', label: 'Booking Confirmed', category: 'Organization' },
  { id: 'org_booking_reminder', label: 'Booking Reminder', category: 'Organization' },
  { id: 'org_payment_received', label: 'Payment Received', category: 'Organization' },
  { id: 'org_new_member', label: 'New Member', category: 'Organization' },
];

export const EMAIL_CATEGORIES = [...new Set(EMAIL_TEMPLATES.map(t => t.category))];

// ---------------------------------------------------------------------------
// Sport emojis (from push.ts)
// ---------------------------------------------------------------------------

export const SPORT_EMOJIS: Record<string, string> = {
  tennis: '\uD83C\uDFBE',
  pickleball: '',
  badminton: '\uD83C\uDFF8',
  squash: '\uD83C\uDFBE',
  padel: '\uD83C\uDFBE',
  default: '\uD83C\uDFC3',
};

// ---------------------------------------------------------------------------
// Mock data for template interpolation
// ---------------------------------------------------------------------------

export const MOCK_DATA: Record<string, string> = {
  playerName: 'Alex Johnson',
  sportName: 'Tennis',
  matchDate: 'April 16, 2026',
  startTime: ' at 2:00 PM',
  locationName: 'Parc La Fontaine',
  locationAddress: '3933 Av du Parc La Fontaine, Montreal, QC H2L 3M6',
  timeUntil: 'in 30 minutes',
  spotsLeft: '2',
  senderName: 'Marie Dupont',
  messagePreview: 'Hey, are we still on for tomorrow?',
  ratingSystemName: 'UTR',
  ratingValue: '7.5',
  ratingLabel: 'UTR 7.5',
  opponentNames: 'Alex Johnson',
  communityName: 'Montreal Tennis League',
  requesterName: 'Marc Tremblay',
  orgName: 'Montreal Tennis Club',
  courtName: 'Court A',
  facilityName: 'Montreal Tennis Club',
  bookingDate: 'April 16, 2026',
  endTime: '3:00 PM',
};

// ---------------------------------------------------------------------------
// Translation helpers
// ---------------------------------------------------------------------------

/**
 * Interpolate {placeholder} patterns in a string with mock data values.
 */
export function interpolate(template: string, values: Record<string, string> = MOCK_DATA): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? `{${key}}`);
}

/**
 * Get notification message (title/body) for a given type and locale.
 * Uses the raw translation JSON from @rallia/shared-translations.
 */
export function getNotificationMessage(
  type: NotificationType,
  locale: Locale
): { title: string; body: string } | null {
  const messages = getLocaleTranslations(locale);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const notifMessages = (messages as any)?.notifications?.messages?.[type];
  if (!notifMessages) return null;
  return {
    title: notifMessages.title ?? '',
    body: notifMessages.body ?? '',
  };
}

/**
 * All notification types that have translation messages defined.
 */
export const NOTIFICATION_TYPES_WITH_MESSAGES: NotificationType[] = (
  Object.keys(NOTIFICATION_CATEGORIES) as NotificationType[]
).filter(type => getNotificationMessage(type, 'en-US') !== null);

// ---------------------------------------------------------------------------
// Push formatting
// ---------------------------------------------------------------------------

function getSportEmoji(sportName?: string): string {
  if (!sportName) return '';
  const normalized = sportName.toLowerCase().trim();
  return SPORT_EMOJIS[normalized] || SPORT_EMOJIS.default;
}

export function formatPushTitle(type: NotificationType, title: string, sportName?: string): string {
  if (type.startsWith('match_') || type === 'reminder') {
    const emoji = getSportEmoji(sportName);
    return emoji ? `${emoji} ${title}` : title;
  }
  return title;
}

// ---------------------------------------------------------------------------
// SMS formatting (ported from supabase/functions/send-notification/handlers/sms.ts)
// ---------------------------------------------------------------------------

interface MockNotification {
  type: NotificationType;
  title: string;
  body: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  payload: Record<string, unknown>;
}

function getSportPrefix(sportName?: string): string {
  if (!sportName) return '';
  const sport = sportName.toLowerCase().trim();
  return `[${sport}] `;
}

function getPrioritizedContent(notification: MockNotification): {
  prefix: string;
  core: string;
  extra?: string;
} {
  const { type, title, body, payload, priority } = notification;
  const sportName = payload?.sportName as string | undefined;
  const matchDate = payload?.matchDate as string | undefined;
  const locationName = payload?.locationName as string | undefined;
  const playerName = payload?.playerName as string | undefined;
  const timeUntil = payload?.timeUntil as string | undefined;

  const sportPrefix = getSportPrefix(sportName);

  if (priority === 'urgent') {
    switch (type) {
      case 'match_starting_soon':
        return {
          prefix: `${sportPrefix}`,
          core: `STARTING ${timeUntil?.toUpperCase() || 'SOON'}!`,
          extra: locationName ? `at ${locationName}` : undefined,
        };
      case 'match_check_in_available':
        return {
          prefix: `${sportPrefix}`,
          core: 'CHECK-IN NOW OPEN!',
          extra: locationName ? `at ${locationName}` : undefined,
        };
      case 'match_cancelled':
        return {
          prefix: `${sportPrefix}`,
          core: 'CANCELLED',
          extra: matchDate ? `Game on ${matchDate}` : undefined,
        };
    }
  }

  switch (type) {
    case 'match_invitation':
      return {
        prefix: `${sportPrefix}`,
        core: title,
        extra: matchDate && playerName ? `${playerName} - ${matchDate}` : body || undefined,
      };
    case 'match_join_accepted':
      return {
        prefix: `${sportPrefix}`,
        core: "You're in!",
        extra: matchDate && locationName ? `${matchDate} at ${locationName}` : body || undefined,
      };
    case 'match_starting_soon':
      return {
        prefix: `${sportPrefix}`,
        core: `Starts ${timeUntil || 'soon'}`,
        extra: locationName ? `at ${locationName}` : undefined,
      };
    case 'match_check_in_available':
      return {
        prefix: `${sportPrefix}`,
        core: 'Check-in is open',
        extra: locationName ? `at ${locationName}` : undefined,
      };
    case 'reminder':
      return {
        prefix: `${sportPrefix}`,
        core: 'Reminder',
        extra: matchDate && locationName ? `${matchDate} at ${locationName}` : body || undefined,
      };
    default:
      return {
        prefix: sportPrefix || 'Rallia: ',
        core: title,
        extra: body || undefined,
      };
  }
}

function formatSmsMessage(notification: MockNotification): string {
  const maxLength = 160;
  const content = getPrioritizedContent(notification);

  let message = content.prefix + content.core;

  if (content.extra) {
    const withExtra = `${message} - ${content.extra}`;
    if (withExtra.length <= maxLength) {
      message = withExtra;
    } else {
      const availableSpace = maxLength - message.length - 5;
      if (availableSpace > 10) {
        message = `${message} - ${content.extra.substring(0, availableSpace)}...`;
      }
    }
  }

  if (message.length > maxLength) {
    message = message.substring(0, maxLength - 3) + '...';
  }

  return message;
}

const URGENT_TYPES: NotificationType[] = [
  'match_cancelled',
  'match_starting_soon',
  'match_check_in_available',
];

export function formatSmsPreview(
  type: NotificationType,
  title: string,
  body: string | null
): { text: string; length: number; segments: number } {
  const isUrgent = URGENT_TYPES.includes(type);
  const notification: MockNotification = {
    type,
    title,
    body,
    priority: isUrgent ? 'urgent' : 'normal',
    payload: {
      sportName: MOCK_DATA.sportName,
      matchDate: MOCK_DATA.matchDate,
      locationName: MOCK_DATA.locationName,
      playerName: MOCK_DATA.playerName,
      timeUntil: MOCK_DATA.timeUntil,
    },
  };

  const text = formatSmsMessage(notification);
  return {
    text,
    length: text.length,
    segments: Math.ceil(text.length / 160),
  };
}
