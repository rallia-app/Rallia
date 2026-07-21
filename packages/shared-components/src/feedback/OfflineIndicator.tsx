/**
 * Offline Indicator Component
 * Shows a banner when the device is offline
 */

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { status } from '@rallia/design-system';
import { Text } from '../foundation/Text';
import { spacing } from '../theme';

export interface OfflineIndicatorProps {
  /** Whether device is offline */
  isOffline: boolean;
  /** Optional message override */
  message?: string;
  /** Whether to show retry button */
  showRetry?: boolean;
  /** Callback when retry is pressed */
  onRetry?: () => void;
  /** Background color */
  backgroundColor?: string;
  /** Text color */
  textColor?: string;
}

export function OfflineIndicator({
  isOffline,
  message = 'No internet connection',
  showRetry = true,
  onRetry,
  backgroundColor = status.error.DEFAULT,
  textColor = '#FFFFFF',
}: OfflineIndicatorProps) {
  const insets = useSafeAreaInsets();
  // The banner height is roughly insets.top + paddingTop spacing + content + paddingBottom.
  // Use a generous value so nothing peeks on any device (Dynamic Island, notch, etc.).
  const hideOffset = -(insets.top + 100);
  const translateY = useRef(new Animated.Value(hideOffset)).current;

  useEffect(() => {
    Animated.spring(translateY, {
      toValue: isOffline ? 0 : hideOffset,
      useNativeDriver: true,
      damping: 20,
      stiffness: 150,
    }).start();
  }, [isOffline, translateY, hideOffset]);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor,
          paddingTop: insets.top + spacing[2],
          transform: [{ translateY }],
        },
      ]}
      pointerEvents={isOffline ? 'auto' : 'none'}
    >
      <View style={styles.content}>
        <Ionicons name="cloud-offline-outline" size={18} color={textColor} />
        <Text style={[styles.message, { color: textColor }]}>{message}</Text>
        {showRetry && onRetry && (
          <TouchableOpacity onPress={onRetry} style={styles.retryButton}>
            <Ionicons name="refresh-outline" size={16} color={textColor} />
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
}

// ============================================================================
// NETWORK STATUS HOOK
// ============================================================================

import { useState, useCallback, useMemo } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

export interface NetworkStatus {
  isConnected: boolean;
  isInternetReachable: boolean | null;
  type: string;
}

export function useNetworkStatus() {
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>({
    isConnected: true,
    isInternetReachable: true,
    type: 'unknown',
  });

  // Keep object identity stable when values are unchanged — NetInfo can emit
  // repeated events with identical payloads, and this state feeds a context
  // consumed app-wide.
  const applyState = useCallback((state: NetInfoState) => {
    setNetworkStatus(prev => {
      const next = {
        isConnected: state.isConnected ?? true,
        isInternetReachable: state.isInternetReachable,
        type: state.type,
      };
      return prev.isConnected === next.isConnected &&
        prev.isInternetReachable === next.isInternetReachable &&
        prev.type === next.type
        ? prev
        : next;
    });
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(applyState);

    // Get initial state
    NetInfo.fetch().then(applyState);

    return () => unsubscribe();
  }, [applyState]);

  const checkConnection = useCallback(async () => {
    const state = await NetInfo.fetch();
    applyState(state);
    return state.isConnected ?? true;
  }, [applyState]);

  return useMemo(
    () => ({
      ...networkStatus,
      isOffline: !networkStatus.isConnected,
      checkConnection,
    }),
    [networkStatus, checkConnection]
  );
}

// ============================================================================
// NETWORK STATUS PROVIDER (for app-wide usage)
// ============================================================================

import { createContext, useContext } from 'react';

interface NetworkContextType extends NetworkStatus {
  isOffline: boolean;
  checkConnection: () => Promise<boolean>;
}

const NetworkContext = createContext<NetworkContextType | null>(null);

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const networkStatus = useNetworkStatus();

  return (
    <NetworkContext.Provider value={networkStatus}>
      {children}
      <OfflineIndicator
        isOffline={networkStatus.isOffline}
        onRetry={networkStatus.checkConnection}
      />
    </NetworkContext.Provider>
  );
}

export function useNetwork(): NetworkContextType {
  const context = useContext(NetworkContext);
  if (!context) {
    // Return default values if used outside provider
    return {
      isConnected: true,
      isInternetReachable: true,
      type: 'unknown',
      isOffline: false,
      checkConnection: async () => true,
    };
  }
  return context;
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9998,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[4],
    gap: spacing[2],
  },
  message: {
    fontSize: 13,
    fontWeight: '600',
  },
  retryButton: {
    padding: spacing[1],
    marginLeft: spacing[2],
  },
});

export default OfflineIndicator;
