/**
 * @rallia/design-system
 *
 * Unified design system for Rallia - providing consistent design tokens
 * across web (Tailwind CSS) and mobile (NativeWind) platforms.
 *
 * @example
 * ```typescript
 * // Import tokens
 * import { primary, secondary, spacing } from '@rallia/design-system';
 *
 * // Import themes
 * import { lightTheme, darkTheme } from '@rallia/design-system/themes';
 *
 * // Import config
 * import { tailwindPreset } from '@rallia/design-system/config/tailwind';
 * import { nativewindConfig } from '@rallia/design-system/config/nativewind';
 *
 * // Import utilities
 * import { hexToRgba, cssVar } from '@rallia/design-system/utils';
 * ```
 */

// ============================================================================
// TOKENS
// ============================================================================

// Colors
export {
  primary,
  secondary,
  accent,
  neutral,
  base,
  status,
  darkMode,
  colors,
  flatColors,
} from './tokens/colors';

// Typography
export {
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
  typography,
} from './tokens/typography';

// Spacing
export { spacing, spacingPixels, spacingSemantic, spacingSemanticPixels } from './tokens/spacing';

// Radius
export { radius, radiusPixels, radiusSemantic, radiusSemanticPixels } from './tokens/radius';

// Shadows
export {
  shadows,
  shadowsLuma,
  shadowsDark,
  shadowsLumaDark,
  shadowsNative,
  shadowsNativeDark,
  shadowsSemantic,
  shadowsSemanticNative,
} from './tokens/shadows';

// Z-Index
export { zIndex, zIndexSemantic } from './tokens/z-index';

// Animations
export {
  duration,
  durationSeconds,
  delay,
  stagger,
  easing,
  animations,
  overlayTiming,
  splashTiming,
  keyframes,
  transitions,
} from './tokens/animations';

// Breakpoints
export {
  breakpoints,
  breakpointsPx,
  breakpointsMax,
  mediaQueries,
  containerMaxWidths,
  screenCategories,
  isBreakpoint,
  getCurrentBreakpoint,
} from './tokens/breakpoints';

// ============================================================================
// THEMES
// ============================================================================

export {
  lightTheme,
  lightThemeCSSValues,
  darkTheme,
  darkThemeCSSValues,
  themes,
  themeCSSValues,
  getTheme,
  getThemeCSSValues,
  getThemeToken,
  systemPrefersDark,
  resolveThemeMode,
} from './themes';

// ============================================================================
// CONFIGURATION
// ============================================================================

export {
  tailwindColors,
  tailwindTypography,
  tailwindSpacing,
  tailwindBorderRadius,
  tailwindBoxShadow,
  tailwindScreens,
  tailwindAnimation,
  tailwindTransition,
  tailwindPreset,
  generateCSSVariables,
} from './config/tailwind.preset';

export {
  nativewindColors,
  nativewindConfig,
  generateNativewindGlobalCSS,
  nativeColors,
} from './config/nativewind';

// ============================================================================
// UTILITIES
// ============================================================================

export {
  // CSS variable utilities
  objectToCSSVariables,
  generateColorScaleVariables,
  generateLightThemeCSS,
  generateDarkThemeCSS,
  generateThemeCSS,
  generateSpacingVariables,
  generateRadiusVariables,
  generateColorPaletteVariables,
  generateDarkModeColorVariables,
  generateDesignSystemCSS,
  cssVar,
  colorVar,
  spacingVar,
  radiusVar,
  // Color utilities
  hexToRgb,
  rgbToHex,
  hexToRgba,
  lighten,
  darken,
  getLuminance,
  getContrastRatio,
  meetsContrastAA,
  meetsContrastAAA,
  getTextColorForBackground,
  getAccessibleTextColor,
  mixColors,
  generateColorScale,
  toGrayscale,
  isDark,
  isLight,
} from './utils';

// ============================================================================
// TYPES
// ============================================================================

export type {
  // Token types
  ColorScale,
  ColorShade,
  PrimaryColor,
  SecondaryColor,
  AccentColor,
  NeutralColor,
  FontSize,
  FontWeight,
  LineHeight,
  LetterSpacing,
  TextStyle,
  SpacingKey,
  SpacingValue,
  SpacingSemanticKey,
  RadiusKey,
  RadiusValue,
  RadiusSemanticKey,
  ShadowKey,
  ShadowValue,
  ShadowSemanticKey,
  ShadowNativeKey,
  ShadowNativeValue,
  ZIndexKey,
  ZIndexValue,
  ZIndexSemanticKey,
  DurationKey,
  DurationValue,
  EasingKey,
  EasingValue,
  AnimationKey,
  BreakpointKey,
  BreakpointValue,
  // Theme types
  ThemeMode,
  ThemeTokenKey,
  ThemeConfig,
  LightTheme,
  LightThemeCSSValues,
  DarkTheme,
  DarkThemeCSSValues,
  // Config types
  TailwindPreset,
  NativewindConfig,
  NativeColors,
  // Utility types
  TokenCategory,
  Platform,
  Shade,
  SemanticColor,
  PaletteColor,
  StatusColor,
  TypographyPreset,
  Elevation,
  AnimationTiming,
  Breakpoint,
  DesignSystemConfig,
  NativeShadowStyle,
  TypographyStyle,
} from './types';

// ============================================================================
// LEGACY COMPATIBILITY
// ============================================================================

import {
  primary as primaryScale,
  secondary as secondaryScale,
  neutral as neutralScale,
  status as statusColors,
} from './tokens/colors';

/**
 * @deprecated Use individual exports instead
 * Legacy COLORS export for backwards compatibility with shared-constants.
 * Values derive from the token scales so legacy call sites follow theme v2.
 */
export const COLORS = {
  // Primary colors
  primary: primaryScale[600],
  primaryLight: primaryScale[100],
  primaryDark: primaryScale[700],

  // Accent colors (using secondary as accent for legacy compat)
  accent: secondaryScale[500],
  accentLight: secondaryScale[300],
  accentLighter: secondaryScale[100],

  // Neutral colors
  white: '#ffffff',
  black: '#000000',
  dark: neutralScale[900],
  darkGray: neutralScale[600],
  gray: neutralScale[500],
  lightGray: neutralScale[200],
  veryLightGray: neutralScale[100],

  // Background colors
  background: '#ffffff',
  backgroundLight: primaryScale[50],
  backgroundGray: neutralScale[100],

  // Overlay colors
  overlayDark: neutralScale[800],
  overlayBackdrop: 'rgba(0, 0, 0, 0.5)',

  // Button colors
  buttonPrimary: secondaryScale[500],
  buttonDisabled: neutralScale[300],

  // Status colors
  success: statusColors.success.DEFAULT,
  error: statusColors.error.DEFAULT,
  warning: statusColors.warning.DEFAULT,
  info: statusColors.info.DEFAULT,
} as const;

/**
 * @deprecated Use duration and delay from animations instead
 * Legacy ANIMATION_DELAYS export for backwards compatibility
 */
export const ANIMATION_DELAYS = {
  OVERLAY_STAGGER: 300,
  OVERLAY_TRANSITION: 800,
  OVERLAY_RESET: 300,
  SPLASH_DURATION: 3000,
  SPLASH_FADE_OUT: 600,
  SPLASH_FADE_IN: 1000,
  SHORT_DELAY: 300,
  MEDIUM_DELAY: 500,
  LONG_DELAY: 800,
} as const;

/**
 * @deprecated Use duration from animations instead
 * Legacy ANIMATION_DURATIONS export for backwards compatibility
 */
export const ANIMATION_DURATIONS = {
  FAST: 200,
  NORMAL: 300,
  SLOW: 500,
  VERY_SLOW: 800,
} as const;
