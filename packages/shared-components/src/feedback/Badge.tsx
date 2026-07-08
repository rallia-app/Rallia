import React from 'react';
import { View, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { Text } from '../foundation/Text';
import { colors, spacing, borderRadius } from '../theme';

export interface BadgeProps {
  /**
   * Text content of the badge
   */
  children: React.ReactNode;

  /**
   * Visual variant of the badge
   * - 'default': Gray background
   * - 'primary': Primary color background
   * - 'success': Green background
   * - 'warning': Orange background
   * - 'error': Red background
   * - 'info': Blue background
   * @default 'default'
   */
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info';

  /**
   * Size of the badge
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg';

  /**
   * Whether to show outline style instead of filled
   * @default false
   */
  outline?: boolean;

  /**
   * Custom background color (overrides variant)
   */
  backgroundColor?: string;

  /**
   * Custom text color (overrides variant)
   */
  textColor?: string;

  /**
   * Icon to display before the text
   */
  icon?: React.ReactNode;

  /**
   * Whether to make the badge rounded/pill-shaped
   * @default true
   */
  rounded?: boolean;

  /**
   * Additional style overrides
   */
  style?: ViewStyle;

  /**
   * Test ID for testing
   */
  testID?: string;
}

/**
 * Badge component for displaying status indicators, tags, or labels
 *
 * @example
 * ```tsx
 * // Basic badge
 * <Badge>New</Badge>
 *
 * // Status badges
 * <Badge variant="success">Active</Badge>
 * <Badge variant="warning">Pending</Badge>
 * <Badge variant="error">Cancelled</Badge>
 *
 * // Sizes
 * <Badge size="sm">Small</Badge>
 * <Badge size="md">Medium</Badge>
 * <Badge size="lg">Large</Badge>
 *
 * // Outline style
 * <Badge variant="primary" outline>Outlined</Badge>
 *
 * // With icon
 * <Badge variant="success" icon={<Text>✓</Text>}>
 *   Verified
 * </Badge>
 *
 * // Custom colors
 * <Badge backgroundColor="#9C27B0" textColor="#fff">
 *   Custom
 * </Badge>
 *
 * // Match status example
 * <HStack spacing={8}>
 *   <Badge variant="info">Tennis</Badge>
 *   <Badge variant="success">4/4 Players</Badge>
 *   <Badge variant="warning">Skill: Intermediate</Badge>
 * </HStack>
 * ```
 */
export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'md',
  outline = false,
  backgroundColor: customBgColor,
  textColor: customTextColor,
  icon,
  rounded = true,
  style,
  testID = 'badge',
}) => {
  // Variant color mapping
  const variantColors = {
    default: {
      bg: colors.gray[200],
      text: colors.gray[800],
      border: colors.gray[400],
    },
    primary: {
      bg: colors.primary,
      text: colors.white,
      border: colors.primary,
    },
    success: {
      bg: colors.success,
      text: colors.white,
      border: colors.success,
    },
    warning: {
      bg: colors.warning,
      text: colors.white,
      border: colors.warning,
    },
    error: {
      bg: colors.error,
      text: colors.white,
      border: colors.error,
    },
    info: {
      bg: colors.info,
      text: colors.white,
      border: colors.info,
    },
  };

  const selectedVariant = variantColors[variant];

  // Size mapping
  const sizeStyles = {
    sm: {
      paddingHorizontal: spacing[2], // 8px
      paddingVertical: spacing[1], // 4px
      fontSize: 12,
    },
    md: {
      paddingHorizontal: spacing[3], // 12px
      paddingVertical: 6, // 6px (1.5 * 4px base unit)
      fontSize: 14,
    },
    lg: {
      paddingHorizontal: spacing[4], // 16px
      paddingVertical: spacing[2], // 8px
      fontSize: 16,
    },
  };

  const selectedSize = sizeStyles[size];

  // Determine colors based on outline mode
  const bgColor = customBgColor || (outline ? 'transparent' : selectedVariant.bg);
  const textClr = customTextColor || (outline ? selectedVariant.border : selectedVariant.text);
  const borderClr = outline ? selectedVariant.border : 'transparent';

  const badgeStyle: ViewStyle = {
    backgroundColor: bgColor,
    paddingHorizontal: selectedSize.paddingHorizontal,
    paddingVertical: selectedSize.paddingVertical,
    borderRadius: rounded ? 999 : borderRadius.sm,
    borderWidth: outline ? 1 : 0,
    borderColor: borderClr,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
  };

  const textStyle: TextStyle = {
    color: textClr,
    fontSize: selectedSize.fontSize,
    fontWeight: '600',
  };

  return (
    <View style={[styles.badge, badgeStyle, style]} testID={testID}>
      {icon && <View style={styles.iconContainer}>{icon}</View>}
      <Text style={textStyle}>{children}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    overflow: 'hidden',
  },
  iconContainer: {
    marginRight: spacing[1], // 4px
  },
});
