/**
 * Notification Factory
 * Provides type-safe builders for creating notifications.
 * Handles template generation, priority assignment, and i18n support.
 */

import { supabase } from '../supabase';
import { createTranslator, normalizeLocale, defaultLocale } from '@rallia/shared-translations';
import type { Locale } from '@rallia/shared-translations';
import type {
  ExtendedNotificationTypeEnum,
  NotificationPriorityEnum,
  Notification,
} from '@rallia/shared-types';

/**
 * Payload types for different notification categories
 */
export interface MatchNotificationPayload {
  matchId: string;
  matchDate?: string;
  startTime?: string;
  sportName?: string;
  locationName?: string;
  playerName?: string;
  hostName?: string;
  spotsLeft?: number | string;
  totalSpots?: number;
  timeUntil?: string;
  updatedFields?: string[];
}

export interface PlayerNotificationPayload {
  playerId: string;
  playerName: string;
  profilePictureUrl?: string;
  sportName?: string;
  matchId?: string;
  matchDate?: string;
}

export interface MessageNotificationPayload {
  conversationId: string;
  senderName: string;
  messagePreview?: string;
}

export interface RatingNotificationPayload {
  sportName: string;
  ratingSystemName: string;
  ratingValue: string;
}

export interface FeedbackNotificationPayload {
  matchId: string;
  sportName?: string;
  playerName?: string;
  opponentNames?: string; // Pre-formatted: "John" or "John, Jane, and Mike"
  matchDate?: string;
  format?: 'singles' | 'doubles';
}

/**
 * Union type for all notification payloads
 */
export type NotificationPayload =
  | MatchNotificationPayload
  | PlayerNotificationPayload
  | MessageNotificationPayload
  | RatingNotificationPayload
  | FeedbackNotificationPayload
  | Record<string, unknown>;

/**
 * Format a human-readable time until a future date
 * Examples: "in 15 minutes", "in 2 hours", "tomorrow at 3:00 PM"
 */
export function formatTimeUntil(targetDate: Date, locale: string = 'en-US'): string {
  const now = new Date();
  const diffMs = targetDate.getTime() - now.getTime();

  if (diffMs < 0) {
    return 'now';
  }

  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 60) {
    return locale.startsWith('fr')
      ? `dans ${diffMinutes} minute${diffMinutes > 1 ? 's' : ''}`
      : `in ${diffMinutes} minute${diffMinutes > 1 ? 's' : ''}`;
  }

  if (diffHours < 24) {
    return locale.startsWith('fr')
      ? `dans ${diffHours} heure${diffHours > 1 ? 's' : ''}`
      : `in ${diffHours} hour${diffHours > 1 ? 's' : ''}`;
  }

  if (diffDays === 1) {
    const timeStr = targetDate.toLocaleTimeString(locale, {
      hour: 'numeric',
      minute: '2-digit',
    });
    return locale.startsWith('fr') ? `demain à ${timeStr}` : `tomorrow at ${timeStr}`;
  }

  // More than 1 day away
  return targetDate.toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Cache for user locales to avoid repeated DB calls
const userLocaleCache = new Map<string, { locale: Locale; timestamp: number }>();
const LOCALE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch user's preferred locale from the database
 * Uses a short-lived cache to avoid repeated DB calls
 */
async function getUserLocale(userId: string): Promise<Locale> {
  // Check cache first
  const cached = userLocaleCache.get(userId);
  if (cached && Date.now() - cached.timestamp < LOCALE_CACHE_TTL) {
    return cached.locale;
  }

  try {
    const { data, error } = await supabase
      .from('profile')
      .select('preferred_locale')
      .eq('id', userId)
      .single();

    if (error || !data?.preferred_locale) {
      return defaultLocale;
    }

    const locale = normalizeLocale(data.preferred_locale);

    // Cache the result
    userLocaleCache.set(userId, { locale, timestamp: Date.now() });

    return locale;
  } catch {
    return defaultLocale;
  }
}

/**
 * Fetch locales for multiple users at once
 * Returns a map of userId -> locale
 */
async function getUserLocales(userIds: string[]): Promise<Map<string, Locale>> {
  const result = new Map<string, Locale>();
  const uncachedUserIds: string[] = [];

  // Check cache first
  for (const userId of userIds) {
    const cached = userLocaleCache.get(userId);
    if (cached && Date.now() - cached.timestamp < LOCALE_CACHE_TTL) {
      result.set(userId, cached.locale);
    } else {
      uncachedUserIds.push(userId);
    }
  }

  // Fetch uncached locales from database
  if (uncachedUserIds.length > 0) {
    try {
      const { data, error } = await supabase
        .from('profile')
        .select('id, preferred_locale')
        .in('id', uncachedUserIds);

      if (!error && data) {
        for (const profile of data) {
          const locale = normalizeLocale(profile.preferred_locale);
          result.set(profile.id, locale);
          userLocaleCache.set(profile.id, { locale, timestamp: Date.now() });
        }
      }
    } catch {
      // Ignore errors, use default locale
    }
  }

  // Set default for any missing users
  for (const userId of userIds) {
    if (!result.has(userId)) {
      result.set(userId, defaultLocale);
    }
  }

  return result;
}

/**
 * Get translated title for a notification type
 */
function getTranslatedTitle(
  type: ExtendedNotificationTypeEnum,
  locale: Locale,
  payload?: NotificationPayload
): string {
  // Normalize payload to ensure sport names are lowercase
  const normalizedPayload = normalizePayload(payload);
  const t = createTranslator(locale);
  const translationKey = `notifications.messages.${type}.title`;
  const translated = t(translationKey, normalizedPayload as Record<string, string | number>);

  // If translation key was returned (not found), fall back to hardcoded templates
  if (translated === translationKey) {
    return interpolateTemplate(TITLE_TEMPLATES[type] ?? 'Notification', normalizedPayload);
  }

  // Ensure all variables are interpolated (safety check in case translation system missed some)
  return interpolateTemplate(translated, normalizedPayload);
}

/**
 * Get translated body for a notification type
 */
function getTranslatedBody(
  type: ExtendedNotificationTypeEnum,
  locale: Locale,
  payload?: NotificationPayload
): string {
  // Normalize payload to ensure sport names are lowercase
  const normalizedPayload = normalizePayload(payload);

  // Format date and startTime with locale-aware formatting
  const payloadWithFormattedValues = normalizedPayload
    ? {
        ...normalizedPayload,
        matchDate: formatDateForNotification(
          (normalizedPayload as Record<string, unknown>).matchDate as string | undefined,
          locale
        ),
        startTime: formatStartTimeWithPrefix(
          (normalizedPayload as Record<string, unknown>).startTime as string | undefined,
          locale
        ),
      }
    : normalizedPayload;

  const t = createTranslator(locale);

  // Use body_full variant when game is full (spotsLeft === 0)
  let bodySuffix = 'body';
  if (type === 'match_player_joined') {
    const spots = (payloadWithFormattedValues as Record<string, unknown>)?.spotsLeft;
    if (spots === '0' || spots === 0) {
      bodySuffix = 'body_full';
    }
  }

  const translationKey = `notifications.messages.${type}.${bodySuffix}`;
  const translated = t(
    translationKey,
    payloadWithFormattedValues as Record<string, string | number>
  );

  // If translation key was returned (not found), fall back to hardcoded templates
  if (translated === translationKey) {
    return interpolateTemplate(BODY_TEMPLATES[type] ?? '', payloadWithFormattedValues);
  }

  // Ensure all variables are interpolated (safety check in case translation system missed some)
  return interpolateTemplate(translated, payloadWithFormattedValues);
}

/**
 * Input for creating a notification
 */
export interface CreateNotificationInput {
  /** Type of notification */
  type: ExtendedNotificationTypeEnum;
  /** User ID to send notification to */
  userId: string;
  /** Optional target entity ID (match, player, conversation, etc.) */
  targetId?: string;
  /** Title override (uses template if not provided) */
  title?: string;
  /** Body override (uses template if not provided) */
  body?: string;
  /** Additional payload data */
  payload?: NotificationPayload;
  /** Priority override (uses default for type if not provided) */
  priority?: NotificationPriorityEnum;
  /** Schedule for later delivery */
  scheduledAt?: Date;
  /** Expiration time */
  expiresAt?: Date;
  /** Organization ID for org-context notifications */
  organizationId?: string;
}

/**
 * Default priorities for notification types
 */
const DEFAULT_PRIORITIES: Record<ExtendedNotificationTypeEnum, NotificationPriorityEnum> = {
  // Urgent - immediate attention required
  match_starting_soon: 'urgent',
  match_cancelled: 'urgent',

  // High - important but not time-critical
  match_invitation: 'high',
  match_join_request: 'high',
  match_join_accepted: 'high',
  match_join_rejected: 'high',
  match_player_joined: 'high',
  match_new_available: 'high',
  player_kicked: 'high',
  player_left: 'high',

  // Normal - standard notifications
  match_updated: 'normal',
  match_completed: 'normal',
  new_message: 'normal',
  chat: 'normal',
  friend_request: 'normal',
  rating_verified: 'normal',
  payment: 'normal',
  support: 'normal',
  reminder: 'normal',

  // Low - informational
  system: 'low',

  // Feedback - normal priority
  feedback_request: 'normal',
  feedback_reminder: 'normal',
  score_confirmation: 'normal',

  // Organization staff notifications
  booking_created: 'normal',
  booking_cancelled_by_player: 'high',
  booking_modified: 'normal',
  new_member_joined: 'normal',
  member_left: 'normal',
  member_role_changed: 'normal',
  payment_received: 'normal',
  payment_failed: 'high',
  refund_processed: 'normal',
  daily_summary: 'low',
  weekly_report: 'low',

  // Organization member notifications
  booking_confirmed: 'normal',
  booking_reminder: 'high',
  booking_cancelled_by_org: 'high',
  membership_approved: 'normal',
  org_announcement: 'normal',

  // Program notifications
  program_registration_confirmed: 'normal',
  program_registration_cancelled: 'high',
  program_session_reminder: 'high',
  program_session_cancelled: 'high',
  program_waitlist_promoted: 'normal',
  program_payment_due: 'high',
  program_payment_received: 'normal',
};

/**
 * Title templates for notification types
 * Use {variable} for interpolation
 * These are fallbacks when translations are not available
 */
const TITLE_TEMPLATES: Record<ExtendedNotificationTypeEnum, string> = {
  match_invitation: 'Game On!',
  match_join_request: 'New Player Request',
  match_join_accepted: "You're In!",
  match_join_rejected: 'Request Declined',
  match_player_joined: 'Player Joined!',
  match_new_available: 'New Game in Group',
  match_cancelled: 'Game Cancelled',
  match_updated: 'Game Updated',
  match_starting_soon: 'Get Ready!',
  match_completed: 'Great Game!',
  player_kicked: 'Removed from Game',
  player_left: 'Player Left',
  new_message: 'Message from {senderName}',
  chat: 'New Message',
  friend_request: 'New Connection Request',
  rating_verified: 'Rating Verified!',
  reminder: 'Upcoming Game',
  payment: 'Payment Update',
  support: 'Message from Rallia',
  system: 'Rallia Update',
  feedback_request: 'How Was Your Game?',
  feedback_reminder: "Don't Forget to Rate Your Game",
  score_confirmation: 'Confirm Match Score',

  // Organization staff notifications
  booking_created: 'New Booking',
  booking_cancelled_by_player: 'Booking Cancelled',
  booking_modified: 'Booking Modified',
  new_member_joined: 'New Member',
  member_left: 'Member Left',
  member_role_changed: 'Role Updated',
  payment_received: 'Payment Received',
  payment_failed: 'Payment Failed',
  refund_processed: 'Refund Processed',
  daily_summary: 'Daily Summary',
  weekly_report: 'Weekly Report',

  // Organization member notifications
  booking_confirmed: 'Booking Confirmed',
  booking_reminder: 'Upcoming Booking',
  booking_cancelled_by_org: 'Booking Cancelled',
  membership_approved: 'Membership Approved',
  org_announcement: 'Announcement',

  // Program notifications
  program_registration_confirmed: 'Registration Confirmed',
  program_registration_cancelled: 'Registration Cancelled',
  program_session_reminder: 'Session Reminder',
  program_session_cancelled: 'Session Cancelled',
  program_waitlist_promoted: "You're In!",
  program_payment_due: 'Payment Due',
  program_payment_received: 'Payment Received',
};

/**
 * Body templates for notification types
 * Use {variable} for interpolation from payload
 * These are fallbacks when translations are not available
 */
const BODY_TEMPLATES: Record<ExtendedNotificationTypeEnum, string> = {
  match_invitation: '{playerName} wants to play {sportName} with you on {matchDate}{startTime}',
  match_join_request: '{playerName} wants to join your {sportName} game on {matchDate}',
  match_join_accepted:
    'Your {sportName} game on {matchDate} at {locationName} is confirmed. See you there!',
  match_join_rejected:
    "Your request to join the {sportName} game wasn't accepted this time. Check out other games nearby!",
  match_player_joined: '{playerName} joined your {sportName} game. {spotsLeft} spot(s) left!',
  match_new_available:
    'A new {sportName} game was created in a group you belong to. Tap to view and join!',
  match_cancelled:
    'The {sportName} game on {matchDate} at {locationName} has been cancelled. We hope to see you on the court soon!',
  match_updated: 'Your {sportName} game on {matchDate} has new details. Tap to review the changes.',
  match_starting_soon:
    'Your {sportName} game at {locationName} starts {timeUntil}. Time to warm up!',
  match_completed: 'Your {sportName} game is complete. How did it go? Share your feedback!',
  player_kicked:
    "You've been removed from the {sportName} game on {matchDate}. Check out other games nearby!",
  player_left: '{playerName} left your {sportName} game. {spotsLeft} spot(s) now available.',
  new_message: '{messagePreview}',
  chat: 'You have a new message waiting for you',
  friend_request: '{playerName} wants to add you to their network. Check out their profile!',
  rating_verified:
    'Congrats! Your {ratingSystemName} rating of {ratingValue} for {sportName} is now verified.',
  reminder: "Don't forget your {sportName} game on {matchDate} at {locationName}",
  payment: 'Your payment status has been updated. Tap to view details.',
  support: 'Our support team has sent you a message. Tap to read.',
  system: 'We have an update for you. Tap to learn more.',
  feedback_request:
    'Rate your {sportName} game with {opponentNames}. Your feedback helps the community!',
  feedback_reminder:
    'Your {sportName} game feedback closes in 24 hours. Rate your experience with {opponentNames}!',
  score_confirmation:
    '{playerName} submitted the score for your {sportName} game. Please confirm or dispute.',

  // Organization staff notifications
  booking_created: '{playerName} booked {resourceName} on {bookingDate}{startTime}.',
  booking_cancelled_by_player:
    '{playerName} cancelled their booking for {resourceName} on {bookingDate}.',
  booking_modified: '{playerName} modified their booking for {resourceName} on {bookingDate}.',
  new_member_joined: '{memberName} has joined your organization.',
  member_left: '{memberName} has left your organization.',
  member_role_changed: "{memberName}'s role has been changed to {newRole}.",
  payment_received: 'Payment of {amount} received from {playerName}.',
  payment_failed: 'Payment of {amount} from {playerName} failed.',
  refund_processed: 'Refund of {amount} has been processed for {playerName}.',
  daily_summary: 'Your daily activity summary is ready to view.',
  weekly_report: 'Your weekly report is ready to view.',

  // Organization member notifications
  booking_confirmed:
    'Your booking for {resourceName} on {bookingDate}{startTime} has been confirmed.',
  booking_reminder:
    'Reminder: Your booking for {resourceName} is coming up on {bookingDate}{startTime}.',
  booking_cancelled_by_org:
    'Your booking for {resourceName} on {bookingDate} has been cancelled by the organization.',
  membership_approved: 'Your membership at {organizationName} has been approved!',
  org_announcement: '{organizationName}: {message}',

  // Program notifications
  program_registration_confirmed:
    'Your registration for {programName} has been confirmed. See you at the first session!',
  program_registration_cancelled:
    'Your registration for {programName} has been cancelled. Contact the organization if this was unexpected.',
  program_session_reminder:
    'Reminder: Your {programName} session is coming up on {sessionDate} at {startTime}.',
  program_session_cancelled:
    'Your {programName} session on {sessionDate} has been cancelled. Check the program for updates.',
  program_waitlist_promoted:
    "Great news! A spot opened up in {programName} and you've been promoted from the waitlist.",
  program_payment_due:
    'Payment for {programName} is due. Please complete payment to secure your spot.',
  program_payment_received: 'Payment for {programName} has been received. Thank you!',
};

/**
 * Normalize sport name to lowercase for consistent display
 */
function normalizeSportName(sportName?: string): string | undefined {
  if (!sportName) return undefined;
  return sportName.toLowerCase().trim();
}

/**
 * Get ordinal suffix for English dates (1st, 2nd, 3rd, 4th, etc.)
 */
function getOrdinalSuffix(day: number): string {
  if (day > 3 && day < 21) return 'th';
  switch (day % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

/**
 * Format date in locale-aware format
 * English: "January 5th 2025"
 * French: "5 Janvier 2025"
 */
function formatDateForNotification(dateStr: string | undefined, locale: Locale): string {
  if (!dateStr) return '';

  try {
    // Parse date string (handles YYYY-MM-DD format)
    // Use UTC to avoid timezone shifts when parsing date-only strings
    let date: Date;
    if (dateStr.includes('T')) {
      date = new Date(dateStr);
    } else {
      // For YYYY-MM-DD format, parse components directly to avoid timezone issues
      const [year, month, day] = dateStr.split('-').map(Number);
      date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    }

    if (isNaN(date.getTime())) {
      // If parsing fails, return original string
      return dateStr;
    }

    if (locale.startsWith('fr')) {
      // French format: "5 Janvier 2025"
      const formatter = new Intl.DateTimeFormat('fr-CA', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC', // Use UTC to avoid timezone shifts
      });
      return formatter.format(date);
    } else {
      // English format: "January 5th 2025"
      // Use UTC date components to avoid timezone shifts
      const utcYear = date.getUTCFullYear();
      const utcMonth = date.getUTCMonth();
      const utcDay = date.getUTCDate();

      const month = new Date(Date.UTC(utcYear, utcMonth, 1)).toLocaleDateString('en-US', {
        month: 'long',
        timeZone: 'UTC',
      });
      const ordinal = getOrdinalSuffix(utcDay);
      return `${month} ${utcDay}${ordinal} ${utcYear}`;
    }
  } catch (error) {
    // If formatting fails, return original string
    return dateStr;
  }
}

/**
 * Format startTime with locale-aware prefix for translation
 */
function formatStartTimeWithPrefix(startTime: string | undefined, locale: Locale): string {
  if (!startTime) return '';
  // Extract just the time part (HH:MM) if it includes date
  const timeOnly = startTime.includes('T')
    ? startTime.split('T')[1]?.slice(0, 5) || startTime.slice(0, 5)
    : startTime.slice(0, 5);

  // Format with locale-appropriate prefix
  // English: " at 14:30", French: " à 14:30"
  if (locale.startsWith('fr')) {
    return ` à ${timeOnly}`;
  }
  return ` at ${timeOnly}`;
}

/**
 * Normalize payload to ensure sport names are lowercase
 */
function normalizePayload(payload?: NotificationPayload): NotificationPayload | undefined {
  if (!payload) return payload;
  const normalized = { ...payload } as Record<string, unknown>;
  if (normalized.sportName) {
    normalized.sportName = normalizeSportName(normalized.sportName as string);
  }
  return normalized as NotificationPayload;
}

/**
 * Interpolate template variables with payload values
 * Handles optional variables by replacing with empty string if undefined
 */
function interpolateTemplate(template: string, payload?: NotificationPayload): string {
  if (!payload) return template;

  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = (payload as Record<string, unknown>)[key];
    if (value !== undefined && value !== null && value !== '') {
      return String(value);
    }
    // For optional variables like startTime, return empty string instead of placeholder
    // This allows translations to conditionally include parts like "at {startTime}"
    return '';
  });
}

/**
 * Create a notification in the database using RPC to bypass RLS
 * Fetches user's preferred locale to generate localized title and body
 */
export async function createNotification(input: CreateNotificationInput): Promise<Notification> {
  const {
    type,
    userId,
    targetId,
    title,
    body,
    payload,
    priority,
    scheduledAt,
    expiresAt,
    organizationId,
  } = input;

  // Normalize payload to ensure sport names are lowercase
  const normalizedPayload = normalizePayload(payload);

  // Fetch user's preferred locale for translations
  const userLocale = await getUserLocale(userId);

  // Generate title and body from translations if not provided
  const finalTitle = title ?? getTranslatedTitle(type, userLocale, normalizedPayload);
  const finalBody = body ?? getTranslatedBody(type, userLocale, normalizedPayload);
  const finalPriority = priority ?? DEFAULT_PRIORITIES[type] ?? 'normal';

  // Use RPC function to bypass RLS (SECURITY DEFINER)
  const { data, error } = await supabase.rpc('insert_notification', {
    p_user_id: userId,
    p_type: type,
    p_target_id: targetId ?? null,
    p_title: finalTitle,
    p_body: finalBody ?? null,
    p_payload: normalizedPayload ?? {},
    p_priority: finalPriority,
    p_scheduled_at: scheduledAt?.toISOString() ?? null,
    p_expires_at: expiresAt?.toISOString() ?? null,
    p_organization_id: organizationId ?? null,
  });

  if (error) {
    throw new Error(`Failed to create notification: ${error.message}`);
  }

  return data as Notification;
}

/**
 * Create multiple notifications at once (for batch operations)
 * Uses RPC function to bypass RLS
 * Fetches all users' preferred locales to generate localized notifications
 */
export async function createNotifications(
  inputs: CreateNotificationInput[]
): Promise<Notification[]> {
  // Fetch all user locales at once for efficiency
  const userIds = [...new Set(inputs.map(input => input.userId))];
  const userLocales = await getUserLocales(userIds);

  const insertData = inputs.map(input => {
    const {
      type,
      userId,
      targetId,
      title,
      body,
      payload,
      priority,
      scheduledAt,
      expiresAt,
      organizationId,
    } = input;

    // Normalize payload to ensure sport names are lowercase
    const normalizedPayload = normalizePayload(payload);

    const userLocale = userLocales.get(userId) ?? defaultLocale;
    const finalTitle = title ?? getTranslatedTitle(type, userLocale, normalizedPayload);
    const finalBody = body ?? getTranslatedBody(type, userLocale, normalizedPayload);
    const finalPriority = priority ?? DEFAULT_PRIORITIES[type] ?? 'normal';

    return {
      user_id: userId,
      type,
      target_id: targetId ?? null,
      title: finalTitle,
      body: finalBody,
      payload: normalizedPayload ?? {},
      priority: finalPriority,
      scheduled_at: scheduledAt?.toISOString() ?? null,
      expires_at: expiresAt?.toISOString() ?? null,
      organization_id: organizationId ?? null,
    };
  });

  // Use RPC function to bypass RLS (SECURITY DEFINER)
  const { data, error } = await supabase.rpc('insert_notifications', {
    p_notifications: insertData,
  });

  if (error) {
    throw new Error(`Failed to create notifications: ${error.message}`);
  }

  return (data ?? []) as Notification[];
}

// ============================================================================
// CONVENIENCE BUILDERS
// Type-safe helper functions for common notification types
// ============================================================================

/**
 * Notify a host that someone wants to join their match
 */
export async function notifyMatchJoinRequest(
  hostUserId: string,
  matchId: string,
  playerName: string,
  sportName?: string,
  matchDate?: string
): Promise<Notification> {
  return createNotification({
    type: 'match_join_request',
    userId: hostUserId,
    targetId: matchId,
    payload: { matchId, playerName, sportName, matchDate },
  });
}

/**
 * Notify a player that their join request was accepted
 */
export async function notifyJoinRequestAccepted(
  playerUserId: string,
  matchId: string,
  matchDate?: string,
  startTime?: string,
  sportName?: string,
  locationName?: string,
  hostName?: string
): Promise<Notification> {
  return createNotification({
    type: 'match_join_accepted',
    userId: playerUserId,
    targetId: matchId,
    payload: { matchId, matchDate, startTime, sportName, locationName, hostName },
  });
}

/**
 * Notify a player that their join request was rejected
 */
export async function notifyJoinRequestRejected(
  playerUserId: string,
  matchId: string,
  sportName?: string,
  matchDate?: string
): Promise<Notification> {
  return createNotification({
    type: 'match_join_rejected',
    userId: playerUserId,
    targetId: matchId,
    payload: { matchId, sportName, matchDate },
  });
}

/**
 * Notify match host and participants that a new player has joined (for open access matches)
 * Uses user's preferred locale for translations
 */
export async function notifyPlayerJoined(
  recipientUserIds: string[],
  matchId: string,
  playerName: string,
  sportName?: string,
  matchDate?: string,
  locationName?: string,
  spotsLeft?: number
): Promise<Notification[]> {
  // Title and body will be generated from translations in createNotifications
  // based on each user's preferred locale
  return createNotifications(
    recipientUserIds.map(userId => ({
      type: 'match_player_joined' as const,
      userId,
      targetId: matchId,
      payload: {
        matchId,
        playerName,
        sportName,
        matchDate,
        locationName,
        spotsLeft: spotsLeft !== undefined ? String(spotsLeft) : undefined,
      },
    }))
  );
}

/**
 * Notify all participants that a match was cancelled
 */
export async function notifyMatchCancelled(
  participantUserIds: string[],
  matchId: string,
  matchDate: string,
  sportName: string,
  startTime?: string,
  locationName?: string
): Promise<Notification[]> {
  return createNotifications(
    participantUserIds.map(userId => ({
      type: 'match_cancelled' as const,
      userId,
      targetId: matchId,
      payload: { matchId, matchDate, startTime, sportName, locationName },
    }))
  );
}

/**
 * Notify all participants that a match was updated
 * Fetches match details for a more informative notification
 */
export async function notifyMatchUpdated(
  participantUserIds: string[],
  matchId: string,
  updatedFields?: string[]
): Promise<Notification[]> {
  // Fetch match details for more informative notification
  const { data: matchDetails } = await supabase
    .from('match')
    .select(
      `
      sport:sport_id (name),
      match_date,
      start_time
    `
    )
    .eq('id', matchId)
    .single();

  const rawSportName = (matchDetails?.sport as { name?: string } | null)?.name;
  const sportName = rawSportName ? normalizeSportName(rawSportName) : undefined;

  // Extract time in HH:MM format for notification (formatting will be done in getTranslatedBody)
  const startTime = matchDetails?.start_time ? matchDetails.start_time.slice(0, 5) : undefined;

  return createNotifications(
    participantUserIds.map(userId => ({
      type: 'match_updated' as const,
      userId,
      targetId: matchId,
      payload: {
        matchId,
        updatedFields,
        sportName,
        matchDate: matchDetails?.match_date,
        startTime,
      },
    }))
  );
}

/**
 * Notify participants that a match is starting soon
 */
export async function notifyMatchStartingSoon(
  participantUserIds: string[],
  matchId: string,
  sportName: string,
  locationName?: string,
  timeUntil?: string
): Promise<Notification[]> {
  return createNotifications(
    participantUserIds.map(userId => ({
      type: 'match_starting_soon' as const,
      userId,
      targetId: matchId,
      payload: { matchId, sportName, locationName, timeUntil },
    }))
  );
}

/**
 * Notify a player they were kicked from a match
 */
export async function notifyPlayerKicked(
  playerUserId: string,
  matchId: string,
  sportName?: string,
  matchDate?: string,
  startTime?: string
): Promise<Notification> {
  return createNotification({
    type: 'player_kicked',
    userId: playerUserId,
    targetId: matchId,
    payload: { matchId, sportName, matchDate, startTime },
  });
}

/**
 * Notify match host and participants that a player has left the match
 * Uses user's preferred locale for translations
 */
export async function notifyPlayerLeft(
  recipientUserIds: string[],
  matchId: string,
  playerName: string,
  sportName?: string,
  spotsLeft?: number
): Promise<Notification[]> {
  // Title and body will be generated from translations in createNotifications
  // based on each user's preferred locale
  return createNotifications(
    recipientUserIds.map(userId => ({
      type: 'player_left' as const,
      userId,
      targetId: matchId,
      payload: {
        matchId,
        playerName,
        sportName,
        spotsLeft: spotsLeft !== undefined ? String(spotsLeft) : undefined,
      },
    }))
  );
}

/**
 * Notify a player they received a match invitation
 */
export async function notifyMatchInvitation(
  playerUserId: string,
  matchId: string,
  inviterName: string,
  sportName: string,
  matchDate: string,
  startTime?: string,
  locationName?: string
): Promise<Notification> {
  return createNotification({
    type: 'match_invitation',
    userId: playerUserId,
    targetId: matchId,
    payload: { matchId, playerName: inviterName, sportName, matchDate, startTime, locationName },
  });
}

/**
 * Notify a player about a new message
 */
export async function notifyNewMessage(
  playerUserId: string,
  conversationId: string,
  senderName: string,
  messagePreview?: string
): Promise<Notification> {
  return createNotification({
    type: 'new_message',
    userId: playerUserId,
    targetId: conversationId,
    payload: { conversationId, senderName, messagePreview },
  });
}

/**
 * Notify a player that their rating was verified
 */
export async function notifyRatingVerified(
  playerUserId: string,
  sportName: string,
  ratingSystemName: string,
  ratingValue: string
): Promise<Notification> {
  return createNotification({
    type: 'rating_verified',
    userId: playerUserId,
    payload: { sportName, ratingSystemName, ratingValue },
  });
}

/**
 * Notify participants that a match has been completed
 */
export async function notifyMatchCompleted(
  participantUserIds: string[],
  matchId: string,
  sportName: string
): Promise<Notification[]> {
  return createNotifications(
    participantUserIds.map(userId => ({
      type: 'match_completed' as const,
      userId,
      targetId: matchId,
      payload: { matchId, sportName },
    }))
  );
}

/**
 * Request feedback from a player about their match experience
 * @param opponentNames - Pre-formatted string: "John" for singles or "John, Jane, and Mike" for doubles
 */
export async function notifyFeedbackRequest(
  playerUserId: string,
  matchId: string,
  sportName: string,
  opponentNames?: string,
  matchDate?: string,
  format?: 'singles' | 'doubles'
): Promise<Notification> {
  return createNotification({
    type: 'feedback_request',
    userId: playerUserId,
    targetId: matchId,
    payload: { matchId, sportName, opponentNames, matchDate, format },
  });
}

/**
 * Send a feedback reminder to a player who hasn't completed their feedback
 * @param opponentNames - Pre-formatted string: "John" for singles or "John, Jane, and Mike" for doubles
 */
export async function notifyFeedbackReminder(
  playerUserId: string,
  matchId: string,
  sportName: string,
  opponentNames?: string,
  matchDate?: string,
  format?: 'singles' | 'doubles'
): Promise<Notification> {
  return createNotification({
    type: 'feedback_reminder',
    userId: playerUserId,
    targetId: matchId,
    payload: { matchId, sportName, opponentNames, matchDate, format },
  });
}

/**
 * Notify a player about a match reminder
 */
export async function notifyReminder(
  playerUserId: string,
  matchId: string,
  sportName: string,
  matchDate: string,
  locationName?: string
): Promise<Notification> {
  return createNotification({
    type: 'reminder',
    userId: playerUserId,
    targetId: matchId,
    payload: { matchId, sportName, matchDate, locationName },
  });
}

/**
 * Notification factory object for grouped exports
 */
export const notificationFactory = {
  // Core functions
  create: createNotification,
  createBatch: createNotifications,

  // Match lifecycle
  matchJoinRequest: notifyMatchJoinRequest,
  joinRequestAccepted: notifyJoinRequestAccepted,
  joinRequestRejected: notifyJoinRequestRejected,
  playerJoined: notifyPlayerJoined,
  playerLeft: notifyPlayerLeft,
  matchCancelled: notifyMatchCancelled,
  matchUpdated: notifyMatchUpdated,
  matchStartingSoon: notifyMatchStartingSoon,
  matchInvitation: notifyMatchInvitation,
  playerKicked: notifyPlayerKicked,
  matchCompleted: notifyMatchCompleted,
  feedbackRequest: notifyFeedbackRequest,
  feedbackReminder: notifyFeedbackReminder,
  reminder: notifyReminder,

  // Social
  newMessage: notifyNewMessage,
  ratingVerified: notifyRatingVerified,

  // Utilities
  formatTimeUntil,
};

export default notificationFactory;
