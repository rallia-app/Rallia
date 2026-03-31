import {
  wrapInLayout,
  renderCtaButton,
  renderDetailCard,
  renderDividerAndDisclaimer,
  escapeHtml,
  EMAIL_TOKENS,
} from '../../_shared/email-layout.ts';
import type { EmailContent, MatchInterestEmailPayload } from '../types.ts';

export function renderMatchInterestEmail(payload: MatchInterestEmailPayload): EmailContent {
  const greeting = payload.name ? `Hi ${escapeHtml(payload.name)},` : 'Hi there,';

  const subject = `You're interested in a ${escapeHtml(payload.sportName)} game!`;
  const preheader = `${payload.sportName} on ${payload.matchDate} at ${payload.location}`;

  const content = `
                <h2 style="margin: 0; padding: 0 0 8px 0; font-family: Poppins, Arial, Helvetica, sans-serif; font-size: 24px; font-weight: bold; color: ${EMAIL_TOKENS.primary600}; letter-spacing: -0.025em; line-height: 1.2;">
                  Game Details
                </h2>
                <p style="margin: 0; padding: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: ${EMAIL_TOKENS.neutral600};">
                  ${greeting} Thanks for your interest! Here are the details for the game you'd like to join:
                </p>
                ${renderDetailCard([
                  { label: 'Sport', value: escapeHtml(payload.sportName) },
                  { label: 'Date', value: escapeHtml(payload.matchDate) },
                  { label: 'Time', value: escapeHtml(payload.matchTime) },
                  { label: 'Location', value: escapeHtml(payload.location) },
                ])}
                <div style="padding: 24px 0 8px 0;">
                  <p style="margin: 0; padding: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: ${EMAIL_TOKENS.neutral600};">
                    To join this game, download the Rallia app and create your free account. You'll be able to join this match and discover more games near you.
                  </p>
                </div>
                ${renderCtaButton('View Game Details', payload.matchUrl)}
                ${renderDividerAndDisclaimer("You received this email because you expressed interest in a game on Rallia. If this wasn't you, you can safely ignore this email.")}`;

  const html = wrapInLayout({
    title: subject,
    content,
    footerNote: 'Rallia — Find your next game',
    preheader,
  });

  return { subject, html };
}
