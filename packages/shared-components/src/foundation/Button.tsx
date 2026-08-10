/**
 * Button Component
 *
 * A versatile button component with multiple variants, sizes, and states.
 * Supports loading states, icons, and full-width layout.
 *
 * @example
 * ```tsx
 * // Primary button
 * <Button onPress={() => console.log('Pressed')}>
 *   Click Me
 * </Button>
 *
 * // Secondary button with icon
 * <Button variant="secondary" leftIcon={<Icon name="check" />}>
 *   Save
 * </Button>
 *
 * // Loading state
 * <Button loading>
 *   Submitting...
 * </Button>
 * ```
 *
 * Role conventions (keep these consistent across screens):
 * - Full-width primary CTA: `size="lg" fullWidth`
 * - Retry / empty-state action: `variant="primary" size="sm"` (or `md` when it is the only action)
 * - Cancel/confirm pair: `variant="outline"` + `variant="primary"` (or `destructive`)
 * - Icon-only actions (close/back/header/FAB): use `IconButton` instead
 */

import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  View,
  ViewStyle,
  TextStyle,
  StyleProp,
  GestureResponderEvent,
  Insets,
} from 'react-native';
import { status } from '@rallia/design-system';
import { useThemeStyles } from '@rallia/shared-hooks';

import { typography, spacing, borderRadius } from '../theme';

export interface ButtonProps {
  /** Button style variant */
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'link';
  /** Button size */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Disabled state */
  disabled?: boolean;
  /** Loading state (shows spinner) */
  loading?: boolean;
  /** Full width button */
  fullWidth?: boolean;
  /** Pill-shaped button (borderRadius: full) */
  rounded?: boolean;
  /** Destructive action styling (red/error colors) */
  destructive?: boolean;
  /** Press handler */
  onPress?: (event?: GestureResponderEvent) => void;
  /** Long-press handler */
  onLongPress?: (event?: GestureResponderEvent) => void;
  /** Screen-reader label (defaults to the visible text) */
  accessibilityLabel?: string;
  /** Extra touch area for small buttons */
  hitSlop?: Insets;
  /** Icon to show on left side */
  leftIcon?: React.ReactNode;
  /** Icon to show on right side */
  rightIcon?: React.ReactNode;
  /** Button text/content */
  children: React.ReactNode;
  /** Additional container styles */
  style?: StyleProp<ViewStyle>;
  /** Additional text styles */
  textStyle?: StyleProp<TextStyle>;
  /** Test ID for testing */
  testID?: string;
  /**
   * @deprecated Button now reads the theme from ThemeProvider automatically.
   * Only pass this to override the resolved theme colors (e.g. a custom palette).
   */
  themeColors?: {
    primary: string;
    primaryForeground: string;
    buttonActive: string;
    buttonInactive: string;
    buttonTextActive: string;
    buttonTextInactive: string;
    text: string;
    textMuted: string;
    border: string;
    background: string;
  };
  /**
   * @deprecated Dark mode is resolved from ThemeProvider automatically; this prop is ignored.
   */
  isDark?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  fullWidth = false,
  rounded = false,
  destructive = false,
  onPress,
  onLongPress,
  accessibilityLabel,
  hitSlop,
  leftIcon,
  rightIcon,
  children,
  style,
  textStyle,
  testID,
  themeColors,
}) => {
  const isDisabled = disabled || loading;
  const { colors: themeStyleColors } = useThemeStyles();

  // Explicit themeColors win untouched (legacy call sites build their own palettes,
  // including destructive ones); otherwise theme context + destructive override.
  const colors =
    themeColors ||
    (destructive
      ? {
          ...themeStyleColors,
          primary: status.error.DEFAULT,
          buttonActive: status.error.DEFAULT,
          border: status.error.DEFAULT,
        }
      : themeStyleColors);

  // Get variant styles
  const variantStyles = getVariantStyles(variant, isDisabled, colors);

  // Get size styles
  const sizeStyles = getSizeStyles(size);

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={isDisabled}
      activeOpacity={0.7}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      testID={testID}
      style={[
        styles.container,
        variantStyles.container,
        sizeStyles.container,
        fullWidth && styles.fullWidth,
        rounded && styles.rounded,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading && (
        <ActivityIndicator size="small" color={variantStyles.spinner} style={styles.spinner} />
      )}

      {!loading && leftIcon && <View style={styles.leftIcon}>{leftIcon}</View>}

      <Text
        style={[
          styles.text,
          variantStyles.text,
          sizeStyles.text,
          isDisabled && variantStyles.textDisabled,
          textStyle,
        ]}
      >
        {children}
      </Text>

      {!loading && rightIcon && <View style={styles.rightIcon}>{rightIcon}</View>}
    </TouchableOpacity>
  );
};

// Variant styles
const getVariantStyles = (
  variant: ButtonProps['variant'],
  disabled: boolean,
  colors: {
    primary: string;
    primaryForeground: string;
    buttonActive: string;
    buttonInactive: string;
    buttonTextActive: string;
    buttonTextInactive: string;
    text: string;
    textMuted: string;
    border: string;
    background: string;
  }
) => {
  const variants = {
    primary: {
      container: {
        backgroundColor: disabled ? colors.buttonInactive : colors.buttonActive,
      },
      text: {
        color: colors.buttonTextActive,
      },
      textDisabled: {
        color: colors.buttonTextInactive,
      },
      spinner: colors.buttonTextActive,
    },
    secondary: {
      container: {
        backgroundColor: disabled ? colors.buttonInactive : colors.background,
        borderWidth: 2,
        borderColor: disabled ? colors.border : colors.primary,
      },
      text: {
        color: colors.primary,
      },
      textDisabled: {
        color: colors.buttonTextInactive,
      },
      spinner: colors.primary,
    },
    outline: {
      container: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: colors.border,
      },
      text: {
        color: colors.text,
      },
      textDisabled: {
        color: colors.textMuted,
      },
      spinner: colors.text,
    },
    ghost: {
      container: {
        backgroundColor: 'transparent',
      },
      text: {
        color: colors.primary,
      },
      textDisabled: {
        color: colors.textMuted,
      },
      spinner: colors.primary,
    },
    link: {
      container: {
        backgroundColor: 'transparent',
        paddingHorizontal: 0,
      },
      text: {
        color: colors.primary,
        textDecorationLine: 'underline' as const,
      },
      textDisabled: {
        color: colors.textMuted,
      },
      spinner: colors.primary,
    },
  };

  return variants[variant || 'primary'];
};

// Size styles
const getSizeStyles = (size: ButtonProps['size']) => {
  const sizes = {
    xs: {
      container: {
        paddingHorizontal: spacing[3],
        paddingVertical: spacing[1],
        minHeight: 28,
      },
      text: {
        fontSize: typography.fontSize.xs,
      },
    },
    sm: {
      container: {
        paddingHorizontal: spacing[4],
        paddingVertical: spacing[2],
        minHeight: 32,
      },
      text: {
        fontSize: typography.fontSize.sm,
      },
    },
    md: {
      container: {
        paddingHorizontal: spacing[5],
        paddingVertical: spacing[3],
        minHeight: 40,
      },
      text: {
        fontSize: typography.fontSize.base,
      },
    },
    lg: {
      container: {
        paddingHorizontal: spacing[6],
        paddingVertical: spacing[4],
        minHeight: 48,
      },
      text: {
        fontSize: typography.fontSize.lg,
      },
    },
    xl: {
      container: {
        paddingHorizontal: spacing[8],
        paddingVertical: spacing[5],
        minHeight: 56,
      },
      text: {
        fontSize: typography.fontSize.xl,
      },
    },
  };

  return sizes[size || 'md'];
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.base,
  },
  fullWidth: {
    width: '100%',
  },
  rounded: {
    borderRadius: borderRadius.full,
  },
  disabled: {
    opacity: 0.6,
  },
  text: {
    fontWeight: typography.fontWeight.semibold,
    textAlign: 'center',
  },
  spinner: {
    marginRight: spacing[2],
  },
  leftIcon: {
    marginRight: spacing[2],
  },
  rightIcon: {
    marginLeft: spacing[2],
  },
});
