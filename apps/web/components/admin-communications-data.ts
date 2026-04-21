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
  /**
   * The NotificationType whose translated title/body should be used as the
   * email heading + description for this preview. Undefined for templates
   * (auth, invitation, match_interest) that localize their content internally
   * via their own translation keys.
   */
  notifType?: NotificationType;
}

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  { id: 'auth_confirmation', label: 'Confirmation', category: 'Auth' },
  { id: 'auth_magic_link', label: 'Magic Link', category: 'Auth' },
  { id: 'welcome', label: 'Onboarding Complete', category: 'Onboarding' },
  { id: 'invitation_org', label: 'Organization', category: 'Invitation' },
  { id: 'invitation_platform', label: 'Platform', category: 'Invitation' },
  { id: 'notification_generic', label: 'Generic', category: 'Notification', notifType: 'system' },
  { id: 'match_invitation', label: 'Invitation', category: 'Match', notifType: 'match_invitation' },
  {
    id: 'match_join_accepted',
    label: 'Join Accepted',
    category: 'Match',
    notifType: 'match_join_accepted',
  },
  {
    id: 'match_join_request',
    label: 'Join Request',
    category: 'Match',
    notifType: 'match_join_request',
  },
  {
    id: 'match_join_rejected',
    label: 'Join Rejected',
    category: 'Match',
    notifType: 'match_join_rejected',
  },
  { id: 'match_cancelled', label: 'Cancelled', category: 'Match', notifType: 'match_cancelled' },
  { id: 'match_updated', label: 'Updated', category: 'Match', notifType: 'match_updated' },
  {
    id: 'match_starting_soon',
    label: 'Starting Soon',
    category: 'Match',
    notifType: 'match_starting_soon',
  },
  {
    id: 'match_check_in_available',
    label: 'Check-in',
    category: 'Match',
    notifType: 'match_check_in_available',
  },
  { id: 'match_reminder', label: 'Reminder', category: 'Match', notifType: 'reminder' },
  {
    id: 'match_player_joined',
    label: 'Player Joined',
    category: 'Match',
    notifType: 'match_player_joined',
  },
  { id: 'player_kicked', label: 'Player Kicked', category: 'Match', notifType: 'player_kicked' },
  {
    id: 'match_new_available',
    label: 'New Available',
    category: 'Match',
    notifType: 'match_new_available',
  },
  { id: 'match_interest', label: 'Match Interest', category: 'Match' },
  {
    id: 'feedback_request',
    label: 'Feedback Request',
    category: 'Match',
    notifType: 'feedback_request',
  },
  {
    id: 'feedback_reminder',
    label: 'Feedback Reminder',
    category: 'Match',
    notifType: 'feedback_reminder',
  },
  {
    id: 'score_confirmation',
    label: 'Score Confirmation',
    category: 'Match',
    notifType: 'score_confirmation',
  },
  {
    id: 'rating_verified',
    label: 'Rating Verified',
    category: 'System',
    notifType: 'rating_verified',
  },
  {
    id: 'org_booking_confirmed',
    label: 'Booking Confirmed',
    category: 'Organization',
    notifType: 'booking_confirmed',
  },
  {
    id: 'org_booking_reminder',
    label: 'Booking Reminder',
    category: 'Organization',
    notifType: 'booking_reminder',
  },
  {
    id: 'org_booking_created',
    label: 'Booking Created',
    category: 'Organization',
    notifType: 'booking_created',
  },
  {
    id: 'org_booking_cancelled_by_player',
    label: 'Booking Cancelled (player)',
    category: 'Organization',
    notifType: 'booking_cancelled_by_player',
  },
  {
    id: 'org_booking_modified',
    label: 'Booking Modified',
    category: 'Organization',
    notifType: 'booking_modified',
  },
  {
    id: 'org_booking_cancelled_by_org',
    label: 'Booking Cancelled (org)',
    category: 'Organization',
    notifType: 'booking_cancelled_by_org',
  },
  {
    id: 'org_payment_received',
    label: 'Payment Received',
    category: 'Organization',
    notifType: 'payment_received',
  },
  {
    id: 'org_payment_failed',
    label: 'Payment Failed',
    category: 'Organization',
    notifType: 'payment_failed',
  },
  {
    id: 'org_refund_processed',
    label: 'Refund Processed',
    category: 'Organization',
    notifType: 'refund_processed',
  },
  {
    id: 'org_new_member',
    label: 'New Member',
    category: 'Organization',
    notifType: 'new_member_joined',
  },
  {
    id: 'org_member_left',
    label: 'Member Left',
    category: 'Organization',
    notifType: 'member_left',
  },
  {
    id: 'org_member_role_changed',
    label: 'Member Role Changed',
    category: 'Organization',
    notifType: 'member_role_changed',
  },
  {
    id: 'org_membership_approved',
    label: 'Membership Approved',
    category: 'Organization',
    notifType: 'membership_approved',
  },
  {
    id: 'org_weekly_report',
    label: 'Weekly Report',
    category: 'Organization',
    notifType: 'weekly_report',
  },
  {
    id: 'org_announcement',
    label: 'Announcement',
    category: 'Organization',
    notifType: 'org_announcement',
  },
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

const MOCK_START_DATE = new Date(2026, 3, 16, 14, 0); // April 16, 2026 14:00 local
const MOCK_END_DATE = new Date(2026, 3, 16, 15, 0); //   April 16, 2026 15:00 local

/**
 * Locale-aware mock values used to interpolate {placeholder} tokens in
 * notification titles/bodies for the admin preview. Dates, times, and
 * currency render via Intl so French previews show "16 avril 2026" instead
 * of "April 16, 2026".
 */
export function getMockData(locale: Locale = 'en-US'): Record<string, string> {
  const isFr = locale === 'fr-CA';
  const dateStr = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(MOCK_START_DATE);
  const startTimeStr = new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(
    MOCK_START_DATE
  );
  const endTimeStr = new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(MOCK_END_DATE);
  const amountStr = new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD' }).format(
    45
  );

  return {
    playerName: 'Alex Johnson',
    sportName: 'Tennis',
    matchDate: dateStr,
    startTime: isFr ? ` à ${startTimeStr}` : ` at ${startTimeStr}`,
    locationName: 'Parc La Fontaine',
    locationAddress: '3933 Av du Parc La Fontaine, Montreal, QC H2L 3M6',
    timeUntil: isFr ? 'dans 30 minutes' : 'in 30 minutes',
    spotsLeft: '2',
    senderName: 'Marie Dupont',
    messagePreview: isFr
      ? 'Salut, on est toujours bons pour demain ?'
      : 'Hey, are we still on for tomorrow?',
    ratingSystemName: 'UTR',
    ratingValue: '7.5',
    ratingLabel: 'UTR 7.5',
    opponentNames: 'Alex Johnson',
    communityName: 'Montreal Tennis League',
    requesterName: 'Marc Tremblay',
    orgName: 'Montreal Tennis Club',
    courtName: 'Court A',
    facilityName: 'Montreal Tennis Club',
    bookingDate: dateStr,
    endTime: endTimeStr,
    memberRole: isFr ? 'Administrateur' : 'Admin',
    amountFormatted: amountStr,
    networkName: 'Rallia',
  };
}

/** @deprecated — use getMockData(locale) instead. Kept for any external callers. */
export const MOCK_DATA = getMockData('en-US');

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

/**
 * Locale-aware SMS string table. Mirrors sms.* keys in
 * supabase/functions/_shared/email-translations.ts — keep them in sync.
 */
const SMS_STRINGS: Record<string, Record<string, string>> = {
  'en-US': {
    prefix: 'Rallia: ',
    'urgent.startingSoon': 'STARTING {timeUntil}!',
    'urgent.startingSoonFallback': 'STARTING SOON!',
    'urgent.checkInOpen': 'CHECK-IN NOW OPEN!',
    'urgent.cancelled': 'CANCELLED',
    youreIn: "You're in!",
    startsIn: 'Starts {timeUntil}',
    startsInFallback: 'Starts soon',
    checkInOpen: 'Check-in is open',
    reminder: 'Reminder',
    at: 'at {location}',
    gameOn: 'Game on {date}',
    separator: ' - ',
  },
  'fr-CA': {
    prefix: 'Rallia : ',
    'urgent.startingSoon': 'COMMENCE {timeUntil} !',
    'urgent.startingSoonFallback': 'COMMENCE BIENTÔT !',
    'urgent.checkInOpen': 'ENREGISTREMENT OUVERT !',
    'urgent.cancelled': 'ANNULÉ',
    youreIn: "C'est confirmé !",
    startsIn: 'Commence {timeUntil}',
    startsInFallback: 'Commence bientôt',
    checkInOpen: 'Enregistrement ouvert',
    reminder: 'Rappel',
    at: 'à {location}',
    gameOn: 'Partie le {date}',
    separator: ' — ',
  },
};

function smsT(locale: Locale, key: string, params?: Record<string, string>): string {
  const normalized = locale === 'fr-CA' ? 'fr-CA' : 'en-US';
  let value = SMS_STRINGS[normalized]?.[key] ?? SMS_STRINGS['en-US'][key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
  }
  return value;
}

function getPrioritizedContent(
  notification: MockNotification,
  locale: Locale
): {
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
  const atLocation = locationName ? smsT(locale, 'at', { location: locationName }) : undefined;
  const gameOnDate = matchDate ? smsT(locale, 'gameOn', { date: matchDate }) : undefined;

  if (priority === 'urgent') {
    switch (type) {
      case 'match_starting_soon':
        return {
          prefix: `${sportPrefix}`,
          core: timeUntil
            ? smsT(locale, 'urgent.startingSoon', { timeUntil: timeUntil.toUpperCase() })
            : smsT(locale, 'urgent.startingSoonFallback'),
          extra: atLocation,
        };
      case 'match_check_in_available':
        return {
          prefix: `${sportPrefix}`,
          core: smsT(locale, 'urgent.checkInOpen'),
          extra: atLocation,
        };
      case 'match_cancelled':
        return {
          prefix: `${sportPrefix}`,
          core: smsT(locale, 'urgent.cancelled'),
          extra: gameOnDate,
        };
    }
  }

  const sep = smsT(locale, 'separator');

  switch (type) {
    case 'match_invitation':
      return {
        prefix: `${sportPrefix}`,
        core: title,
        extra: matchDate && playerName ? `${playerName}${sep}${matchDate}` : body || undefined,
      };
    case 'match_join_accepted':
      return {
        prefix: `${sportPrefix}`,
        core: smsT(locale, 'youreIn'),
        extra:
          matchDate && locationName
            ? `${matchDate} ${smsT(locale, 'at', { location: locationName })}`
            : body || undefined,
      };
    case 'match_starting_soon':
      return {
        prefix: `${sportPrefix}`,
        core: timeUntil
          ? smsT(locale, 'startsIn', { timeUntil })
          : smsT(locale, 'startsInFallback'),
        extra: atLocation,
      };
    case 'match_check_in_available':
      return {
        prefix: `${sportPrefix}`,
        core: smsT(locale, 'checkInOpen'),
        extra: atLocation,
      };
    case 'reminder':
      return {
        prefix: `${sportPrefix}`,
        core: smsT(locale, 'reminder'),
        extra:
          matchDate && locationName
            ? `${matchDate} ${smsT(locale, 'at', { location: locationName })}`
            : body || undefined,
      };
    default:
      return {
        prefix: sportPrefix || smsT(locale, 'prefix'),
        core: title,
        extra: body || undefined,
      };
  }
}

function formatSmsMessage(notification: MockNotification, locale: Locale): string {
  const maxLength = 160;
  const content = getPrioritizedContent(notification, locale);
  const separator = smsT(locale, 'separator');

  let message = content.prefix + content.core;

  if (content.extra) {
    const withExtra = `${message}${separator}${content.extra}`;
    if (withExtra.length <= maxLength) {
      message = withExtra;
    } else {
      const availableSpace = maxLength - message.length - separator.length - 3;
      if (availableSpace > 10) {
        message = `${message}${separator}${content.extra.substring(0, availableSpace)}...`;
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
  body: string | null,
  locale: Locale = 'en-US'
): { text: string; length: number; segments: number } {
  const mock = getMockData(locale);
  const isUrgent = URGENT_TYPES.includes(type);
  const notification: MockNotification = {
    type,
    title,
    body,
    priority: isUrgent ? 'urgent' : 'normal',
    payload: {
      sportName: mock.sportName,
      matchDate: mock.matchDate,
      locationName: mock.locationName,
      playerName: mock.playerName,
      timeUntil: mock.timeUntil,
    },
  };

  const text = formatSmsMessage(notification, locale);
  return {
    text,
    length: text.length,
    segments: Math.ceil(text.length / 160),
  };
}
