/**
 * Notifications Service
 * Handles all notification-related database operations using Supabase.
 */

import { supabase } from '../supabase';
import { Notification, NotificationQueryOptions, NotificationsPage } from '@rallia/shared-types';

const DEFAULT_PAGE_SIZE = 20;

/**
 * Fetch paginated notifications for a user
 */
export async function getNotifications(
  userId: string,
  options: NotificationQueryOptions = {}
): Promise<NotificationsPage> {
  const { pageSize = DEFAULT_PAGE_SIZE, cursor, unreadOnly = false, type } = options;

  // Build query
  let query = supabase
    .from('notification')
    .select('*')
    .eq('user_id', userId)
    .is('organization_id', null) // Only player notifications (exclude org notifications)
    .order('created_at', { ascending: false })
    .limit(pageSize + 1); // Fetch one extra to determine if there are more

  // Apply cursor-based pagination
  if (cursor) {
    query = query.lt('created_at', cursor);
  }

  // Filter by unread only
  if (unreadOnly) {
    query = query.is('read_at', null);
  }

  // Filter by notification type
  if (type) {
    query = query.eq('type', type);
  }

  // Filter out expired notifications
  query = query.or('expires_at.is.null,expires_at.gt.now()');

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch notifications: ${error.message}`);
  }

  const notifications = data as Notification[];
  const hasMore = notifications.length > pageSize;

  // Remove the extra item used for pagination check
  if (hasMore) {
    notifications.pop();
  }

  const nextCursor =
    hasMore && notifications.length > 0 ? notifications[notifications.length - 1].created_at : null;

  return {
    notifications,
    nextCursor,
    hasMore,
  };
}

/**
 * Get count of unread notifications for a user
 */
export async function getUnreadCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('notification')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('organization_id', null) // Only player notifications (exclude org notifications)
    .is('read_at', null)
    .or('expires_at.is.null,expires_at.gt.now()');

  if (error) {
    throw new Error(`Failed to get unread count: ${error.message}`);
  }

  return count ?? 0;
}

/**
 * Get count of unread notifications for a user, filtered to the selected sport.
 * Counts notifications whose `payload->>sportName` matches the selected sport,
 * PLUS system/social notifications that have no `sportName` in payload.
 */
export async function getUnreadCountForSport(userId: string, sportName: string): Promise<number> {
  const { count, error } = await supabase
    .from('notification')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('organization_id', null)
    .is('read_at', null)
    .or(`payload->>sportName.eq.${sportName},payload->>sportName.is.null`)
    .or('expires_at.is.null,expires_at.gt.now()');

  if (error) {
    throw new Error(`Failed to get unread count for sport: ${error.message}`);
  }

  return count ?? 0;
}

/**
 * Get count of unread notifications for a user, filtered by sport name.
 * Uses the `sportName` field inside the notification `payload` JSONB column.
 * Counts all notification types (not just match-category).
 */
export async function getUnreadCountBySport(userId: string, sportName: string): Promise<number> {
  const { count, error } = await supabase
    .from('notification')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('organization_id', null)
    .is('read_at', null)
    .eq('payload->>sportName', sportName)
    .or('expires_at.is.null,expires_at.gt.now()');

  if (error) {
    throw new Error(`Failed to get unread count by sport: ${error.message}`);
  }

  return count ?? 0;
}

/**
 * Mark a single notification as read
 */
export async function markAsRead(notificationId: string): Promise<Notification> {
  const { data, error } = await supabase
    .from('notification')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to mark notification as read: ${error.message}`);
  }

  return data as Notification;
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllAsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from('notification')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);

  if (error) {
    throw new Error(`Failed to mark all notifications as read: ${error.message}`);
  }
}

/**
 * Delete a notification (hard delete)
 */
export async function deleteNotification(notificationId: string): Promise<void> {
  const { error } = await supabase.from('notification').delete().eq('id', notificationId);

  if (error) {
    throw new Error(`Failed to delete notification: ${error.message}`);
  }
}

/**
 * Get a single notification by ID
 */
export async function getNotification(notificationId: string): Promise<Notification | null> {
  const { data, error } = await supabase
    .from('notification')
    .select('*')
    .eq('id', notificationId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows returned
      return null;
    }
    throw new Error(`Failed to get notification: ${error.message}`);
  }

  return data as Notification;
}

/**
 * Notifications service object for grouped exports
 */
export const notificationsService = {
  getNotifications,
  getUnreadCount,
  getUnreadCountForSport,
  getUnreadCountBySport,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getNotification,
};

export default notificationsService;
