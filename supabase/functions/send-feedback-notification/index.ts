/**
 * Edge Function: Send Feedback Notification
 *
 * Sends an email notification to the admin when new feedback is submitted.
 * This function can be called directly from the app after feedback submission
 * or via a database webhook.
 */

import { Resend } from 'resend';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'noreply@rallia.app';
const ADMIN_EMAIL = 'apprallia@gmail.com';

interface FeedbackPayload {
  feedback_id: string;
  category: 'bug' | 'feature' | 'improvement' | 'other';
  module?: string | null;
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

// ── Brand tokens ───────────────────────────────────────────────────────────
const BRAND = {
  primary: '#14b8a6',
  primaryDark: '#0f766e',
  primaryLight: '#ccfbf1',
  secondary: '#ed6a6d',
  accent: '#f59e0b',
  neutral50: '#fafafa',
  neutral100: '#f5f5f5',
  neutral200: '#e5e5e5',
  neutral400: '#a3a3a3',
  neutral600: '#525252',
  neutral800: '#262626',
  neutral900: '#171717',
  white: '#ffffff',
  logoUrl: 'https://rallia.app/logo-dark.png',
};

function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    bug: 'Bug Report',
    feature: 'Feature Request',
    improvement: 'Improvement',
    other: 'Other',
  };
  return labels[category] || category;
}

function getCategoryEmoji(category: string): string {
  const emojis: Record<string, string> = {
    bug: '🐛',
    feature: '✨',
    improvement: '💡',
    other: '📝',
  };
  return emojis[category] || '📝';
}

function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    bug: '#EF4444',
    feature: '#8B5CF6',
    improvement: '#3B82F6',
    other: '#6B7280',
  };
  return colors[category] || '#6B7280';
}

function getModuleLabel(module: string | null | undefined): string {
  if (!module) return 'Not specified';
  const labels: Record<string, string> = {
    match_features: 'Match Features',
    profile_settings: 'Profile & Settings',
    messaging: 'Messaging',
    rating_system: 'Rating System',
    player_directory: 'Player Directory',
    notifications: 'Notifications',
    performance: 'Performance',
    other: 'Other',
  };
  return labels[module] || module;
}

function getModuleEmoji(module: string | null | undefined): string {
  if (!module) return '📦';
  const emojis: Record<string, string> = {
    match_features: '🎾',
    profile_settings: '👤',
    messaging: '💬',
    rating_system: '⭐',
    player_directory: '📋',
    notifications: '🔔',
    performance: '⚡',
    other: '📦',
  };
  return emojis[module] || '📦';
}

function formatDeviceInfo(deviceInfo: Record<string, unknown> | null | undefined): string {
  if (!deviceInfo) return 'Not provided';

  const parts: string[] = [];
  if (deviceInfo.platform) parts.push(`${deviceInfo.platform}`);
  if (deviceInfo.osVersion) parts.push(`OS ${deviceInfo.osVersion}`);
  if (deviceInfo.deviceModel) parts.push(`${deviceInfo.deviceModel}`);

  return parts.length > 0 ? parts.join(' &middot; ') : 'Not provided';
}

function renderScreenshotsSection(screenshotUrls: string[] | null | undefined): string {
  if (!screenshotUrls || screenshotUrls.length === 0) return '';

  const screenshotImages = screenshotUrls
    .map(
      (url, index) => `
      <a href="${url}" target="_blank" style="display: inline-block; margin: 6px; text-decoration: none;">
        <img src="${url}" alt="Screenshot ${index + 1}" style="width: 160px; height: 160px; object-fit: cover; border-radius: 12px; border: 2px solid ${BRAND.neutral200};" />
      </a>
    `
    )
    .join('');

  return `
          <tr>
            <td style="padding: 0 32px 28px;">
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding-bottom: 12px;">
                    <p style="margin: 0; font-family: 'Poppins', 'Segoe UI', sans-serif; font-size: 11px; font-weight: 700; color: ${BRAND.neutral400}; text-transform: uppercase; letter-spacing: 1.2px;">
                      📸 &nbsp;Attachments (${screenshotUrls.length})
                    </p>
                  </td>
                </tr>
                <tr>
                  <td>
                    <div style="background-color: ${BRAND.neutral50}; border-radius: 12px; padding: 16px; text-align: center; border: 1px solid ${BRAND.neutral200};">
                      ${screenshotImages}
                    </div>
                    <p style="margin: 10px 0 0; font-size: 11px; color: ${BRAND.neutral400}; text-align: center;">
                      Click images to view full size
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
  `;
}

function renderInfoRow(
  icon: string,
  label: string,
  value: string,
  isLast: boolean = false
): string {
  return `
    <tr>
      <td style="padding: 14px 20px; ${isLast ? '' : `border-bottom: 1px solid ${BRAND.neutral200};`}">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="width: 28px; vertical-align: top; padding-top: 1px;">
              <span style="font-size: 14px;">${icon}</span>
            </td>
            <td>
              <p style="margin: 0 0 2px; font-family: 'Poppins', 'Segoe UI', sans-serif; font-size: 10px; font-weight: 700; color: ${BRAND.neutral400}; text-transform: uppercase; letter-spacing: 1px;">
                ${label}
              </p>
              <p style="margin: 0; font-family: 'Inter', 'Segoe UI', sans-serif; font-size: 14px; color: ${BRAND.neutral800}; line-height: 1.4;">
                ${value}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

function renderFeedbackEmail(payload: FeedbackPayload): { subject: string; html: string } {
  const categoryLabel = getCategoryLabel(payload.category);
  const categoryEmoji = getCategoryEmoji(payload.category);
  const categoryColor = getCategoryColor(payload.category);
  const formattedDate = new Date(payload.created_at).toLocaleString('en-US', {
    dateStyle: 'full',
    timeStyle: 'short',
  });

  const subject = `[Rallia] ${categoryEmoji} ${categoryLabel}: ${payload.subject}`;

  // Build the details rows dynamically
  const playerName = payload.player_name || 'Anonymous User';
  const playerEmailLink = payload.player_email
    ? `<a href="mailto:${payload.player_email}" style="color: ${BRAND.primary}; text-decoration: none;">${payload.player_email}</a>`
    : '';
  const playerDisplay = playerEmailLink ? `${playerName}<br>${playerEmailLink}` : playerName;

  // Build detail rows with metadata so we can mark the last row (no bottom border)
  interface RowData {
    icon: string;
    label: string;
    value: string;
  }
  const rowMeta: RowData[] = [];
  rowMeta.push({ icon: '👤', label: 'Submitted By', value: playerDisplay });
  if (payload.module && payload.module !== 'other') {
    rowMeta.push({
      icon: getModuleEmoji(payload.module),
      label: 'Section',
      value: getModuleLabel(payload.module),
    });
  }
  if (payload.app_version) {
    rowMeta.push({ icon: '📱', label: 'App Version', value: payload.app_version });
  }
  if (payload.device_info) {
    rowMeta.push({ icon: '🖥️', label: 'Device', value: formatDeviceInfo(payload.device_info) });
  }
  const detailRows: string[] = rowMeta.map((row, i) =>
    renderInfoRow(row.icon, row.label, row.value, i === rowMeta.length - 1)
  );

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>New Feedback — Rallia</title>
  <!--[if mso]>
  <style>
    table { border-collapse: collapse; }
    td { font-family: Arial, sans-serif; }
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f0fdfa;">

  <!-- Outer wrapper -->
  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f0fdfa;">
    <tr>
      <td align="center" style="padding: 32px 16px 48px;">

        <!-- ── Logo ──────────────────────────────────────────────────── -->
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 0 0 24px;">
              <img src="${BRAND.logoUrl}" alt="Rallia" width="120" style="display: block; border: 0; outline: none;" />
            </td>
          </tr>
        </table>

        <!-- ── Main card ─────────────────────────────────────────────── -->
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: ${BRAND.white}; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">

          <!-- Branded top bar -->
          <tr>
            <td style="height: 4px; background: linear-gradient(90deg, ${BRAND.primary}, ${BRAND.primaryDark}); font-size: 0; line-height: 0;">&nbsp;</td>
          </tr>

          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 0; text-align: center;">
              <p style="margin: 0 0 6px; font-family: 'Poppins', 'Segoe UI', sans-serif; font-size: 26px; font-weight: 700; color: ${BRAND.neutral900};">
                New Feedback Received
              </p>
              <p style="margin: 0; font-size: 13px; color: ${BRAND.neutral400};">
                ${formattedDate}
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 20px 32px 0;">
              <div style="height: 1px; background-color: ${BRAND.neutral200};"></div>
            </td>
          </tr>

          <!-- Category & Module badges -->
          <tr>
            <td style="padding: 24px 32px 0;">
              <table role="presentation" style="border-collapse: collapse;">
                <tr>
                  <td style="padding: 6px 18px; background-color: ${categoryColor}18; border-radius: 24px; border: 1px solid ${categoryColor}30;">
                    <span style="font-family: 'Poppins', 'Segoe UI', sans-serif; font-size: 13px; font-weight: 600; color: ${categoryColor};">
                      ${categoryEmoji} &nbsp;${categoryLabel}
                    </span>
                  </td>
                  <td style="width: 8px;"></td>
                  <td style="padding: 6px 18px; background-color: ${BRAND.primary}18; border-radius: 24px; border: 1px solid ${BRAND.primary}30;">
                    <span style="font-family: 'Poppins', 'Segoe UI', sans-serif; font-size: 13px; font-weight: 600; color: ${BRAND.primary};">
                      ${getModuleEmoji(payload.module)} &nbsp;${getModuleLabel(payload.module)}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Subject -->
          <tr>
            <td style="padding: 16px 32px 0;">
              <h2 style="margin: 0; font-family: 'Poppins', 'Segoe UI', sans-serif; font-size: 20px; font-weight: 700; color: ${BRAND.neutral900}; line-height: 1.3;">
                ${payload.subject}
              </h2>
            </td>
          </tr>

          <!-- Message body -->
          <tr>
            <td style="padding: 20px 32px 28px;">
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="width: 4px; background-color: ${categoryColor}; border-radius: 4px;"></td>
                  <td style="padding: 20px 24px; background-color: ${BRAND.neutral50}; border-radius: 0 12px 12px 0;">
                    <p style="margin: 0; font-family: 'Inter', 'Segoe UI', sans-serif; font-size: 15px; line-height: 1.7; color: ${BRAND.neutral600}; white-space: pre-wrap;">
${payload.message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${renderScreenshotsSection(payload.screenshot_urls)}

          <!-- Details card -->
          <tr>
            <td style="padding: 0 32px 32px;">
              <table role="presentation" style="width: 100%; border-collapse: collapse; border-radius: 12px; border: 1px solid ${BRAND.neutral200}; overflow: hidden;">
                ${detailRows.join('')}
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: ${BRAND.neutral50}; border-top: 1px solid ${BRAND.neutral200};">
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center">
                    <p style="margin: 0 0 4px; font-family: 'Inter', 'Segoe UI', sans-serif; font-size: 11px; color: ${BRAND.neutral400};">
                      Feedback ID &nbsp;<code style="background-color: ${BRAND.neutral200}; padding: 2px 8px; border-radius: 4px; font-family: 'Fira Code', Consolas, monospace; font-size: 11px; color: ${BRAND.neutral600};">${payload.feedback_id}</code>
                    </p>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top: 16px;">
                    <div style="height: 1px; background-color: ${BRAND.neutral200}; margin: 0 48px;"></div>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top: 16px;">
                    <img src="${BRAND.logoUrl}" alt="Rallia" width="64" style="display: inline-block; border: 0; opacity: 0.4;" />
                    <p style="margin: 8px 0 0; font-family: 'Inter', 'Segoe UI', sans-serif; font-size: 11px; color: ${BRAND.neutral400};">
                      Sent from the Rallia feedback system
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <!-- end main card -->

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
      return new Response(JSON.stringify({ success: false, error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Render email content
    const { subject, html } = renderFeedbackEmail(payload);

    // Send email via Resend SDK
    const resend = new Resend(RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject,
      html,
    });

    if (error) {
      console.error('Resend API error:', error.message);

      return new Response(
        JSON.stringify({ success: false, error: error.message } as EmailResponse),
        {
          status: 400,
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
