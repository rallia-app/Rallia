import {
  wrapInLayout,
  renderCtaButton,
  renderDividerAndDisclaimer,
  escapeHtml,
  EMAIL_TOKENS,
} from '../../_shared/email-layout.ts';
import { t } from '../../_shared/email-translations.ts';
import type { EmailContent, WelcomeEmailPayload } from '../types.ts';

const CONTACT_EMAIL = 'contact@rallia.ca';

/** Uppercase the first letter, leave the rest as-is (e.g. "alex" → "Alex"). */
function capitalizeFirst(value: string): string {
  return value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/** A secondary step: title, body, and an inline arrow link to the app/website. */
function renderStepRow(title: string, body: string, ctaText: string, ctaUrl: string): string {
  const T = EMAIL_TOKENS;
  return `
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td style="padding: 0 0 20px 0;">
                      <p style="margin: 0; padding: 0 0 6px 0; font-size: 15px; font-weight: 700; color: ${T.neutral900}; line-height: 1.3;">
                        ${escapeHtml(title)}
                      </p>
                      <p style="margin: 0; padding: 0 0 6px 0; font-size: 15px; line-height: 1.6; color: ${T.neutral600};">
                        ${escapeHtml(body)}
                      </p>
                      <p style="margin: 0; padding: 0; font-size: 15px; font-weight: 600; line-height: 1.4;">
                        <a href="${ctaUrl}" style="color: ${T.primary600}; text-decoration: none;">&rarr; ${escapeHtml(ctaText)}</a>
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
  const subject = payload.firstName
    ? t(locale, 'welcome.subject', { firstName: capitalizeFirst(payload.firstName) })
    : t(locale, 'welcome.subjectDefault');
  const preheader = t(locale, 'welcome.preheader');

  const heading = payload.firstName
    ? t(locale, 'welcome.heading', { firstName: escapeHtml(capitalizeFirst(payload.firstName)) })
    : t(locale, 'welcome.headingDefault');

  const emailLink = `<a href="mailto:${CONTACT_EMAIL}" style="color: ${T.primary600}; text-decoration: none;">${CONTACT_EMAIL}</a>`;
  // Trusted copy only (no user input) — rendered unescaped so the mailto link survives.
  const contact = t(locale, 'welcome.contact', { email: emailLink });

  const isFr = locale.startsWith('fr');
  const sportLabel = payload.sports.length
    ? payload.sports.map(s => s.toLowerCase()).join(isFr ? ' et ' : ' and ')
    : t(locale, 'welcome.sportFallback');
  const intro = t(locale, 'welcome.intro', { sport: sportLabel });

  const courtCountLabel =
    payload.courtCount != null
      ? String(payload.courtCount)
      : t(locale, 'welcome.courts.countFallback');
  const courtArea = t(
    locale,
    payload.courtCount != null ? 'welcome.area.nearYou' : 'welcome.area.region'
  );
  const courtsBody = t(locale, 'welcome.steps.courts.body', {
    courtCount: courtCountLabel,
    area: courtArea,
  });

  const content = `
                <h2 style="margin: 0; padding: 0 0 16px 0; font-family: Poppins, Arial, Helvetica, sans-serif; font-size: 24px; font-weight: bold; color: ${T.neutral900}; letter-spacing: -0.025em; line-height: 1.2;">
                  ${heading}
                </h2>

                <p style="margin: 0; padding: 0 0 12px 0; font-size: 16px; line-height: 1.6; color: ${T.neutral600};">
                  ${escapeHtml(intro)}
                </p>

                <p style="margin: 0; padding: 0 0 28px 0; font-size: 16px; font-weight: 600; line-height: 1.5; color: ${T.neutral900};">
                  ${escapeHtml(t(locale, 'welcome.mission'))}
                </p>

                <p style="margin: 0; padding: 0 0 6px 0; font-size: 18px; font-weight: 700; color: ${T.neutral900}; line-height: 1.3;">
                  ${escapeHtml(t(locale, 'welcome.hero.title'))}
                </p>
                <p style="margin: 0; padding: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: ${T.neutral600};">
                  ${escapeHtml(t(locale, 'welcome.hero.body'))}
                </p>

                ${renderCtaButton(t(locale, 'welcome.hero.cta'), payload.profileUrl)}

                <p style="margin: 0; padding: 8px 0 16px 0; font-size: 15px; font-weight: 600; line-height: 1.5; color: ${T.neutral900};">
                  ${escapeHtml(t(locale, 'welcome.stepsIntro'))}
                </p>

                ${renderStepRow(
                  t(locale, 'welcome.steps.courts.title'),
                  courtsBody,
                  t(locale, 'welcome.steps.courts.cta'),
                  payload.courtsUrl
                )}

                ${renderStepRow(
                  t(locale, 'welcome.steps.games.title'),
                  t(locale, 'welcome.steps.games.body'),
                  t(locale, 'welcome.steps.games.cta'),
                  payload.gamesUrl
                )}

                <p style="margin: 0; padding: 8px 0 24px 0; font-size: 15px; line-height: 1.6; color: ${T.neutral600};">
                  ${escapeHtml(t(locale, 'welcome.community'))}
                </p>

                <p style="margin: 0; padding: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: ${T.neutral600};">
                  ${contact}
                </p>

                <p style="margin: 0; padding: 0; font-size: 15px; line-height: 1.6; color: ${T.neutral900};">
                  ${escapeHtml(t(locale, 'welcome.signoff'))}<br />
                  ${escapeHtml(t(locale, 'welcome.signoffTeam'))}
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
