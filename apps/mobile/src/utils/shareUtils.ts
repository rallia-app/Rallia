/**
 * Share Utilities
 *
 * Functions for generating rich share messages with match details and deep links.
 */

import { Share } from 'react-native';
import { generateInvitationLink } from '@rallia/shared-services';
import type { MatchDetailData } from '../context/MatchDetailSheetContext';
import type { TranslationKey } from '../hooks';

/**
 * Translation function type for generating localized share messages.
 */
type TranslateFunction = (
  key: TranslationKey,
  options?: Record<string, string | number | boolean>
) => string;

/**
 * Options for generating share messages.
 */
interface ShareOptions {
  /** Translation function from useTranslation hook */
  t: TranslateFunction;
  /** Current locale for date/time formatting (e.g., 'en-US', 'fr-CA') */
  locale: string;
  /** Sender's referral code for attribution tracking */
  referralCode?: string;
}

/**
 * Generate the deep link URL for a match.
 * When referralCode is provided, uses the unified invitation link format
 * for referral attribution.
 */
export function generateMatchDeepLink(matchId: string, referralCode?: string): string {
  if (referralCode) {
    return generateInvitationLink({ type: 'match', referralCode, targetId: matchId });
  }
  return `https://rallia.app/match/${matchId}`;
}

/**
 * Format a date string for display in share messages.
 * Uses a locale-aware format: "Mon, Jan 20" (en) or "lun. 20 janv." (fr)
 */
function formatShareDate(dateStr: string, locale: string, timezone?: string): string {
  try {
    // Parse the date string (YYYY-MM-DD format)
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);

    return date.toLocaleDateString(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: timezone || 'UTC',
    });
  } catch {
    return dateStr;
  }
}

/**
 * Format time for display in share messages.
 * Uses locale-aware format: "2:00 PM" (en) or "14:00" (fr)
 */
function formatShareTime(timeStr: string, locale: string): string {
  try {
    const [hours, minutes] = timeStr.split(':').map(Number);

    // Create a date object to use Intl.DateTimeFormat
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);

    return date.toLocaleTimeString(locale, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: locale.startsWith('en'),
    });
  } catch {
    return timeStr?.substring(0, 5) || '';
  }
}

/**
 * Generate a rich share message for a match.
 * Includes sport, date, time, location, and deep link.
 * The message is localized based on the provided translation function and locale.
 *
 * @example (English)
 * "Join me for Tennis!
 *
 * 📅 Mon, Jan 20 at 2:00 PM
 * 📍 Central Park Courts
 *
 * https://rallia.app/match/abc123"
 *
 * @example (French)
 * "Rejoins-moi pour Tennis !
 *
 * 📅 lun. 20 janv. à 14:00
 * 📍 Courts de Central Park
 *
 * https://rallia.app/match/abc123"
 */
export function generateMatchShareMessage(match: MatchDetailData, options: ShareOptions): string {
  const { t, locale } = options;
  const sportName = match.sport?.name || 'game';
  const date = formatShareDate(match.match_date, locale, match.timezone);
  const time = match.start_time ? formatShareTime(match.start_time, locale) : '';
  const location = match.location_name || match.facility?.name || t('matchDetail.locationTBD');
  const deepLink = generateMatchDeepLink(match.id, options.referralCode);

  // Use translated strings
  const inviteText = t('matchDetail.shareInvite', { sport: sportName });
  const dateTimeStr = time ? t('matchDetail.shareDateTime', { date, time }) : date;

  // Build extra detail lines
  const extraLines: string[] = [];

  if (match.format) {
    const formatLabel = t(`match.format.${match.format}` as TranslationKey);
    extraLines.push(`👥 ${t('matchDetail.shareFormat', { format: formatLabel })}`);
  }

  if (match.duration) {
    const durationLabel =
      match.duration === 'custom' && match.custom_duration_minutes
        ? `${match.custom_duration_minutes} min`
        : t(`matchCreation.duration.${match.duration}` as TranslationKey);
    extraLines.push(`⏱ ${t('matchDetail.shareDuration', { duration: durationLabel })}`);
  }

  if (match.min_rating_score) {
    extraLines.push(
      `🏅 ${t('matchDetail.shareMinLevel', { level: match.min_rating_score.label })}`
    );
  }

  const extraBlock = extraLines.length > 0 ? `\n${extraLines.join('\n')}` : '';

  return (
    `${inviteText}\n\n` +
    `📅 ${dateTimeStr}\n` +
    `📍 ${location}` +
    `${extraBlock}\n\n` +
    `${deepLink}`
  );
}

/**
 * Share a match using the native share sheet.
 * Opens the system share dialog with a rich message containing match details.
 * The message is localized based on the user's current locale.
 *
 * @param match - The match to share
 * @param options - Translation options including t function and locale
 * @returns Promise that resolves when sharing is complete or cancelled
 */
export async function shareMatch(match: MatchDetailData, options: ShareOptions): Promise<void> {
  const message = generateMatchShareMessage(match, options);
  await Share.share({
    message,
    title: `${match.sport?.name || 'Game'} on Rallia`,
  });
}
