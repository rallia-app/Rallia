/**
 * useAdminPush Hook
 *
 * Manages push notification registration and handling for admin users.
 *
 * NOTE: This hook is mobile-specific and should not be in shared-hooks.
 * It uses native modules (expo-notifications, expo-device, react-native).
 */

import { useEffect, useCallback, useRef } from 'react';
import { Platform, AppState, type AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { adminPushService, Logger } from '@rallia/shared-services';

// =============================================================================
// TYPES
// =============================================================================

export interface UseAdminPushOptions {
  adminId: string | null;
  enabled?: boolean;
  onNotificationReceived?: (notification: Notifications.Notification) => void;
  onNotificationPressed?: (response: Notifications.NotificationResponse) => void;
}

export interface UseAdminPushResult {
  pushToken: string | null;
  isRegistered: boolean;
  registerDevice: () => Promise<boolean>;
  unregisterDevice: () => Promise<boolean>;
}

// =============================================================================
// NOTIFICATION HANDLER CONFIGURATION
// =============================================================================

// Configure how notifications appear when app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async notification => {
    const data = notification.request.content.data;
    const severity = data?.severity as string;

    // Always show critical alerts
    if (severity === 'critical') {
      return {
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      };
    }

    // Show warnings but without sound
    if (severity === 'warning') {
      return {
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      };
    }

    // Info notifications - show silently
    return {
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    };
  },
});

// =============================================================================
// HOOK
// =============================================================================

export function useAdminPush(options: UseAdminPushOptions): UseAdminPushResult {
  const { adminId, enabled = true, onNotificationReceived, onNotificationPressed } = options;

  const pushTokenRef = useRef<string | null>(null);
  const isRegisteredRef = useRef(false);
  const notificationListenerRef = useRef<Notifications.Subscription | null>(null);
  const responseListenerRef = useRef<Notifications.Subscription | null>(null);

  /**
   * Request notification permissions
   */
  const requestPermissions = useCallback(async (): Promise<boolean> => {
    if (!Device.isDevice) {
      Logger.warn('Push notifications require a physical device');
      return false;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      Logger.warn('Push notification permission not granted');
      return false;
    }

    // Android: Create notification channels
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('admin-critical', {
        name: 'Critical Alerts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF0000',
        sound: 'default',
        enableVibrate: true,
        enableLights: true,
      });

      await Notifications.setNotificationChannelAsync('admin-alerts', {
        name: 'Admin Alerts',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 100, 100, 100],
        sound: 'default',
      });
    }

    return true;
  }, []);

  /**
   * Get Expo push token
   */
  const getPushToken = useCallback(async (): Promise<string | null> => {
    try {
      const token = await Notifications.getExpoPushTokenAsync({
        projectId: process.env.EXPO_PUBLIC_PROJECT_ID,
      });
      return token.data;
    } catch (error) {
      Logger.error('Failed to get push token:', error instanceof Error ? error : undefined);
      return null;
    }
  }, []);

  /**
   * Register device for push notifications
   */
  const registerDevice = useCallback(async (): Promise<boolean> => {
    if (!adminId) {
      Logger.warn('Cannot register device: no admin ID');
      return false;
    }

    const hasPermission = await requestPermissions();
    if (!hasPermission) {
      return false;
    }

    const token = await getPushToken();
    if (!token) {
      return false;
    }

    pushTokenRef.current = token;

    const deviceId = await adminPushService.registerDevice({
      adminId,
      pushToken: token,
      platform: Platform.OS as 'ios' | 'android',
      deviceName: Device.deviceName || undefined,
    });

    if (deviceId) {
      isRegisteredRef.current = true;
      Logger.debug('Admin push registration successful');
      return true;
    }

    return false;
  }, [adminId, requestPermissions, getPushToken]);

  /**
   * Unregister device from push notifications
   */
  const unregisterDevice = useCallback(async (): Promise<boolean> => {
    if (!adminId || !pushTokenRef.current) {
      return false;
    }

    const success = await adminPushService.unregisterDevice(adminId, pushTokenRef.current);
    if (success) {
      isRegisteredRef.current = false;
      Logger.debug('Admin push unregistration successful');
    }

    return success;
  }, [adminId]);

  // Setup notification listeners
  useEffect(() => {
    if (!enabled || !adminId) return;

    // Listener for notifications received while app is foregrounded
    notificationListenerRef.current = Notifications.addNotificationReceivedListener(
      notification => {
        Logger.debug('Admin notification received:', notification.request.content);
        onNotificationReceived?.(notification);
      }
    );

    // Listener for when user taps on notification
    responseListenerRef.current = Notifications.addNotificationResponseReceivedListener(
      response => {
        Logger.debug('Admin notification pressed:', response.notification.request.content);
        onNotificationPressed?.(response);
      }
    );

    return () => {
      if (notificationListenerRef.current) {
        notificationListenerRef.current.remove();
      }
      if (responseListenerRef.current) {
        responseListenerRef.current.remove();
      }
    };
  }, [enabled, adminId, onNotificationReceived, onNotificationPressed]);

  // Auto-register on mount and handle app state changes
  useEffect(() => {
    if (!enabled || !adminId) return;

    // Register on mount
    registerDevice();

    // Update last_active when app comes to foreground
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active' && pushTokenRef.current && adminId) {
        adminPushService.updateLastActive(adminId, pushTokenRef.current);
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [enabled, adminId, registerDevice]);

  return {
    pushToken: pushTokenRef.current,
    isRegistered: isRegisteredRef.current,
    registerDevice,
    unregisterDevice,
  };
}

export default useAdminPush;
