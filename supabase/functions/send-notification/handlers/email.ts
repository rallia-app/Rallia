/**
 * Email Handler for Notification Delivery
 * Uses Resend SDK to send email notifications
 */

import { Resend } from 'resend';
import type { NotificationRecord, DeliveryResult, OrganizationInfo } from '../types.ts';
import { renderOrgEmail } from '../templates/organization.ts';
import {
  wrapInLayout,
  renderCtaButton,
  renderDetailCard,
  renderDividerAndDisclaimer,
  escapeHtml,
  EMAIL_TOKENS,
} from '../../_shared/email-layout.ts';
import { t } from '../../_shared/email-translations.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'noreply@rallia.com';

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
function generateEmailSubject(notification: NotificationRecord): string {
  const { title, type, payload } = notification;
  const sportName = (payload as Record<string, unknown>)?.sportName as string | undefined;
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
 * Send an email notification via Resend
 */
export async function sendEmail(
  notification: NotificationRecord,
  recipientEmail: string,
  locale: string = 'en-US'
): Promise<DeliveryResult> {
  if (!RESEND_API_KEY) {
    return {
      channel: 'email',
      status: 'failed',
      errorMessage: 'RESEND_API_KEY not configured',
    };
  }

  try {
    const htmlContent = generateEmailHtml(notification, locale);
    const subject = generateEmailSubject(notification);

    const resend = new Resend(RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: recipientEmail,
      subject,
      html: htmlContent,
    });

    if (error) {
      return {
        channel: 'email',
        status: 'failed',
        errorMessage: error.message,
        providerResponse: error,
      };
    }

    return {
      channel: 'email',
      status: 'success',
      providerResponse: { id: data?.id },
    };
  } catch (error) {
    return {
      channel: 'email',
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Generate match details card for match-related emails
 */
function generateMatchDetailsCard(
  payload: Record<string, unknown>,
  locale: string
): string {
  const sportName = payload.sportName as string | undefined;
  const matchDate = payload.matchDate as string | undefined;
  const startTime = payload.startTime as string | undefined;
  const locationName = payload.locationName as string | undefined;
  const playerName = payload.playerName as string | undefined;

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

  if (playerName) {
    rows.push({ label: t(locale, 'match.with'), value: escapeHtml(playerName) });
  }

  return renderDetailCard(rows);
}

/**
 * Generate HTML email content from notification
 */
function generateEmailHtml(notification: NotificationRecord, locale: string): string {
  const { title, body, type, payload } = notification;
  const T = EMAIL_TOKENS;

  const isMatchRelated =
    type.startsWith('match_') || type === 'feedback_request' || type === 'reminder';
  const matchDetailsCard = isMatchRelated
    ? generateMatchDetailsCard(payload as Record<string, unknown>, locale)
    : '';

  const bodyHtml = body
    ? `
                <p style="margin: 0; padding: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: ${T.neutral900};">
                  ${escapeHtml(body)}
                </p>`
    : '';

  const content = `
                <h2 style="margin: 0; padding: 0 0 16px 0; font-family: Poppins, Arial, Helvetica, sans-serif; font-size: 24px; font-weight: bold; color: ${T.primary600}; letter-spacing: -0.025em; line-height: 1.2;">
                  ${escapeHtml(title)}
                </h2>
                ${bodyHtml}

                ${matchDetailsCard}

                ${generateActionButton(type, payload, locale)}

                ${renderDividerAndDisclaimer(t(locale, 'match.disclaimer'))}`;

  const manageLink = `<a href="rallia://settings/notifications" style="color: ${T.primary600}; text-decoration: none;">${t(locale, 'match.managePreferences')}</a>`;
  const footerNote = `${t(locale, 'match.footerNote')}<br>${manageLink}`;

  return wrapInLayout({
    title: escapeHtml(title),
    content,
    footerNote,
    locale,
  });
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
    case 'match_completed':
      buttonKey = 'match.button.rateGame';
      if (payload.matchId) deepLink = `rallia://match/${payload.matchId}/feedback`;
      break;
    case 'match_join_accepted':
    case 'match_player_joined':
    case 'match_updated':
    case 'match_starting_soon':
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
 * Send an organization-branded email notification via Resend
 */
export async function sendOrgEmail(
  notification: NotificationRecord,
  recipientEmail: string,
  organization: OrganizationInfo,
  locale: string = 'en-US'
): Promise<DeliveryResult> {
  if (!RESEND_API_KEY) {
    return {
      channel: 'email',
      status: 'failed',
      errorMessage: 'RESEND_API_KEY not configured',
    };
  }

  try {
    const { subject, html } = renderOrgEmail(notification, organization, locale);

    // Use organization's email as sender if available, otherwise fall back to default
    const fromEmail = organization.email || FROM_EMAIL;

    const resend = new Resend(RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: recipientEmail,
      subject,
      html,
    });

    if (error) {
      return {
        channel: 'email',
        status: 'failed',
        errorMessage: error.message,
        providerResponse: error,
      };
    }

    return {
      channel: 'email',
      status: 'success',
      providerResponse: { id: data?.id, organizationId: organization.id },
    };
  } catch (error) {
    return {
      channel: 'email',
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
