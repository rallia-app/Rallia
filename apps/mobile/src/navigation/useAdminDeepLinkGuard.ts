/**
 * useAdminDeepLinkGuard Hook
 *
 * Security guard for admin deep links.
 * Prevents unauthorized access to admin screens via deep links.
 */

import { useEffect, useCallback } from 'react';
import { Alert } from 'react-native';
import * as Linking from 'expo-linking';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAdminStatus } from '@rallia/shared-hooks';
import { auditService, Logger } from '@rallia/shared-services';
import { isAdminRoute } from './linking';
import type { RootStackParamList } from './types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export interface UseAdminDeepLinkGuardOptions {
  /** Whether to show an alert on unauthorized access */
  showAlert?: boolean;
  /** Custom message for unauthorized access alert */
  unauthorizedMessage?: string;
  /** Callback when unauthorized access is attempted */
  onUnauthorizedAccess?: (url: string) => void;
}

/**
 * Hook to guard admin deep links from unauthorized access.
 *
 * Should be used in the root navigation component to intercept
 * all deep links before they are processed by React Navigation.
 *
 * @example
 * ```tsx
 * function App() {
 *   useAdminDeepLinkGuard();
 *   return <NavigationContainer linking={linking}>...</NavigationContainer>;
 * }
 * ```
 */
export function useAdminDeepLinkGuard(options: UseAdminDeepLinkGuardOptions = {}) {
  const {
    showAlert = true,
    unauthorizedMessage = 'You do not have permission to access this area.',
    onUnauthorizedAccess,
  } = options;

  const { isAdmin, loading, adminId } = useAdminStatus();
  const navigation = useNavigation<NavigationProp>();

  // Handle unauthorized admin link access
  const handleUnauthorizedAccess = useCallback(
    (url: string) => {
      Logger.warn('Unauthorized admin deep link access attempted:', { url });

      // Log the attempt using system entity for anonymous access
      auditService
        .logAdminAction({
          adminId: 'anonymous',
          actionType: 'view',
          entityType: 'admin',
          entityId: 'deep_link',
          metadata: {
            url,
            timestamp: new Date().toISOString(),
            accessResult: 'denied',
          },
          severity: 'warning',
        })
        .catch((err: unknown) => {
          Logger.warn('[useAdminDeepLinkGuard] Failed to log unauthorized access audit', {
            url,
            error: String(err),
          });
        });

      if (showAlert) {
        Alert.alert('Access Denied', unauthorizedMessage, [
          {
            text: 'OK',
            onPress: () => {
              // Navigate to home
              navigation.reset({
                index: 0,
                routes: [{ name: 'Main' }],
              });
            },
          },
        ]);
      }

      onUnauthorizedAccess?.(url);
    },
    [showAlert, unauthorizedMessage, onUnauthorizedAccess, navigation]
  );

  // Handle authorized admin link access - log to audit trail
  const handleAuthorizedAccess = useCallback(
    async (url: string) => {
      if (adminId) {
        try {
          await auditService.logAdminAction({
            adminId,
            actionType: 'view',
            entityType: 'admin',
            entityId: 'deep_link',
            metadata: {
              url,
              timestamp: new Date().toISOString(),
              accessResult: 'granted',
            },
          });
        } catch (err) {
          Logger.warn('[useAdminDeepLinkGuard] Failed to log authorized access audit', {
            url,
            error: String(err),
          });
        }
      }
    },
    [adminId]
  );

  // Listen for incoming deep links
  useEffect(() => {
    // Handle initial URL (app opened via deep link)
    const handleInitialUrl = async () => {
      const initialUrl = await Linking.getInitialURL();
      if (initialUrl && isAdminRoute(initialUrl)) {
        if (!loading && !isAdmin) {
          handleUnauthorizedAccess(initialUrl);
        } else if (isAdmin) {
          handleAuthorizedAccess(initialUrl);
        }
      }
    };

    // Don't process until we know admin status
    if (!loading) {
      handleInitialUrl();
    }

    // Handle subsequent URL events (app already open)
    const subscription = Linking.addEventListener('url', ({ url }) => {
      if (isAdminRoute(url)) {
        if (!isAdmin) {
          handleUnauthorizedAccess(url);
        } else {
          handleAuthorizedAccess(url);
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [isAdmin, loading, handleUnauthorizedAccess, handleAuthorizedAccess]);

  return {
    isAdmin,
    loading,
  };
}

export default useAdminDeepLinkGuard;
