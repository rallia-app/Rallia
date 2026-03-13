import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { Logger } from '@rallia/shared-services';
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
    Notifications.setBadgeCountAsync(count).catch((err: unknown) => {
      Logger.warn('[useBadgeCountSync] Failed to set badge count', {
        count,
        error: String(err),
      });
    });
  }, [count]);

  // Reset badge on unmount (logout)
  useEffect(() => {
    return () => {
      Notifications.setBadgeCountAsync(0).catch((err: unknown) => {
        Logger.warn('[useBadgeCountSync] Failed to reset badge count', {
          error: String(err),
        });
      });
    };
  }, []);
}
