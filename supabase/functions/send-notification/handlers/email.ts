/**
 * Email Handler for Notification Delivery
 * Uses Resend SDK to send email notifications
 */

import { Resend } from 'resend';
import { SignJWT } from 'https://esm.sh/jose@5';

import type { NotificationRecord, DeliveryResult, OrganizationInfo } from '../types.ts';
import { renderOrgEmail } from '../templates/organization.ts';
import { generateEmailHtml, generateEmailSubject } from '../templates/match.ts';
import { isFakeSeedEmail } from '../../_shared/email-guards.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'Rallia <no-reply@updates.rallia.ca>';
const SITE_URL = Deno.env.get('NEXT_PUBLIC_BASE_URL') || 'https://rallia.app';
// Signs per-recipient one-click unsubscribe tokens, verified by the web route
// /api/notifications/unsubscribe. Same secret resolution as the digest/broadcast
// senders so the existing SUPABASE_JWT_SECRET on the web side verifies them.
const JWT_SECRET = Deno.env.get('JWT_SECRET') ?? Deno.env.get('SUPABASE_JWT_SECRET');
const ENC = new TextEncoder();

/**
 * Build a signed one-click unsubscribe URL for a user. Returns null when no
 * signing secret is configured so callers degrade gracefully (no header/link).
 */
async function buildUnsubscribeUrl(userId: string): Promise<string | null> {
  if (!JWT_SECRET) return null;
  const token = await new SignJWT({ aud: 'notification_email_unsub' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('60d')
    .sign(ENC.encode(JWT_SECRET));
  return `${SITE_URL}/api/notifications/unsubscribe?token=${encodeURIComponent(token)}`;
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

  if (isFakeSeedEmail(recipientEmail)) {
    return {
      channel: 'email',
      status: 'skipped_missing_contact',
      errorMessage: 'fake seed user — no real inbox',
    };
  }

  try {
    const unsubscribeUrl = (await buildUnsubscribeUrl(notification.user_id)) ?? undefined;
    const htmlContent = generateEmailHtml(notification, locale, SITE_URL, unsubscribeUrl);
    const subject = generateEmailSubject(notification);

    const resend = new Resend(RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: recipientEmail,
      subject,
      html: htmlContent,
      ...(unsubscribeUrl && {
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
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

  if (isFakeSeedEmail(recipientEmail)) {
    return {
      channel: 'email',
      status: 'skipped_missing_contact',
      errorMessage: 'fake seed user — no real inbox',
    };
  }

  try {
    const { subject, html } = renderOrgEmail(notification, organization, locale, SITE_URL);

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
