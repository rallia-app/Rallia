/**
 * SMS Handler for Notification Delivery
 * Uses Twilio API to send SMS notifications
 */

import type { NotificationRecord, DeliveryResult } from '../types.ts';
import { t } from '../../_shared/email-translations.ts';

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER');

/**
 * Send an SMS notification via Twilio
 */
export async function sendSms(
  notification: NotificationRecord,
  recipientPhone: string,
  locale: string = 'en-US'
): Promise<DeliveryResult> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    return {
      channel: 'sms',
      status: 'failed',
      errorMessage: 'Twilio credentials not configured',
    };
  }

  try {
    const messageBody = formatSmsMessage(notification, locale);

    // Twilio API URL
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

    // Build form data
    const formData = new URLSearchParams();
    formData.append('To', recipientPhone);
    formData.append('From', TWILIO_PHONE_NUMBER);
    formData.append('Body', messageBody);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
      },
      body: formData.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        channel: 'sms',
        status: 'failed',
        errorMessage: data?.message || 'Failed to send SMS',
        providerResponse: data,
      };
    }

    return {
      channel: 'sms',
      status: 'success',
      providerResponse: {
        sid: data?.sid,
        status: data?.status,
      },
    };
  } catch (error) {
    return {
      channel: 'sms',
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get sport prefix for SMS messages
 * Keeps sport name in lowercase as per user preference
 */
function getSportPrefix(sportName?: string): string {
  if (!sportName) return '';
  const sport = sportName.toLowerCase().trim();
  return `[${sport}] `;
}

/**
 * Get the most important info for SMS based on notification type
 * Prioritizes critical info that fits in 160 chars
 */
function getPrioritizedContent(
  notification: NotificationRecord,
  locale: string
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
  const atLocation = locationName ? t(locale, 'sms.at', { location: locationName }) : undefined;
  const gameOnDate = matchDate ? t(locale, 'sms.gameOn', { date: matchDate }) : undefined;

  // Urgent notifications get special formatting
  if (priority === 'urgent') {
    switch (type) {
      case 'match_starting_soon':
        return {
          prefix: `${sportPrefix}`,
          core: timeUntil
            ? t(locale, 'sms.urgent.startingSoon', { timeUntil: timeUntil.toUpperCase() })
            : t(locale, 'sms.urgent.startingSoonFallback'),
          extra: atLocation,
        };
      case 'match_check_in_available':
        return {
          prefix: `${sportPrefix}`,
          core: t(locale, 'sms.urgent.checkInOpen'),
          extra: atLocation,
        };
      case 'match_cancelled':
        return {
          prefix: `${sportPrefix}`,
          core: t(locale, 'sms.urgent.cancelled'),
          extra: gameOnDate,
        };
    }
  }

  // Type-specific formatting for better context
  switch (type) {
    case 'match_invitation':
      return {
        prefix: `${sportPrefix}`,
        core: title,
        extra:
          matchDate && playerName
            ? `${playerName}${t(locale, 'sms.separator')}${matchDate}`
            : body || undefined,
      };

    case 'match_join_accepted':
      return {
        prefix: `${sportPrefix}`,
        core: t(locale, 'sms.youreIn'),
        extra:
          matchDate && locationName
            ? `${matchDate} ${t(locale, 'sms.at', { location: locationName })}`
            : body || undefined,
      };

    case 'match_starting_soon':
      return {
        prefix: `${sportPrefix}`,
        core: timeUntil
          ? t(locale, 'sms.startsIn', { timeUntil })
          : t(locale, 'sms.startsInFallback'),
        extra: atLocation,
      };

    case 'match_check_in_available':
      return {
        prefix: `${sportPrefix}`,
        core: t(locale, 'sms.checkInOpen'),
        extra: atLocation,
      };

    case 'reminder':
      return {
        prefix: `${sportPrefix}`,
        core: t(locale, 'sms.reminder'),
        extra:
          matchDate && locationName
            ? `${matchDate} ${t(locale, 'sms.at', { location: locationName })}`
            : body || undefined,
      };

    default:
      return {
        prefix: sportPrefix || t(locale, 'sms.prefix'),
        core: title,
        extra: body || undefined,
      };
  }
}

/**
 * Format the SMS message from notification
 * SMS has a 160 character limit for single segment
 * Prioritizes most important information within the limit
 */
function formatSmsMessage(notification: NotificationRecord, locale: string): string {
  const maxLength = 160;
  const content = getPrioritizedContent(notification, locale);
  const separator = t(locale, 'sms.separator');

  // Build message with prioritized content
  let message = content.prefix + content.core;

  // Add extra info if we have room
  if (content.extra) {
    const withExtra = `${message}${separator}${content.extra}`;
    if (withExtra.length <= maxLength) {
      message = withExtra;
    } else {
      // Try to fit as much extra as possible
      const availableSpace = maxLength - message.length - separator.length - 3; // sep + "..."
      if (availableSpace > 10) {
        message = `${message}${separator}${content.extra.substring(0, availableSpace)}...`;
      }
    }
  }

  // Final truncation if still too long
  if (message.length > maxLength) {
    message = message.substring(0, maxLength - 3) + '...';
  }

  return message;
}

/**
 * Validate phone number format
 * Returns true if phone appears to be a valid format
 */
export function isValidPhoneNumber(phone: string): boolean {
  // Basic validation - should start with + and contain only digits after
  const phoneRegex = /^\+[1-9]\d{6,14}$/;
  return phoneRegex.test(phone.replace(/[\s\-()]/g, ''));
}
