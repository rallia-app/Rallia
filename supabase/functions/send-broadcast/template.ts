/**
 * Admin broadcast email template.
 *
 * Renders the admin-composed subject + body into the shared Rallia layout
 * (logo/header/footer + dark mode), with an optional CTA button and a
 * CASL-compliant unsubscribe link. Body is plain text authored in the admin
 * UI — blank lines become paragraphs, single newlines become <br>, and
 * everything is HTML-escaped (no raw HTML from the composer).
 */

import {
  wrapInLayout,
  renderCtaButton,
  renderDividerAndDisclaimer,
  escapeHtml,
  EMAIL_TOKENS,
} from '../_shared/email-layout.ts';

export interface BroadcastEmailParams {
  subject: string;
  body: string;
  ctaText?: string | null;
  ctaUrl?: string | null;
  firstName?: string | null;
  locale: string;
  unsubscribeUrl: string;
  siteUrl?: string;
}

/** Convert plain-text body into escaped paragraph HTML. */
function paragraphsToHtml(body: string): string {
  return body
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(block => block.length > 0)
    .map(block => {
      const safe = escapeHtml(block).replace(/\n/g, '<br />');
      return `<p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: ${EMAIL_TOKENS.neutral900};">${safe}</p>`;
    })
    .join('');
}

export function renderBroadcastEmail(params: BroadcastEmailParams): {
  subject: string;
  html: string;
} {
  const { subject, body, ctaText, ctaUrl, firstName, locale, unsubscribeUrl, siteUrl } = params;
  const isFr = locale === 'fr-CA' || locale === 'fr';

  const greeting = firstName
    ? `<p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: ${EMAIL_TOKENS.neutral900};">${isFr ? 'Bonjour' : 'Hi'} ${escapeHtml(firstName)},</p>`
    : '';

  const ctaHtml = ctaText && ctaUrl ? renderCtaButton(ctaText, ctaUrl) : '';

  const disclaimer = isFr
    ? 'Tu reçois ce courriel parce que tu as un compte Rallia.'
    : "You're receiving this email because you have a Rallia account.";

  const content = `
                <h2 style="margin: 0; padding: 0 0 16px 0; font-family: Poppins, Arial, Helvetica, sans-serif; font-size: 28px; font-weight: 800; color: ${EMAIL_TOKENS.neutral900}; letter-spacing: -0.03em; line-height: 1.2;">
                  ${escapeHtml(subject)}
                </h2>
                ${greeting}
                ${paragraphsToHtml(body)}
                ${ctaHtml}
                ${renderDividerAndDisclaimer(disclaimer)}`;

  const preheader = body.replace(/\s+/g, ' ').trim().slice(0, 100);

  const html = wrapInLayout({
    title: subject,
    content,
    locale,
    preheader,
    showUnsubscribe: true,
    unsubscribeUrl,
    unsubscribeLabel: isFr ? 'Se désabonner de ces courriels' : 'Unsubscribe from these emails',
    ...(siteUrl ? { siteUrl } : {}),
  });

  return { subject, html };
}
