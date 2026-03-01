/**
 * Report Service
 * Handles user reporting functionality
 *
 * Reports are stored in the `player_report` table which is used by the admin
 * moderation system. This ensures all user reports appear in the admin dashboard.
 */

import { supabase } from '../supabase';

// Report reasons shown to users (friendly names)
export type ReportReason = 'inappropriate_behavior' | 'harassment' | 'spam' | 'cheating' | 'other';

// Type used by the player_report table (database enum: report_type_enum)
export type PlayerReportType =
  | 'harassment'
  | 'cheating'
  | 'inappropriate_content'
  | 'spam'
  | 'impersonation'
  | 'no_show'
  | 'unsportsmanlike'
  | 'other';

// Labels for display in user-facing UI
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  inappropriate_behavior: 'Inappropriate Behavior',
  harassment: 'Harassment',
  spam: 'Spam',
  cheating: 'Cheating',
  other: 'Other',
};

// Map user-facing reasons to database report_type_enum values
const REASON_TO_REPORT_TYPE: Record<ReportReason, PlayerReportType> = {
  inappropriate_behavior: 'inappropriate_content',
  harassment: 'harassment',
  spam: 'spam',
  cheating: 'cheating',
  other: 'other',
};

// Priority assignment based on report type (for database storage)
export const REPORT_TYPE_PRIORITY: Record<PlayerReportType, 'low' | 'normal' | 'high' | 'urgent'> =
  {
    harassment: 'high',
    cheating: 'normal',
    inappropriate_content: 'normal',
    spam: 'low',
    impersonation: 'high',
    no_show: 'low',
    unsportsmanlike: 'normal',
    other: 'normal',
  };

// Analytics priority (simplified scale for dashboards)
export type AnalyticsPriority = 'high' | 'medium' | 'low';

/**
 * Get analytics-style priority (high/medium/low) from report type
 * This ensures consistent priority across all dashboards
 */
export function getReportTypePriority(reportType: string): AnalyticsPriority {
  const highPriority: string[] = ['harassment', 'impersonation'];
  const mediumPriority: string[] = ['cheating', 'inappropriate_content', 'unsportsmanlike'];
  // low: spam, no_show, other, and any unknown types

  if (highPriority.includes(reportType)) return 'high';
  if (mediumPriority.includes(reportType)) return 'medium';
  return 'low';
}

export interface CreateReportParams {
  reporterId: string;
  reportedId: string;
  reason: ReportReason;
  description?: string;
  matchId?: string;
  conversationId?: string;
  /** Optional array of evidence image URLs (uploaded to storage) */
  evidenceUrls?: string[];
}

/**
 * Submit a report against another user
 * Reports are stored in player_report table for admin moderation
 */
export async function createReport(params: CreateReportParams): Promise<void> {
  const { reporterId, reportedId, reason, description, matchId, evidenceUrls } = params;

  // Don't allow self-reporting
  if (reporterId === reportedId) {
    throw new Error('You cannot report yourself');
  }

  // Map user reason to database report_type
  const reportType = REASON_TO_REPORT_TYPE[reason];

  // Check if already reported this user for this type within 24 hours
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);

  const { data: existingReport } = await supabase
    .from('player_report')
    .select('id')
    .eq('reporter_id', reporterId)
    .eq('reported_player_id', reportedId)
    .eq('report_type', reportType)
    .gte('created_at', oneDayAgo.toISOString())
    .maybeSingle();

  if (existingReport) {
    throw new Error('You have already reported this user for this reason in the last 24 hours');
  }

  // Get priority for this report type
  const priority = REPORT_TYPE_PRIORITY[reportType];

  const { error } = await supabase.from('player_report').insert({
    reporter_id: reporterId,
    reported_player_id: reportedId,
    report_type: reportType,
    description: description || null,
    related_match_id: matchId || null,
    status: 'pending',
    priority,
    evidence_urls: evidenceUrls || [],
  });

  if (error) {
    console.error('Error creating report:', error);
    throw new Error('Failed to submit report. Please try again.');
  }
}

/**
 * Get all reports made by a user (for viewing report history)
 */
export async function getMyReports(playerId: string) {
  const { data, error } = await supabase
    .from('player_report')
    .select(
      `
      id,
      reported_player_id,
      report_type,
      description,
      status,
      created_at,
      reported:reported_player_id (
        id,
        first_name,
        last_name,
        profile_picture_url
      )
    `
    )
    .eq('reporter_id', playerId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching reports:', error);
    throw new Error('Failed to fetch reports');
  }

  // Map report_type back to user-friendly reason for display
  return data?.map(report => ({
    ...report,
    // Map back to original reason format for backwards compatibility
    reason: mapReportTypeToReason(report.report_type),
  }));
}

/**
 * Map database report_type back to user-facing ReportReason
 */
function mapReportTypeToReason(reportType: string): ReportReason {
  const mapping: Record<string, ReportReason> = {
    inappropriate_content: 'inappropriate_behavior',
    harassment: 'harassment',
    spam: 'spam',
    cheating: 'cheating',
    impersonation: 'other',
    no_show: 'other',
    unsportsmanlike: 'other',
    other: 'other',
  };
  return mapping[reportType] || 'other';
}
