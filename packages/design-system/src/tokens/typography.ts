/**
 * Typography Tokens - Theme v2
 *
 * Font families, sizes, weights, line heights, and letter spacing
 * for consistent typography across web and mobile.
 */

/**
 * Font families (theme v2)
 * - Display: Poppins (headings)
 * - Stat: Barlow Semi Condensed (scores, ratings, ranks, countdowns)
 * - Body: Inter
 */
export const fontFamily = {
  heading: ['Poppins', 'sans-serif'],
  stat: ['Barlow Semi Condensed', 'sans-serif'],
  body: ['Inter', 'sans-serif'],
  mono: ['Fira Code', 'Consolas', 'monospace'],
} as const;

/**
 * Font family strings for React Native. These are the @expo-google-fonts
 * export names; the mobile app loads them at boot (App.tsx SplashGate).
 */
export const fontFamilyNative = {
  heading: 'Poppins_400Regular',
  headingMedium: 'Poppins_500Medium',
  headingSemiBold: 'Poppins_600SemiBold',
  headingBold: 'Poppins_700Bold',
  headingExtraBold: 'Poppins_800ExtraBold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
  stat: 'BarlowSemiCondensed_700Bold',
  statSemiBold: 'BarlowSemiCondensed_600SemiBold',
  mono: 'FiraCode',
} as const;

/**
 * Font sizes with corresponding line heights
 * Based on a 16px base with a 1.25 modular scale
 */
export const fontSize = {
  xs: '0.75rem', // 12px
  sm: '0.875rem', // 14px
  base: '1rem', // 16px
  lg: '1.125rem', // 18px
  xl: '1.25rem', // 20px
  '2xl': '1.5rem', // 24px
  '3xl': '1.875rem', // 30px
  '4xl': '2.25rem', // 36px
  '5xl': '3rem', // 48px
  '6xl': '3.75rem', // 60px
  '7xl': '4.5rem', // 72px
  '8xl': '6rem', // 96px
  '9xl': '8rem', // 128px
} as const;

/**
 * Font sizes in pixels (for React Native)
 */
export const fontSizePixels = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
  '4xl': 36,
  '5xl': 48,
  '6xl': 60,
  '7xl': 72,
  '8xl': 96,
  '9xl': 128,
} as const;

/**
 * Font weights
 */
export const fontWeight = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
} as const;

/**
 * Font weights as numbers (for React Native)
 */
export const fontWeightNumeric = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
} as const;

/**
 * Line heights
 */
export const lineHeight = {
  none: '1',
  tight: '1.1',
  snug: '1.2',
  normal: '1.5',
  relaxed: '1.6',
  loose: '2',
} as const;

/**
 * Line heights as multipliers (for React Native)
 */
export const lineHeightMultiplier = {
  none: 1,
  tight: 1.1,
  snug: 1.2,
  normal: 1.5,
  relaxed: 1.6,
  loose: 2,
} as const;

/**
 * Letter spacing
 */
export const letterSpacing = {
  tighter: '-0.05em',
  tight: '-0.025em',
  normal: '0',
  wide: '0.025em',
  wider: '0.05em',
  widest: '0.1em',
} as const;

/**
 * Letter spacing in pixels (for React Native, based on 16px base)
 */
export const letterSpacingPixels = {
  tighter: -0.8,
  tight: -0.4,
  normal: 0,
  wide: 0.4,
  wider: 0.8,
  widest: 1.6,
} as const;

/**
 * Text styles - predefined combinations
 */
export const textStyles = {
  // Headings
  h1: {
    fontFamily: fontFamily.heading,
    fontSize: fontSize['5xl'],
    fontWeight: fontWeight.extrabold,
    lineHeight: lineHeight.tight,
    letterSpacing: letterSpacing.tighter,
  },
  h2: {
    fontFamily: fontFamily.heading,
    fontSize: fontSize['4xl'],
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.snug,
    letterSpacing: letterSpacing.tight,
  },
  h3: {
    fontFamily: fontFamily.heading,
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.snug,
    letterSpacing: letterSpacing.tight,
  },
  h4: {
    fontFamily: fontFamily.heading,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.snug,
    letterSpacing: letterSpacing.tight,
  },
  h5: {
    fontFamily: fontFamily.heading,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.snug,
    letterSpacing: letterSpacing.tight,
  },
  h6: {
    fontFamily: fontFamily.heading,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.snug,
    letterSpacing: letterSpacing.tight,
  },

  // Body text
  bodyLarge: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.normal,
    lineHeight: lineHeight.relaxed,
    letterSpacing: letterSpacing.normal,
  },
  body: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.base,
    fontWeight: fontWeight.normal,
    lineHeight: lineHeight.relaxed,
    letterSpacing: letterSpacing.normal,
  },
  bodySmall: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.normal,
    lineHeight: lineHeight.normal,
    letterSpacing: letterSpacing.normal,
  },

  // Labels and captions
  label: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    lineHeight: lineHeight.normal,
    letterSpacing: letterSpacing.wide,
  },
  caption: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.normal,
    lineHeight: lineHeight.normal,
    letterSpacing: letterSpacing.normal,
  },

  // Button text
  button: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.none,
    letterSpacing: letterSpacing.wide,
  },
  buttonSmall: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.none,
    letterSpacing: letterSpacing.wide,
  },

  // Stat numerals (scores, ratings, ranks, countdowns) - tabular figures
  stat: {
    fontFamily: fontFamily.stat,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.none,
    letterSpacing: letterSpacing.normal,
  },
  statLarge: {
    fontFamily: fontFamily.stat,
    fontSize: fontSize['4xl'],
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.none,
    letterSpacing: letterSpacing.normal,
  },

  // Code
  code: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.normal,
    lineHeight: lineHeight.normal,
    letterSpacing: letterSpacing.normal,
  },
} as const;

/**
 * Text styles for React Native (using pixel values)
 */
export const textStylesNative = {
  h1: {
    fontFamily: fontFamilyNative.headingExtraBold,
    fontSize: fontSizePixels['5xl'],
    lineHeight: fontSizePixels['5xl'] * lineHeightMultiplier.tight,
    letterSpacing: letterSpacingPixels.tighter,
  },
  h2: {
    fontFamily: fontFamilyNative.headingBold,
    fontSize: fontSizePixels['4xl'],
    lineHeight: fontSizePixels['4xl'] * lineHeightMultiplier.snug,
    letterSpacing: letterSpacingPixels.tight,
  },
  h3: {
    fontFamily: fontFamilyNative.headingBold,
    fontSize: fontSizePixels['3xl'],
    lineHeight: fontSizePixels['3xl'] * lineHeightMultiplier.snug,
    letterSpacing: letterSpacingPixels.tight,
  },
  h4: {
    fontFamily: fontFamilyNative.headingBold,
    fontSize: fontSizePixels['2xl'],
    lineHeight: fontSizePixels['2xl'] * lineHeightMultiplier.snug,
    letterSpacing: letterSpacingPixels.tight,
  },
  h5: {
    fontFamily: fontFamilyNative.headingBold,
    fontSize: fontSizePixels.xl,
    lineHeight: fontSizePixels.xl * lineHeightMultiplier.snug,
    letterSpacing: letterSpacingPixels.tight,
  },
  h6: {
    fontFamily: fontFamilyNative.headingBold,
    fontSize: fontSizePixels.lg,
    lineHeight: fontSizePixels.lg * lineHeightMultiplier.snug,
    letterSpacing: letterSpacingPixels.tight,
  },
  bodyLarge: {
    fontFamily: fontFamilyNative.body,
    fontSize: fontSizePixels.lg,
    lineHeight: fontSizePixels.lg * lineHeightMultiplier.relaxed,
    letterSpacing: letterSpacingPixels.normal,
  },
  body: {
    fontFamily: fontFamilyNative.body,
    fontSize: fontSizePixels.base,
    lineHeight: fontSizePixels.base * lineHeightMultiplier.relaxed,
    letterSpacing: letterSpacingPixels.normal,
  },
  bodySmall: {
    fontFamily: fontFamilyNative.body,
    fontSize: fontSizePixels.sm,
    lineHeight: fontSizePixels.sm * lineHeightMultiplier.normal,
    letterSpacing: letterSpacingPixels.normal,
  },
  label: {
    fontFamily: fontFamilyNative.bodyMedium,
    fontSize: fontSizePixels.sm,
    lineHeight: fontSizePixels.sm * lineHeightMultiplier.normal,
    letterSpacing: letterSpacingPixels.wide,
  },
  caption: {
    fontFamily: fontFamilyNative.body,
    fontSize: fontSizePixels.xs,
    lineHeight: fontSizePixels.xs * lineHeightMultiplier.normal,
    letterSpacing: letterSpacingPixels.normal,
  },
  button: {
    fontFamily: fontFamilyNative.bodySemiBold,
    fontSize: fontSizePixels.base,
    lineHeight: fontSizePixels.base,
    letterSpacing: letterSpacingPixels.wide,
  },
  buttonSmall: {
    fontFamily: fontFamilyNative.bodySemiBold,
    fontSize: fontSizePixels.sm,
    lineHeight: fontSizePixels.sm,
    letterSpacing: letterSpacingPixels.wide,
  },
  stat: {
    fontFamily: fontFamilyNative.stat,
    fontSize: fontSizePixels['2xl'],
    lineHeight: fontSizePixels['2xl'] * lineHeightMultiplier.tight,
    letterSpacing: letterSpacingPixels.normal,
    fontVariant: ['tabular-nums'] as const,
  },
  statLarge: {
    fontFamily: fontFamilyNative.stat,
    fontSize: fontSizePixels['4xl'],
    lineHeight: fontSizePixels['4xl'] * lineHeightMultiplier.tight,
    letterSpacing: letterSpacingPixels.normal,
    fontVariant: ['tabular-nums'] as const,
  },
  code: {
    fontFamily: fontFamilyNative.mono,
    fontSize: fontSizePixels.sm,
    lineHeight: fontSizePixels.sm * lineHeightMultiplier.normal,
    letterSpacing: letterSpacingPixels.normal,
  },
} as const;

/**
 * Typography export
 */
export const typography = {
  fontFamily,
  fontFamilyNative,
  fontSize,
  fontSizePixels,
  fontWeight,
  fontWeightNumeric,
  lineHeight,
  lineHeightMultiplier,
  letterSpacing,
  letterSpacingPixels,
  textStyles,
  textStylesNative,
} as const;

export type FontSize = keyof typeof fontSize;
export type FontWeight = keyof typeof fontWeight;
export type LineHeight = keyof typeof lineHeight;
export type LetterSpacing = keyof typeof letterSpacing;
export type TextStyle = keyof typeof textStyles;
