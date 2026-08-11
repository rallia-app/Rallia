/**
 * Color Palette - Theme v2 "Court & Rally"
 *
 * Hand-tuned ramps (no longer Tailwind's stock scales). Single source of
 * truth for all colors across web (Tailwind) and mobile (NativeWind).
 *
 * Accent jobs: primary (Court Teal) = act, secondary (Rally Coral) = people,
 * accent (Champion Gold) = earned. Gold is distinct from status.warning.
 */

/**
 * Primary colors - Court Teal
 * Anchors: 600 #007a6e (light-mode action), 400 #17c9b4 (dark-mode action)
 */
export const primary = {
  50: '#f0faf7',
  100: '#d6f5ee',
  200: '#a9ebdf',
  300: '#6bdcc9',
  400: '#17c9b4',
  500: '#0fa893',
  600: '#007a6e',
  700: '#06635b',
  800: '#0a4e48',
  900: '#0d3b38',
  950: '#062220',
} as const;

/**
 * Secondary colors - Rally Coral
 * Anchors: 500 #f2554b (light), 400 #ff8b76 (dark-mode step, warm coral not red)
 */
export const secondary = {
  50: '#fef1ef',
  100: '#fde2df',
  200: '#fbc5bf',
  300: '#f9a390',
  400: '#ff8b76',
  500: '#f2554b',
  600: '#d0433a',
  700: '#a93129',
  800: '#7f231d',
  900: '#571713',
  950: '#300b08',
} as const;

/**
 * Accent colors - Champion Gold
 * Anchors: 500 #e8a020 (light), 300 #ffc94d (dark-mode step)
 */
export const accent = {
  50: '#fdf6e7',
  100: '#faebc8',
  200: '#f6d98f',
  300: '#ffc94d',
  400: '#f5b535',
  500: '#e8a020',
  600: '#c68414',
  700: '#9c660f',
  800: '#734a0c',
  900: '#4e3108',
  950: '#2b1a04',
} as const;

/**
 * Neutral colors - teal-tinted grays (oklch chroma ~0.004-0.012 at hue ~190).
 * 900/950 double as the dark-mode card/background surfaces.
 */
export const neutral = {
  50: '#f4f9f8',
  100: '#e9f1ef',
  200: '#dce8e5',
  300: '#c4d4d0',
  400: '#93a8a2',
  500: '#5c6f6b',
  600: '#475753',
  700: '#35423f',
  800: '#232e2c',
  900: '#15211f',
  950: '#0c1514',
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
 * Deliberately separate from the brand accents: warning stays amber-orange,
 * Champion Gold (accent) is reserved for earned moments.
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
 * 50-400 are elevated dark surfaces (teal-black, not gray), 500-800 are the
 * brightened brand steps for dark grounds, 900 is a deep resting shade.
 */
export const darkMode = {
  primary: {
    50: '#0c1514',
    100: '#121b1a',
    200: '#15211f',
    300: '#1b2a27',
    400: '#22332f',
    500: '#17c9b4',
    600: '#3ddcc8',
    700: '#6fe2d0',
    800: '#a5efe2',
    900: '#0f1717',
  },
  secondary: {
    50: '#1c100e',
    100: '#2b1714',
    200: '#3b201c',
    300: '#4b2a24',
    400: '#5c342d',
    500: '#ff8b76',
    600: '#ff9a85',
    700: '#ffaa95',
    800: '#ffbaa6',
    900: '#2b1714',
  },
  accent: {
    50: '#1b1507',
    100: '#2c230e',
    200: '#3d3115',
    300: '#4e3f1c',
    400: '#5f4d23',
    500: '#ffc94d',
    600: '#ffd166',
    700: '#ffd980',
    800: '#ffe099',
    900: '#2c230e',
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
