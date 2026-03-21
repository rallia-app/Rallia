/**
 * Organization-branded Email Templates
 * Renders emails with organization branding for booking, member, and payment notifications.
 */

import type { NotificationRecord, OrganizationInfo, OrgNotificationType } from '../types.ts';
import {
  wrapInLayout,
  renderCtaButton,
  renderDetailCard,
  renderDividerAndDisclaimer,
  escapeHtml,
  EMAIL_TOKENS,
} from '../../_shared/email-layout.ts';
import { t } from '../../_shared/email-translations.ts';

export interface EmailContent {
  subject: string;
  html: string;
}

/**
 * Convert a rallia:// deep link to a universal link using siteUrl.
 */
function toUniversalLink(deepLink: string, siteUrl?: string): string {
  if (!siteUrl || !deepLink.startsWith('rallia://')) return deepLink;
  return deepLink.replace('rallia://', `${siteUrl}/`);
}

/**
 * Format currency amount from cents
 */
function formatCurrency(
  cents: number | undefined,
  currency: string = 'CAD',
  locale: string = 'en-US'
): string {
  if (cents === undefined) return '';
  return new Intl.NumberFormat(locale, {
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
 * Get preheader key for org notification category
 */
function getOrgPreheaderKey(category: string): string {
  switch (category) {
    case 'booking':
      return 'preheader.orgBooking';
    case 'member':
      return 'preheader.orgMember';
    case 'payment':
      return 'preheader.orgPayment';
    default:
      return 'preheader.orgGeneral';
  }
}

/**
 * Generate QR code image HTML for booking notifications
 */
function generateQrCodeHtml(bookingId: string, locale: string): string {
  if (!bookingId) return '';

  const qrData = `rallia://booking/${bookingId}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(qrData)}`;

  return `
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td align="center" style="padding: 0 0 16px 0;">
                      <img src="${qrUrl}" alt="QR Code" width="120" height="120" style="display: block; border: 0;" />
                      <p style="margin: 4px 0 0 0; font-size: 12px; color: ${EMAIL_TOKENS.neutral500};">
                        ${t(locale, 'org.scanQrCode')}
                      </p>
                    </td>
                  </tr>
                </table>`;
}

/**
 * Generate booking details card
 */
function generateBookingCard(payload: Record<string, unknown>, locale: string): string {
  const courtName = payload.courtName as string | undefined;
  const facilityName = payload.facilityName as string | undefined;
  const bookingDate = payload.bookingDate as string | undefined;
  const startTime = payload.startTime as string | undefined;
  const endTime = payload.endTime as string | undefined;
  const playerName = payload.playerName as string | undefined;
  const priceCents = payload.priceCents as number | undefined;
  const currency = (payload.currency as string) || 'CAD';
  const locationAddress = payload.locationAddress as string | undefined;

  if (!courtName && !bookingDate) return '';

  const rows: Array<{ label: string; value: string }> = [];

  if (courtName) {
    rows.push({ label: t(locale, 'org.court'), value: escapeHtml(courtName) });
  }
  if (facilityName) {
    rows.push({ label: t(locale, 'org.location'), value: escapeHtml(facilityName) });
  }
  if (locationAddress) {
    rows.push({ label: t(locale, 'org.address'), value: escapeHtml(locationAddress) });
  }
  if (bookingDate) {
    const timeStr = startTime && endTime ? `${startTime} - ${endTime}` : startTime || '';
    rows.push({
      label: t(locale, 'org.when'),
      value: escapeHtml(bookingDate) + (timeStr ? ` ${t(locale, 'org.dateAt')} ${timeStr}` : ''),
    });
  }
  if (playerName) {
    rows.push({ label: t(locale, 'org.player'), value: escapeHtml(playerName) });
  }
  if (priceCents !== undefined) {
    rows.push({
      label: t(locale, 'org.amount'),
      value: formatCurrency(priceCents, currency, locale),
    });
  }

  return renderDetailCard(rows);
}

/**
 * Generate payment details card
 */
function generatePaymentCard(payload: Record<string, unknown>, locale: string): string {
  const amountCents = payload.amountCents as number | undefined;
  const currency = (payload.currency as string) || 'CAD';
  const playerName = payload.playerName as string | undefined;
  const failureReason = payload.failureReason as string | undefined;
  const paymentDate = payload.paymentDate as string | undefined;

  if (amountCents === undefined) return '';

  const rows: Array<{ label: string; value: string }> = [];

  rows.push({
    label: t(locale, 'org.amount'),
    value: formatCurrency(amountCents, currency, locale),
  });
  if (playerName) {
    rows.push({ label: t(locale, 'org.from'), value: escapeHtml(playerName) });
  }
  if (paymentDate) {
    rows.push({ label: t(locale, 'org.timestamp'), value: escapeHtml(paymentDate) });
  }
  if (failureReason) {
    rows.push({ label: t(locale, 'org.reason'), value: escapeHtml(failureReason) });
  }

  return renderDetailCard(rows);
}

/**
 * Generate action button
 */
function generateActionButton(type: OrgNotificationType, locale: string, siteUrl?: string): string {
  let buttonKey = 'org.button.viewDetails';
  let deepLink = 'rallia://dashboard';

  switch (type) {
    case 'booking_created':
    case 'booking_cancelled_by_player':
    case 'booking_modified':
    case 'booking_confirmed':
    case 'booking_reminder':
    case 'booking_cancelled_by_org':
      buttonKey = 'org.button.viewBooking';
      deepLink = 'rallia://dashboard/bookings';
      break;
    case 'new_member_joined':
    case 'member_left':
    case 'member_role_changed':
    case 'membership_approved':
      buttonKey = 'org.button.viewMembers';
      deepLink = 'rallia://dashboard/members';
      break;
    case 'payment_received':
    case 'payment_failed':
    case 'refund_processed':
      buttonKey = 'org.button.viewPayments';
      deepLink = 'rallia://dashboard/payments';
      break;
    case 'daily_summary':
    case 'weekly_report':
      buttonKey = 'org.button.viewReport';
      deepLink = 'rallia://dashboard/reports';
      break;
    case 'org_announcement':
      buttonKey = 'org.button.viewAnnouncement';
      break;
  }

  return renderCtaButton(t(locale, buttonKey), toUniversalLink(deepLink, siteUrl));
}

/**
 * Render organization-branded email
 */
export function renderOrgEmail(
  notification: NotificationRecord,
  organization: OrganizationInfo,
  locale: string = 'en-US',
  siteUrl?: string
): EmailContent {
  const { title, body, type, payload } = notification;
  const T = EMAIL_TOKENS;
  const category = getNotificationCategory(type as OrgNotificationType);

  const subject = `[${organization.name}] ${title}`;

  let detailsCard = '';
  if (category === 'booking') {
    detailsCard = generateBookingCard(payload, locale);
  } else if (category === 'payment') {
    detailsCard = generatePaymentCard(payload, locale);
  }

  // QR code for booking_confirmed and booking_reminder
  const bookingId = payload.bookingId as string | undefined;
  const showQrCode = (type === 'booking_confirmed' || type === 'booking_reminder') && bookingId;
  const qrCodeHtml = showQrCode ? generateQrCodeHtml(bookingId, locale) : '';

  const bodyHtml = body
    ? `
                <p style="margin: 0; padding: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: ${T.neutral900};">
                  ${escapeHtml(body)}
                </p>`
    : '';

  const manageHref = toUniversalLink('rallia://dashboard/settings/notifications', siteUrl);
  const manageLink = `<a href="${manageHref}" style="color: ${T.primary600}; text-decoration: none;">${t(locale, 'org.managePreferences')}</a>`;
  const websiteLink = organization.website
    ? `<br><a href="${organization.website}" style="color: ${T.primary600}; text-decoration: none;">${organization.website}</a>`
    : '';
  const disclaimerText = `${t(locale, 'org.disclaimer', { org: escapeHtml(organization.name) })} ${manageLink}${websiteLink}`;

  const content = `
                <h2 style="margin: 0; padding: 0 0 16px 0; font-family: Poppins, Arial, Helvetica, sans-serif; font-size: 24px; font-weight: bold; color: ${T.primary600}; letter-spacing: -0.025em; line-height: 1.2;">
                  ${escapeHtml(title)}
                </h2>
                ${bodyHtml}

                ${detailsCard}

                ${qrCodeHtml}

                ${generateActionButton(type as OrgNotificationType, locale, siteUrl)}

                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 24px;">
                  <tr>
                    <td class="email-divider" style="padding: 24px 0; border-top: 1px solid ${T.neutral200};">&nbsp;</td>
                  </tr>
                </table>

                <p class="email-muted" style="margin: 0; padding: 0; font-size: 13px; line-height: 1.5; color: ${T.neutral500};">
                  ${disclaimerText}
                </p>`;

  // Build preheader
  const preheaderKey = getOrgPreheaderKey(category);
  const preheader = t(locale, preheaderKey, { orgName: organization.name });

  const html = wrapInLayout({
    title: escapeHtml(title),
    content,
    headerSubtitle: organization.name,
    footerNote: t(locale, 'org.poweredBy'),
    locale,
    preheader,
    showUnsubscribe: true,
    ...(siteUrl && { siteUrl }),
  });

  return { subject, html };
}

export default renderOrgEmail;
