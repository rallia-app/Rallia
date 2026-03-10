import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { useUnreadNotificationCount } from './useNotifications';

/**
 * Side-effect hook that keeps the app icon badge count in sync
 * with the unread notification count from the database.
 *
 * Mobile-only (requires expo-notifications).
 */
export function useBadgeCountSync(userId: string | undefined) {
  const { data: count } = useUnreadNotificationCount(userId);

  useEffect(() => {
    if (count == null) return;
    Notifications.setBadgeCountAsync(count).catch(() => {
      // Silently ignore - badge API may not be available on all platforms
    });
  }, [count]);

  // Reset badge on unmount (logout)
  useEffect(() => {
    return () => {
      Notifications.setBadgeCountAsync(0).catch(() => {});
    };
  }, []);
}
