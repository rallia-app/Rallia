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

/**
 * Sport-specific emoji for email subjects
 */
const SPORT_EMOJI: Record<string, string> = {
  tennis: '🎾',
  pickleball: '',
  badminton: '🏸',
  default: '🏃',
};

/**
 * Get sport emoji
 */
function getSportEmoji(sportName?: string): string {
  if (!sportName) return SPORT_EMOJI.default;
  const normalized = sportName.toLowerCase().trim();
  return SPORT_EMOJI[normalized] || SPORT_EMOJI.default;
}

/**
 * Generate email subject with sport context
 */
export function generateEmailSubject(notification: NotificationRecord): string {
  const { title, type, payload } = notification;
  const sportName = payload?.sportName as string | undefined;
  const emoji = getSportEmoji(sportName);

  if (type.startsWith('match_') || type === 'feedback_request' || type === 'reminder') {
    if (sportName) {
      const normalizedSport = sportName.toLowerCase().trim();
      return `${emoji} [${normalizedSport}] ${title}`;
    }
  }

  return title;
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
function generateMatchDetailsCard(payload: Record<string, unknown>, locale: string): string {
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

  const emoji = getSportEmoji(sportName);
  const rows: Array<{ label: string; value: string }> = [];

  if (sportName) {
    rows.push({ label: t(locale, 'match.sport'), value: `${emoji} ${escapeHtml(sportName)}` });
  }

  if (matchDate) {
    const dateLabel = startTime ? `${matchDate} at ${startTime}` : matchDate;
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
  locale: string
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
    case 'player_left':
      buttonKey = 'match.button.viewGame';
      if (payload.matchId) deepLink = `rallia://match/${payload.matchId}`;
      break;
    case 'feedback_request':
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
    case 'friend_request':
      buttonKey = 'match.button.viewProfile';
      if (payload.playerId) deepLink = `rallia://player/${payload.playerId}`;
      break;
    case 'rating_verified':
      buttonKey = 'match.button.viewRating';
      deepLink = 'rallia://profile/ratings';
      break;
    default:
      buttonKey = 'match.button.openRallia';
      deepLink = 'rallia://';
  }

  return renderCtaButton(t(locale, buttonKey), deepLink);
}

/**
 * Generate HTML email content from notification
 */
export function generateEmailHtml(
  notification: NotificationRecord,
  locale: string,
  siteUrl?: string
): string {
  const { title, body, type, payload } = notification;
  const T = EMAIL_TOKENS;

  const isMatchRelated =
    type.startsWith('match_') || type === 'feedback_request' || type === 'reminder';
  const matchDetailsCard = isMatchRelated ? generateMatchDetailsCard(payload, locale) : '';

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

                ${generateActionButton(type, payload, locale)}

                ${calendarHtml}

                ${renderDividerAndDisclaimer(t(locale, 'match.disclaimer'))}`;

  const manageLink = `<a href="rallia://settings/notifications" style="color: ${T.primary600}; text-decoration: none;">${t(locale, 'match.managePreferences')}</a>`;
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
  });
}
