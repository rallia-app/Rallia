/**
 * usePushNotifications Hook
 * Handles Expo push notification registration and permissions.
 * Should be used at the app root level to register the device on login.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { registerPushToken, unregisterPushToken } from '@rallia/shared-services';
import { Logger } from '@rallia/shared-services';
import { navigateFromOutside, navigateToCommunityScreen } from '../navigation';

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
  [key: string]: unknown;
}

/**
 * Match-related notification types that should navigate to match detail
 */
const MATCH_NOTIFICATION_TYPES = [
  'match_invitation',
  'match_join_request',
  'match_join_accepted',
  'match_join_rejected',
  'match_player_joined',
  'match_cancelled',
  'match_updated',
  'match_starting_soon',
  'match_check_in_available',
  'match_new_available',
  'match_spot_opened',
  'nearby_match_available',
  'player_kicked',
  'player_left',
  'score_confirmation',
  'feedback_request',
  'feedback_reminder',
] as const;

/**
 * Community-related notification types that should navigate to community detail
 */
const COMMUNITY_NOTIFICATION_TYPES = [
  'community_join_request',
  'community_join_accepted',
  'community_join_rejected',
] as const;

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

// Configure how notifications are handled when app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
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
      const token = await Notifications.getExpoPushTokenAsync();
      return token.data;
    }

    const token = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    return token.data;
  } catch (error) {
    Logger.error('Failed to get Expo push token', error as Error);
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
      lightColor: '#4DB8A8', // Primary teal color
    });

    // Match-specific channel for high-priority notifications
    await Notifications.setNotificationChannelAsync('match', {
      name: 'Match Notifications',
      importance: Notifications.AndroidImportance.HIGH,
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

    // Handle match-related notifications
    if (data.matchId && notificationType) {
      const isMatchNotification = MATCH_NOTIFICATION_TYPES.includes(
        notificationType as (typeof MATCH_NOTIFICATION_TYPES)[number]
      );

      if (isMatchNotification) {
        // Set pending match ID for deep linking
        if (onMatchNotificationTappedRef.current) {
          onMatchNotificationTappedRef.current(data.matchId);
        }

        // Navigate to PlayerMatches screen (My Games)
        // The screen will check for pending deep link and open the match detail
        navigateFromOutside('PlayerMatches');

        Logger.logUserAction('push_notification_deep_link', {
          matchId: data.matchId,
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

    // TODO: Handle other notification types (messages, etc.)
  }, []);

  // Track if we've already handled the initial notification (to prevent double handling)
  const hasHandledInitialNotification = useRef(false);
  // Store pending cold start notification until splash completes
  const pendingColdStartNotification = useRef<Notifications.NotificationResponse | null>(null);

  // Set up notification listeners
  useEffect(() => {
    // Listen for incoming notifications while app is foregrounded
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      Logger.logUserAction('push_notification_received', {
        title: notification.request.content.title,
        data: notification.request.content.data,
      });
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

  // Unregister on logout
  useEffect(() => {
    return () => {
      // Clean up when user logs out (userId becomes null)
      if (previousUserId.current && !userId) {
        unregisterPushToken(previousUserId.current).catch(error => {
          Logger.error('Failed to unregister push token on logout', error);
        });
        previousUserId.current = null;
        setState({
          expoPushToken: null,
          isRegistered: false,
          isRegistering: false,
          error: null,
        });
      }
    };
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
