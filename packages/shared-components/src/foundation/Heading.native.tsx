/**
 * Heading Component
 *
 * Semantic heading component for hierarchical text structure.
 * Supports levels 1-6 (H1-H6) with appropriate sizing and weights.
 *
 * @example
 * ```tsx
 * <Heading level={1}>Main Title</Heading>
 * <Heading level={2} color={colors.primary}>Section Title</Heading>
 * <Heading level={3} weight="semibold">Subsection</Heading>
 * ```
 */

import React from 'react';
import { Text as RNText, TextProps as RNTextProps, StyleSheet, TextStyle } from 'react-native';
import { colors } from '../theme';
import { typography } from '../theme';

export interface HeadingProps extends Omit<RNTextProps, 'style'> {
  /**
   * Heading level (1-6, where 1 is largest)
   */
  level: 1 | 2 | 3 | 4 | 5 | 6;

  /**
   * Text color - defaults to theme dark color
   */
  color?: string;

  /**
   * Font weight - defaults to bold for H1-H3, semibold for H4-H6
   */
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';

  /**
   * Text alignment
   */
  align?: 'left' | 'center' | 'right' | 'justify';

  /**
   * Line height multiplier
   */
  lineHeight?: 'tight' | 'normal' | 'relaxed';

  /**
   * Custom style overrides
   */
  style?: TextStyle | TextStyle[];

  /**
   * Heading text content
   */
  children: React.ReactNode;

  /**
   * Accessibility label
   */
  accessibilityRole?: 'header';
}

/**
 * Get styles for each heading level
 */
const getHeadingStyles = (level: HeadingProps['level']): TextStyle => {
  const headingStyles: Record<number, TextStyle> = {
    1: {
      fontSize: typography.fontSize['4xl'], // 36px
      fontWeight: typography.fontWeight.bold,
      lineHeight: typography.fontSize['4xl'] * typography.lineHeight.tight,
      letterSpacing: typography.letterSpacing.tight,
    },
    2: {
      fontSize: typography.fontSize['3xl'], // 30px
      fontWeight: typography.fontWeight.bold,
      lineHeight: typography.fontSize['3xl'] * typography.lineHeight.tight,
      letterSpacing: typography.letterSpacing.tight,
    },
    3: {
      fontSize: typography.fontSize['2xl'], // 24px
      fontWeight: typography.fontWeight.bold,
      lineHeight: typography.fontSize['2xl'] * typography.lineHeight.normal,
    },
    4: {
      fontSize: typography.fontSize.xl, // 20px
      fontWeight: typography.fontWeight.semibold,
      lineHeight: typography.fontSize.xl * typography.lineHeight.normal,
    },
    5: {
      fontSize: typography.fontSize.lg, // 18px
      fontWeight: typography.fontWeight.semibold,
      lineHeight: typography.fontSize.lg * typography.lineHeight.normal,
    },
    6: {
      fontSize: typography.fontSize.base, // 16px
      fontWeight: typography.fontWeight.semibold,
      lineHeight: typography.fontSize.base * typography.lineHeight.normal,
    },
  };

  return headingStyles[level];
};

/**
 * Get font weight value
 */
const getFontWeight = (weight: HeadingProps['weight']): TextStyle['fontWeight'] => {
  if (!weight) return undefined;
  return typography.fontWeight[weight];
};

/**
 * Get line height multiplier
 */
const getLineHeight = (
  lineHeight: HeadingProps['lineHeight'],
  fontSize: number
): number | undefined => {
  if (!lineHeight) return undefined;
  return fontSize * typography.lineHeight[lineHeight];
};

export const Heading: React.FC<HeadingProps> = ({
  level,
  color,
  weight,
  align,
  lineHeight,
  style,
  children,
  accessibilityRole = 'header',
  ...props
}) => {
  // Base styles for heading level
  const headingStyles = getHeadingStyles(level);

  // Calculate line height if specified
  const calculatedLineHeight = lineHeight
    ? getLineHeight(lineHeight, headingStyles.fontSize as number)
    : undefined;

  // Build style object
  const textStyle: TextStyle = {
    ...headingStyles,
    ...(color && { color }),
    ...(weight && { fontWeight: getFontWeight(weight) }),
    ...(align && { textAlign: align }),
    ...(calculatedLineHeight && { lineHeight: calculatedLineHeight }),
  };

  return (
    <RNText
      style={[styles.base, textStyle, style]}
      accessibilityRole={accessibilityRole}
      {...props}
    >
      {children}
    </RNText>
  );
};

const styles = StyleSheet.create({
  base: {
    color: colors.dark,
  },
});

// Export default for convenience
export default Heading;
