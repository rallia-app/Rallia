import {
  wrapInLayout,
  renderDividerAndDisclaimer,
  escapeHtml,
  EMAIL_TOKENS,
} from '../../_shared/email-layout.ts';
import { t } from '../../_shared/email-translations.ts';
import type { EmailContent, NotificationEmailPayload } from '../types.ts';

function stripHtmlTags(str: string): string {
  let result = str;
  let previous: string;
  do {
    previous = result;
    result = result.replace(/<[^>]*>/g, '');
  } while (result !== previous);
  return result;
}

export function renderNotificationEmail(
  payload: NotificationEmailPayload,
  locale: string = 'en-US',
  siteUrl?: string
): EmailContent {
  // Map notification types to translated subject prefixes
  const subjectPrefixKey = `notification.prefix.${payload.notificationType}`;
  const subjectPrefix = t(locale, subjectPrefixKey);
  const subject = `${subjectPrefix}: ${escapeHtml(payload.title)}`;

  // Build preheader from body, truncated to 100 chars
  const preheaderBody = payload.body
    ? stripHtmlTags(payload.body).slice(0, 100)
    : escapeHtml(payload.title);
  const preheader = t(locale, 'preheader.notification', { body: preheaderBody });

  const bodyHtml = payload.body
    ? `<div style="padding: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: ${EMAIL_TOKENS.neutral900};">${escapeHtml(payload.body)}</div>`
    : '';

  const content = `
                <h2 style="margin: 0; padding: 0 0 16px 0; font-family: Poppins, Arial, Helvetica, sans-serif; font-size: 24px; font-weight: bold; color: ${EMAIL_TOKENS.primary600}; letter-spacing: -0.025em; line-height: 1.2;">
                  ${escapeHtml(payload.title)}
                </h2>
                ${bodyHtml}
                ${renderDividerAndDisclaimer(t(locale, 'notification.disclaimer'))}`;

  const html = wrapInLayout({
    title: payload.title,
    content,
    footerNote: t(locale, 'notification.footerNote'),
    locale,
    preheader,
    showUnsubscribe: true,
    ...(siteUrl && { siteUrl }),
  });

  return { subject, html };
}
