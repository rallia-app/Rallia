/**
 * Shared Email Layout Module
 * Provides unified HTML shell, design tokens, and reusable components for all email templates.
 */

/** Design system tokens for email templates */
export const EMAIL_TOKENS = {
  // Primary
  primary600: '#0d9488',
  primary100: '#ccfbf1',
  primary50: '#f0fdfa',
  // Secondary
  secondary500: '#ed6a6d',
  // Neutral
  neutral900: '#171717',
  neutral600: '#525252',
  neutral500: '#737373',
  neutral200: '#e5e5e5',
  neutral50: '#fafafa',
  // Misc
  white: '#ffffff',
  pageBg: '#f0fdfa',
  // Sizes
  buttonRadius: '8px',
} as const;

const T = EMAIL_TOKENS;

/** Escape HTML special characters to prevent XSS */
export function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => htmlEscapes[char] || char);
}

export interface LayoutOptions {
  title: string;
  content: string;
  footerNote?: string;
  headerSubtitle?: string;
  siteUrl?: string;
  locale?: string;
}

/**
 * Wrap email content in the unified HTML layout shell.
 */
export function wrapInLayout(options: LayoutOptions): string {
  const {
    title,
    content,
    footerNote = '',
    headerSubtitle,
    siteUrl = Deno.env.get('SITE_URL') || 'https://rallia.com',
    locale = 'en-US',
  } = options;

  const isFr = locale === 'fr-CA' || locale === 'fr';
  const needHelpText = isFr ? "Besoin d'aide ?" : 'Need help?';
  const supportText = isFr
    ? "En cas de problème, contactez notre équipe de soutien."
    : "If you're having trouble, please contact our support team.";
  const rightsText = isFr ? 'Tous droits réservés.' : 'All rights reserved.';

  const subtitleHtml = headerSubtitle
    ? `<p style="margin: 12px 0 0 0; padding: 0; font-size: 14px; font-weight: bold; color: ${T.white}; letter-spacing: 0.05em;">${escapeHtml(headerSubtitle)}</p>`
    : '';

  const footerNoteHtml = footerNote
    ? `
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td align="center" style="padding: 20px 0;">
                <p style="margin: 0; padding: 0; font-size: 12px; line-height: 1.5; color: ${T.neutral500};">
                  ${footerNote}
                </p>
              </td>
            </tr>
          </table>`
    : '';

  return `
<!DOCTYPE html>
<html lang="${isFr ? 'fr' : 'en'}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@600;700&display=swap" rel="stylesheet" />
    <!--[if mso]>
      <style type="text/css">
        body, table, td { font-family: Arial, sans-serif !important; }
      </style>
    <![endif]-->
  </head>
  <body style="margin: 0; padding: 0;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: ${T.pageBg}; font-family: Inter, Arial, Helvetica, sans-serif;">
      <tr>
        <td align="center" style="padding: 40px 20px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="background-color: ${T.white}; border-radius: 12px; overflow: hidden;">
            <!-- Header -->
            <tr>
              <td align="center" style="padding: 40px 40px 20px 40px; background-color: ${T.primary600}; border-radius: 12px 12px 0 0;">
                <img src="${siteUrl}/logo-dark.png" alt="Rallia" width="140" height="55" style="display: block; border: 0; max-width: 140px; height: auto;" />
                ${subtitleHtml}
              </td>
            </tr>

            <!-- Content -->
            <tr>
              <td style="padding: 40px 40px 30px 40px;">
                ${content}
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td align="center" style="padding: 30px 40px 40px 40px; background-color: ${T.neutral50}; border-top: 1px solid ${T.neutral200}; border-radius: 0 0 12px 12px;">
                <p style="margin: 0; padding: 0 0 8px 0; font-size: 14px; font-weight: bold; color: ${T.primary600};">${needHelpText}</p>
                <p style="margin: 0; padding: 0; font-size: 13px; line-height: 1.5; color: ${T.neutral600};">
                  ${supportText}
                </p>
                <p style="margin: 0; padding: 16px 0 0 0; font-size: 12px; line-height: 1.5; color: ${T.neutral500};">
                  &copy; Rallia. ${rightsText}
                </p>
              </td>
            </tr>
          </table>
          ${footerNoteHtml}
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();
}

/** Render a coral CTA button */
export function renderCtaButton(text: string, href: string): string {
  return `
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td align="center" style="padding: 0 0 32px 0;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td style="background-color: ${T.secondary500}; border-radius: ${T.buttonRadius};">
                            <a href="${href}" style="display: inline-block; padding: 16px 40px; font-family: Inter, Arial, Helvetica, sans-serif; font-size: 16px; font-weight: 600; color: ${T.white}; text-decoration: none; letter-spacing: -0.01em;">
                              ${escapeHtml(text)}
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>`;
}

/** Render a detail card with label/value rows */
export function renderDetailCard(rows: Array<{ label: string; value: string }>): string {
  if (rows.length === 0) return '';

  const rowsHtml = rows
    .map(
      (row) => `
                      <tr>
                        <td style="padding: 8px 0; color: ${T.neutral600}; font-size: 14px; width: 120px;">${escapeHtml(row.label)}</td>
                        <td style="padding: 8px 0; color: ${T.neutral900}; font-size: 14px; font-weight: 500;">${row.value}</td>
                      </tr>`
    )
    .join('');

  return `
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="padding: 0 0 24px 0;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: ${T.primary50}; border: 1px solid ${T.primary100};">
                        <tr>
                          <td style="padding: 20px;">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                              ${rowsHtml}
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>`;
}

/** Render a "copy this link" fallback box */
export function renderLinkFallbackBox(label: string, url: string): string {
  return `
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td align="center" style="padding: 0 0 24px 0;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: ${T.primary50}; border: 1px solid ${T.primary100};">
                        <tr>
                          <td style="padding: 24px;">
                            <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: bold; color: ${T.primary600}; text-transform: uppercase; letter-spacing: 0.05em;">
                              ${escapeHtml(label)}
                            </p>
                            <p style="margin: 0; font-size: 14px; color: ${T.neutral600}; word-break: break-all; line-height: 1.6;">
                              ${escapeHtml(url)}
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>`;
}

/** Render a divider + disclaimer text block */
export function renderDividerAndDisclaimer(text: string): string {
  return `
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 24px;">
                  <tr>
                    <td style="padding: 24px 0; border-top: 1px solid ${T.neutral200};">&nbsp;</td>
                  </tr>
                </table>

                <p style="margin: 0; padding: 0; font-size: 13px; line-height: 1.5; color: ${T.neutral500};">
                  ${escapeHtml(text)}
                </p>`;
}
