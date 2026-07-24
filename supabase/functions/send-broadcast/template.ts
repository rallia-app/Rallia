/**
 * Admin broadcast email template.
 *
 * Renders the admin-composed subject + body into the shared Rallia layout
 * (logo/header/footer + dark mode), with an optional CTA button and a
 * CASL-compliant unsubscribe link. Body is authored in the admin UI as text
 * with a safe markdown subset — **bold**, *italic*, [link](https://…), and
 * "- " bullet lists. Blank lines become paragraphs, single newlines become
 * <br>, and everything is HTML-escaped first (no raw HTML from the composer).
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

const TEXT_STYLE = `font-size: 16px; line-height: 1.6; color: ${EMAIL_TOKENS.neutral900};`;

/**
 * Render the inline markdown subset of an already-escaped block. Links are
 * extracted into placeholders first so the emphasis passes can't touch
 * characters inside a URL or the generated <a> markup.
 */
function inlineMarkdownToHtml(escaped: string): string {
  const links: string[] = [];
  let out = escaped.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, text, url) => {
    links.push(
      `<a href="${url}" style="color: ${EMAIL_TOKENS.primary600}; font-weight: 600; text-decoration: underline;">${text}</a>`
    );
    // "<" can never survive escapeHtml, so this token cannot collide with text.
    return `<L${links.length - 1}>`;
  });
  out = out
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  return out.replace(/<L(\d+)>/g, (_match, index) => links[Number(index)]);
}

/** Convert the composer body (text + markdown subset) into escaped HTML. */
function paragraphsToHtml(body: string): string {
  return body
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(block => block.length > 0)
    .map(block => {
      const lines = block.split('\n').map(line => line.trim());
      if (lines.every(line => /^[-*]\s+/.test(line))) {
        const items = lines
          .map(line => inlineMarkdownToHtml(escapeHtml(line.replace(/^[-*]\s+/, ''))))
          .map(item => `<li style="margin: 0 0 8px 0; ${TEXT_STYLE}">${item}</li>`)
          .join('');
        return `<ul style="margin: 0 0 16px 0; padding: 0 0 0 24px;">${items}</ul>`;
      }
      const safe = inlineMarkdownToHtml(escapeHtml(block)).replace(/\n/g, '<br />');
      return `<p style="margin: 0 0 16px 0; ${TEXT_STYLE}">${safe}</p>`;
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
                <h2 style="margin: 0; padding: 0 0 16px 0; font-family: Poppins, Arial, Helvetica, sans-serif; font-size: 24px; font-weight: bold; color: ${EMAIL_TOKENS.primary600}; letter-spacing: -0.025em; line-height: 1.2;">
                  ${escapeHtml(subject)}
                </h2>
                ${greeting}
                ${paragraphsToHtml(body)}
                ${ctaHtml}
                ${renderDividerAndDisclaimer(disclaimer)}`;

  const preheader = body
    .replace(/\[([^\]\n]+)\]\(https?:\/\/[^\s)]+\)/g, '$1')
    .replace(/\*/g, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);

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
