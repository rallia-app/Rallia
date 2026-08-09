/**
 * IconButton Component
 *
 * Icon-only button for close/back/header actions and FABs. Replaces hand-rolled
 * icon touchables so hit area, radius, and theming stay consistent.
 *
 * The icon node controls its own color. Recommended pairing with `useThemeStyles()`:
 * ghost/tinted/outline -> `colors.icon` (or `colors.iconMuted`), filled -> '#ffffff'.
 *
 * @example
 * ```tsx
 * // Sheet close button
 * <IconButton
 *   accessibilityLabel={t('common.close')}
 *   icon={<Ionicons name="close" size={22} color={colors.icon} />}
 *   onPress={onClose}
 * />
 *
 * // FAB
 * <IconButton
 *   variant="filled"
 *   size="lg"
 *   elevated
 *   accessibilityLabel={t('chat.newConversation')}
 *   icon={<Ionicons name="add" size={28} color="#ffffff" />}
 *   onPress={onCreate}
 * />
 * ```
 */

import React from 'react';
import {
  TouchableOpacity,
  StyleSheet,
  ViewStyle,
  StyleProp,
  GestureResponderEvent,
  Insets,
} from 'react-native';
import { useThemeStyles } from '@rallia/shared-hooks';
import { shadowsNative, shadowsNativeDark } from '@rallia/design-system';

export interface IconButtonProps {
  /** Icon node (caller sets its size and color) */
  icon: React.ReactNode;
  /** Required: screen-reader label for the action */
  accessibilityLabel: string;
  /** Visual variant */
  variant?: 'ghost' | 'tinted' | 'filled' | 'outline';
  /** Square touch target: sm 32pt, md 40pt, lg 48pt (circular) */
  size?: 'sm' | 'md' | 'lg';
  /** FAB-style elevation shadow */
  elevated?: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** Press handler */
  onPress?: (event?: GestureResponderEvent) => void;
  /** Long-press handler */
  onLongPress?: (event?: GestureResponderEvent) => void;
  /** Additional container styles */
  style?: StyleProp<ViewStyle>;
  /** Test ID for testing */
  testID?: string;
}

const SIZES: Record<NonNullable<IconButtonProps['size']>, number> = {
  sm: 32,
  md: 40,
  lg: 48,
};

// Pads touch targets below 44pt up to the platform minimum.
const hitSlopFor = (dimension: number): Insets | undefined => {
  if (dimension >= 44) return undefined;
  const pad = Math.ceil((44 - dimension) / 2);
  return { top: pad, bottom: pad, left: pad, right: pad };
};

export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  accessibilityLabel,
  variant = 'ghost',
  size = 'md',
  elevated = false,
  disabled = false,
  onPress,
  onLongPress,
  style,
  testID,
}) => {
  const { colors, isDark } = useThemeStyles();
  const dimension = SIZES[size];
  const elevationShadow = isDark ? shadowsNativeDark.lg : shadowsNative.lg;

  const variantStyle: ViewStyle =
    variant === 'filled'
      ? { backgroundColor: colors.primary }
      : variant === 'tinted'
        ? { backgroundColor: colors.inputBackground }
        : variant === 'outline'
          ? { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border }
          : { backgroundColor: 'transparent' };

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      activeOpacity={0.7}
      hitSlop={hitSlopFor(dimension)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      testID={testID}
      style={[
        styles.container,
        { width: dimension, height: dimension, borderRadius: dimension / 2 },
        variantStyle,
        elevated && elevationShadow,
        disabled && styles.disabled,
        style,
      ]}
    >
      {icon}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.6,
  },
});
