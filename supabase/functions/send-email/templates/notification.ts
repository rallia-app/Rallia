import type { EmailContent, NotificationEmailPayload } from '../types.ts';

export function renderNotificationEmail(payload: NotificationEmailPayload): EmailContent {
  const currentYear = new Date().getFullYear();
  const siteUrl = Deno.env.get('SITE_URL') || 'https://rallia.com';

  // Map notification types to more user-friendly subject prefixes
  const subjectPrefixes: Record<NotificationEmailPayload['notificationType'], string> = {
    match_invitation: 'Match Invitation',
    reminder: 'Reminder',
    payment: 'Payment',
    support: 'Support',
    chat: 'New Message',
    system: 'System Notification',
  };

  const subjectPrefix = subjectPrefixes[payload.notificationType];
  const subject = `${subjectPrefix}: ${payload.title}`;

  const html = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${payload.title}</title>
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
                  ${payload.title}
                </h2>
                ${payload.body ? `<div style="padding: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #374151;">${payload.body}</div>` : ''}

                <!-- Divider -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td style="padding: 24px 0; border-top: 1px solid #e5e7eb;">&nbsp;</td>
                  </tr>
                </table>

                <p style="margin: 0; padding: 0; font-size: 13px; line-height: 1.5; color: #9ca3af;">
                  If you didn't expect this notification, you can safely ignore this email.
                </p>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td align="center" style="padding: 30px 40px 40px 40px; background-color: #f9fafb; border-top: 1px solid #e5e7eb;">
                <p style="margin: 0; padding: 0 0 8px 0; font-size: 14px; font-weight: bold; color: #006d77;">Need help?</p>
                <p style="margin: 0; padding: 0; font-size: 13px; line-height: 1.5; color: #6b7280;">
                  If you're having trouble, please contact our support team.
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
                  You're receiving this email because of your notification preferences on Rallia.
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

  return { subject, html };
}
