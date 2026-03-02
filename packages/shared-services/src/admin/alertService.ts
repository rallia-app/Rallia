/**
 * Admin Alert Service
 *
 * Provides functions for managing admin alerts and notifications.
 */

import { supabase } from '../supabase';

// =============================================================================
// TYPES
// =============================================================================

export type AlertType = 'security' | 'system' | 'user_activity' | 'threshold' | 'error';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AdminAlert {
  id: string;
  alert_type: AlertType;
  title: string;
  message: string;
  severity: AlertSeverity;
  source_type: string | null;
  source_id: string | null;
  action_url: string | null;
  metadata: Record<string, unknown>;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface AlertCounts {
  total: number;
  critical: number;
  warning: number;
  info: number;
}

export interface AlertPreference {
  id: string;
  admin_id: string;
  alert_type: AlertType;
  email_enabled: boolean;
  push_enabled: boolean;
  in_app_enabled: boolean;
  min_severity: AlertSeverity;
}

// =============================================================================
// ALERT FUNCTIONS
// =============================================================================

/**
 * Get alerts for the current admin
 */
export async function getAdminAlerts(
  adminId: string,
  limit: number = 20,
  includeRead: boolean = false
): Promise<AdminAlert[]> {
  try {
    const { data, error } = await supabase.rpc('get_admin_alerts', {
      p_admin_id: adminId,
      p_limit: limit,
      p_include_read: includeRead,
    });

    if (error) {
      console.error('[AlertService] Error fetching alerts:', error);
      return [];
    }

    return (data as AdminAlert[]) || [];
  } catch (err) {
    console.error('[AlertService] Exception fetching alerts:', err);
    return [];
  }
}

/**
 * Get alert counts by severity
 */
export async function getAlertCounts(adminId: string): Promise<AlertCounts> {
  try {
    const { data, error } = await supabase.rpc('get_alert_counts', {
      p_admin_id: adminId,
    });

    if (error) {
      console.error('[AlertService] Error fetching alert counts:', error);
      return { total: 0, critical: 0, warning: 0, info: 0 };
    }

    // RPC returns array with single row
    const result = Array.isArray(data) ? data[0] : data;
    return {
      total: Number(result?.total || 0),
      critical: Number(result?.critical || 0),
      warning: Number(result?.warning || 0),
      info: Number(result?.info || 0),
    };
  } catch (err) {
    console.error('[AlertService] Exception fetching alert counts:', err);
    return { total: 0, critical: 0, warning: 0, info: 0 };
  }
}

/**
 * Mark an alert as read
 */
export async function markAlertRead(alertId: string, adminId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('mark_alert_read', {
      p_alert_id: alertId,
      p_admin_id: adminId,
    });

    if (error) {
      console.error('[AlertService] Error marking alert read:', error);
      return false;
    }

    return data as boolean;
  } catch (err) {
    console.error('[AlertService] Exception marking alert read:', err);
    return false;
  }
}

/**
 * Mark all alerts as read
 */
export async function markAllAlertsRead(adminId: string): Promise<number> {
  try {
    const alerts = await getAdminAlerts(adminId, 100, false);
    let count = 0;

    for (const alert of alerts) {
      const success = await markAlertRead(alert.id, adminId);
      if (success) count++;
    }

    return count;
  } catch (err) {
    console.error('[AlertService] Exception marking all alerts read:', err);
    return 0;
  }
}

/**
 * Dismiss an alert
 */
export async function dismissAlert(alertId: string, adminId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('dismiss_alert', {
      p_alert_id: alertId,
      p_admin_id: adminId,
    });

    if (error) {
      console.error('[AlertService] Error dismissing alert:', error);
      return false;
    }

    return data as boolean;
  } catch (err) {
    console.error('[AlertService] Exception dismissing alert:', err);
    return false;
  }
}

/**
 * Create a manual alert (for super admins)
 */
export async function createManualAlert(
  title: string,
  message: string,
  alertType: AlertType = 'system',
  severity: AlertSeverity = 'info',
  targetRoles: string[] = ['super_admin', 'moderator', 'support'],
  actionUrl?: string,
  metadata?: Record<string, unknown>
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('admin_alert')
      .insert({
        alert_type: alertType,
        title,
        message,
        severity,
        source_type: 'manual',
        target_roles: targetRoles,
        action_url: actionUrl || null,
        metadata: metadata || {},
      })
      .select('id')
      .single();

    if (error) {
      console.error('[AlertService] Error creating alert:', error);
      return null;
    }

    return data?.id || null;
  } catch (err) {
    console.error('[AlertService] Exception creating alert:', err);
    return null;
  }
}

// =============================================================================
// ALERT PREFERENCES
// =============================================================================

/**
 * Get alert preferences for an admin
 */
export async function getAlertPreferences(adminId: string): Promise<AlertPreference[]> {
  try {
    const { data, error } = await supabase
      .from('admin_alert_preference')
      .select('*')
      .eq('admin_id', adminId);

    if (error) {
      console.error('[AlertService] Error fetching preferences:', error);
      return [];
    }

    return (data as AlertPreference[]) || [];
  } catch (err) {
    console.error('[AlertService] Exception fetching preferences:', err);
    return [];
  }
}

/**
 * Update alert preference
 */
export async function updateAlertPreference(
  adminId: string,
  alertType: AlertType,
  updates: Partial<Pick<AlertPreference, 'email_enabled' | 'push_enabled' | 'in_app_enabled' | 'min_severity'>>
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('admin_alert_preference')
      .upsert(
        {
          admin_id: adminId,
          alert_type: alertType,
          ...updates,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'admin_id,alert_type',
        }
      );

    if (error) {
      console.error('[AlertService] Error updating preference:', error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('[AlertService] Exception updating preference:', err);
    return false;
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Get alert type icon name (for Ionicons)
 */
export function getAlertTypeIcon(alertType: AlertType): string {
  const icons: Record<AlertType, string> = {
    security: 'shield-outline',
    system: 'settings-outline',
    user_activity: 'person-outline',
    threshold: 'trending-up-outline',
    error: 'warning-outline',
  };
  return icons[alertType] || 'notifications-outline';
}

/**
 * Get alert type label
 */
export function getAlertTypeLabel(alertType: AlertType): string {
  const labels: Record<AlertType, string> = {
    security: 'Security',
    system: 'System',
    user_activity: 'User Activity',
    threshold: 'Threshold',
    error: 'Error',
  };
  return labels[alertType] || alertType;
}

/**
 * Get severity badge color
 */
export function getSeverityColor(
  severity: AlertSeverity,
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

/**
 * Format alert time for display
 */
export function formatAlertTime(createdAt: string): string {
  const date = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export const alertService = {
  // Alert functions
  getAdminAlerts,
  getAlertCounts,
  markAlertRead,
  markAllAlertsRead,
  dismissAlert,
  createManualAlert,
  // Preference functions
  getAlertPreferences,
  updateAlertPreference,
  // Utility functions
  getAlertTypeIcon,
  getAlertTypeLabel,
  getSeverityColor,
  formatAlertTime,
};
