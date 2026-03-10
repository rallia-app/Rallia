/**
 * Cross-platform Toast/Snackbar Component
 * Works on both iOS and Android with animated entry/exit
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { StyleSheet, Animated, TouchableOpacity, Platform, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../foundation/Text.native';
import { spacing } from '../theme';

export type ToastType = 'success' | 'error' | 'warning' | 'info';
export type ToastPosition = 'top' | 'bottom';

export interface ToastProps {
  /** Whether the toast is visible */
  visible: boolean;
  /** Message to display */
  message: string;
  /** Type of toast (affects color) */
  type?: ToastType;
  /** Position of the toast */
  position?: ToastPosition;
  /** Duration in ms before auto-dismiss (0 = no auto-dismiss) */
  duration?: number;
  /** Callback when toast is dismissed */
  onDismiss: () => void;
  /** Optional action button text */
  actionText?: string;
  /** Optional action button callback */
  onAction?: () => void;
  /** Custom style */
  style?: ViewStyle;
}

const TOAST_COLORS: Record<ToastType, { background: string; text: string; icon: string }> = {
  success: { background: '#10B981', text: '#FFFFFF', icon: '✓' },
  error: { background: '#EF4444', text: '#FFFFFF', icon: '✕' },
  warning: { background: '#F59E0B', text: '#FFFFFF', icon: '!' },
  info: { background: '#3B82F6', text: '#FFFFFF', icon: 'ℹ' },
};

export function Toast({
  visible,
  message,
  type = 'info',
  position = 'bottom',
  duration = 3000,
  onDismiss,
  actionText,
  onAction,
  style,
}: ToastProps) {
  const insets = useSafeAreaInsets();
  const [translateY] = useState(() => new Animated.Value(position === 'top' ? -100 : 100));
  const [opacity] = useState(() => new Animated.Value(0));
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const colors = TOAST_COLORS[type];

  const showToast = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, [translateY, opacity]);

  const hideToast = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: position === 'top' ? -100 : 100,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismiss();
    });
  }, [translateY, opacity, position, onDismiss]);

  useEffect(() => {
    if (visible) {
      showToast();

      if (duration > 0) {
        timeoutRef.current = setTimeout(() => {
          hideToast();
        }, duration);
      }
    } else {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [visible, duration, showToast, hideToast]);

  const handleAction = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    onAction?.();
    hideToast();
  };

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        position === 'top'
          ? { top: insets.top + spacing[4] }
          : { bottom: insets.bottom + spacing[4] },
        { backgroundColor: colors.background },
        { transform: [{ translateY }], opacity },
        style,
      ]}
    >
      <TouchableOpacity style={styles.content} onPress={hideToast} activeOpacity={0.9}>
        <Text style={[styles.icon, { color: colors.text }]}>{colors.icon}</Text>
        <Text style={[styles.message, { color: colors.text }]}>{message}</Text>
        {actionText && onAction && (
          <TouchableOpacity onPress={handleAction} style={styles.actionButton}>
            <Text style={[styles.actionText, { color: colors.text }]}>{actionText}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={hideToast}
          style={styles.closeButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.closeIcon, { color: colors.text }]}>✕</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ============================================================================
// TOAST CONTEXT & PROVIDER
// ============================================================================

import { createContext, useContext } from 'react';

interface ToastConfig {
  message: string;
  type?: ToastType;
  position?: ToastPosition;
  duration?: number;
  actionText?: string;
  onAction?: () => void;
}

interface ToastContextType {
  showToast: (config: ToastConfig) => void;
  hideToast: () => void;
  success: (message: string, options?: Partial<ToastConfig>) => void;
  error: (message: string, options?: Partial<ToastConfig>) => void;
  warning: (message: string, options?: Partial<ToastConfig>) => void;
  info: (message: string, options?: Partial<ToastConfig>) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toastConfig, setToastConfig] = useState<ToastConfig | null>(null);
  const [visible, setVisible] = useState(false);

  const showToast = useCallback((config: ToastConfig) => {
    setToastConfig(config);
    setVisible(true);
  }, []);

  const hideToast = useCallback(() => {
    setVisible(false);
  }, []);

  const success = useCallback(
    (message: string, options?: Partial<ToastConfig>) => {
      showToast({ message, type: 'success', ...options });
    },
    [showToast]
  );

  const error = useCallback(
    (message: string, options?: Partial<ToastConfig>) => {
      showToast({ message, type: 'error', ...options });
    },
    [showToast]
  );

  const warning = useCallback(
    (message: string, options?: Partial<ToastConfig>) => {
      showToast({ message, type: 'warning', ...options });
    },
    [showToast]
  );

  const info = useCallback(
    (message: string, options?: Partial<ToastConfig>) => {
      showToast({ message, type: 'info', ...options });
    },
    [showToast]
  );

  return (
    <ToastContext.Provider value={{ showToast, hideToast, success, error, warning, info }}>
      {children}
      {toastConfig && (
        <Toast
          visible={visible}
          message={toastConfig.message}
          type={toastConfig.type}
          position={toastConfig.position}
          duration={toastConfig.duration}
          actionText={toastConfig.actionText}
          onAction={toastConfig.onAction}
          onDismiss={hideToast}
        />
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextType {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: spacing[4],
    right: spacing[4],
    borderRadius: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
      },
      android: {
        elevation: 6,
      },
    }),
    zIndex: 9999,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
  },
  icon: {
    fontSize: 16,
    fontWeight: '600',
    marginRight: spacing[3],
  },
  message: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  actionButton: {
    marginLeft: spacing[3],
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[2],
  },
  actionText: {
    fontSize: 14,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  closeButton: {
    marginLeft: spacing[2],
    padding: spacing[1],
  },
  closeIcon: {
    fontSize: 14,
    fontWeight: '600',
    opacity: 0.8,
  },
});

export default Toast;
