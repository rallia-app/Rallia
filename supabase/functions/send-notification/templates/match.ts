/**
 * Match Email Template Rendering
 * Pure rendering functions — no SDK dependencies.
 * Used by both the email handler (send-notification) and the email-preview function.
 */

import type { NotificationRecord } from '../types.ts';
import {
  wrapInLayout,
  renderCtaButton,
  renderSecondaryButton,
  renderDetailCard,
  renderDividerAndDisclaimer,
  renderStatusBadge,
  escapeHtml,
  EMAIL_TOKENS,
} from '../../_shared/email-layout.ts';
import { t } from '../../_shared/email-translations.ts';

const GOOGLE_MAPS_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';

/** Known sport icons available as hosted SVGs */
const SPORT_ICONS = new Set(['tennis', 'pickleball']);

/**
 * Convert a rallia:// deep link to a universal link using siteUrl.
 * Includes the locale segment so it matches the Next.js `/[locale]/...` route
 * and the mobile universal-link intent filters.
 */
function toUniversalLink(deepLink: string, siteUrl?: string, locale: string = 'en-US'): string {
  if (!siteUrl || !deepLink.startsWith('rallia://')) return deepLink;
  const path = deepLink.slice('rallia://'.length);
  const urlLocale = locale === 'fr' || locale === 'fr-CA' ? 'fr-CA' : 'en-US';
  return path ? `${siteUrl}/${urlLocale}/${path}` : `${siteUrl}/${urlLocale}/`;
}

/**
 * Generate email subject from the notification title.
 * Sport context belongs in the title/body itself, not as a bracketed tag.
 */
export function generateEmailSubject(notification: NotificationRecord): string {
  return notification.title;
}

/**
 * Map notification type to preheader translation key
 */
function getPreheaderKey(type: string): string {
  const keyMap: Record<string, string> = {
    match_invitation: 'preheader.matchInvitation',
    match_join_request: 'preheader.matchJoinRequest',
    match_join_accepted: 'preheader.matchJoinAccepted',
    match_join_rejected: 'preheader.matchJoinRejected',
    match_player_joined: 'preheader.matchPlayerJoined',
    match_cancelled: 'preheader.matchCancelled',
    match_updated: 'preheader.matchUpdated',
    match_starting_soon: 'preheader.matchStartingSoon',
    match_check_in_available: 'preheader.matchCheckInAvailable',
    player_kicked: 'preheader.playerKicked',
    player_left: 'preheader.playerLeft',
    reminder: 'preheader.reminder',
    feedback_request: 'preheader.feedbackRequest',
    feedback_reminder: 'preheader.feedbackReminder',
  };
  return keyMap[type] || '';
}

/**
 * Generate static map image HTML
 */
function generateStaticMapHtml(latitude: number, longitude: number, locale: string): string {
  if (!GOOGLE_MAPS_API_KEY) return '';

  const mapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${latitude},${longitude}&zoom=15&size=520x200&markers=color:red|${latitude},${longitude}&key=${GOOGLE_MAPS_API_KEY}`;
  const mapsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;

  return `
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="padding: 0 0 16px 0;">
                      <a href="${mapsLink}" style="text-decoration: none;">
                        <img src="${mapUrl}" alt="${t(locale, 'match.viewOnMap')}" width="520" style="display: block; border: 0; border-radius: 8px; max-width: 100%; height: auto;" />
                      </a>
                    </td>
                  </tr>
                </table>`;
}

/**
 * Generate calendar buttons HTML (Google Calendar + .ics download)
 */
function generateCalendarButtons(payload: Record<string, unknown>, locale: string): string {
  const matchDate = payload.matchDate as string | undefined;
  const startTime = payload.startTime as string | undefined;
  const sportName = payload.sportName as string | undefined;
  const locationName = payload.locationName as string | undefined;
  const matchDurationMinutes = payload.matchDurationMinutes as number | undefined;

  if (!matchDate) return '';

  // Build start/end ISO dates
  const startIso = startTime
    ? `${matchDate}T${startTime.length === 5 ? startTime + ':00' : startTime}`
    : `${matchDate}T00:00:00`;
  const durationMs = (matchDurationMinutes || 60) * 60 * 1000;
  const startDate = new Date(startIso);
  const endDate = new Date(startDate.getTime() + durationMs);

  if (isNaN(startDate.getTime())) return '';

  const title = sportName ? `${sportName} game on Rallia` : 'Game on Rallia';
  const location = locationName || '';

  // Google Calendar URL
  const gcalStart = startDate
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const gcalEnd = endDate
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const gcalUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${gcalStart}/${gcalEnd}&location=${encodeURIComponent(location)}&details=${encodeURIComponent('Created with Rallia')}`;

  // .ics download URL
  const icsUrl = `${SUPABASE_URL}/functions/v1/calendar-event?title=${encodeURIComponent(title)}&start=${encodeURIComponent(startDate.toISOString())}&end=${encodeURIComponent(endDate.toISOString())}&location=${encodeURIComponent(location)}&description=${encodeURIComponent('Created with Rallia')}`;

  return `
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td align="center" style="padding: 0 0 24px 0;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td style="padding: 0 8px 0 0;">
                            ${renderSecondaryButton(t(locale, 'match.addToGoogleCalendar'), gcalUrl)}
                          </td>
                          <td style="padding: 0 0 0 8px;">
                            ${renderSecondaryButton(t(locale, 'match.downloadIcs'), icsUrl)}
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>`;
}

/**
 * Generate status badge HTML for specific notification types
 */
function generateStatusBadge(type: string, locale: string): string {
  switch (type) {
    case 'match_cancelled':
      return renderStatusBadge(t(locale, 'match.status.cancelled'), 'red');
    case 'match_updated':
      return renderStatusBadge(t(locale, 'match.status.updated'), 'amber');
    case 'match_starting_soon':
      return renderStatusBadge(t(locale, 'match.status.startingSoon'), 'green');
    case 'match_check_in_available':
      return renderStatusBadge(t(locale, 'match.status.checkInOpen'), 'green');
    default:
      return '';
  }
}

/**
 * Generate match details card for match-related emails
 */
function generateMatchDetailsCard(
  payload: Record<string, unknown>,
  locale: string,
  siteUrl?: string
): string {
  const sportName = payload.sportName as string | undefined;
  const matchDate = payload.matchDate as string | undefined;
  const startTime = payload.startTime as string | undefined;
  const locationName = payload.locationName as string | undefined;
  const locationAddress = payload.locationAddress as string | undefined;
  const playerName = payload.playerName as string | undefined;
  const playerAvatarUrl = payload.playerAvatarUrl as string | undefined;
  const latitude = payload.latitude as number | undefined;
  const longitude = payload.longitude as number | undefined;

  if (!matchDate && !locationName && !playerName) {
    return '';
  }

  const rows: Array<{ label: string; value: string }> = [];

  if (sportName) {
    const normalized = sportName.toLowerCase().trim();
    const iconHtml =
      siteUrl && SPORT_ICONS.has(normalized)
        ? `<img src="${siteUrl}/icons/${normalized}.svg" alt="" width="20" height="20" style="vertical-align: middle; margin-right: 4px;" />`
        : '';
    rows.push({ label: t(locale, 'match.sport'), value: `${iconHtml}${escapeHtml(sportName)}` });
  }

  if (matchDate) {
    const dateLabel = startTime
      ? `${matchDate} ${t(locale, 'match.dateAt')} ${startTime}`
      : matchDate;
    rows.push({ label: t(locale, 'match.when'), value: escapeHtml(dateLabel) });
  }

  if (locationName) {
    rows.push({ label: t(locale, 'match.where'), value: escapeHtml(locationName) });
  }

  if (locationAddress) {
    rows.push({ label: t(locale, 'match.address'), value: escapeHtml(locationAddress) });
  }

  if (playerName) {
    // Show avatar next to player name if available
    const avatarHtml = playerAvatarUrl
      ? `<img src="${playerAvatarUrl}" alt="" width="32" height="32" style="display: inline-block; vertical-align: middle; border-radius: 50%; margin-right: 8px; border: 0;" />`
      : '';
    rows.push({
      label: t(locale, 'match.with'),
      value: `${avatarHtml}${escapeHtml(playerName)}`,
    });
  }

  let html = renderDetailCard(rows);

  // Add static map if coordinates are available
  if (latitude && longitude) {
    html += generateStaticMapHtml(latitude, longitude, locale);
  }

  return html;
}

/**
 * Generate action button based on notification type
 */
function generateActionButton(
  type: string,
  payload: Record<string, unknown>,
  locale: string,
  siteUrl?: string
): string {
  let buttonKey = 'match.button.openRallia';
  let deepLink = 'rallia://';

  switch (type) {
    case 'match_invitation':
      buttonKey = 'match.button.viewInvitation';
      if (payload.matchId) deepLink = `rallia://match/${payload.matchId}`;
      break;
    case 'match_join_request':
      buttonKey = 'match.button.reviewRequest';
      if (payload.matchId) deepLink = `rallia://match/${payload.matchId}/requests`;
      break;
    case 'match_join_rejected':
    case 'match_cancelled':
    case 'player_kicked':
      buttonKey = 'match.button.browseGames';
      deepLink = 'rallia://discover';
      break;
    case 'match_join_accepted':
    case 'match_player_joined':
    case 'match_updated':
    case 'match_starting_soon':
    case 'match_check_in_available':
    case 'match_new_available':
    case 'match_spot_opened':
    case 'nearby_match_available':
    case 'score_confirmation':
    case 'player_left':
      buttonKey = 'match.button.viewGame';
      if (payload.matchId) deepLink = `rallia://match/${payload.matchId}`;
      break;
    case 'feedback_request':
    case 'feedback_reminder':
      buttonKey = 'match.button.rateGame';
      if (payload.matchId) deepLink = `rallia://match/${payload.matchId}/feedback`;
      break;
    case 'reminder':
      buttonKey = 'match.button.viewGameDetails';
      if (payload.matchId) deepLink = `rallia://match/${payload.matchId}`;
      break;
    case 'new_message':
    case 'chat':
      buttonKey = 'match.button.viewMessage';
      if (payload.conversationId) deepLink = `rallia://chat/${payload.conversationId}`;
      break;
    case 'rating_verified':
      buttonKey = 'match.button.viewRating';
      deepLink = 'rallia://profile/ratings';
      break;
    default:
      buttonKey = 'match.button.openRallia';
      deepLink = 'rallia://';
  }

  return renderCtaButton(t(locale, buttonKey), toUniversalLink(deepLink, siteUrl, locale));
}

/**
 * Generate HTML email content from notification
 */
export function generateEmailHtml(
  notification: NotificationRecord,
  locale: string,
  siteUrl?: string,
  unsubscribeUrl?: string
): string {
  const { title, body, type, payload } = notification;
  const T = EMAIL_TOKENS;

  const isMatchRelated =
    type.startsWith('match_') || type === 'feedback_request' || type === 'reminder';
  const matchDetailsCard = isMatchRelated ? generateMatchDetailsCard(payload, locale, siteUrl) : '';

  const bodyHtml = body
    ? `
                <p style="margin: 0; padding: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: ${T.neutral900};">
                  ${escapeHtml(body)}
                </p>`
    : '';

  // Status badge for specific notification types
  const statusBadge = generateStatusBadge(type, locale);
  const titleWithBadge = statusBadge ? `${escapeHtml(title)} ${statusBadge}` : escapeHtml(title);

  // Calendar buttons for calendar-eligible notifications
  const calendarEligibleTypes = [
    'match_invitation',
    'match_join_accepted',
    'match_starting_soon',
    'match_check_in_available',
    'reminder',
  ];
  const calendarHtml = calendarEligibleTypes.includes(type)
    ? generateCalendarButtons(payload, locale)
    : '';

  const content = `
                <h2 style="margin: 0; padding: 0 0 16px 0; font-family: Poppins, Arial, Helvetica, sans-serif; font-size: 24px; font-weight: bold; color: ${T.primary600}; letter-spacing: -0.025em; line-height: 1.2;">
                  ${titleWithBadge}
                </h2>
                ${bodyHtml}

                ${matchDetailsCard}

                ${generateActionButton(type, payload, locale, siteUrl)}

                ${calendarHtml}

                ${renderDividerAndDisclaimer(t(locale, 'match.disclaimer'))}`;

  const manageHref = toUniversalLink('rallia://settings/notifications', siteUrl, locale);
  const manageLink = `<a href="${manageHref}" style="color: ${T.primary600}; text-decoration: none;">${t(locale, 'match.managePreferences')}</a>`;
  const footerNote = `${t(locale, 'match.footerNote')}<br>${manageLink}`;

  // Build preheader text
  const preheaderKey = getPreheaderKey(type);
  const preheader = preheaderKey
    ? t(locale, preheaderKey, payload as Record<string, string>)
    : undefined;

  return wrapInLayout({
    title: escapeHtml(title),
    content,
    footerNote,
    locale,
    preheader,
    showUnsubscribe: true,
    ...(siteUrl && { siteUrl }),
    ...(unsubscribeUrl && {
      unsubscribeUrl,
      unsubscribeLabel:
        locale === 'fr-CA' || locale === 'fr'
          ? 'Se désabonner de ces courriels'
          : 'Unsubscribe from these emails',
    }),
  });
}

/**
 * Mirrors `formatIntuitiveDateInTimezone` from
 * packages/shared-utils/src/formatters/dateFormatter.ts so notifications use the
 * same Today / Tomorrow / Weekday / Date cascade as the in-app match cards.
 *
 * - Today / Tomorrow → translated label (Today, Aujourd'hui, …).
 * - Within 6 days → weekday name (Wednesday, Mercredi).
 * - Further out → "Mon, Apr 28" / "lun. 28 avr." style.
 */
function formatNearbyDate(matchDate: string | undefined, timezone: string, locale: string): string {
  if (!matchDate) return '';
  const parts = matchDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some(n => Number.isNaN(n))) return '';

  const tz = timezone || 'America/Toronto';
  const ymd = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);

  const now = new Date();
  const today = ymd(now);
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = ymd(tomorrowDate);

  if (matchDate === today) {
    return t(locale, 'notification.nearby.today');
  }
  if (matchDate === tomorrow) {
    return t(locale, 'notification.nearby.tomorrow');
  }

  // Compute day delta from midnight in the target timezone (matches util logic)
  const todayMidnight = new Date(`${today}T00:00:00`);
  const targetMidnight = new Date(`${matchDate}T00:00:00`);
  const daysDiff = Math.round(
    (targetMidnight.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24)
  );

  const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  // Anchor at 12:00 UTC like the shared util, so the date doesn't slip across timezones
  const [y, m, d] = parts;
  const anchored = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));

  if (daysDiff >= 2 && daysDiff <= 6) {
    const weekday = new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      weekday: 'long',
    }).format(anchored);
    return capitalize(weekday);
  }

  return capitalize(
    new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(anchored)
  );
}

/**
 * Format a HH:MM time for the nearby_match push body.
 * EN: "6:30 PM". FR: "18:30".
 */
function formatNearbyTime(startTime: string | undefined, locale: string): string {
  if (!startTime) return '';
  const [hStr, mStr] = startTime.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return '';
  if (locale.startsWith('fr')) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Render the localized {title, body} for a `nearby_match_available` push.
 *
 * The trigger writes a compact English fallback into notification.title/body,
 * but the lock-screen experience should be in the recipient's preferred locale.
 * Each segment is conditionally rendered so a match without a min rating, a
 * custom location, or unknown spots count doesn't leak empty placeholders.
 */
export function renderNearbyMatchPush(
  payload: Record<string, unknown> | null | undefined,
  locale: string
): { title: string; body: string } {
  const sportNameRaw = (payload?.sportName as string | undefined)?.trim();
  const sportName = sportNameRaw ? sportNameRaw.toLowerCase() : '';

  const hostNameRaw = (payload?.hostName as string | undefined)?.trim();
  const timezone = (payload?.timezone as string | undefined) ?? 'America/Toronto';

  const matchDate = formatNearbyDate(payload?.matchDate as string | undefined, timezone, locale);
  const timeFormatted = formatNearbyTime(payload?.startTime as string | undefined, locale);
  const startTime = timeFormatted
    ? t(locale, 'notification.nearby.startTimePrefix', { time: timeFormatted })
    : '';
  const locationNameRaw = (payload?.locationName as string | undefined)?.trim();
  const locationName = locationNameRaw
    ? t(locale, 'notification.nearby.locationPrefix', { location: locationNameRaw })
    : '';

  const minRating = payload?.minRatingScore as string | undefined;
  const minRatingLabel = minRating
    ? t(locale, 'notification.nearby.minRatingPrefix', { score: minRating })
    : '';

  const spotsRaw = payload?.spotsLeft;
  const spotsCount = typeof spotsRaw === 'number' ? spotsRaw : Number(spotsRaw);
  const spotsLabel =
    Number.isFinite(spotsCount) && spotsCount > 0
      ? t(
          locale,
          spotsCount === 1
            ? 'notification.nearby.spotsLabel'
            : 'notification.nearby.spotsLabel_plural',
          { count: String(spotsCount) }
        )
      : '';

  const hostLabel = hostNameRaw
    ? t(locale, 'notification.nearby.hostLabel', { hostName: hostNameRaw })
    : '';

  const title = t(locale, 'notification.nearby.title', { sportName });
  const body = t(locale, 'notification.nearby.body', {
    matchDate,
    startTime,
    locationName,
    minRatingLabel,
    spotsLabel,
    hostLabel,
  });

  return { title, body: body.trim() };
}

/**
 * Render the localized {title, body} for a `new_message` push.
 *
 * notify_new_message hardcodes an English "Message from {sender}" title and
 * stores the raw message content as the body. For the lock screen we re-render
 * in the recipient's locale:
 *  - the title prefix is always ours, so it's localized for every chat push;
 *  - court_booking_prompt / court_booked are fully app-generated, so title AND
 *    body are localized (mirrors the in-app CourtSystemMessageCard copy);
 *  - match_organizer's body is app copy stored in the poster's locale, so it's
 *    re-rendered for the recipient;
 *  - a plain human message keeps the sender's own words as the body.
 *
 * `fallback` is the stored English title/body, used when the payload lacks the
 * fields needed to localize (older rows, missing sender name).
 */
export function renderChatMessagePush(
  payload: Record<string, unknown> | null | undefined,
  locale: string,
  fallback: { title: string; body: string }
): { title: string; body: string } {
  const messageType = payload?.messageType;
  const facility = (payload?.facilityName as string | undefined)?.trim();

  // Court system messages: fully app-generated — localize title + body.
  if (messageType === 'court_booking_prompt') {
    return {
      title: t(locale, 'notification.courtPrompt.title'),
      body: facility
        ? t(locale, 'notification.courtPrompt.body', { facility })
        : t(locale, 'notification.courtPrompt.bodyNoFacility'),
    };
  }
  if (messageType === 'court_booked') {
    const court =
      (payload?.courtLabel as string | undefined)?.trim() ||
      t(locale, 'notification.courtFallback');
    return {
      title: t(locale, 'notification.courtBooked.title', { court }),
      body: facility
        ? t(locale, 'notification.courtBooked.body', { facility })
        : t(locale, 'notification.courtBooked.bodyNoFacility'),
    };
  }

  // Human + match_organizer messages share the generic "message from {sender}"
  // title — localize it (the trigger hardcodes English).
  const senderName = (payload?.senderName as string | undefined)?.trim();
  const title = senderName
    ? t(locale, 'notification.chat.titleFrom', { senderName })
    : fallback.title;

  // match_organizer body is app copy in the poster's locale — re-render it.
  if (messageType === 'match_organizer') {
    return { title, body: t(locale, 'notification.matchOrganizer.body') };
  }

  // Plain human message: keep the sender's own words.
  return { title, body: fallback.body };
}
