/**
 * Text Component
 *
 * Foundational text component with consistent typography styles.
 * Uses theme tokens for sizes, weights, and spacing.
 *
 * @example
 * ```tsx
 * <Text variant="body">Regular body text</Text>
 * <Text variant="caption" color={colors.gray}>Small caption text</Text>
 * <Text weight="bold" size="lg">Large bold text</Text>
 * ```
 */

import React from 'react';
import { Text as RNText, TextProps as RNTextProps, StyleSheet, TextStyle } from 'react-native';
import { colors } from '../theme';
import { typography } from '../theme';

export interface TextProps extends Omit<RNTextProps, 'style'> {
  /**
   * Predefined text variants for common use cases
   */
  variant?: 'body' | 'caption' | 'label';

  /**
   * Text color - defaults to theme text color
   */
  color?: string;

  /**
   * Font weight
   */
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';

  /**
   * Font size - use predefined sizes or custom
   */
  size?: keyof typeof typography.fontSize | number;

  /**
   * Text alignment
   */
  align?: 'left' | 'center' | 'right' | 'justify';

  /**
   * Line height multiplier
   */
  lineHeight?: 'tight' | 'normal' | 'relaxed';

  /**
   * Whether text should be italic
   */
  italic?: boolean;

  /**
   * Whether text should be underlined
   */
  underline?: boolean;

  /**
   * Whether text should be struck through
   */
  strikethrough?: boolean;

  /**
   * Custom style overrides
   */
  style?: TextStyle | TextStyle[];

  /**
   * Text content
   */
  children: React.ReactNode;
}

/**
 * Line-height ratio each variant reads at. Kept as a ratio, not an absolute, so
 * it still applies once `size` overrides the variant's own font size.
 */
const VARIANT_LINE_HEIGHT: Record<string, NonNullable<TextProps['lineHeight']>> = {
  body: 'normal',
  caption: 'normal',
  label: 'tight',
};

/**
 * Get styles for text variants.
 *
 * Deliberately omits lineHeight — it is derived from the *resolved* font size in
 * the component. Returning an absolute here is what made `size` and line height
 * disagree (a 30px `size="3xl"` rendered in the body variant's fixed 24px box
 * and clipped its ascenders).
 */
const getVariantStyles = (variant: TextProps['variant']): TextStyle => {
  // Defensive checks for runtime initialization
  const baseSize = typography?.fontSize?.base ?? 16;
  const smSize = typography?.fontSize?.sm ?? 14;

  const variants: Record<string, TextStyle> = {
    body: {
      fontSize: baseSize,
      fontWeight: typography?.fontWeight?.regular ?? '400',
    },
    caption: {
      fontSize: smSize,
      fontWeight: typography?.fontWeight?.regular ?? '400',
      color: colors.gray,
    },
    label: {
      fontSize: smSize,
      fontWeight: typography?.fontWeight?.medium ?? '500',
      letterSpacing: typography?.letterSpacing?.wide ?? 0.5,
      textTransform: 'uppercase',
    },
  };

  return variants[variant || 'body'];
};

/**
 * Get font weight value
 */
const getFontWeight = (weight: TextProps['weight']): TextStyle['fontWeight'] => {
  if (!weight) return typography?.fontWeight?.regular ?? '400';
  return typography?.fontWeight?.[weight] ?? '400';
};

/**
 * Get font size value
 */
export const getFontSize = (size: TextProps['size']): number => {
  if (typeof size === 'number') return size;
  // Defensive check for runtime initialization
  if (!typography?.fontSize) {
    return 16; // Default base size
  }
  if (!size) return typography.fontSize.base ?? 16;
  return typography.fontSize[size] ?? 16;
};

/**
 * Resolve line height against the font size actually being rendered. Explicit
 * `lineHeight` wins, otherwise the variant's ratio applies.
 *
 * Exported for unit tests: this is the rule that decides whether tall glyphs fit.
 */
export const getLineHeight = (
  lineHeight: TextProps['lineHeight'],
  variant: TextProps['variant'],
  fontSize: number
): number => {
  const ratioKey = lineHeight ?? VARIANT_LINE_HEIGHT[variant || 'body'] ?? 'normal';
  return fontSize * (typography?.lineHeight?.[ratioKey] ?? 1.5);
};

export const Text: React.FC<TextProps> = ({
  variant,
  color,
  weight,
  size,
  align,
  lineHeight,
  italic,
  underline,
  strikethrough,
  style,
  children,
  ...props
}) => {
  // Base styles from variant
  const variantStyles = getVariantStyles(variant);

  // Calculate font size
  const fontSize = size
    ? getFontSize(size)
    : variantStyles.fontSize || (typography?.fontSize?.base ?? 16);

  const calculatedLineHeight = getLineHeight(lineHeight, variant, fontSize);

  // Build style object
  const textStyle: TextStyle = {
    ...variantStyles,
    fontSize,
    lineHeight: calculatedLineHeight,
    ...(color && { color }),
    ...(weight && { fontWeight: getFontWeight(weight) }),
    ...(align && { textAlign: align }),
    ...(italic && { fontStyle: 'italic' }),
    ...(underline && { textDecorationLine: 'underline' }),
    ...(strikethrough && { textDecorationLine: 'line-through' }),
    ...(underline && strikethrough && { textDecorationLine: 'underline line-through' }),
  };

  return (
    <RNText style={[styles.base, textStyle, style]} {...props}>
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
export default Text;
