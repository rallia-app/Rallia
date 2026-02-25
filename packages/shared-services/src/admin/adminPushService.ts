/**
 * Admin Push Notification Service
 *
 * Handles push notification token registration and management for admin devices.
 */

import { supabase } from '../supabase';
import { Logger } from '../logger';
import { Platform } from 'react-native';

// =============================================================================
// TYPES
// =============================================================================

export interface AdminDevice {
  id: string;
  admin_id: string;
  push_token: string;
  platform: 'ios' | 'android' | 'web';
  device_name: string | null;
  is_active: boolean;
  last_active: string;
  created_at: string;
  updated_at: string;
}

export interface RegisterDeviceParams {
  adminId: string;
  pushToken: string;
  platform?: 'ios' | 'android' | 'web';
  deviceName?: string;
}

// =============================================================================
// SERVICE
// =============================================================================

export const adminPushService = {
  /**
   * Register a device token for push notifications
   */
  async registerDevice(params: RegisterDeviceParams): Promise<string | null> {
    const { adminId, pushToken, platform, deviceName } = params;

    try {
      const devicePlatform = platform || (Platform.OS as 'ios' | 'android' | 'web');

      const { data, error } = await supabase.rpc('register_admin_device', {
        p_admin_id: adminId,
        p_push_token: pushToken,
        p_platform: devicePlatform,
        p_device_name: deviceName || null,
      });

      if (error) {
        Logger.error('Failed to register admin device:', error);
        return null;
      }

      Logger.debug('Admin device registered:', { data });
      return data as string;
    } catch (err) {
      Logger.error('Error registering admin device:', err instanceof Error ? err : undefined);
      return null;
    }
  },

  /**
   * Unregister a device token (e.g., on logout)
   */
  async unregisterDevice(adminId: string, pushToken: string): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('unregister_admin_device', {
        p_admin_id: adminId,
        p_push_token: pushToken,
      });

      if (error) {
        Logger.error('Failed to unregister admin device:', error);
        return false;
      }

      Logger.debug('Admin device unregistered:', { data });
      return data as boolean;
    } catch (err) {
      Logger.error('Error unregistering admin device:', err instanceof Error ? err : undefined);
      return false;
    }
  },

  /**
   * Get all active devices for an admin
   */
  async getActiveDevices(adminId: string): Promise<AdminDevice[]> {
    try {
      const { data, error } = await supabase
        .from('admin_device')
        .select('*')
        .eq('admin_id', adminId)
        .eq('is_active', true)
        .order('last_active', { ascending: false });

      if (error) {
        Logger.error('Failed to fetch admin devices:', error);
        return [];
      }

      return (data || []) as AdminDevice[];
    } catch (err) {
      Logger.error('Error fetching admin devices:', err instanceof Error ? err : undefined);
      return [];
    }
  },

  /**
   * Update device last active timestamp
   */
  async updateLastActive(adminId: string, pushToken: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('admin_device')
        .update({ last_active: new Date().toISOString() })
        .eq('admin_id', adminId)
        .eq('push_token', pushToken);

      if (error) {
        Logger.error('Failed to update device last active:', error);
        return false;
      }

      return true;
    } catch (err) {
      Logger.error('Error updating device last active:', err instanceof Error ? err : undefined);
      return false;
    }
  },

  /**
   * Deactivate all devices for an admin (e.g., on password change)
   */
  async deactivateAllDevices(adminId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('admin_device')
        .update({ is_active: false })
        .eq('admin_id', adminId);

      if (error) {
        Logger.error('Failed to deactivate admin devices:', error);
        return false;
      }

      Logger.debug('All admin devices deactivated for:', { adminId });
      return true;
    } catch (err) {
      Logger.error('Error deactivating admin devices:', err instanceof Error ? err : undefined);
      return false;
    }
  },

  /**
   * Delete old inactive devices (cleanup)
   */
  async cleanupInactiveDevices(adminId: string, olderThanDays = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const { data, error } = await supabase
        .from('admin_device')
        .delete()
        .eq('admin_id', adminId)
        .eq('is_active', false)
        .lt('last_active', cutoffDate.toISOString())
        .select('id');

      if (error) {
        Logger.error('Failed to cleanup inactive devices:', error);
        return 0;
      }

      return data?.length || 0;
    } catch (err) {
      Logger.error('Error cleaning up inactive devices:', err instanceof Error ? err : undefined);
      return 0;
    }
  },
};

export default adminPushService;
