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
   * Predefined text variants for common use cases.
   * `display` renders in the heading face (Poppins);
   * `stat` renders numerals in Barlow Semi Condensed with tabular figures.
   */
  variant?: 'body' | 'caption' | 'label' | 'display' | 'stat';

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
  display: 'tight',
  stat: 'tight',
};

/**
 * Weight-to-family maps. The v2 faces ship as static files, so the weight
 * must be encoded in the family name; numeric fontWeight on a static file
 * gets synthesized (or ignored) per platform. Loaded at boot in App.tsx.
 */
const BODY_FONTS: Record<NonNullable<TextProps['weight']>, string> = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
};
const DISPLAY_FONTS: Record<NonNullable<TextProps['weight']>, string> = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
};
const STAT_FONTS: Record<NonNullable<TextProps['weight']>, string> = {
  regular: 'BarlowSemiCondensed_600SemiBold',
  medium: 'BarlowSemiCondensed_600SemiBold',
  semibold: 'BarlowSemiCondensed_600SemiBold',
  bold: 'BarlowSemiCondensed_700Bold',
};

const resolveFontFamily = (
  variant: TextProps['variant'],
  weight: NonNullable<TextProps['weight']>
): string => {
  if (variant === 'stat') return STAT_FONTS[weight];
  if (variant === 'display') return DISPLAY_FONTS[weight];
  return BODY_FONTS[weight];
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
    },
    caption: {
      fontSize: smSize,
      color: colors.gray,
    },
    label: {
      fontSize: smSize,
      letterSpacing: typography?.letterSpacing?.wide ?? 0.5,
      textTransform: 'uppercase',
    },
    display: {
      fontSize: baseSize,
      letterSpacing: -0.4,
    },
    stat: {
      fontSize: baseSize,
      fontVariant: ['tabular-nums'],
    },
  };

  return variants[variant || 'body'];
};

/**
 * Default weight per variant (label reads medium, display/stat read bold).
 */
const getDefaultWeight = (variant: TextProps['variant']): NonNullable<TextProps['weight']> => {
  if (variant === 'label') return 'medium';
  if (variant === 'display' || variant === 'stat') return 'bold';
  return 'regular';
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
    fontFamily: resolveFontFamily(variant, weight ?? getDefaultWeight(variant)),
    ...(color && { color }),
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
