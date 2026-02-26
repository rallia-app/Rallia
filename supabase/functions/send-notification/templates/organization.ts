/**
 * Organization-branded Email Templates
 * Renders emails with organization branding for booking, member, and payment notifications.
 */

import type { NotificationRecord, OrganizationInfo, OrgNotificationType } from '../types.ts';

export interface EmailContent {
  subject: string;
  html: string;
}

const SITE_URL = Deno.env.get('SITE_URL') || 'https://rallia.com';

/**
 * Format currency amount from cents
 */
function formatCurrency(cents: number | undefined, currency: string = 'CAD'): string {
  if (cents === undefined) return '';
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

/**
 * Get notification category for styling
 */
function getNotificationCategory(
  type: OrgNotificationType
): 'booking' | 'member' | 'payment' | 'system' {
  if (type.startsWith('booking_')) return 'booking';
  if (type.includes('member') || type === 'membership_approved') return 'member';
  if (type.includes('payment') || type === 'refund_processed') return 'payment';
  return 'system';
}

/**
 * Generate booking details card
 */
function generateBookingCard(payload: Record<string, unknown>): string {
  const courtName = payload.courtName as string | undefined;
  const facilityName = payload.facilityName as string | undefined;
  const bookingDate = payload.bookingDate as string | undefined;
  const startTime = payload.startTime as string | undefined;
  const endTime = payload.endTime as string | undefined;
  const playerName = payload.playerName as string | undefined;
  const priceCents = payload.priceCents as number | undefined;
  const currency = (payload.currency as string) || 'CAD';

  if (!courtName && !bookingDate) return '';

  const rows: string[] = [];

  if (courtName) {
    rows.push(`
      <tr>
        <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 120px;">Court</td>
        <td style="padding: 8px 0; color: #374151; font-size: 14px; font-weight: 500;">${escapeHtml(courtName)}</td>
      </tr>
    `);
  }

  if (facilityName) {
    rows.push(`
      <tr>
        <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 120px;">Location</td>
        <td style="padding: 8px 0; color: #374151; font-size: 14px; font-weight: 500;">${escapeHtml(facilityName)}</td>
      </tr>
    `);
  }

  if (bookingDate) {
    const timeStr = startTime && endTime ? `${startTime} - ${endTime}` : startTime || '';
    rows.push(`
      <tr>
        <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 120px;">When</td>
        <td style="padding: 8px 0; color: #374151; font-size: 14px; font-weight: 500;">${escapeHtml(bookingDate)}${timeStr ? ` at ${timeStr}` : ''}</td>
      </tr>
    `);
  }

  if (playerName) {
    rows.push(`
      <tr>
        <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 120px;">Player</td>
        <td style="padding: 8px 0; color: #374151; font-size: 14px; font-weight: 500;">${escapeHtml(playerName)}</td>
      </tr>
    `);
  }

  if (priceCents !== undefined) {
    rows.push(`
      <tr>
        <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 120px;">Amount</td>
        <td style="padding: 8px 0; color: #374151; font-size: 14px; font-weight: 500;">${formatCurrency(priceCents, currency)}</td>
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
                  ${rows.join('')}
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
 * Generate payment details card
 */
function generatePaymentCard(payload: Record<string, unknown>): string {
  const amountCents = payload.amountCents as number | undefined;
  const currency = (payload.currency as string) || 'CAD';
  const playerName = payload.playerName as string | undefined;
  const failureReason = payload.failureReason as string | undefined;

  if (amountCents === undefined) return '';

  const rows: string[] = [];

  rows.push(`
    <tr>
      <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 120px;">Amount</td>
      <td style="padding: 8px 0; color: #374151; font-size: 14px; font-weight: 500;">${formatCurrency(amountCents, currency)}</td>
    </tr>
  `);

  if (playerName) {
    rows.push(`
      <tr>
        <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 120px;">From</td>
        <td style="padding: 8px 0; color: #374151; font-size: 14px; font-weight: 500;">${escapeHtml(playerName)}</td>
      </tr>
    `);
  }

  if (failureReason) {
    rows.push(`
      <tr>
        <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 120px;">Reason</td>
        <td style="padding: 8px 0; color: #374151; font-size: 14px; font-weight: 500;">${escapeHtml(failureReason)}</td>
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
                  ${rows.join('')}
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
 * Generate action button
 */
function generateActionButton(type: OrgNotificationType): string {
  let buttonText = 'View Details';
  let deepLink = 'rallia://dashboard';

  switch (type) {
    case 'booking_created':
    case 'booking_cancelled_by_player':
    case 'booking_modified':
    case 'booking_confirmed':
    case 'booking_reminder':
    case 'booking_cancelled_by_org':
      buttonText = 'View Booking';
      deepLink = 'rallia://dashboard/bookings';
      break;
    case 'new_member_joined':
    case 'member_left':
    case 'member_role_changed':
    case 'membership_approved':
      buttonText = 'View Members';
      deepLink = 'rallia://dashboard/members';
      break;
    case 'payment_received':
    case 'payment_failed':
    case 'refund_processed':
      buttonText = 'View Payments';
      deepLink = 'rallia://dashboard/payments';
      break;
    case 'daily_summary':
    case 'weekly_report':
      buttonText = 'View Report';
      deepLink = 'rallia://dashboard/reports';
      break;
    case 'org_announcement':
      buttonText = 'View Announcement';
      break;
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
 * Render organization-branded email
 */
export function renderOrgEmail(
  notification: NotificationRecord,
  organization: OrganizationInfo
): EmailContent {
  const { title, body, type, payload } = notification;
  const currentYear = new Date().getFullYear();
  const category = getNotificationCategory(type as OrgNotificationType);

  // Generate subject with organization name
  const subject = `[${organization.name}] ${title}`;

  // Determine which details card to show
  let detailsCard = '';
  if (category === 'booking') {
    detailsCard = generateBookingCard(payload);
  } else if (category === 'payment') {
    detailsCard = generatePaymentCard(payload);
  }

  const html = `
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
                <p style="margin: 12px 0 0 0; padding: 0; font-size: 14px; font-weight: bold; color: #006d77; letter-spacing: 0.05em;">
                  ${escapeHtml(organization.name)}
                </p>
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

                ${detailsCard}

                ${generateActionButton(type as OrgNotificationType)}

                <!-- Divider -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 24px;">
                  <tr>
                    <td style="padding: 24px 0; border-top: 1px solid #e5e7eb;">&nbsp;</td>
                  </tr>
                </table>

                <p style="margin: 0; padding: 0; font-size: 13px; line-height: 1.5; color: #9ca3af;">
                  You received this email because you are a member of ${escapeHtml(organization.name)}.
                  <a href="rallia://dashboard/settings/notifications" style="color: #006d77; text-decoration: none;">Manage notification preferences</a>
                  ${organization.website ? `<br><a href="${organization.website}" style="color: #006d77; text-decoration: none;">${organization.website}</a>` : ''}
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
                  Powered by Rallia
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

  return { subject, html };
}

export default renderOrgEmail;
