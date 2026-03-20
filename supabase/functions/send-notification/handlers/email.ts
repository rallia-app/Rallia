/**
 * Email Handler for Notification Delivery
 * Uses Resend SDK to send email notifications
 */

import { Resend } from 'resend';

import type { NotificationRecord, DeliveryResult, OrganizationInfo } from '../types.ts';
import { renderOrgEmail } from '../templates/organization.ts';
import { generateEmailHtml, generateEmailSubject } from '../templates/match.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'noreply@rallia.com';

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
