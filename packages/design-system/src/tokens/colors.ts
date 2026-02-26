/**
 * Color Palette - Energy & Trust Theme
 *
 * Extracted from globals.css - the single source of truth for all colors
 * across web (Tailwind) and mobile (NativeWind) platforms.
 */

/**
 * Primary colors - Teal/Cyan
 * Base color: #14b8a6 (500)
 */
export const primary = {
  50: '#f0fdfa',
  100: '#ccfbf1',
  200: '#99f6e4',
  300: '#5eead4',
  400: '#2dd4bf',
  500: '#14b8a6',
  600: '#0d9488',
  700: '#0f766e',
  800: '#115e59',
  900: '#134e4a',
  950: '#042f2e',
} as const;

/**
 * Secondary colors - Red/Coral
 * Base color: #ed6a6d (500)
 */
export const secondary = {
  50: '#fdf0f0',
  100: '#fbe1e2',
  200: '#f8c3c5',
  300: '#f4a6a7',
  400: '#f1888a',
  500: '#ed6a6d',
  600: '#be5557',
  700: '#8e4041',
  800: '#5f2a2c',
  900: '#2f1516',
  950: '#180b0b',
} as const;

/**
 * Accent colors - Yellow/Gold
 * Base color: #f59e0b (500)
 */
export const accent = {
  50: '#fffbeb',
  100: '#fef3c7',
  200: '#fde68a',
  300: '#fcd34d',
  400: '#fbbf24',
  500: '#f59e0b',
  600: '#d97706',
  700: '#b45309',
  800: '#92400e',
  900: '#78350f',
  950: '#451a03',
} as const;

/**
 * Neutral/Gray colors
 */
export const neutral = {
  50: '#fafafa',
  100: '#f5f5f5',
  200: '#e5e5e5',
  300: '#d4d4d4',
  400: '#a3a3a3',
  500: '#737373',
  600: '#525252',
  700: '#404040',
  800: '#262626',
  900: '#171717',
  950: '#0a0a0a',
} as const;

/**
 * Pure black and white
 */
export const base = {
  white: '#ffffff',
  black: '#000000',
  transparent: 'transparent',
} as const;

/**
 * Status/Semantic colors
 */
export const status = {
  success: {
    light: '#10b981',
    DEFAULT: '#059669',
    dark: '#047857',
  },
  error: {
    light: '#f87171',
    DEFAULT: '#ef4444',
    dark: '#dc2626',
  },
  warning: {
    light: '#fbbf24',
    DEFAULT: '#f59e0b',
    dark: '#d97706',
  },
  info: {
    light: '#38bdf8',
    DEFAULT: '#0ea5e9',
    dark: '#0284c7',
  },
} as const;

/**
 * Dark mode color adjustments
 * These are the inverted/adjusted values for dark mode
 */
export const darkMode = {
  primary: {
    50: '#0a0a0a',
    100: '#141414',
    200: '#1f1f1f',
    300: '#2a2a2a',
    400: '#353535',
    500: '#14b8a6',
    600: '#0d9488',
    700: '#0f766e',
    800: '#115e59',
    900: '#0f1212',
  },
  secondary: {
    50: '#1a0a0a',
    100: '#2d1414',
    200: '#3d1e1e',
    300: '#4d2828',
    400: '#5d3232',
    500: '#ff6b6b',
    600: '#ff7a7a',
    700: '#ff8989',
    800: '#ff9898',
    900: '#2d1414',
  },
  accent: {
    50: '#1a1508',
    100: '#2d2410',
    200: '#3d3318',
    300: '#4d4220',
    400: '#5d5128',
    500: '#ffd23f',
    600: '#ffd653',
    700: '#ffda67',
    800: '#ffde7b',
    900: '#2d2410',
  },
} as const;

/**
 * Complete color palette export
 */
export const colors = {
  primary,
  secondary,
  accent,
  neutral,
  base,
  status,
  darkMode,
} as const;

/**
 * Flat color map for direct access
 * Useful for StyleSheet.create() in React Native
 */
export const flatColors = {
  // Primary
  'primary-50': primary[50],
  'primary-100': primary[100],
  'primary-200': primary[200],
  'primary-300': primary[300],
  'primary-400': primary[400],
  'primary-500': primary[500],
  'primary-600': primary[600],
  'primary-700': primary[700],
  'primary-800': primary[800],
  'primary-900': primary[900],
  'primary-950': primary[950],

  // Secondary
  'secondary-50': secondary[50],
  'secondary-100': secondary[100],
  'secondary-200': secondary[200],
  'secondary-300': secondary[300],
  'secondary-400': secondary[400],
  'secondary-500': secondary[500],
  'secondary-600': secondary[600],
  'secondary-700': secondary[700],
  'secondary-800': secondary[800],
  'secondary-900': secondary[900],
  'secondary-950': secondary[950],

  // Accent
  'accent-50': accent[50],
  'accent-100': accent[100],
  'accent-200': accent[200],
  'accent-300': accent[300],
  'accent-400': accent[400],
  'accent-500': accent[500],
  'accent-600': accent[600],
  'accent-700': accent[700],
  'accent-800': accent[800],
  'accent-900': accent[900],
  'accent-950': accent[950],

  // Neutral
  'neutral-50': neutral[50],
  'neutral-100': neutral[100],
  'neutral-200': neutral[200],
  'neutral-300': neutral[300],
  'neutral-400': neutral[400],
  'neutral-500': neutral[500],
  'neutral-600': neutral[600],
  'neutral-700': neutral[700],
  'neutral-800': neutral[800],
  'neutral-900': neutral[900],
  'neutral-950': neutral[950],

  // Base
  white: base.white,
  black: base.black,
  transparent: base.transparent,

  // Status
  success: status.success.DEFAULT,
  'success-light': status.success.light,
  'success-dark': status.success.dark,
  error: status.error.DEFAULT,
  'error-light': status.error.light,
  'error-dark': status.error.dark,
  warning: status.warning.DEFAULT,
  'warning-light': status.warning.light,
  'warning-dark': status.warning.dark,
  info: status.info.DEFAULT,
  'info-light': status.info.light,
  'info-dark': status.info.dark,
} as const;

export type ColorScale = typeof primary;
export type ColorShade = keyof ColorScale;
export type PrimaryColor = (typeof primary)[ColorShade];
export type SecondaryColor = (typeof secondary)[ColorShade];
export type AccentColor = (typeof accent)[ColorShade];
export type NeutralColor = (typeof neutral)[ColorShade];
