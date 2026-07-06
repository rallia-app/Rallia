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
} from 'react-native';
import { typography, spacing, borderRadius } from '../theme';
import { primary, neutral, lightTheme, darkTheme, status } from '@rallia/design-system';

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
  /** Theme colors - if not provided, uses design system defaults */
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
  /** Whether dark mode is active */
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
  leftIcon,
  rightIcon,
  children,
  style,
  textStyle,
  testID,
  themeColors,
  isDark = false,
}) => {
  const isDisabled = disabled || loading;

  // Use theme colors if provided, otherwise use design system defaults
  // Note: Using string literals for base colors to avoid runtime import issues
  const basePrimary = destructive ? status.error.DEFAULT : isDark ? primary[500] : primary[600];

  const colors = themeColors || {
    primary: basePrimary,
    primaryForeground: '#ffffff', // base.white
    buttonActive: basePrimary,
    buttonInactive: isDark ? neutral[700] : neutral[300],
    buttonTextActive: '#ffffff', // base.white
    buttonTextInactive: isDark ? neutral[400] : neutral[500],
    text: isDark ? darkTheme.foreground : lightTheme.foreground,
    textMuted: isDark ? darkTheme.mutedForeground : lightTheme.mutedForeground,
    border: destructive ? status.error.DEFAULT : isDark ? darkTheme.border : lightTheme.border,
    background: isDark ? darkTheme.background : lightTheme.background,
  };

  // Get variant styles
  const variantStyles = getVariantStyles(variant, isDisabled, colors);

  // Get size styles
  const sizeStyles = getSizeStyles(size);

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.7}
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
