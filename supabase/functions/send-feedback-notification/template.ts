/**
 * Feedback notification email template.
 *
 * Renders the admin-facing "new feedback" email inside the shared brand shell
 * (`wrapInLayout`), so it inherits the same header, gold accent rule, footer and
 * dark mode as every other Rallia email. Feedback-specific content (category
 * badges, severity pills, metadata blocks, screenshots) lives here.
 */

import { renderDetailCard, renderEyebrow, wrapInLayout } from '../_shared/email-layout.ts';

export interface FeedbackMetadata {
  // Bug
  severity?: 'minor' | 'major' | 'critical';
  steps_to_reproduce?: string;
  expected_vs_actual?: string;
  // Feature
  feature_title?: string;
  description?: string;
  use_case?: string;
  // PMF / Improvement
  disappointment_score?: 'very_disappointed' | 'somewhat_disappointed' | 'not_disappointed';
  main_benefit?: string;
  ideal_user?: string;
  how_to_improve?: string;
}

export interface FeedbackPayload {
  feedback_id: string;
  category: 'bug' | 'feature' | 'improvement' | 'other';
  module?: string | null;
  subject: string;
  message: string;
  metadata?: FeedbackMetadata | null;
  player_id?: string | null;
  player_name?: string | null;
  player_email?: string | null;
  app_version?: string | null;
  device_info?: Record<string, unknown> | null;
  screenshot_urls?: string[] | null;
  created_at: string;
}

// ── Content palette ─────────────────────────────────────────────────────────
// Structural colours mirror the shared design tokens; the category/severity
// values below stay semantic (they encode meaning, not brand chrome).
const BRAND = {
  primary: '#0d9488',
  neutral50: '#fafafa',
  neutral200: '#e5e5e5',
  neutral400: '#a3a3a3',
  neutral600: '#525252',
  neutral800: '#262626',
  neutral900: '#171717',
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
    profile_settings: 'Profile & Settings',
    match_features: 'Match Features',
    facilities: 'Facilities',
    player_directory: 'Player Directory',
    groups_communities: 'Groups & Communities',
    notifications: 'Notifications',
    performance: 'Performance',
    other: 'Other',
  };
  return labels[module] || module;
}

function getModuleEmoji(module: string | null | undefined): string {
  if (!module) return '📦';
  const emojis: Record<string, string> = {
    profile_settings: '👤',
    match_features: '🎾',
    facilities: '🏟️',
    player_directory: '📋',
    groups_communities: '👥',
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
                    <td style="padding: 0 0 16px 0;">
                      <p class="email-muted" style="margin: 0 0 12px; font-family: 'Poppins', 'Segoe UI', sans-serif; font-size: 11px; font-weight: 700; color: ${BRAND.neutral400}; text-transform: uppercase; letter-spacing: 1.2px;">
                        📸 &nbsp;Attachments (${screenshotUrls.length})
                      </p>
                      <table role="presentation" width="100%" class="email-detail-card" style="border-collapse: separate; background-color: ${BRAND.neutral50}; border: 1px solid ${BRAND.neutral200}; border-radius: 14px;">
                        <tr>
                          <td style="padding: 16px; text-align: center;">
                            ${screenshotImages}
                          </td>
                        </tr>
                      </table>
                      <p class="email-muted" style="margin: 10px 0 0; font-size: 11px; color: ${BRAND.neutral400}; text-align: center;">
                        Click images to view full size
                      </p>
                    </td>
                  </tr>
  `;
}

function getSeverityLabel(severity: string): string {
  const labels: Record<string, string> = {
    minor: 'Minor',
    major: 'Major',
    critical: 'Critical',
  };
  return labels[severity] || severity;
}

function getSeverityColor(severity: string): string {
  const colors: Record<string, string> = {
    minor: '#F59E0B',
    major: '#F97316',
    critical: '#EF4444',
  };
  return colors[severity] || '#6B7280';
}

function getDisappointmentLabel(score: string): string {
  const labels: Record<string, string> = {
    very_disappointed: 'Very disappointed',
    somewhat_disappointed: 'Somewhat disappointed',
    not_disappointed: 'Not disappointed',
  };
  return labels[score] || score;
}

function escapeHtml(text: string): string {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A pill (uppercase label + coloured chip), as a content-table row. */
function renderPillBlock(label: string, value: string, color: string): string {
  return `
                  <tr>
                    <td style="padding: 0 0 16px 0;">
                      <p class="email-muted" style="margin: 0 0 8px; font-family: 'Poppins', 'Segoe UI', sans-serif; font-size: 11px; font-weight: 700; color: ${BRAND.neutral400}; text-transform: uppercase; letter-spacing: 1.2px;">
                        ${label}
                      </p>
                      <table role="presentation" style="border-collapse: collapse;">
                        <tr>
                          <td style="padding: 6px 18px; background-color: ${color}18; border-radius: 24px; border: 1px solid ${color}30;">
                            <span style="font-family: 'Poppins', 'Segoe UI', sans-serif; font-size: 13px; font-weight: 600; color: ${color};">
                              ${value}
                            </span>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
  `;
}

/**
 * A free-text block with a coloured left accent, as a content-table row.
 * `label` is optional — the main message body passes an empty label.
 */
function renderMetadataBlock(
  label: string,
  content: string,
  color: string = BRAND.neutral600
): string {
  const labelHtml = label
    ? `
                      <p class="email-muted" style="margin: 0 0 8px; font-family: 'Poppins', 'Segoe UI', sans-serif; font-size: 11px; font-weight: 700; color: ${BRAND.neutral400}; text-transform: uppercase; letter-spacing: 1.2px;">
                        ${label}
                      </p>`
    : '';
  return `
                  <tr>
                    <td style="padding: 0 0 16px 0;">${labelHtml}
                      <table role="presentation" style="width: 100%; border-collapse: collapse;">
                        <tr>
                          <td style="width: 4px; background-color: ${color}; border-radius: 4px;"></td>
                          <td class="email-detail-card" style="padding: 16px 20px; background-color: ${BRAND.neutral50}; border-radius: 0 14px 14px 0;">
                            <p class="email-text" style="margin: 0; font-family: 'Inter', 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.6; color: ${BRAND.neutral600}; white-space: pre-wrap;">${escapeHtml(content)}</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
  `;
}

function renderMetadataSection(payload: FeedbackPayload): string {
  const meta = payload.metadata;
  if (!meta) return '';

  const categoryColor = getCategoryColor(payload.category);
  const parts: string[] = [];

  if (payload.category === 'bug' && meta.severity) {
    parts.push(
      renderPillBlock('Severity', getSeverityLabel(meta.severity), getSeverityColor(meta.severity))
    );
    if (meta.steps_to_reproduce) {
      parts.push(renderMetadataBlock('Steps to Reproduce', meta.steps_to_reproduce, categoryColor));
    }
    if (meta.expected_vs_actual) {
      parts.push(renderMetadataBlock('Expected vs Actual', meta.expected_vs_actual, categoryColor));
    }
  }

  if (payload.category === 'feature') {
    if (meta.use_case) {
      parts.push(renderMetadataBlock('Use Case', meta.use_case, categoryColor));
    }
  }

  if (payload.category === 'improvement') {
    if (meta.disappointment_score) {
      parts.push(
        renderPillBlock(
          'Disappointment Score',
          getDisappointmentLabel(meta.disappointment_score),
          categoryColor
        )
      );
    }
    if (meta.main_benefit) {
      parts.push(renderMetadataBlock('Main Benefit', meta.main_benefit, categoryColor));
    }
    if (meta.ideal_user) {
      parts.push(renderMetadataBlock('Ideal User', meta.ideal_user, categoryColor));
    }
    if (meta.how_to_improve) {
      parts.push(renderMetadataBlock('How to Improve', meta.how_to_improve, categoryColor));
    }
  }

  return parts.join('');
}

export function renderFeedbackEmail(payload: FeedbackPayload): { subject: string; html: string } {
  const categoryLabel = getCategoryLabel(payload.category);
  const categoryEmoji = getCategoryEmoji(payload.category);
  const categoryColor = getCategoryColor(payload.category);
  const formattedDate = new Date(payload.created_at).toLocaleString('en-US', {
    dateStyle: 'full',
    timeStyle: 'short',
  });

  const subjectText = payload.subject || categoryLabel;
  const subject = `[Feedback] ${categoryEmoji} ${categoryLabel}: ${subjectText}`;

  // Submitter / device details → shared detail card (emoji folded into labels).
  const playerName = payload.player_name || 'Anonymous User';
  const playerEmailLink = payload.player_email
    ? `<a href="mailto:${payload.player_email}" style="color: ${BRAND.primary}; text-decoration: none;">${payload.player_email}</a>`
    : '';
  const playerDisplay = playerEmailLink ? `${playerName}<br>${playerEmailLink}` : playerName;

  const detailRows: Array<{ label: string; value: string }> = [
    { label: '👤  Submitted By', value: playerDisplay },
  ];
  if (payload.module && payload.module !== 'other') {
    detailRows.push({
      label: `${getModuleEmoji(payload.module)}  Section`,
      value: getModuleLabel(payload.module),
    });
  }
  if (payload.app_version) {
    detailRows.push({ label: '📱  App Version', value: payload.app_version });
  }
  if (payload.device_info) {
    detailRows.push({ label: '🖥️  Device', value: formatDeviceInfo(payload.device_info) });
  }

  const content = `
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="padding: 0 0 12px 0;">
                      ${renderEyebrow('New feedback')}
                      <h2 style="margin: 0; padding: 0; font-family: 'Poppins', Arial, Helvetica, sans-serif; font-size: 24px; font-weight: bold; color: ${BRAND.neutral900}; letter-spacing: -0.02em; line-height: 1.25;">
                        ${escapeHtml(subjectText)}
                      </h2>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 0 0 20px 0;">
                      <p class="email-muted" style="margin: 0; font-size: 13px; color: ${BRAND.neutral400};">${formattedDate}</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 0 0 18px 0;">
                      <table role="presentation" style="border-collapse: collapse;">
                        <tr>
                          <td style="padding: 6px 16px; background-color: ${categoryColor}18; border-radius: 24px; border: 1px solid ${categoryColor}30;">
                            <span style="font-family: 'Poppins', 'Segoe UI', sans-serif; font-size: 13px; font-weight: 600; color: ${categoryColor};">${categoryEmoji} &nbsp;${categoryLabel}</span>
                          </td>
                          <td style="width: 8px;"></td>
                          <td style="padding: 6px 16px; background-color: ${BRAND.primary}18; border-radius: 24px; border: 1px solid ${BRAND.primary}30;">
                            <span style="font-family: 'Poppins', 'Segoe UI', sans-serif; font-size: 13px; font-weight: 600; color: ${BRAND.primary};">${getModuleEmoji(payload.module)} &nbsp;${getModuleLabel(payload.module)}</span>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  ${payload.message ? renderMetadataBlock('', payload.message, categoryColor) : ''}
                  ${renderMetadataSection(payload)}
                  ${renderScreenshotsSection(payload.screenshot_urls)}
                  <tr>
                    <td style="padding: 4px 0 0 0;">
                      ${renderDetailCard(detailRows)}
                    </td>
                  </tr>
                </table>`;

  const html = wrapInLayout({
    title: 'New feedback — Rallia',
    preheader: `${categoryLabel}: ${subjectText}`,
    content,
    footerNote: `Feedback ID ${escapeHtml(payload.feedback_id)} &middot; Sent from the Rallia feedback system`,
    locale: 'en-US',
  });

  return { subject, html };
}
