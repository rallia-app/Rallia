/**
 * Shared Email Layout Module
 * Provides unified HTML shell, design tokens, and reusable components for all email templates.
 *
 * --- Redesign: "Editorial" ---
 * Same API and dark-mode classes; refreshed visuals:
 *   • compact teal header + slim gold accent rule
 *   • dark neutral headings (teal reserved for eyebrows/links)
 *   • neutral hairline cards instead of mint tints
 *   • flat coral CTA at 12px radius, quieter footer
 *   • mobile padding step-down via media query
 */

/** Design system tokens for email templates */
/* eslint-disable no-restricted-syntax -- Deno edge functions can't import
   @rallia/design-system (deploy bundles only supabase/functions); EMAIL_TOKENS
   is the sanctioned hand-copy of the palette for email HTML. */
export const EMAIL_TOKENS = {
  // Primary
  primary600: '#0d9488',
  primary100: '#ccfbf1',
  primary50: '#f0fdfa',
  primary300: '#5eead4',
  // Secondary
  secondary500: '#ed6a6d',
  // Accent (gold)
  accent500: '#f59e0b',
  accent100: '#fef3c7',
  accent700: '#b45309',
  // Neutral
  neutral900: '#171717',
  neutral600: '#525252',
  neutral500: '#737373',
  neutral200: '#e5e5e5',
  neutral50: '#fafafa',
  // Misc
  white: '#ffffff',
  pageBg: '#f3f6f5',
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
  buttonRadius: '12px',
  cardRadius: '16px',
} as const;
/* eslint-enable no-restricted-syntax */

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
  /** Optional override for the unsubscribe link target. When provided this URL
   *  is rendered in the footer instead of the generic settings page. Required
   *  for List-Unsubscribe one-click flows that ship a signed token. */
  unsubscribeUrl?: string;
  /** Optional override for the unsubscribe link label. Defaults to a
   *  morning-digest-specific label when `unsubscribeUrl` is set; callers like
   *  the admin broadcast pass their own ("Unsubscribe from these emails"). */
  unsubscribeLabel?: string;
}

/** Generate dark mode CSS block */
function getDarkModeCss(): string {
  return `
    <style type="text/css">
      @media (prefers-color-scheme: dark) {
        .email-body { background-color: ${T.darkPageBg} !important; }
        .email-container { background-color: ${T.darkContainerBg} !important; border-color: #404040 !important; }
        .email-header { background-color: ${T.darkHeaderBg} !important; }
        .email-content { background-color: ${T.darkContainerBg} !important; }
        .email-footer { background-color: #1f1f1f !important; border-top-color: #404040 !important; }
        .email-text { color: ${T.darkText} !important; }
        .email-muted { color: ${T.darkMutedText} !important; }
        .email-eyebrow { color: #5eead4 !important; }
        .email-detail-card { background-color: #2d2d2d !important; border-color: #404040 !important; }
        .email-detail-card td { border-bottom-color: #404040 !important; }
        .email-link-box { background-color: #2d2d2d !important; border-color: #404040 !important; }
        .email-divider { border-top-color: #404040 !important; }
        /* Content text — override inline colors on elements without dark-mode classes */
        .email-content p { color: ${T.darkText} !important; }
        .email-content div { color: ${T.darkText} !important; }
        .email-content h2 { color: #fafafa !important; }
        .email-content td { color: ${T.darkText} !important; }
        .email-content a { color: #5eead4 !important; }
        .email-content a.email-cta { color: ${T.white} !important; }
        .email-content strong { color: #fafafa !important; }
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
      [data-ogsc] .email-eyebrow { color: #5eead4 !important; }
      [data-ogsc] .email-content p { color: ${T.darkText} !important; }
      [data-ogsc] .email-content div { color: ${T.darkText} !important; }
      [data-ogsc] .email-content h2 { color: #fafafa !important; }
      [data-ogsc] .email-content td { color: ${T.darkText} !important; }
      [data-ogsc] .email-detail-label { color: ${T.darkMutedText} !important; }
      [data-ogsc] .email-detail-value { color: ${T.darkText} !important; }
      [data-ogsc] .email-footer p { color: ${T.darkMutedText} !important; }
      /* Responsive */
      @media (max-width: 620px) {
        .email-container { width: 100% !important; }
        .email-header { padding: 22px 24px 20px 24px !important; }
        .email-content { padding: 30px 24px 26px 24px !important; }
        .email-footer { padding: 26px 24px 30px 24px !important; }
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
                    <td align="center" style="padding: 18px 0 0 0;">
                      <p style="margin: 0; padding: 0 0 12px 0; font-size: 13px; font-weight: 600; color: ${T.primary600};">${downloadText}</p>
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td style="padding: 0 6px 0 0;">
                            <a href="https://apps.apple.com/app/rallia/id6760482014" style="text-decoration: none;">
                              <img src="${siteUrl}/app-store-badge.svg" alt="${appStoreAlt}" width="120" height="40" style="display: block; border: 0;" />
                            </a>
                          </td>
                          <td style="padding: 0 0 0 6px;">
                            <a href="https://play.google.com/store/apps/details?id=com.mathisl971.ralliaapp" style="text-decoration: none;">
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
    siteUrl = Deno.env.get('SITE_URL') || 'https://rallia.app',
    locale = 'en-US',
    preheader,
    showUnsubscribe = false,
    unsubscribeUrl,
    unsubscribeLabel: unsubscribeLabelOverride,
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
    ? `<p style="margin: 10px 0 0 0; padding: 0; font-size: 13px; font-weight: 600; color: ${T.primary100}; letter-spacing: 0.04em;">${escapeHtml(headerSubtitle)}</p>`
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

  const unsubscribeHref = unsubscribeUrl ?? `${siteUrl}/settings/notifications`;
  const unsubscribeLabel =
    unsubscribeLabelOverride ??
    (unsubscribeUrl
      ? isFr
        ? 'Se désabonner du résumé matinal'
        : 'Unsubscribe from the morning digest'
      : isFr
        ? 'Gérer les préférences de notification'
        : 'Manage notification preferences');
  const unsubscribeHtml = showUnsubscribe
    ? `
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td align="center" style="padding: 0 0 12px 0;">
                <a href="${unsubscribeHref}" style="font-size: 12px; color: ${T.neutral500}; text-decoration: underline;">
                  ${unsubscribeLabel}
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
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" class="email-container" style="background-color: ${T.white}; border: 1px solid ${T.neutral200}; border-radius: ${T.cardRadius}; overflow: hidden;">
            <!-- Header -->
            <tr>
              <td align="center" class="email-header" style="padding: 26px 40px 22px 40px; background-color: ${T.primary600}; border-radius: ${T.cardRadius} ${T.cardRadius} 0 0;">
                <img src="${siteUrl}/logo-light.png" alt="Rallia" width="112" height="44" style="display: block; border: 0; max-width: 112px; height: auto;" />
                ${subtitleHtml}
              </td>
            </tr>

            <!-- Gold accent rule -->
            <tr>
              <td style="height: 3px; line-height: 3px; font-size: 3px; background-color: ${T.accent500};">&nbsp;</td>
            </tr>

            <!-- Content -->
            <tr>
              <td class="email-content" style="padding: 40px 44px 32px 44px;">
                ${content}
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td align="center" class="email-footer" style="padding: 28px 40px 32px 40px; background-color: ${T.neutral50}; border-top: 1px solid ${T.neutral200}; border-radius: 0 0 ${T.cardRadius} ${T.cardRadius};">
                <p class="email-text" style="margin: 0; padding: 0 0 4px 0; font-size: 13px; font-weight: 600; color: ${T.neutral900};">${needHelpText}</p>
                <p class="email-muted" style="margin: 0; padding: 0; font-size: 13px; line-height: 1.5; color: ${T.neutral500};">
                  ${supportText}
                </p>
                ${getAppStoreBadgesHtml(siteUrl, locale)}
                <p class="email-muted" style="margin: 0; padding: 20px 0 0 0; font-size: 12px; line-height: 1.5; color: ${T.neutral500};">
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

/** Render an uppercase eyebrow label that sits above the H2 heading */
export function renderEyebrow(text: string): string {
  return `<p class="email-eyebrow" style="margin: 0; padding: 0 0 10px 0; font-size: 12px; font-weight: bold; color: ${T.primary600}; text-transform: uppercase; letter-spacing: 0.12em;">${escapeHtml(text)}</p>`;
}

/** Render a coral CTA button */
export function renderCtaButton(text: string, href: string): string {
  return `
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td align="center" style="padding: 4px 0 32px 0;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td style="background-color: ${T.secondary500}; border-radius: ${T.buttonRadius};">
                            <a href="${href}" class="email-cta" style="display: inline-block; padding: 15px 40px; font-family: Inter, Arial, Helvetica, sans-serif; font-size: 16px; font-weight: 600; color: ${T.white}; text-decoration: none; letter-spacing: -0.01em;">
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

  const lastIndex = rows.length - 1;
  const rowsHtml = rows
    .map(
      (row, i) => `
                      <tr>
                        <td class="email-detail-label" style="padding: 13px 0; ${i < lastIndex ? 'border-bottom: 1px solid #f0f0f0;' : ''} color: ${T.neutral500}; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; width: 110px; vertical-align: middle;">${escapeHtml(row.label)}</td>
                        <td class="email-detail-value" style="padding: 13px 0; ${i < lastIndex ? 'border-bottom: 1px solid #f0f0f0;' : ''} color: ${T.neutral900}; font-size: 15px; font-weight: 600; vertical-align: middle;">${row.value}</td>
                      </tr>`
    )
    .join('');

  return `
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="padding: 0 0 24px 0;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="email-detail-card" style="background-color: ${T.white}; border: 1px solid ${T.neutral200}; border-radius: 14px; overflow: hidden;">
                        <tr>
                          <td style="padding: 8px 22px;">
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
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="email-link-box" style="background-color: ${T.neutral50}; border: 1px solid ${T.neutral200}; border-radius: 14px; overflow: hidden;">
                        <tr>
                          <td style="padding: 20px 24px;">
                            <p style="margin: 0 0 8px 0; font-size: 12px; font-weight: bold; color: ${T.primary600}; text-transform: uppercase; letter-spacing: 0.08em;">
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
    // eslint-disable-next-line no-restricted-syntax -- decorative badge palette, must not track brand-token changes
    amber: { bg: '#fffbeb', text: T.statusAmber, border: '#fde68a' },
    green: { bg: '#f0fdf4', text: T.statusGreen, border: '#bbf7d0' },
  };
  const c = colorMap[color];
  return `<span style="display: inline-block; vertical-align: middle; margin-left: 8px; padding: 4px 10px; font-size: 12px; font-weight: 600; color: ${c.text}; background-color: ${c.bg}; border: 1px solid ${c.border}; border-radius: 12px; letter-spacing: 0.02em; line-height: 1;">${escapeHtml(text)}</span>`;
}
