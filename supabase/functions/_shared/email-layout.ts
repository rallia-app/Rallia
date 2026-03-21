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
  // Dark mode
  darkPageBg: '#1a1a1a',
  darkContainerBg: '#262626',
  darkHeaderBg: '#0f766e',
  darkText: '#e5e5e5',
  darkMutedText: '#a3a3a3',
  // Status
  statusRed: '#dc2626',
  statusAmber: '#d97706',
  statusGreen: '#16a34a',
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
  return text.replace(/[&<>"']/g, char => htmlEscapes[char] || char);
}

export interface LayoutOptions {
  title: string;
  content: string;
  footerNote?: string;
  headerSubtitle?: string;
  siteUrl?: string;
  locale?: string;
  preheader?: string;
  showUnsubscribe?: boolean;
}

/** Generate dark mode CSS block */
function getDarkModeCss(): string {
  return `
    <style type="text/css">
      @media (prefers-color-scheme: dark) {
        .email-body { background-color: ${T.darkPageBg} !important; }
        .email-container { background-color: ${T.darkContainerBg} !important; }
        .email-header { background-color: ${T.darkHeaderBg} !important; }
        .email-content { background-color: ${T.darkContainerBg} !important; }
        .email-footer { background-color: #1f1f1f !important; border-top-color: #404040 !important; }
        .email-text { color: ${T.darkText} !important; }
        .email-muted { color: ${T.darkMutedText} !important; }
        .email-detail-card { background-color: #1a2e2b !important; border-color: #2d4a46 !important; }
        .email-link-box { background-color: #1a2e2b !important; border-color: #2d4a46 !important; }
        .email-divider { border-top-color: #404040 !important; }
        /* Content text — override inline colors on elements without dark-mode classes */
        .email-content p { color: ${T.darkText} !important; }
        .email-content div { color: ${T.darkText} !important; }
        .email-content h2 { color: #5eead4 !important; }
        .email-content td { color: ${T.darkText} !important; }
        .email-content a { color: #5eead4 !important; }
        .email-content a.email-cta { color: ${T.white} !important; }
        .email-content strong { color: #5eead4 !important; }
        .email-detail-label { color: ${T.darkMutedText} !important; }
        .email-detail-value { color: ${T.darkText} !important; }
        .email-link-box p { color: ${T.darkMutedText} !important; }
        .email-footer p { color: ${T.darkMutedText} !important; }
        .email-footer a { color: #5eead4 !important; }
      }
      /* Outlook dark mode */
      [data-ogsc] .email-body { background-color: ${T.darkPageBg} !important; }
      [data-ogsc] .email-container { background-color: ${T.darkContainerBg} !important; }
      [data-ogsc] .email-header { background-color: ${T.darkHeaderBg} !important; }
      [data-ogsc] .email-footer { background-color: #1f1f1f !important; }
      [data-ogsc] .email-text { color: ${T.darkText} !important; }
      [data-ogsc] .email-muted { color: ${T.darkMutedText} !important; }
      [data-ogsc] .email-content p { color: ${T.darkText} !important; }
      [data-ogsc] .email-content div { color: ${T.darkText} !important; }
      [data-ogsc] .email-content h2 { color: #5eead4 !important; }
      [data-ogsc] .email-content td { color: ${T.darkText} !important; }
      [data-ogsc] .email-detail-label { color: ${T.darkMutedText} !important; }
      [data-ogsc] .email-detail-value { color: ${T.darkText} !important; }
      [data-ogsc] .email-footer p { color: ${T.darkMutedText} !important; }
      /* Responsive */
      @media (max-width: 620px) {
        .email-container { width: 100% !important; }
      }
    </style>`;
}

/** Generate preheader hidden span */
function getPreheaderHtml(preheader: string): string {
  return `<span style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${escapeHtml(preheader)}</span>`;
}

/** Generate app store badges HTML */
function getAppStoreBadgesHtml(siteUrl: string, locale: string): string {
  const isFr = locale === 'fr-CA' || locale === 'fr';
  const downloadText = isFr ? "Téléchargez l'application" : 'Download the app';
  const appStoreAlt = isFr ? "Télécharger dans l'App Store" : 'Download on the App Store';
  const googlePlayAlt = isFr ? 'Disponible sur Google Play' : 'Get it on Google Play';

  return `
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td align="center" style="padding: 16px 0 0 0;">
                      <p style="margin: 0; padding: 0 0 12px 0; font-size: 13px; font-weight: 600; color: ${T.primary600};">${downloadText}</p>
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td style="padding: 0 6px 0 0;">
                            <a href="https://apps.apple.com/app/rallia/idXXXXXXXXXX" style="text-decoration: none;">
                              <img src="${siteUrl}/app-store-badge.svg" alt="${appStoreAlt}" width="120" height="40" style="display: block; border: 0;" />
                            </a>
                          </td>
                          <td style="padding: 0 0 0 6px;">
                            <a href="https://play.google.com/store/apps/details?id=com.rallia.app" style="text-decoration: none;">
                              <img src="${siteUrl}/google-play-badge.svg" alt="${googlePlayAlt}" width="135" height="40" style="display: block; border: 0;" />
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>`;
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
    siteUrl = Deno.env.get('SITE_URL') || 'https://www.rallia.ca',
    locale = 'en-US',
    preheader,
    showUnsubscribe = false,
  } = options;

  const isFr = locale === 'fr-CA' || locale === 'fr';
  const needHelpText = isFr ? "Besoin d'aide ?" : 'Need help?';
  const supportText = isFr
    ? 'En cas de problème, contactez-nous à <a href="mailto:contact@rallia.ca" style="color: ' +
      T.primary600 +
      '; text-decoration: none;">contact@rallia.ca</a>'
    : 'If you\'re having trouble, contact us at <a href="mailto:contact@rallia.ca" style="color: ' +
      T.primary600 +
      '; text-decoration: none;">contact@rallia.ca</a>';
  const rightsText = isFr ? 'Tous droits réservés.' : 'All rights reserved.';

  const subtitleHtml = headerSubtitle
    ? `<p style="margin: 12px 0 0 0; padding: 0; font-size: 14px; font-weight: bold; color: ${T.white}; letter-spacing: 0.05em;">${escapeHtml(headerSubtitle)}</p>`
    : '';

  const preheaderHtml = preheader ? getPreheaderHtml(preheader) : '';

  const footerNoteHtml = footerNote
    ? `
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td align="center" style="padding: 20px 0;">
                <p class="email-muted" style="margin: 0; padding: 0; font-size: 12px; line-height: 1.5; color: ${T.neutral500};">
                  ${footerNote}
                </p>
              </td>
            </tr>
          </table>`
    : '';

  const unsubscribeHtml = showUnsubscribe
    ? `
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td align="center" style="padding: 0 0 12px 0;">
                <a href="${siteUrl}/settings/notifications" style="font-size: 12px; color: ${T.neutral500}; text-decoration: underline;">
                  ${isFr ? 'Gérer les préférences de notification' : 'Manage notification preferences'}
                </a>
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
    <!--[if mso]>
      <style type="text/css">
        body, table, td { font-family: Arial, sans-serif !important; }
      </style>
    <![endif]-->
    ${getDarkModeCss()}
  </head>
  <body style="margin: 0; padding: 0;">
    ${preheaderHtml}
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="email-body" style="background-color: ${T.pageBg}; font-family: Inter, Arial, Helvetica, sans-serif;">
      <tr>
        <td align="center" style="padding: 40px 20px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" class="email-container" style="background-color: ${T.white}; border-radius: 12px; overflow: hidden;">
            <!-- Header -->
            <tr>
              <td align="center" class="email-header" style="padding: 40px 40px 20px 40px; background-color: ${T.primary600}; border-radius: 12px 12px 0 0;">
                <img src="${siteUrl}/logo-light.png" alt="Rallia" width="140" height="55" style="display: block; border: 0; max-width: 140px; height: auto;" />
                ${subtitleHtml}
              </td>
            </tr>

            <!-- Content -->
            <tr>
              <td class="email-content" style="padding: 40px 40px 30px 40px;">
                ${content}
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td align="center" class="email-footer" style="padding: 30px 40px 40px 40px; background-color: ${T.neutral50}; border-top: 1px solid ${T.neutral200}; border-radius: 0 0 12px 12px;">
                <p style="margin: 0; padding: 0 0 8px 0; font-size: 14px; font-weight: bold; color: ${T.primary600};">${needHelpText}</p>
                <p class="email-muted" style="margin: 0; padding: 0; font-size: 13px; line-height: 1.5; color: ${T.neutral600};">
                  ${supportText}
                </p>
                ${getAppStoreBadgesHtml(siteUrl, locale)}
                <p class="email-muted" style="margin: 0; padding: 16px 0 0 0; font-size: 12px; line-height: 1.5; color: ${T.neutral500};">
                  &copy; ${new Date().getFullYear()} Rallia. ${rightsText}
                </p>
              </td>
            </tr>
          </table>
          ${footerNoteHtml}
          ${unsubscribeHtml}
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
                            <a href="${href}" class="email-cta" style="display: inline-block; padding: 16px 40px; font-family: Inter, Arial, Helvetica, sans-serif; font-size: 16px; font-weight: 600; color: ${T.white}; text-decoration: none; letter-spacing: -0.01em;">
                              ${escapeHtml(text)}
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>`;
}

/** Render a secondary (outline) CTA button */
export function renderSecondaryButton(text: string, href: string): string {
  return `
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="border: 2px solid ${T.primary600}; border-radius: ${T.buttonRadius};">
                      <a href="${href}" style="display: inline-block; padding: 10px 20px; font-family: Inter, Arial, Helvetica, sans-serif; font-size: 14px; font-weight: 600; color: ${T.primary600}; text-decoration: none;">
                        ${escapeHtml(text)}
                      </a>
                    </td>
                  </tr>
                </table>`;
}

/** Render a detail card with label/value rows */
export function renderDetailCard(rows: Array<{ label: string; value: string }>): string {
  if (rows.length === 0) return '';

  const rowsHtml = rows
    .map(
      row => `
                      <tr>
                        <td class="email-detail-label" style="padding: 8px 0; color: ${T.neutral600}; font-size: 14px; width: 120px;">${escapeHtml(row.label)}</td>
                        <td class="email-detail-value" style="padding: 8px 0; color: ${T.neutral900}; font-size: 14px; font-weight: 500;">${row.value}</td>
                      </tr>`
    )
    .join('');

  return `
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="padding: 0 0 24px 0;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="email-detail-card" style="background-color: ${T.primary50}; border: 1px solid ${T.primary100}; border-radius: 8px; overflow: hidden;">
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
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="email-link-box" style="background-color: ${T.primary50}; border: 1px solid ${T.primary100}; border-radius: 8px; overflow: hidden;">
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
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td class="email-divider" style="padding: 16px 0; border-top: 1px solid ${T.neutral200};"></td>
                  </tr>
                </table>

                <p class="email-muted" style="margin: 0; padding: 0; font-size: 13px; line-height: 1.5; color: ${T.neutral500}; text-align: center;">
                  ${escapeHtml(text)}
                </p>`;
}

/** Render a colored status badge */
export function renderStatusBadge(text: string, color: 'red' | 'amber' | 'green'): string {
  const colorMap = {
    red: { bg: '#fef2f2', text: T.statusRed, border: '#fecaca' },
    amber: { bg: '#fffbeb', text: T.statusAmber, border: '#fde68a' },
    green: { bg: '#f0fdf4', text: T.statusGreen, border: '#bbf7d0' },
  };
  const c = colorMap[color];
  return `<span style="display: inline-block; vertical-align: middle; margin-left: 8px; padding: 4px 10px; font-size: 12px; font-weight: 600; color: ${c.text}; background-color: ${c.bg}; border: 1px solid ${c.border}; border-radius: 12px; letter-spacing: 0.02em; line-height: 1;">${escapeHtml(text)}</span>`;
}
