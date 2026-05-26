/**
 * Share Utilities
 *
 * Functions for generating rich share messages with match details and deep links.
 */

import { Share } from 'react-native';
import { generateInvitationLink } from '@rallia/shared-services';
import { buildUtmUrl, formatIntuitiveDateInTimezone, type UtmParams } from '@rallia/shared-utils';

import type { MatchDetailData } from '#/context/MatchDetailSheetContext';
import type { TranslationKey } from '#/hooks';

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
  /** Optional UTM params for inbound attribution */
  utm?: UtmParams;
}

/**
 * Generate the deep link URL for a match.
 * When referralCode is provided, uses the unified invitation link format
 * for referral attribution.
 */
export function generateMatchDeepLink(
  matchId: string,
  referralCode?: string,
  utm?: UtmParams
): string {
  if (referralCode) {
    return generateInvitationLink({ type: 'match', referralCode, targetId: matchId, utm });
  }
  const base = `https://rallia.app/match/${matchId}`;
  return utm ? buildUtmUrl(base, utm) : base;
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
 * Build a date phrase with the correct preposition for inline use in
 * conversational share messages.
 *
 * Uses `formatIntuitiveDateInTimezone` to detect today/tomorrow/weekday,
 * then wraps the result in a locale-aware phrase that includes the
 * appropriate preposition (EN: "today", "this Wednesday", "on Mon, Jan 20";
 * FR: "aujourd'hui", "mercredi", "le lun. 20 janv.").
 */
function buildDatePhrase(
  dateStr: string,
  timezone: string,
  locale: string,
  t: TranslateFunction
): string {
  const result = formatIntuitiveDateInTimezone(dateStr, timezone || 'UTC', locale);
  switch (result.type) {
    case 'today':
      return t('matchCreation.shareToFacebook.message.datePhraseToday');
    case 'tomorrow':
      return t('matchCreation.shareToFacebook.message.datePhraseTomorrow');
    case 'weekday':
      return t('matchCreation.shareToFacebook.message.datePhraseWeekday', {
        weekday: result.label,
      });
    case 'date':
    default:
      return t('matchCreation.shareToFacebook.message.datePhraseDate', {
        date: result.label,
      });
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
  const deepLink = generateMatchDeepLink(match.id, options.referralCode, options.utm);

  // Use translated strings
  const inviteText = t('matchDetail.shareInvite', { sport: sportName });
  const dateTimeStr = time ? t('matchDetail.shareDateTime', { date, time }) : date;

  // Build extra detail lines
  const extraLines: string[] = [];

  if (match.format) {
    const formatLabel = t(`match.format.${match.format}`);
    extraLines.push(`👥 ${t('matchDetail.shareFormat', { format: formatLabel })}`);
  }

  if (match.duration) {
    const durationLabel =
      match.duration === 'custom' && match.custom_duration_minutes
        ? `${match.custom_duration_minutes} min`
        : t(`matchCreation.duration.${match.duration}`);
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

/**
 * Capitalize the first character of a string.
 */
function capitalizeFirst(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Format a money amount for inline use in the share message.
 * Drops trailing `.00` for whole dollars, keeps two decimals otherwise.
 */
function formatMoney(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/**
 * Format a rating score (e.g. NTRP 3.0, UTR 4.5) with at least one decimal —
 * "3" → "3.0", "3.5" → "3.5", "4" → "4.0".
 */
function formatRatingScore(score: number): string {
  return Number.isInteger(score) ? score.toFixed(1) : String(score);
}

/**
 * Generate a conversational Facebook-group-style post for a match.
 *
 * Designed to read like an actual human post in a Facebook group, not a
 * structured invitation. Each available field (location, format, duration,
 * rating) flows inline as a sentence rather than being labelled.
 *
 * @example (English, singles + casual + court booked + free + 3.5+)
 * "Looking for a partner on Mon, Jan 20 at 2:00 PM. Heading to Central Park Courts, court's already booked. It's free. Pretty chill, about 1 hour, 3.5+ would be great.
 *
 * Hit the link if you're in.
 * https://rallia.app/match/abc123"
 */
export function generateFacebookPostMessage(match: MatchDetailData, options: ShareOptions): string {
  const { t, locale } = options;
  const datePhrase = buildDatePhrase(match.match_date, match.timezone || 'UTC', locale, t);
  const time = match.start_time ? formatShareTime(match.start_time, locale) : '';
  const location = match.location_name || match.facility?.name || null;
  const deepLink = generateMatchDeepLink(match.id, options.referralCode, options.utm);

  // contentParts collects sentences that will be joined with a space into one
  // prose paragraph, avoiding a bullet-pointish look.
  const contentParts: string[] = [];

  // Intro line — phrasing depends on format (singles vs doubles)
  // since the ask is fundamentally different ("partner" vs "group of players")
  const hasTime = !!time;
  let introKey: TranslationKey;
  if (match.format === 'singles') {
    introKey = hasTime
      ? 'matchCreation.shareToFacebook.message.introSingles'
      : 'matchCreation.shareToFacebook.message.introSinglesNoTime';
  } else if (match.format === 'doubles') {
    introKey = hasTime
      ? 'matchCreation.shareToFacebook.message.introDoubles'
      : 'matchCreation.shareToFacebook.message.introDoublesNoTime';
  } else {
    introKey = hasTime
      ? 'matchCreation.shareToFacebook.message.introGeneric'
      : 'matchCreation.shareToFacebook.message.introGenericNoTime';
  }
  contentParts.push(t(introKey, hasTime ? { datePhrase, time } : { datePhrase }));

  // Location — simple, no court booking or cost details.
  if (location) {
    contentParts.push(t('matchCreation.shareToFacebook.message.locationLine', { location }));
  }

  // Inline details: gender filter + vibe + duration — comma-joined into one
  // sentence. Level gets its own sentence for emphasis.
  const detailParts: string[] = [];
  if (match.preferred_opponent_gender === 'male') {
    detailParts.push(t('matchCreation.shareToFacebook.message.preferMale'));
  } else if (match.preferred_opponent_gender === 'female') {
    detailParts.push(t('matchCreation.shareToFacebook.message.preferFemale'));
  }
  if (match.player_expectation === 'casual') {
    detailParts.push(t('matchCreation.shareToFacebook.message.casual'));
  } else if (match.player_expectation === 'competitive') {
    detailParts.push(t('matchCreation.shareToFacebook.message.competitive'));
  }
  if (match.duration) {
    const durationLabel =
      match.duration === 'custom' && match.custom_duration_minutes
        ? `${match.custom_duration_minutes} min`
        : t(`matchCreation.duration.${match.duration}`);
    detailParts.push(
      t('matchCreation.shareToFacebook.message.duration', { duration: durationLabel })
    );
  }
  if (detailParts.length > 0) {
    contentParts.push(`${capitalizeFirst(detailParts.join(', '))}.`);
  }

  // Level as its own sentence — reads as an inviting suggestion rather than
  // the tail of a comma list.
  if (match.min_rating_score) {
    const numericScore = match.min_rating_score.value;
    let scoreLabel: string;
    if (typeof numericScore === 'number') {
      scoreLabel = formatRatingScore(numericScore);
    } else {
      const trailing = match.min_rating_score.label.match(/[\d.]+\s*$/);
      const parsed = trailing ? Number(trailing[0]) : NaN;
      scoreLabel = Number.isFinite(parsed)
        ? formatRatingScore(parsed)
        : match.min_rating_score.label;
    }
    contentParts.push(
      `${capitalizeFirst(t('matchCreation.shareToFacebook.message.level', { level: scoreLabel }))}.`
    );
  }

  // Join all sentences into one flowing paragraph, then CTA + link.
  return [
    contentParts.join(' '),
    '',
    t('matchCreation.shareToFacebook.message.cta'),
    deepLink,
  ].join('\n');
}
