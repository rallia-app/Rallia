import type { EmailContent, InvitationEmailPayload } from '../types.ts';

export function renderInvitationEmail(payload: InvitationEmailPayload): EmailContent {
  const currentYear = new Date().getFullYear();
  const siteUrl = Deno.env.get('SITE_URL') || 'https://rallia.com';

  // Build role display text
  let roleDisplay: string;
  if (payload.organizationName && payload.orgRole) {
    // For organization invitations, show the org role (admin, manager, staff, member)
    roleDisplay = payload.orgRole;
  } else if (payload.adminRole) {
    roleDisplay = `${payload.role} (${payload.adminRole})`;
  } else {
    roleDisplay = payload.role;
  }

  // Build invitation message
  let invitationMessage: string;
  if (payload.organizationName) {
    invitationMessage = `<strong style="color: #006d77;">${payload.inviterName}</strong> has invited you to join <strong style="color: #006d77;">${payload.organizationName}</strong> on Rallia as a <strong style="color: #006d77;">${roleDisplay}</strong>.`;
  } else {
    invitationMessage = `<strong style="color: #006d77;">${payload.inviterName}</strong> has invited you to join Rallia as a <strong style="color: #006d77;">${roleDisplay}</strong>.`;
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Rallia - You're Invited</title>
    <!--[if mso]>
      <style type="text/css">
        body, table, td { font-family: Arial, sans-serif !important; }
      </style>
    <![endif]-->
  </head>
  <body style="margin: 0; padding: 0;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f0fdfa; font-family: Arial, Helvetica, sans-serif;">
      <tr>
        <td align="center" style="padding: 40px 20px;">
          <!-- Main Container -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="background-color: #ffffff;">
            <!-- Header -->
            <tr>
              <td align="center" style="padding: 40px 40px 20px 40px; background-color: #a8dad6;">
                <img src="${siteUrl}/logo-dark.png" alt="Rallia" width="140" height="55" style="display: block; border: 0; max-width: 140px; height: auto;" />
              </td>
            </tr>

            <!-- Content -->
            <tr>
              <td style="padding: 40px 40px 30px 40px;">
                <h2 style="margin: 0; padding: 0 0 16px 0; font-family: Arial, Helvetica, sans-serif; font-size: 24px; font-weight: bold; color: #006d77; letter-spacing: -0.025em; line-height: 1.2;">
                  You're Invited!
                </h2>

                <p style="margin: 0; padding: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                  ${invitationMessage}
                </p>

                <p style="margin: 0; padding: 0 0 32px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                  Click the button below to accept your invitation and create your account.
                </p>

                <!-- CTA Button -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td align="center" style="padding: 0 0 32px 0;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td style="background-color: #006d77; border-radius: 10px;">
                            <a href="${payload.signUpUrl}" style="display: inline-block; padding: 16px 40px; font-family: Arial, Helvetica, sans-serif; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none; letter-spacing: -0.01em;">
                              Accept Invitation
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <!-- Link Fallback Box -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td align="center" style="padding: 0 0 24px 0;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #ccfbf1; border: 2px solid #83c5be;">
                        <tr>
                          <td style="padding: 24px;">
                            <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: bold; color: #006d77; text-transform: uppercase; letter-spacing: 0.05em;">
                              Or copy this link
                            </p>
                            <p style="margin: 0; font-size: 14px; color: #6b7280; word-break: break-all; line-height: 1.6;">
                              ${payload.signUpUrl}
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <p style="margin: 0; padding: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #6b7280;">
                  This invitation will expire on <strong style="color: #374151;">${payload.expiresAt}</strong>.
                </p>

                <!-- Divider -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td style="padding: 24px 0; border-top: 1px solid #e5e7eb;">&nbsp;</td>
                  </tr>
                </table>

                <p style="margin: 0; padding: 0; font-size: 13px; line-height: 1.5; color: #9ca3af;">
                  If you didn't expect this invitation, you can safely ignore this email.
                </p>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td align="center" style="padding: 30px 40px 40px 40px; background-color: #f9fafb; border-top: 1px solid #e5e7eb;">
                <p style="margin: 0; padding: 0 0 8px 0; font-size: 14px; font-weight: bold; color: #006d77;">Need help?</p>
                <p style="margin: 0; padding: 0; font-size: 13px; line-height: 1.5; color: #6b7280;">
                  If you're having trouble accepting your invitation, please contact our support team.
                </p>
                <p style="margin: 0; padding: 16px 0 0 0; font-size: 12px; line-height: 1.5; color: #9ca3af;">
                  &copy; ${currentYear} Rallia. All rights reserved.
                </p>
              </td>
            </tr>
          </table>

          <!-- Spacer -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td align="center" style="padding: 20px 0;">
                <p style="margin: 0; padding: 0; font-size: 12px; line-height: 1.5; color: #9ca3af;">
                  You're receiving this email because you were invited to join Rallia.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();

  return {
    subject: "You're Invited to Join Rallia",
    html,
  };
}
