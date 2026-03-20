import React from 'react';
import { View, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { spacing, shadows, borderRadius, colors } from '../theme';

export interface CardProps {
  /**
   * Content to render inside the card
   */
  children: React.ReactNode;

  /**
   * Visual style variant of the card
   * - 'default': Elevated with shadow
   * - 'outlined': Border without shadow
   * - 'elevated': Higher elevation shadow
   * @default 'default'
   */
  variant?: 'default' | 'outlined' | 'elevated';

  /**
   * Padding inside the card
   * @default 16
   */
  padding?: number;

  /**
   * Border radius of the card
   * @default 12
   */
  borderRadius?: number;

  /**
   * Background color of the card
   * @default '#ffffff'
   */
  backgroundColor?: string;

  /**
   * Callback when card is pressed (makes card tappable)
   */
  onPress?: () => void;

  /**
   * Whether the card is disabled (only applies when onPress is set)
   * @default false
   */
  disabled?: boolean;

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
 * Card component for grouping related content in an elevated container
 *
 * @example
 * ```tsx
 * // Basic card
 * <Card>
 *   <Text>Card content</Text>
 * </Card>
 *
 * // Outlined card
 * <Card variant="outlined">
 *   <Text>Outlined card</Text>
 * </Card>
 *
 * // Elevated card with custom padding
 * <Card variant="elevated" padding={24}>
 *   <Text>More elevated</Text>
 * </Card>
 *
 * // Tappable card
 * <Card onPress={() => console.log('Tapped')}>
 *   <Text>Tap me!</Text>
 * </Card>
 *
 * // Card with custom background
 * <Card backgroundColor="#f0f0f0">
 *   <Text>Custom background</Text>
 * </Card>
 * ```
 */
export const Card: React.FC<CardProps> = ({
  children,
  variant = 'default',
  padding = spacing[4], // 16px default
  borderRadius: borderRadiusProp = borderRadius.lg,
  backgroundColor = colors.white,
  onPress,
  disabled = false,
  style,
  testID = 'card',
}) => {
  // Determine shadow/border styles based on variant
  const variantStyles: ViewStyle = {
    default: {
      ...shadows.sm,
      borderWidth: 0,
    },
    outlined: {
      borderWidth: 1,
      borderColor: colors.gray[300],
    },
    elevated: {
      ...shadows.lg,
      borderWidth: 0,
    },
  }[variant];

  const cardStyles: ViewStyle = {
    backgroundColor,
    padding,
    borderRadius: borderRadiusProp,
    ...variantStyles,
  };

  // If onPress is provided, make it tappable
  if (onPress) {
    return (
      <TouchableOpacity
        style={[styles.card, cardStyles, disabled && styles.disabled, style]}
        onPress={onPress}
        disabled={disabled}
        activeOpacity={0.7}
        testID={testID}
      >
        {children}
      </TouchableOpacity>
    );
  }

  // Otherwise, render as a static View
  return (
    <View style={[styles.card, cardStyles, style]} testID={testID}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
  },
  disabled: {
    opacity: 0.5,
  },
});
