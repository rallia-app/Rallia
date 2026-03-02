/**
 * Edge Function: Send Feedback Notification
 *
 * Sends an email notification to the admin when new feedback is submitted.
 * This function can be called directly from the app after feedback submission
 * or via a database webhook.
 */

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'noreply@rallia.app';
const ADMIN_EMAIL = 'apprallia@gmail.com';

interface FeedbackPayload {
  feedback_id: string;
  category: 'bug' | 'feature' | 'improvement' | 'other';
  subject: string;
  message: string;
  player_id?: string | null;
  player_name?: string | null;
  player_email?: string | null;
  app_version?: string | null;
  device_info?: Record<string, unknown> | null;
  screenshot_urls?: string[] | null;
  created_at: string;
}

interface EmailResponse {
  success: boolean;
  id?: string;
  error?: string;
}

function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    bug: '🐛 Bug Report',
    feature: '✨ Feature Request',
    improvement: '💡 Improvement',
    other: '📝 Other',
  };
  return labels[category] || category;
}

function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    bug: '#EF4444', // red
    feature: '#8B5CF6', // purple
    improvement: '#3B82F6', // blue
    other: '#6B7280', // gray
  };
  return colors[category] || '#6B7280';
}

function formatDeviceInfo(deviceInfo: Record<string, unknown> | null | undefined): string {
  if (!deviceInfo) return 'Not provided';

  const parts: string[] = [];
  if (deviceInfo.platform) parts.push(`Platform: ${deviceInfo.platform}`);
  if (deviceInfo.osVersion) parts.push(`OS: ${deviceInfo.osVersion}`);
  if (deviceInfo.deviceModel) parts.push(`Device: ${deviceInfo.deviceModel}`);

  return parts.length > 0 ? parts.join(' | ') : 'Not provided';
}

function renderScreenshotsSection(screenshotUrls: string[] | null | undefined): string {
  if (!screenshotUrls || screenshotUrls.length === 0) return '';

  const screenshotImages = screenshotUrls
    .map(
      (url, index) => `
      <a href="${url}" target="_blank" style="display: inline-block; margin: 4px;">
        <img src="${url}" alt="Screenshot ${index + 1}" style="width: 150px; height: 150px; object-fit: cover; border-radius: 8px; border: 1px solid #e4e4e7;" />
      </a>
    `
    )
    .join('');

  return `
          <!-- Screenshots -->
          <tr>
            <td style="padding: 0 32px 24px;">
              <p style="margin: 0 0 12px; font-size: 13px; font-weight: 600; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px;">
                📸 Screenshots (${screenshotUrls.length})
              </p>
              <div style="background-color: #f4f4f5; border-radius: 8px; padding: 12px; text-align: center;">
                ${screenshotImages}
              </div>
              <p style="margin: 8px 0 0; font-size: 12px; color: #a1a1aa; text-align: center;">
                Click on images to view full size
              </p>
            </td>
          </tr>
  `;
}

function renderFeedbackEmail(payload: FeedbackPayload): { subject: string; html: string } {
  const categoryLabel = getCategoryLabel(payload.category);
  const categoryColor = getCategoryColor(payload.category);
  const formattedDate = new Date(payload.created_at).toLocaleString('en-US', {
    dateStyle: 'full',
    timeStyle: 'short',
  });

  const subject = `[Rallia Feedback] ${categoryLabel}: ${payload.subject}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Feedback Submission</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px; text-align: center; border-bottom: 1px solid #e4e4e7;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #18181b;">
                📬 New Feedback Received
              </h1>
              <p style="margin: 8px 0 0; font-size: 14px; color: #71717a;">
                ${formattedDate}
              </p>
            </td>
          </tr>
          
          <!-- Category Badge -->
          <tr>
            <td style="padding: 24px 32px 0;">
              <span style="display: inline-block; padding: 6px 16px; background-color: ${categoryColor}20; color: ${categoryColor}; font-size: 14px; font-weight: 600; border-radius: 20px;">
                ${categoryLabel}
              </span>
            </td>
          </tr>
          
          <!-- Subject -->
          <tr>
            <td style="padding: 16px 32px 0;">
              <h2 style="margin: 0; font-size: 20px; font-weight: 600; color: #18181b;">
                ${payload.subject}
              </h2>
            </td>
          </tr>
          
          <!-- Message -->
          <tr>
            <td style="padding: 16px 32px;">
              <div style="padding: 20px; background-color: #f4f4f5; border-radius: 8px; border-left: 4px solid ${categoryColor};">
                <p style="margin: 0; font-size: 15px; line-height: 1.6; color: #3f3f46; white-space: pre-wrap;">
                  ${payload.message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
                </p>
              </div>
            </td>
          </tr>
          
          ${renderScreenshotsSection(payload.screenshot_urls)}
          
          <!-- User Info -->
          <tr>
            <td style="padding: 0 32px 24px;">
              <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #fafafa; border-radius: 8px;">
                <tr>
                  <td style="padding: 16px;">
                    <p style="margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px;">
                      Submitted By
                    </p>
                    <p style="margin: 0; font-size: 15px; color: #3f3f46;">
                      ${payload.player_name || 'Anonymous User'}
                      ${payload.player_email ? `<br><span style="color: #71717a; font-size: 13px;">${payload.player_email}</span>` : ''}
                    </p>
                  </td>
                </tr>
                ${
                  payload.app_version
                    ? `
                <tr>
                  <td style="padding: 0 16px 16px;">
                    <p style="margin: 0 0 4px; font-size: 13px; font-weight: 600; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px;">
                      App Version
                    </p>
                    <p style="margin: 0; font-size: 14px; color: #3f3f46;">
                      ${payload.app_version}
                    </p>
                  </td>
                </tr>
                `
                    : ''
                }
                ${
                  payload.device_info
                    ? `
                <tr>
                  <td style="padding: 0 16px 16px;">
                    <p style="margin: 0 0 4px; font-size: 13px; font-weight: 600; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px;">
                      Device Info
                    </p>
                    <p style="margin: 0; font-size: 14px; color: #3f3f46;">
                      ${formatDeviceInfo(payload.device_info)}
                    </p>
                  </td>
                </tr>
                `
                    : ''
                }
              </table>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: #fafafa; border-radius: 0 0 12px 12px; border-top: 1px solid #e4e4e7;">
              <p style="margin: 0; font-size: 13px; color: #71717a; text-align: center;">
                Feedback ID: <code style="background-color: #e4e4e7; padding: 2px 6px; border-radius: 4px; font-size: 12px;">${payload.feedback_id}</code>
              </p>
              <p style="margin: 8px 0 0; font-size: 12px; color: #a1a1aa; text-align: center;">
                This notification was sent from the Rallia app feedback system.
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

Deno.serve(async req => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  try {
    // Only allow POST requests
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check for API key
    if (!RESEND_API_KEY) {
      console.error('RESEND_API_KEY not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'Email service not configured' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Parse request body
    const payload: FeedbackPayload = await req.json();

    // Validate required fields
    if (!payload.feedback_id || !payload.category || !payload.subject || !payload.message) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Render email content
    const { subject, html } = renderFeedbackEmail(payload);

    // Send email via Resend API
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: ADMIN_EMAIL,
        subject,
        html,
      }),
    });

    const data = await res.json();

    // Handle Resend API errors
    if (!res.ok) {
      const errorMessage = data?.message || data?.error || 'Failed to send email';
      console.error('Resend API error:', errorMessage, data);

      return new Response(
        JSON.stringify({ success: false, error: errorMessage } as EmailResponse),
        {
          status: res.status,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // Return success response
    const successResponse: EmailResponse = {
      success: true,
      id: data?.id,
    };

    console.log('Feedback notification sent successfully:', payload.feedback_id);

    return new Response(JSON.stringify(successResponse), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Feedback notification error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      } as EmailResponse),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
});
