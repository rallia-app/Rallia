import {
  wrapInLayout,
  renderCtaButton,
  renderDetailCard,
  renderDividerAndDisclaimer,
  escapeHtml,
  EMAIL_TOKENS,
} from '../../_shared/email-layout.ts';
import { t } from '../../_shared/email-translations.ts';
import type { EmailContent, MatchInterestEmailPayload } from '../types.ts';

export function renderMatchInterestEmail(payload: MatchInterestEmailPayload): EmailContent {
  const locale = payload.locale || 'en-US';
  const greeting = payload.name
    ? t(locale, 'matchInterest.greeting', { name: escapeHtml(payload.name) })
    : t(locale, 'matchInterest.greetingDefault');

  const subject = t(locale, 'matchInterest.subject', {
    sportName: escapeHtml(payload.sportName),
  });
  const preheader = t(locale, 'matchInterest.preheader', {
    sportName: payload.sportName,
    matchDate: payload.matchDate,
  });

  const content = `
                <h2 style="margin: 0; padding: 0 0 8px 0; font-family: Poppins, Arial, Helvetica, sans-serif; font-size: 24px; font-weight: bold; color: ${EMAIL_TOKENS.primary600}; letter-spacing: -0.025em; line-height: 1.2;">
                  ${t(locale, 'matchInterest.heading')}
                </h2>
                <p style="margin: 0; padding: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: ${EMAIL_TOKENS.neutral600};">
                  ${greeting} ${t(locale, 'matchInterest.body')}
                </p>
                ${renderCtaButton(t(locale, 'matchInterest.ctaButton'), payload.matchUrl)}
                <div style="padding: 24px 0 8px 0;">
                  <p style="margin: 0; padding: 0 0 12px 0; font-size: 14px; font-weight: 600; color: ${EMAIL_TOKENS.neutral600}; text-transform: uppercase; letter-spacing: 0.05em;">
                    ${t(locale, 'matchInterest.gameInfoLabel')}
                  </p>
                </div>
                ${renderDetailCard([
                  { label: t(locale, 'matchInterest.sport'), value: escapeHtml(payload.sportName) },
                  { label: t(locale, 'matchInterest.date'), value: escapeHtml(payload.matchDate) },
                  { label: t(locale, 'matchInterest.time'), value: escapeHtml(payload.matchTime) },
                  {
                    label: t(locale, 'matchInterest.location'),
                    value: escapeHtml(payload.location),
                  },
                ])}
                <div style="padding: 24px 0 8px 0;">
                  <p style="margin: 0; padding: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: ${EMAIL_TOKENS.neutral600};">
                    ${t(locale, 'matchInterest.valueProp')}
                  </p>
                </div>
                ${renderDividerAndDisclaimer(t(locale, 'matchInterest.disclaimer'))}`;

  const html = wrapInLayout({
    title: subject,
    content,
    footerNote: t(locale, 'matchInterest.footerNote'),
    preheader,
    locale,
  });

  return { subject, html };
}
