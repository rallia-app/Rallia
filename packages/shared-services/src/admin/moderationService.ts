/**
 * Moderation Service
 *
 * Provides functionality for admin moderation of player reports and bans.
 */

import { supabase } from '../supabase';
import { Logger } from '../logger';

// =============================================================================
// TYPES
// =============================================================================

export type ReportType =
  | 'harassment'
  | 'cheating'
  | 'inappropriate_content'
  | 'spam'
  | 'impersonation'
  | 'no_show'
  | 'unsportsmanlike'
  | 'other';

export type ReportStatus =
  | 'pending'
  | 'under_review'
  | 'dismissed'
  | 'action_taken'
  | 'escalated';

export type ReportPriority = 'low' | 'normal' | 'high' | 'urgent';

export type BanType = 'temporary' | 'permanent';

export interface PlayerReport {
  id: string;
  reporter_id: string;
  reporter_name: string;
  reporter_avatar: string | null;
  reported_player_id: string;
  reported_player_name: string;
  reported_player_avatar: string | null;
  report_type: ReportType;
  description: string | null;
  evidence_urls: string[];
  related_match_id: string | null;
  status: ReportStatus;
  priority: ReportPriority;
  reviewed_by: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  action_taken: string | null;
  admin_notes: string | null;
  resulting_ban_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlayerBan {
  id: string;
  player_id: string;
  player_name?: string;
  player_avatar?: string | null;
  banned_by: string;
  banned_by_name?: string;
  ban_type: BanType;
  reason: string;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
  created_at: string;
}

export interface ReportCounts {
  total: number;
  pending: number;
  under_review: number;
  high_priority: number;
}

export interface ReportFilters {
  status?: ReportStatus;
  reportType?: ReportType;
  priority?: ReportPriority;
  reportedPlayerId?: string;
}

export interface BanFilters {
  playerId?: string;
  isActive?: boolean;
  banType?: BanType;
}

export interface CreateBanParams {
  playerId: string;
  banType: BanType;
  reason: string;
  endDate?: string; // Required for temporary bans
}

export interface ReviewReportParams {
  reportId: string;
  adminId: string;
  status: ReportStatus;
  actionTaken?: string;
  adminNotes?: string;
  banId?: string;
}

// =============================================================================
// REPORT FUNCTIONS
// =============================================================================

/**
 * Get pending reports count for dashboard
 */
export async function getPendingReportsCount(): Promise<ReportCounts> {
  try {
    const { data, error } = await supabase.rpc('get_pending_reports_count');

    if (error) throw error;

    const result = data?.[0] || { total: 0, pending: 0, under_review: 0, high_priority: 0 };
    return {
      total: Number(result.total) || 0,
      pending: Number(result.pending) || 0,
      under_review: Number(result.under_review) || 0,
      high_priority: Number(result.high_priority) || 0,
    };
  } catch (error) {
    Logger.error('Failed to get pending reports count', error as Error);
    return { total: 0, pending: 0, under_review: 0, high_priority: 0 };
  }
}

/**
 * Get player reports with pagination and filters
 */
export async function getPlayerReports(
  filters: ReportFilters = {},
  limit = 20,
  offset = 0
): Promise<PlayerReport[]> {
  try {
    const { data, error } = await supabase.rpc('get_player_reports', {
      p_limit: limit,
      p_offset: offset,
      p_status: filters.status || null,
      p_report_type: filters.reportType || null,
      p_priority: filters.priority || null,
      p_reported_player_id: filters.reportedPlayerId || null,
    });

    if (error) throw error;

    return (data || []) as PlayerReport[];
  } catch (error) {
    Logger.error('Failed to get player reports', error as Error);
    return [];
  }
}

/**
 * Review a player report
 */
export async function reviewReport(params: ReviewReportParams): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('review_player_report', {
      p_report_id: params.reportId,
      p_admin_id: params.adminId,
      p_status: params.status,
      p_action_taken: params.actionTaken || null,
      p_admin_notes: params.adminNotes || null,
      p_ban_id: params.banId || null,
    });

    if (error) throw error;

    return data === true;
  } catch (error) {
    Logger.error('Failed to review report', error as Error);
    return false;
  }
}

/**
 * Dismiss a report
 */
export async function dismissReport(
  reportId: string,
  adminId: string,
  reason?: string
): Promise<boolean> {
  return reviewReport({
    reportId,
    adminId,
    status: 'dismissed',
    actionTaken: 'Report dismissed',
    adminNotes: reason,
  });
}

/**
 * Escalate a report
 */
export async function escalateReport(
  reportId: string,
  adminId: string,
  notes?: string
): Promise<boolean> {
  return reviewReport({
    reportId,
    adminId,
    status: 'escalated',
    adminNotes: notes,
  });
}

/**
 * Create a new player report (for players)
 * Requires player_report table from migration: 20260223000000_add_player_reports.sql
 */
export async function createReport(
  reporterId: string,
  reportedPlayerId: string,
  reportType: ReportType,
  description?: string,
  evidenceUrls?: string[],
  relatedMatchId?: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('player_report')
      .insert({
        reporter_id: reporterId,
        reported_player_id: reportedPlayerId,
        report_type: reportType,
        description,
        evidence_urls: evidenceUrls || [],
        related_match_id: relatedMatchId,
      })
      .select('id')
      .single();

    if (error) throw error;

    return data?.id || null;
  } catch (error) {
    Logger.error('Failed to create report', error as Error);
    return null;
  }
}

// =============================================================================
// BAN FUNCTIONS
// =============================================================================

/**
 * Get player bans with filters
 */
export async function getPlayerBans(
  filters: BanFilters = {},
  limit = 20,
  offset = 0
): Promise<PlayerBan[]> {
  try {
    // Query player_ban with joins to get player info via player->profile
    // Note: player_ban.player_id references player(id), which in turn references profile(id)
    let query = supabase
      .from('player_ban')
      .select(`
        id,
        player_id,
        banned_by_admin_id,
        ban_type,
        reason,
        banned_at,
        expires_at,
        is_active,
        lifted_at,
        lifted_by_admin_id,
        lift_reason,
        created_at
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (filters.playerId) {
      query = query.eq('player_id', filters.playerId);
    }
    if (filters.isActive !== undefined) {
      query = query.eq('is_active', filters.isActive);
    }
    if (filters.banType) {
      query = query.eq('ban_type', filters.banType);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Fetch player profile info separately for better reliability
    const results: PlayerBan[] = [];
    for (const ban of data || []) {
      // Get player profile
      const { data: playerProfile } = await supabase
        .from('profile')
        .select('first_name, last_name, display_name, profile_picture_url')
        .eq('id', ban.player_id)
        .single();

      results.push({
        id: ban.id,
        player_id: ban.player_id,
        player_name: playerProfile
          ? `${playerProfile.first_name || ''} ${playerProfile.last_name || ''}`.trim() || playerProfile.display_name || 'Unknown'
          : 'Unknown',
        player_avatar: playerProfile?.profile_picture_url || null,
        banned_by: ban.banned_by_admin_id,
        banned_by_name: 'Admin', // Admin names require additional lookup
        ban_type: ban.ban_type as BanType,
        reason: ban.reason,
        start_date: ban.banned_at, // Use banned_at from migration schema
        end_date: ban.expires_at || null, // Use expires_at from migration schema
        is_active: ban.is_active,
        revoked_at: ban.lifted_at || null, // Use lifted_at from migration schema
        revoked_by: ban.lifted_by_admin_id || null,
        revoke_reason: ban.lift_reason || null, // Use lift_reason from migration schema
        created_at: ban.created_at,
      });
    }
    
    return results;
  } catch (error) {
    Logger.error('Failed to get player bans', error as Error);
    return [];
  }
}

/**
 * Get active bans count
 */
export async function getActiveBansCount(): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('player_ban')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    if (error) throw error;

    return count || 0;
  } catch (error) {
    Logger.error('Failed to get active bans count', error as Error);
    return 0;
  }
}

/**
 * Create a new ban
 * Uses column names from migration: 20260222000000_add_admin_management_tables.sql
 */
export async function createBan(
  adminId: string,
  params: CreateBanParams
): Promise<PlayerBan | null> {
  try {
    const { data, error } = await supabase
      .from('player_ban')
      .insert({
        player_id: params.playerId,
        banned_by_admin_id: adminId,
        ban_type: params.banType,
        reason: params.reason,
        banned_at: new Date().toISOString(),
        expires_at: params.banType === 'temporary' ? params.endDate : null,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;

    // Map response to PlayerBan interface
    return {
      id: data.id,
      player_id: data.player_id,
      banned_by: data.banned_by_admin_id,
      ban_type: data.ban_type,
      reason: data.reason,
      start_date: data.banned_at,
      end_date: data.expires_at,
      is_active: data.is_active,
      revoked_at: data.lifted_at,
      revoked_by: data.lifted_by_admin_id,
      revoke_reason: data.lift_reason,
      created_at: data.created_at,
    };
  } catch (error) {
    Logger.error('Failed to create ban', error as Error);
    return null;
  }
}

/**
 * Revoke a ban
 * Uses column names from migration: 20260222000000_add_admin_management_tables.sql
 */
export async function revokeBan(
  banId: string,
  adminId: string,
  reason?: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('player_ban')
      .update({
        is_active: false,
        lifted_at: new Date().toISOString(),
        lifted_by_admin_id: adminId,
        lift_reason: reason,
      })
      .eq('id', banId);

    if (error) throw error;

    return true;
  } catch (error) {
    Logger.error('Failed to revoke ban', error as Error);
    return false;
  }
}

/**
 * Check if a player is currently banned
 */
export async function isPlayerBanned(playerId: string): Promise<boolean> {
  try {
    const { count, error } = await supabase
      .from('player_ban')
      .select('*', { count: 'exact', head: true })
      .eq('player_id', playerId)
      .eq('is_active', true);

    if (error) throw error;

    return (count || 0) > 0;
  } catch (error) {
    Logger.error('Failed to check player ban status', error as Error);
    return false;
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Get report type label
 */
export function getReportTypeLabel(type: ReportType): string {
  const labels: Record<ReportType, string> = {
    harassment: 'Harassment',
    cheating: 'Cheating',
    inappropriate_content: 'Inappropriate Content',
    spam: 'Spam',
    impersonation: 'Impersonation',
    no_show: 'No-Show',
    unsportsmanlike: 'Unsportsmanlike',
    other: 'Other',
  };
  return labels[type] || type;
}

/**
 * Get report type icon
 */
export function getReportTypeIcon(type: ReportType): string {
  const icons: Record<ReportType, string> = {
    harassment: 'warning-outline',
    cheating: 'shield-outline',
    inappropriate_content: 'eye-off-outline',
    spam: 'mail-unread-outline',
    impersonation: 'person-outline',
    no_show: 'time-outline',
    unsportsmanlike: 'sad-outline',
    other: 'help-circle-outline',
  };
  return icons[type] || 'alert-circle-outline';
}

/**
 * Get status color
 */
export function getReportStatusColor(status: ReportStatus): string {
  const colors: Record<ReportStatus, string> = {
    pending: '#f59e0b', // warning/amber
    under_review: '#3b82f6', // blue
    dismissed: '#6b7280', // gray
    action_taken: '#22c55e', // green
    escalated: '#ef4444', // red
  };
  return colors[status] || '#6b7280';
}

/**
 * Get priority color
 */
export function getPriorityColor(priority: ReportPriority): string {
  const colors: Record<ReportPriority, string> = {
    low: '#6b7280',
    normal: '#3b82f6',
    high: '#f59e0b',
    urgent: '#ef4444',
  };
  return colors[priority] || '#6b7280';
}

// =============================================================================
// EXPORT SERVICE
// =============================================================================

export const moderationService = {
  // Reports
  getPendingReportsCount,
  getPlayerReports,
  reviewReport,
  dismissReport,
  escalateReport,
  createReport,
  
  // Bans
  getPlayerBans,
  getActiveBansCount,
  createBan,
  revokeBan,
  isPlayerBanned,
  
  // Utilities
  getReportTypeLabel,
  getReportTypeIcon,
  getReportStatusColor,
  getPriorityColor,
};

export default moderationService;
