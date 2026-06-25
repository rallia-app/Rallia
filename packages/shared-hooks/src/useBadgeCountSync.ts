import { useEffect } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Logger, markNotificationsSeen } from '@rallia/shared-services';

/**
 * Keeps the home-screen app-icon badge in sync with the canonical "unseen"
 * model used by most notification apps: the badge counts notifications that
 * arrived while the app was backgrounded, and resets to 0 when the user opens
 * the app.
 *
 * The badge *number* is set by the server on each push (count of notifications
 * since `player.notifications_seen_at`). This hook owns the *clearing* side:
 * whenever the app is foregrounded it zeroes the icon badge, and — when signed
 * in — advances the server-side "seen" cursor.
 *
 * Auth handling:
 * - Signed in (`userId` set): clear the icon AND advance the cursor via
 *   `mark_notifications_seen()` (which relies on `auth.uid()`).
 * - Signed out (`userId` undefined): only clear the icon. We never call the RPC
 *   without a session (it would no-op), and a signed-out device receives no
 *   pushes anyway because the token is removed on sign-out — so the badge can't
 *   grow. Clearing on foreground still wipes any badge left over from before
 *   sign-out or an app kill.
 * - The effect re-keys on `userId`, so sign-in / sign-out / account switch each
 *   immediately re-run the clear.
 *
 * Per-item "read" state (the in-app bell dot / bold rows, driven by
 * `notification.read_at`) is intentionally separate and unaffected.
 *
 * Mobile-only (requires expo-notifications).
 */
export function useBadgeCountSync(userId: string | undefined) {
  useEffect(() => {
    const clearBadge = () => {
      Notifications.setBadgeCountAsync(0).catch((err: unknown) => {
        Logger.warn('[useBadgeCountSync] Failed to clear badge count', { error: String(err) });
      });
    };

    const onForeground = () => {
      clearBadge();
      // Only advance the server-side cursor when authenticated —
      // mark_notifications_seen() updates the row for auth.uid().
      if (userId) {
        markNotificationsSeen().catch((err: unknown) => {
          Logger.warn('[useBadgeCountSync] Failed to mark notifications seen', {
            error: String(err),
          });
        });
      }
    };

    // Run once now: clears the icon on launch, on sign-in, and on sign-out
    // (userId undefined -> clear without an RPC).
    onForeground();

    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        onForeground();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [userId]);
}
