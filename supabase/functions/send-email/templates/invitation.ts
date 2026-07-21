import {
  wrapInLayout,
  renderCtaButton,
  renderDividerAndDisclaimer,
  escapeHtml,
  EMAIL_TOKENS,
} from '../../_shared/email-layout.ts';
import { t } from '../../_shared/email-translations.ts';
import type { EmailContent, InvitationEmailPayload } from '../types.ts';

export function renderInvitationEmail(
  payload: InvitationEmailPayload,
  locale: string = 'en-US',
  siteUrl?: string
): EmailContent {
  const T = EMAIL_TOKENS;

  // Build role display text
  let roleDisplay: string;
  if (payload.organizationName && payload.orgRole) {
    roleDisplay = payload.orgRole;
  } else if (payload.adminRole) {
    roleDisplay = `${payload.role} (${payload.adminRole})`;
  } else {
    roleDisplay = payload.role;
  }

  // Build invitation message
  let invitationMessage: string;
  if (payload.organizationName) {
    invitationMessage = t(locale, 'invitation.messageOrg', {
      inviter: `<strong style="color: ${T.primary600};">${escapeHtml(payload.inviterName)}</strong>`,
      org: `<strong style="color: ${T.primary600};">${escapeHtml(payload.organizationName)}</strong>`,
      role: `<strong style="color: ${T.primary600};">${escapeHtml(roleDisplay)}</strong>`,
    });
  } else {
    invitationMessage = t(locale, 'invitation.messagePlatform', {
      inviter: `<strong style="color: ${T.primary600};">${escapeHtml(payload.inviterName)}</strong>`,
      role: `<strong style="color: ${T.primary600};">${escapeHtml(roleDisplay)}</strong>`,
    });
  }

  // Build preheader text
  const preheader = t(locale, 'preheader.invitation', {
    networkName: payload.organizationName || 'Rallia',
  });

  const content = `
                <h2 style="margin: 0; padding: 0 0 16px 0; font-family: Poppins, Arial, Helvetica, sans-serif; font-size: 24px; font-weight: bold; color: ${T.primary600}; letter-spacing: -0.025em; line-height: 1.2;">
                  ${t(locale, 'invitation.heading')}
                </h2>

                <p style="margin: 0; padding: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: ${T.neutral900};">
                  ${invitationMessage}
                </p>

                <p style="margin: 0; padding: 0 0 32px 0; font-size: 16px; line-height: 1.6; color: ${T.neutral900};">
                  ${t(locale, 'invitation.ctaDescription')}
                </p>

                ${renderCtaButton(t(locale, 'invitation.ctaButton'), payload.signUpUrl)}

                <p style="margin: 0; padding: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: ${T.neutral600}; text-align: center;">
                  ${t(locale, 'invitation.expiresAt')} <strong style="color: ${T.neutral900};">${payload.expiresAt}</strong>.
                </p>

                ${renderDividerAndDisclaimer(t(locale, 'invitation.disclaimer'))}`;

  const html = wrapInLayout({
    title: `Rallia - ${t(locale, 'invitation.heading')}`,
    content,
    footerNote: t(locale, 'invitation.footerNote'),
    locale,
    preheader,
    ...(siteUrl && { siteUrl }),
  });

  return {
    subject: t(locale, 'invitation.subject'),
    html,
  };
}
