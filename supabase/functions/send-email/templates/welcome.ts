import {
  wrapInLayout,
  renderCtaButton,
  renderDividerAndDisclaimer,
  escapeHtml,
  EMAIL_TOKENS,
} from '../../_shared/email-layout.ts';
import { t } from '../../_shared/email-translations.ts';
import type { EmailContent, WelcomeEmailPayload } from '../types.ts';

function renderFeatureRow(title: string, body: string): string {
  const T = EMAIL_TOKENS;
  return `
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td style="padding: 0 0 20px 0;">
                      <p style="margin: 0; padding: 0 0 6px 0; font-size: 15px; font-weight: 700; color: ${T.primary600}; line-height: 1.3;">
                        ${escapeHtml(title)}
                      </p>
                      <p style="margin: 0; padding: 0; font-size: 15px; line-height: 1.6; color: ${T.neutral600};">
                        ${escapeHtml(body)}
                      </p>
                    </td>
                  </tr>
                </table>`;
}

export function renderWelcomeEmail(
  payload: WelcomeEmailPayload,
  locale: string = 'en-US'
): EmailContent {
  const T = EMAIL_TOKENS;
  const subject = t(locale, 'welcome.subject');
  const preheader = t(locale, 'welcome.preheader');

  const heading = payload.firstName
    ? t(locale, 'welcome.heading', { firstName: escapeHtml(payload.firstName) })
    : t(locale, 'welcome.headingDefault');

  const features = [
    renderFeatureRow(
      t(locale, 'welcome.features.courts.title'),
      t(locale, 'welcome.features.courts.body')
    ),
    renderFeatureRow(
      t(locale, 'welcome.features.matches.title'),
      t(locale, 'welcome.features.matches.body')
    ),
    renderFeatureRow(
      t(locale, 'welcome.features.levels.title'),
      t(locale, 'welcome.features.levels.body')
    ),
    renderFeatureRow(
      t(locale, 'welcome.features.reputation.title'),
      t(locale, 'welcome.features.reputation.body')
    ),
  ].join('');

  const content = `
                <h2 style="margin: 0; padding: 0 0 8px 0; font-family: Poppins, Arial, Helvetica, sans-serif; font-size: 24px; font-weight: bold; color: ${T.primary600}; letter-spacing: -0.025em; line-height: 1.2;">
                  ${heading}
                </h2>

                <p style="margin: 0; padding: 0 0 24px 0; font-size: 18px; font-weight: 600; line-height: 1.4; color: ${T.neutral900};">
                  ${escapeHtml(t(locale, 'welcome.missionTagline'))}
                </p>

                <p style="margin: 0; padding: 0 0 32px 0; font-size: 16px; line-height: 1.6; color: ${T.neutral600};">
                  ${escapeHtml(t(locale, 'welcome.intro'))}
                </p>

                ${renderCtaButton(t(locale, 'welcome.ctaButton'), payload.openAppUrl)}

                <p style="margin: 0; padding: 8px 0 16px 0; font-size: 14px; font-weight: 600; color: ${T.neutral600}; text-transform: uppercase; letter-spacing: 0.05em;">
                  ${escapeHtml(t(locale, 'welcome.featuresHeading'))}
                </p>

                ${features}

                <p style="margin: 0; padding: 16px 0 0 0; font-size: 15px; font-weight: 600; line-height: 1.6; color: ${T.primary600}; text-align: center;">
                  ${escapeHtml(t(locale, 'welcome.footerTagline'))}
                </p>

                ${renderDividerAndDisclaimer(t(locale, 'welcome.disclaimer'))}`;

  const html = wrapInLayout({
    title: subject,
    content,
    footerNote: t(locale, 'welcome.footerNote'),
    preheader,
    locale,
  });

  return { subject, html };
}
