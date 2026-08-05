/**
 * usePushNotifications Hook
 * Handles Expo push notification registration and permissions.
 * Should be used at the app root level to register the device on login.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { registerPushToken, unregisterPushToken, Logger } from '@rallia/shared-services';
import {
  MATCH_NOTIFICATION_TYPES,
  COMMUNITY_NOTIFICATION_TYPES,
  REFERENCE_NOTIFICATION_TYPES,
  TOURNAMENT_NOTIFICATION_TYPES,
  LEAGUE_NOTIFICATION_TYPES,
  SESSION_NOTIFICATION_TYPES,
} from '@rallia/shared-types';

// Import from the dedicated navigationRef module (not the '#/navigation'
// barrel) to avoid a require cycle: the barrel re-exports AppNavigator → every
// screen → the '#/hooks' barrel that re-exports this hook.
import {
  navigateFromOutside,
  navigateToChatConversationFromOutside,
  navigateToTournamentDetailFromOutside,
  navigateToLeagueDetailFromOutside,
  navigateToSessionDetailFromOutside,
  navigateToCommunityScreen,
  navigateToIncomingReferenceRequestsFromOutside,
} from '#/navigation/navigationRef';
import * as Analytics from '#/services/analytics';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Notification data payload structure
 * Matches the payload structure from notificationFactory.ts
 */
interface NotificationPayload {
  matchId?: string;
  conversationId?: string;
  playerId?: string;
  communityId?: string;
  notificationId?: string;
  [key: string]: unknown;
}

// Notification-type routing groups live in @rallia/shared-types so the in-app
// Notifications screen and this push handler share one source of truth and
// cannot drift.

/**
 * Check if we're running on a physical device (vs simulator/emulator)
 * Uses expo-constants instead of expo-device to avoid additional dependency
 */
function isPhysicalDevice(): boolean {
  // In development, Constants.executionEnvironment can indicate if it's a store build
  // Constants.isDevice is available in newer Expo versions
  // For simulators, deviceName often contains "Simulator" or "Emulator"
  const deviceName = Constants.deviceName ?? '';
  const isSimulator =
    deviceName.toLowerCase().includes('simulator') || deviceName.toLowerCase().includes('emulator');

  // Also check if it's an Expo Go or development build scenario
  const isDevBuild = Constants.appOwnership === 'expo' || __DEV__;

  // For production builds, we should always try to register
  // For dev builds on simulator, we skip
  if (isDevBuild && isSimulator) {
    return false;
  }

  return true;
}

// Configure how notifications are handled when app is foregrounded.
// shouldSetBadge is false: if the app is open, the user is already seeing the
// activity, so a foreground-delivered push must not bump the home-screen icon.
// The badge only matters while backgrounded (set by the OS from the push
// payload) and is cleared on foreground by useBadgeCountSync.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export interface PushNotificationState {
  expoPushToken: string | null;
  isRegistered: boolean;
  isRegistering: boolean;
  error: string | null;
}

/**
 * Options for the usePushNotifications hook
 */
export interface UsePushNotificationsOptions {
  /** Callback to set a pending match ID for deep linking */
  onMatchNotificationTapped?: (matchId: string) => void;
  /** Callback to set a pending community ID for deep linking */
  onCommunityNotificationTapped?: (communityId: string) => void;
  /** Whether the splash animation has completed (delays cold start navigation until true) */
  isSplashComplete?: boolean;
}

/**
 * Expo's push registration endpoint returns transient 503s ("upstream connect
 * error / connection timeout"). Retry with backoff before giving up.
 */
async function getExpoPushTokenWithRetry(
  options?: Parameters<typeof Notifications.getExpoPushTokenAsync>[0]
): Promise<Awaited<ReturnType<typeof Notifications.getExpoPushTokenAsync>>> {
  const backoffMs = [500, 1500, 3000];
  let lastError: unknown;
  for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
    try {
      return options
        ? await Notifications.getExpoPushTokenAsync(options)
        : await Notifications.getExpoPushTokenAsync();
    } catch (error) {
      lastError = error;
      if (attempt < backoffMs.length) {
        await new Promise(resolve => setTimeout(resolve, backoffMs[attempt]));
      }
    }
  }
  throw lastError;
}

/**
 * Get the Expo push token for this device
 */
async function getExpoPushToken(): Promise<string | null> {
  // Must be a physical device
  if (!isPhysicalDevice()) {
    Logger.warn('Push notifications require a physical device');
    return null;
  }

  // Check/request permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    Logger.warn('Push notification permission not granted');
    return null;
  }

  // Get the token
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;

    if (!projectId) {
      Logger.warn('EAS project ID not found in app config');
      // Fallback for development
      const token = await getExpoPushTokenWithRetry();
      return token.data;
    }

    const token = await getExpoPushTokenWithRetry({ projectId });

    return token.data;
  } catch (error) {
    // After retries this is Expo-side / network flakiness, not an app bug —
    // warn so it stays a breadcrumb instead of opening a Sentry issue. Push
    // simply won't register this session; the app degrades gracefully.
    Logger.warn('Failed to get Expo push token after retries', {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Set up Android notification channel
 */
async function setupAndroidChannel(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4DB8A8',
    });

    await Notifications.setNotificationChannelAsync('match', {
      name: 'Match Notifications',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4DB8A8',
    });

    // Urgent match alerts (invitations, join requests) — must match channelId
    // sent by the send-notification edge function for match_ types with priority=urgent.
    await Notifications.setNotificationChannelAsync('match_urgent', {
      name: 'Match Alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4DB8A8',
      bypassDnd: true,
    });

    await Notifications.setNotificationChannelAsync('messages', {
      name: 'Messages',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4DB8A8',
    });

    await Notifications.setNotificationChannelAsync('feedback', {
      name: 'Feedback',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4DB8A8',
    });
  }
}

/**
 * Hook for managing push notification registration
 *
 * @param userId - The authenticated user's ID (null if not logged in)
 * @param enabled - Whether to attempt registration (default: true)
 * @param options - Optional configuration including deep link handlers
 */
export function usePushNotifications(
  userId: string | null | undefined,
  enabled: boolean = true,
  options: UsePushNotificationsOptions = {}
): PushNotificationState & {
  requestPermissions: () => Promise<boolean>;
  unregister: () => Promise<void>;
} {
  const {
    onMatchNotificationTapped,
    onCommunityNotificationTapped,
    isSplashComplete = true,
  } = options;
  const [state, setState] = useState<PushNotificationState>({
    expoPushToken: null,
    isRegistered: false,
    isRegistering: false,
    error: null,
  });

  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);
  const previousUserId = useRef<string | null>(null);

  // Register push token when user logs in
  useEffect(() => {
    if (!enabled || !userId) {
      return;
    }

    // Skip if already registered for this user
    if (previousUserId.current === userId && state.isRegistered) {
      return;
    }

    const register = async () => {
      setState(prev => ({ ...prev, isRegistering: true, error: null }));

      try {
        // Set up Android channels first
        await setupAndroidChannel();

        // Get push token
        const token = await getExpoPushToken();

        if (!token) {
          setState(prev => ({
            ...prev,
            isRegistering: false,
            error: 'Could not get push token',
          }));
          return;
        }

        // Register token with backend
        await registerPushToken(userId, token);

        previousUserId.current = userId;
        setState({
          expoPushToken: token,
          isRegistered: true,
          isRegistering: false,
          error: null,
        });

        Logger.logUserAction('push_notifications_registered', {
          token: token.substring(0, 20) + '...',
        });
      } catch (error) {
        Logger.error('Failed to register push notifications', error as Error);
        setState(prev => ({
          ...prev,
          isRegistering: false,
          error: (error as Error).message,
        }));
      }
    };

    register();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, enabled]);

  // Ref to store the latest callback to avoid stale closures
  const onMatchNotificationTappedRef = useRef(onMatchNotificationTapped);
  useEffect(() => {
    onMatchNotificationTappedRef.current = onMatchNotificationTapped;
  }, [onMatchNotificationTapped]);

  const onCommunityNotificationTappedRef = useRef(onCommunityNotificationTapped);
  useEffect(() => {
    onCommunityNotificationTappedRef.current = onCommunityNotificationTapped;
  }, [onCommunityNotificationTapped]);

  /**
   * Handle a notification response (from tap)
   * Extracted to reuse for both listener and cold start handling
   */
  const handleNotificationResponse = useCallback((response: Notifications.NotificationResponse) => {
    const data = response.notification.request.content.data as NotificationPayload;
    const notificationType = data.type as string | undefined;

    Logger.logUserAction('push_notification_tapped', { data, type: notificationType });
    Analytics.pushNotificationOpened({
      type: notificationType ?? 'unknown',
      notification_id: data.notificationId,
      match_id: data.matchId,
    });

    // Handle match-related notifications. match_time_* carry the match id as
    // target_id (no matchId field), so fall back to targetId; the type-membership
    // check below keeps non-match notifications from matching.
    const matchId = (data.matchId ?? data.targetId) as string | undefined;

    // Cancelled/unfilled-game taps recover instead of dead-ending: land on
    // Public Games with context so the player immediately sees alternatives.
    if (notificationType === 'match_cancelled' || notificationType === 'match_unfilled_recovery') {
      navigateFromOutside('PublicMatches', {
        cancelledContext: {
          matchId,
          matchDate: data.matchDate as string | undefined,
          startTime: data.startTime as string | undefined,
          sportName: data.sportName as string | undefined,
          reason: notificationType === 'match_cancelled' ? 'cancelled' : 'unfilled',
        },
      });
      Logger.logUserAction('push_notification_deep_link', {
        matchId,
        type: notificationType,
        redirect: 'public_matches',
      });
      return;
    }

    if (matchId && notificationType) {
      const isMatchNotification = MATCH_NOTIFICATION_TYPES.includes(
        notificationType as (typeof MATCH_NOTIFICATION_TYPES)[number]
      );

      if (isMatchNotification) {
        // Set pending match ID for deep linking
        if (onMatchNotificationTappedRef.current) {
          onMatchNotificationTappedRef.current(matchId);
        }

        // Navigate to PlayerMatches screen (My Games)
        // The screen will check for pending deep link and open the match detail
        navigateFromOutside('PlayerMatches');

        Logger.logUserAction('push_notification_deep_link', {
          matchId,
          type: notificationType,
        });
      }
    }

    // Handle community-related notifications
    if (data.communityId && notificationType) {
      const isCommunityNotification = COMMUNITY_NOTIFICATION_TYPES.includes(
        notificationType as (typeof COMMUNITY_NOTIFICATION_TYPES)[number]
      );

      if (isCommunityNotification) {
        // Set pending community ID for deep linking
        if (onCommunityNotificationTappedRef.current) {
          onCommunityNotificationTappedRef.current(data.communityId);
        }

        // Navigate to CommunityDetail screen
        navigateToCommunityScreen('CommunityDetail', { communityId: data.communityId });

        Logger.logUserAction('push_notification_deep_link', {
          communityId: data.communityId,
          type: notificationType,
        });
      }
    }

    // Handle reference request notifications
    if (notificationType) {
      const isReferenceNotification = REFERENCE_NOTIFICATION_TYPES.includes(
        notificationType as (typeof REFERENCE_NOTIFICATION_TYPES)[number]
      );

      if (isReferenceNotification) {
        // Navigate to IncomingReferenceRequests screen
        navigateToIncomingReferenceRequestsFromOutside();

        Logger.logUserAction('push_notification_deep_link', {
          requestId: data.requestId,
          type: notificationType,
        });
      }
    }

    // Handle new-message notifications (incl. the "book your court" system card
    // posted into a match chat) — deep-link straight to the conversation.
    if (notificationType === 'new_message' || notificationType === 'chat') {
      const conversationId = data.conversationId ?? (data.targetId as string | undefined);
      if (conversationId) {
        navigateToChatConversationFromOutside(conversationId);
        Logger.logUserAction('push_notification_deep_link', {
          conversationId,
          type: notificationType,
        });
      }
    }

    // Handle tournament notifications — deep-link to the tournament detail screen.
    if (notificationType) {
      const isTournamentNotification = TOURNAMENT_NOTIFICATION_TYPES.includes(
        notificationType as (typeof TOURNAMENT_NOTIFICATION_TYPES)[number]
      );

      if (isTournamentNotification) {
        const tournamentId = (data.tournamentId ?? data.targetId) as string | undefined;
        if (tournamentId) {
          navigateToTournamentDetailFromOutside(tournamentId);
          Logger.logUserAction('push_notification_deep_link', {
            tournamentId,
            type: notificationType,
          });
        }
      }
    }

    // Handle session notifications — deep-link to the session detail (confirm CTA).
    if (notificationType) {
      const isSessionNotification = SESSION_NOTIFICATION_TYPES.includes(
        notificationType as (typeof SESSION_NOTIFICATION_TYPES)[number]
      );

      if (isSessionNotification) {
        const sessionId = (data.sessionId ?? data.targetId) as string | undefined;
        const leagueId = data.leagueId as string | undefined;
        if (sessionId && leagueId) {
          navigateToSessionDetailFromOutside(sessionId, leagueId);
          Logger.logUserAction('push_notification_deep_link', {
            sessionId,
            leagueId,
            type: notificationType,
          });
        }
      }
    }

    // Handle league notifications — deep-link to the league detail screen.
    if (notificationType) {
      const isLeagueNotification = LEAGUE_NOTIFICATION_TYPES.includes(
        notificationType as (typeof LEAGUE_NOTIFICATION_TYPES)[number]
      );

      if (isLeagueNotification) {
        const leagueId = (data.leagueId ?? data.targetId) as string | undefined;
        if (leagueId) {
          navigateToLeagueDetailFromOutside(leagueId);
          Logger.logUserAction('push_notification_deep_link', {
            leagueId,
            type: notificationType,
          });
        }
      }
    }
  }, []);

  // Track if we've already handled the initial notification (to prevent double handling)
  const hasHandledInitialNotification = useRef(false);
  // Store pending cold start notification until splash completes
  const pendingColdStartNotification = useRef<Notifications.NotificationResponse | null>(null);

  // Set up notification listeners
  useEffect(() => {
    // Listen for incoming notifications while app is foregrounded
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      const data = notification.request.content.data as NotificationPayload;
      const type = (data?.type as string | undefined) ?? 'unknown';
      Logger.logUserAction('push_notification_received', {
        title: notification.request.content.title,
        data: notification.request.content.data,
      });
      Analytics.notificationReceived({ type, channel: 'push', match_id: data.matchId });
    });

    // Listen for user interactions with notifications (while app is running/backgrounded)
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      handleNotificationResponse(response);
    });

    // Handle cold start: Check if app was opened from a notification when completely killed
    // This is needed because the listener above won't catch notifications that opened the app
    // Note: getLastNotificationResponseAsync() is specifically designed for this use case
    // and should only return a notification when the app was launched from that notification tap
    const checkInitialNotification = async () => {
      if (hasHandledInitialNotification.current) {
        return;
      }

      try {
        const response = await Notifications.getLastNotificationResponseAsync();
        if (response) {
          const notificationDate = response.notification.date;
          const now = Date.now();
          const ageMs = now - notificationDate;

          Logger.logUserAction('push_notification_cold_start_detected', {
            ageMs,
            data: response.notification.request.content.data,
            isSplashComplete,
          });

          // Store the notification for later handling
          pendingColdStartNotification.current = response;
          hasHandledInitialNotification.current = true;

          // If splash is already complete, handle immediately
          if (isSplashComplete) {
            handleNotificationResponse(response);
            pendingColdStartNotification.current = null;
          }
          // Otherwise, the effect below will handle it when splash completes
        }
      } catch (error) {
        Logger.error('Failed to check initial notification', error as Error);
      }
    };

    // Small delay to ensure the check happens after initial render
    const timeoutId = setTimeout(checkInitialNotification, 100);

    return () => {
      clearTimeout(timeoutId);
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, [handleNotificationResponse, isSplashComplete]);

  // Handle pending cold start notification when splash completes
  useEffect(() => {
    if (isSplashComplete && pendingColdStartNotification.current) {
      Logger.logUserAction('push_notification_cold_start_handling', {
        data: pendingColdStartNotification.current.notification.request.content.data,
      });

      // Small delay to ensure navigation is ready after splash
      const timeoutId = setTimeout(() => {
        if (pendingColdStartNotification.current) {
          handleNotificationResponse(pendingColdStartNotification.current);
          pendingColdStartNotification.current = null;
        }
      }, 300);

      return () => clearTimeout(timeoutId);
    }
  }, [isSplashComplete, handleNotificationResponse]);

  // Reset local registration state on logout. The token is cleared from the
  // DB inside AuthContext.signOut (before the Supabase JWT is dropped), so we
  // only need to reset hook state here — not call unregisterPushToken.
  useEffect(() => {
    if (!userId && previousUserId.current) {
      previousUserId.current = null;
      setState({
        expoPushToken: null,
        isRegistered: false,
        isRegistering: false,
        error: null,
      });
    }
  }, [userId]);

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  }, []);

  const unregister = useCallback(async (): Promise<void> => {
    if (userId) {
      await unregisterPushToken(userId);
      previousUserId.current = null;
      setState({
        expoPushToken: null,
        isRegistered: false,
        isRegistering: false,
        error: null,
      });
    }
  }, [userId]);

  return {
    ...state,
    requestPermissions,
    unregister,
  };
}

export default usePushNotifications;
