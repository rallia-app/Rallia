/**
 * Email Handler for Notification Delivery
 * Uses Resend API to send email notifications
 */

import type { NotificationRecord, DeliveryResult, OrganizationInfo } from '../types.ts';
import { renderOrgEmail } from '../templates/organization.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'noreply@rallia.com';
const SITE_URL = Deno.env.get('SITE_URL') || 'https://rallia.com';

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

  // Add sport context to match-related emails
  // Keep sport name lowercase as per user preference
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
  recipientEmail: string
): Promise<DeliveryResult> {
  if (!RESEND_API_KEY) {
    return {
      channel: 'email',
      status: 'failed',
      errorMessage: 'RESEND_API_KEY not configured',
    };
  }

  try {
    const htmlContent = generateEmailHtml(notification);
    const subject = generateEmailSubject(notification);

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: recipientEmail,
        subject,
        html: htmlContent,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        channel: 'email',
        status: 'failed',
        errorMessage: data?.message || data?.error || 'Failed to send email',
        providerResponse: data,
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
function generateMatchDetailsCard(payload: Record<string, unknown>): string {
  const sportName = payload.sportName as string | undefined;
  const matchDate = payload.matchDate as string | undefined;
  const startTime = payload.startTime as string | undefined;
  const locationName = payload.locationName as string | undefined;
  const playerName = payload.playerName as string | undefined;

  // Don't show card if no details available
  if (!matchDate && !locationName && !playerName) {
    return '';
  }

  const emoji = getSportEmoji(sportName);
  const detailRows: string[] = [];

  if (sportName) {
    detailRows.push(`
      <tr>
        <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 100px;">Sport</td>
        <td style="padding: 8px 0; color: #374151; font-size: 14px; font-weight: 500;">${emoji} ${escapeHtml(sportName)}</td>
      </tr>
    `);
  }

  if (matchDate) {
    const dateLabel = startTime ? `${matchDate} at ${startTime}` : matchDate;
    detailRows.push(`
      <tr>
        <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 100px;">When</td>
        <td style="padding: 8px 0; color: #374151; font-size: 14px; font-weight: 500;">${escapeHtml(dateLabel)}</td>
      </tr>
    `);
  }

  if (locationName) {
    detailRows.push(`
      <tr>
        <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 100px;">Where</td>
        <td style="padding: 8px 0; color: #374151; font-size: 14px; font-weight: 500;">${escapeHtml(locationName)}</td>
      </tr>
    `);
  }

  if (playerName) {
    detailRows.push(`
      <tr>
        <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 100px;">With</td>
        <td style="padding: 8px 0; color: #374151; font-size: 14px; font-weight: 500;">${escapeHtml(playerName)}</td>
      </tr>
    `);
  }

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td style="padding: 0 0 24px 0;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #ccfbf1; border: 2px solid #83c5be;">
            <tr>
              <td style="padding: 20px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  ${detailRows.join('')}
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

/**
 * Generate HTML email content from notification
 */
function generateEmailHtml(notification: NotificationRecord): string {
  const { title, body, type, payload } = notification;
  const currentYear = new Date().getFullYear();

  // Determine if we should show the match details card
  const isMatchRelated =
    type.startsWith('match_') || type === 'feedback_request' || type === 'reminder';
  const matchDetailsCard = isMatchRelated
    ? generateMatchDetailsCard(payload as Record<string, unknown>)
    : '';

  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <!--[if mso]>
      <style type="text/css">
        body, table, td { font-family: Arial, sans-serif !important; }
      </style>
    <![endif]-->
  </head>
  <body style="margin: 0; padding: 0;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f0fdfa; font-family: Arial, Helvetica, sans-serif;">
      <tr>
        <td align="center" style="padding: 40px 20px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="background-color: #ffffff;">
            <!-- Header -->
            <tr>
              <td align="center" style="padding: 40px 40px 20px 40px; background-color: #a8dad6;">
                <img src="${SITE_URL}/logo-dark.png" alt="Rallia" width="140" height="55" style="display: block; border: 0; max-width: 140px; height: auto;" />
              </td>
            </tr>

            <!-- Content -->
            <tr>
              <td style="padding: 40px 40px 30px 40px;">
                <h2 style="margin: 0; padding: 0 0 16px 0; font-family: Arial, Helvetica, sans-serif; font-size: 24px; font-weight: bold; color: #006d77; letter-spacing: -0.025em; line-height: 1.2;">
                  ${escapeHtml(title)}
                </h2>
                ${
                  body
                    ? `
                <p style="margin: 0; padding: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                  ${escapeHtml(body)}
                </p>
                `
                    : ''
                }

                ${matchDetailsCard}

                ${generateActionButton(type, payload)}

                <!-- Divider -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 24px;">
                  <tr>
                    <td style="padding: 24px 0; border-top: 1px solid #e5e7eb;">&nbsp;</td>
                  </tr>
                </table>

                <p style="margin: 0; padding: 0; font-size: 13px; line-height: 1.5; color: #9ca3af;">
                  If you didn't expect this notification, you can safely ignore this email.
                </p>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td align="center" style="padding: 30px 40px 40px 40px; background-color: #f9fafb; border-top: 1px solid #e5e7eb;">
                <p style="margin: 0; padding: 0 0 8px 0; font-size: 14px; font-weight: bold; color: #006d77;">Need help?</p>
                <p style="margin: 0; padding: 0; font-size: 13px; line-height: 1.5; color: #6b7280;">
                  If you're having trouble, please contact our support team.
                </p>
                <p style="margin: 0; padding: 16px 0 0 0; font-size: 12px; line-height: 1.5; color: #9ca3af;">
                  &copy; ${currentYear} Rallia. All rights reserved.
                </p>
              </td>
            </tr>
          </table>

          <!-- Spacer -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td align="center" style="padding: 20px 0;">
                <p style="margin: 0; padding: 0; font-size: 12px; line-height: 1.5; color: #9ca3af;">
                  You're receiving this email because of your notification preferences on Rallia.
                  <br>
                  <a href="rallia://settings/notifications" style="color: #006d77; text-decoration: none;">Manage preferences</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();
}

/**
 * Generate action button based on notification type
 */
function generateActionButton(type: string, payload: Record<string, unknown>): string {
  // Determine button text and deep link based on notification type
  let buttonText = 'Open Rallia';
  let deepLink = 'rallia://';

  switch (type) {
    case 'match_invitation':
      buttonText = 'View Invitation';
      if (payload.matchId) deepLink = `rallia://match/${payload.matchId}`;
      break;
    case 'match_join_request':
      buttonText = 'Review Request';
      if (payload.matchId) deepLink = `rallia://match/${payload.matchId}/requests`;
      break;
    case 'match_join_rejected':
    case 'match_cancelled':
    case 'player_kicked':
      buttonText = 'Browse Games';
      deepLink = 'rallia://discover';
      break;
    case 'match_completed':
      buttonText = 'Rate Your Game';
      if (payload.matchId) deepLink = `rallia://match/${payload.matchId}/feedback`;
      break;
    case 'match_join_accepted':
    case 'match_player_joined':
    case 'match_updated':
    case 'match_starting_soon':
    case 'player_left':
      buttonText = 'View Game';
      if (payload.matchId) deepLink = `rallia://match/${payload.matchId}`;
      break;
    case 'feedback_request':
      buttonText = 'Rate Your Game';
      if (payload.matchId) deepLink = `rallia://match/${payload.matchId}/feedback`;
      break;
    case 'reminder':
      buttonText = 'View Game Details';
      if (payload.matchId) deepLink = `rallia://match/${payload.matchId}`;
      break;
    case 'new_message':
    case 'chat':
      buttonText = 'View Message';
      if (payload.conversationId) deepLink = `rallia://chat/${payload.conversationId}`;
      break;
    case 'friend_request':
      buttonText = 'View Profile';
      if (payload.playerId) deepLink = `rallia://player/${payload.playerId}`;
      break;
    case 'rating_verified':
      buttonText = 'View Rating';
      deepLink = 'rallia://profile/ratings';
      break;
    default:
      buttonText = 'Open Rallia';
      deepLink = 'rallia://';
  }

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td style="background-color: #006d77; border-radius: 10px;">
          <a href="${deepLink}" style="display: inline-block; padding: 16px 40px; font-family: Arial, Helvetica, sans-serif; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none; letter-spacing: -0.01em;">
            ${buttonText}
          </a>
        </td>
      </tr>
    </table>
  `;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, char => htmlEscapes[char] || char);
}

/**
 * Send an organization-branded email notification via Resend
 */
export async function sendOrgEmail(
  notification: NotificationRecord,
  recipientEmail: string,
  organization: OrganizationInfo
): Promise<DeliveryResult> {
  if (!RESEND_API_KEY) {
    return {
      channel: 'email',
      status: 'failed',
      errorMessage: 'RESEND_API_KEY not configured',
    };
  }

  try {
    // Use organization email template
    const { subject, html } = renderOrgEmail(notification, organization);

    // Use organization's email as sender if available, otherwise fall back to default
    const fromEmail = organization.email || FROM_EMAIL;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: recipientEmail,
        subject,
        html,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        channel: 'email',
        status: 'failed',
        errorMessage: data?.message || data?.error || 'Failed to send email',
        providerResponse: data,
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
