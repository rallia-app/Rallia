/**
 * Admin Audit Service
 *
 * Provides functions for logging admin actions and retrieving audit logs.
 * All admin actions should be logged through this service for accountability.
 */

import { supabase } from '../supabase';

// =============================================================================
// TYPES
// =============================================================================

export type AuditActionType =
  | 'view'
  | 'create'
  | 'update'
  | 'delete'
  | 'ban'
  | 'unban'
  | 'export'
  | 'login'
  | 'logout'
  | 'search'
  | 'config_change';

export type AuditEntityType =
  | 'player'
  | 'match'
  | 'report'
  | 'admin'
  | 'analytics'
  | 'settings'
  | 'system';

export type AuditSeverity = 'info' | 'warning' | 'critical';

export interface AuditLogEntry {
  id: string;
  admin_id: string;
  admin_name: string | null;
  admin_email: string | null;
  admin_role: string | null;
  action_type: AuditActionType;
  entity_type: AuditEntityType;
  entity_id: string | null;
  entity_name: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  severity: AuditSeverity;
  created_at: string;
}

export interface AuditLogStats {
  total_actions: number;
  actions_by_type: Record<string, number>;
  actions_by_admin: Record<string, number>;
  actions_by_severity: Record<string, number>;
  daily_counts: Array<{ date: string; count: number }>;
}

export interface AuditLogFilters {
  adminId?: string;
  actionType?: AuditActionType;
  entityType?: AuditEntityType;
  severity?: AuditSeverity;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface LogActionParams {
  adminId: string;
  actionType: AuditActionType;
  entityType: AuditEntityType;
  entityId?: string;
  entityName?: string;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  severity?: AuditSeverity;
}

// =============================================================================
// AUDIT LOG FUNCTIONS
// =============================================================================

/**
 * Log an admin action to the audit trail
 */
export async function logAdminAction(params: LogActionParams): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('log_admin_action', {
      p_admin_id: params.adminId,
      p_action_type: params.actionType,
      p_entity_type: params.entityType,
      p_entity_id: params.entityId || null,
      p_entity_name: params.entityName || null,
      p_old_data: params.oldData || null,
      p_new_data: params.newData || null,
      p_metadata: params.metadata || {},
      p_severity: params.severity || 'info',
    });

    if (error) {
      console.error('[AuditService] Error logging action:', error);
      return null;
    }

    return data as string;
  } catch (err) {
    console.error('[AuditService] Exception logging action:', err);
    return null;
  }
}

/**
 * Get audit log entries with filters
 */
export async function getAuditLog(filters: AuditLogFilters = {}): Promise<AuditLogEntry[]> {
  try {
    const { data, error } = await supabase.rpc('get_admin_audit_log', {
      p_limit: filters.limit || 50,
      p_offset: filters.offset || 0,
      p_admin_id: filters.adminId || null,
      p_action_type: filters.actionType || null,
      p_entity_type: filters.entityType || null,
      p_severity: filters.severity || null,
      p_start_date: filters.startDate?.toISOString() || null,
      p_end_date: filters.endDate?.toISOString() || null,
    });

    if (error) {
      console.error('[AuditService] Error fetching audit log:', error);
      return [];
    }

    return (data as AuditLogEntry[]) || [];
  } catch (err) {
    console.error('[AuditService] Exception fetching audit log:', err);
    return [];
  }
}

/**
 * Get audit log statistics for dashboard
 */
export async function getAuditLogStats(days: number = 7): Promise<AuditLogStats | null> {
  try {
    const { data, error } = await supabase.rpc('get_audit_log_stats', {
      p_days: days,
    });

    if (error) {
      console.error('[AuditService] Error fetching audit stats:', error);
      return null;
    }

    // RPC returns array with single row
    const result = Array.isArray(data) ? data[0] : data;
    return result as AuditLogStats;
  } catch (err) {
    console.error('[AuditService] Exception fetching audit stats:', err);
    return null;
  }
}

/**
 * Get recent activity for a specific entity
 */
export async function getEntityAuditHistory(
  entityType: AuditEntityType,
  entityId: string,
  limit: number = 20
): Promise<AuditLogEntry[]> {
  return getAuditLog({
    entityType,
    limit,
  }).then((logs) => logs.filter((log) => log.entity_id === entityId));
}

/**
 * Get recent activity for a specific admin
 */
export async function getAdminActivityHistory(
  adminId: string,
  limit: number = 50
): Promise<AuditLogEntry[]> {
  return getAuditLog({
    adminId,
    limit,
  });
}

// =============================================================================
// HELPER FUNCTIONS FOR COMMON ACTIONS
// =============================================================================

/**
 * Log a user view action
 */
export async function logUserView(
  adminId: string,
  userId: string,
  userName: string
): Promise<string | null> {
  return logAdminAction({
    adminId,
    actionType: 'view',
    entityType: 'player',
    entityId: userId,
    entityName: userName,
    severity: 'info',
  });
}

/**
 * Log a user ban action
 */
export async function logUserBan(
  adminId: string,
  userId: string,
  userName: string,
  reason: string,
  banData: Record<string, unknown>
): Promise<string | null> {
  return logAdminAction({
    adminId,
    actionType: 'ban',
    entityType: 'player',
    entityId: userId,
    entityName: userName,
    newData: banData,
    metadata: { reason },
    severity: 'warning',
  });
}

/**
 * Log a user unban action
 */
export async function logUserUnban(
  adminId: string,
  userId: string,
  userName: string,
  reason: string
): Promise<string | null> {
  return logAdminAction({
    adminId,
    actionType: 'unban',
    entityType: 'player',
    entityId: userId,
    entityName: userName,
    metadata: { reason },
    severity: 'info',
  });
}

/**
 * Log a data export action
 */
export async function logDataExport(
  adminId: string,
  exportType: string,
  recordCount: number,
  filters?: Record<string, unknown>
): Promise<string | null> {
  return logAdminAction({
    adminId,
    actionType: 'export',
    entityType: 'analytics',
    entityName: `${exportType} export`,
    metadata: {
      export_type: exportType,
      record_count: recordCount,
      filters: filters || {},
    },
    severity: 'info',
  });
}

/**
 * Log an admin login
 */
export async function logAdminLogin(adminId: string, adminName: string): Promise<string | null> {
  return logAdminAction({
    adminId,
    actionType: 'login',
    entityType: 'admin',
    entityId: adminId,
    entityName: adminName,
    severity: 'info',
  });
}

/**
 * Log a configuration change
 */
export async function logConfigChange(
  adminId: string,
  configName: string,
  oldValue: unknown,
  newValue: unknown
): Promise<string | null> {
  return logAdminAction({
    adminId,
    actionType: 'config_change',
    entityType: 'settings',
    entityName: configName,
    oldData: { value: oldValue },
    newData: { value: newValue },
    severity: 'warning',
  });
}

/**
 * Log a search action
 */
export async function logSearchAction(
  adminId: string,
  searchType: AuditEntityType,
  query: string,
  resultCount: number
): Promise<string | null> {
  return logAdminAction({
    adminId,
    actionType: 'search',
    entityType: searchType,
    entityName: `Search: "${query}"`,
    metadata: {
      query,
      result_count: resultCount,
    },
    severity: 'info',
  });
}

// =============================================================================
// ACTION TYPE HELPERS
// =============================================================================

/**
 * Get human-readable action type label
 */
export function getActionTypeLabel(actionType: AuditActionType): string {
  const labels: Record<AuditActionType, string> = {
    view: 'Viewed',
    create: 'Created',
    update: 'Updated',
    delete: 'Deleted',
    ban: 'Banned',
    unban: 'Unbanned',
    export: 'Exported',
    login: 'Logged in',
    logout: 'Logged out',
    search: 'Searched',
    config_change: 'Changed config',
  };
  return labels[actionType] || actionType;
}

/**
 * Get action type icon name (for Ionicons)
 */
export function getActionTypeIcon(actionType: AuditActionType): string {
  const icons: Record<AuditActionType, string> = {
    view: 'eye-outline',
    create: 'add-circle-outline',
    update: 'create-outline',
    delete: 'trash-outline',
    ban: 'ban-outline',
    unban: 'checkmark-circle-outline',
    export: 'download-outline',
    login: 'log-in-outline',
    logout: 'log-out-outline',
    search: 'search-outline',
    config_change: 'settings-outline',
  };
  return icons[actionType] || 'help-outline';
}

/**
 * Get severity color
 */
export function getSeverityColor(
  severity: AuditSeverity,
  colors: { success: string; warning: string; error: string }
): string {
  switch (severity) {
    case 'critical':
      return colors.error;
    case 'warning':
      return colors.warning;
    default:
      return colors.success;
  }
}

export const auditService = {
  // Core functions
  logAdminAction,
  getAuditLog,
  getAuditLogStats,
  getEntityAuditHistory,
  getAdminActivityHistory,
  // Helper functions
  logUserView,
  logUserBan,
  logUserUnban,
  logDataExport,
  logAdminLogin,
  logConfigChange,
  logSearchAction,
  // Utility functions
  getActionTypeLabel,
  getActionTypeIcon,
  getSeverityColor,
};
