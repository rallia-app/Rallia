/**
 * Dark Theme - Energy & Trust
 *
 * Semantic color tokens mapped from the base palette for dark mode.
 * These are the CSS variable values used in globals.css .dark class.
 */

import { primary, darkMode, neutral, base, status } from '../tokens/colors';

/**
 * Dark theme semantic tokens
 * Maps semantic names to actual color values
 */
export const darkTheme = {
  // Core colors
  background: neutral[950],
  foreground: neutral[50],

  // Card/Surface colors
  card: neutral[900],
  cardForeground: neutral[50],

  // Popover colors
  popover: neutral[900],
  popoverForeground: neutral[50],

  // Primary colors (buttons, links, etc.)
  // Bright Court Teal on dark grounds; CTA text flips to dark ink for contrast.
  primary: primary[400],
  primaryForeground: primary[950],

  // Secondary colors (secondary buttons, less emphasis)
  secondary: neutral[800],
  secondaryForeground: neutral[50],

  // Muted colors (disabled, placeholder)
  muted: neutral[800],
  mutedForeground: neutral[400],

  // Accent colors (highlights, badges)
  accent: neutral[800],
  accentForeground: neutral[50],

  // Destructive colors (errors, warnings)
  destructive: status.error.light,
  destructiveForeground: base.white,

  // Border and input colors (tinted hairlines, not plain white alpha)
  border: 'rgba(180, 220, 210, 0.14)',
  input: 'rgba(180, 220, 210, 0.18)',
  ring: primary[400],

  // Sidebar specific
  sidebar: neutral[900],
  sidebarForeground: neutral[50],
  sidebarPrimary: primary[400],
  sidebarPrimaryForeground: primary[950],
  sidebarAccent: neutral[800],
  sidebarAccentForeground: neutral[50],
  sidebarBorder: 'rgba(180, 220, 210, 0.14)',
  sidebarRing: primary[400],

  // Theme palette colors (for direct use) - dark mode adjusted
  palette: {
    primary: darkMode.primary,
    secondary: darkMode.secondary,
    accent: darkMode.accent,
  },

  // Background variations
  backgroundSecondary: neutral[900],
  foregroundSecondary: primary[400],

  // Accent jobs (theme v2): coral = people/social moments, gold = earned.
  social: darkMode.secondary[500],
  socialSubtle: darkMode.secondary[100],
  socialForeground: darkMode.secondary[700],
  achievement: darkMode.accent[500],
  achievementSubtle: darkMode.accent[100],
  achievementForeground: darkMode.accent[700],
} as const;

/**
 * Dark theme CSS variable values (for generating CSS)
 * Uses oklch color space where appropriate
 */
export const darkThemeCSSValues = {
  '--background': neutral[950],
  '--foreground': neutral[50],
  '--card': neutral[900],
  '--card-foreground': neutral[50],
  '--popover': neutral[900],
  '--popover-foreground': neutral[50],
  '--primary': primary[400], // bright Court Teal
  '--primary-foreground': primary[950],
  '--secondary': neutral[800],
  '--secondary-foreground': neutral[50],
  '--muted': neutral[800],
  '--muted-foreground': neutral[400],
  '--accent': neutral[800],
  '--accent-foreground': neutral[50],
  '--destructive': status.error.light,
  '--border': 'rgba(180, 220, 210, 0.14)',
  '--input': 'rgba(180, 220, 210, 0.18)',
  '--ring': primary[400],

  // Sidebar
  '--sidebar': neutral[900],
  '--sidebar-foreground': neutral[50],
  '--sidebar-primary': primary[400],
  '--sidebar-primary-foreground': primary[950],
  '--sidebar-accent': neutral[800],
  '--sidebar-accent-foreground': neutral[50],
  '--sidebar-border': 'rgba(180, 220, 210, 0.14)',
  '--sidebar-ring': primary[400],

  // Theme-specific background
  '--background-secondary': neutral[900],
  '--foreground-secondary': primary[500],

  // Primary scale (dark mode adjusted)
  '--primary-50': darkMode.primary[50],
  '--primary-100': darkMode.primary[100],
  '--primary-200': darkMode.primary[200],
  '--primary-300': darkMode.primary[300],
  '--primary-400': darkMode.primary[400],
  '--primary-500': darkMode.primary[500],
  '--primary-600': darkMode.primary[600],
  '--primary-700': darkMode.primary[700],
  '--primary-800': darkMode.primary[800],
  '--primary-900': darkMode.primary[900],

  // Secondary scale (dark mode adjusted)
  '--secondary-50': darkMode.secondary[50],
  '--secondary-100': darkMode.secondary[100],
  '--secondary-200': darkMode.secondary[200],
  '--secondary-300': darkMode.secondary[300],
  '--secondary-400': darkMode.secondary[400],
  '--secondary-500': darkMode.secondary[500],
  '--secondary-600': darkMode.secondary[600],
  '--secondary-700': darkMode.secondary[700],
  '--secondary-800': darkMode.secondary[800],
  '--secondary-900': darkMode.secondary[900],

  // Accent scale (dark mode adjusted)
  '--accent-50': darkMode.accent[50],
  '--accent-100': darkMode.accent[100],
  '--accent-200': darkMode.accent[200],
  '--accent-300': darkMode.accent[300],
  '--accent-400': darkMode.accent[400],
  '--accent-500': darkMode.accent[500],
  '--accent-600': darkMode.accent[600],
  '--accent-700': darkMode.accent[700],
  '--accent-800': darkMode.accent[800],
  '--accent-900': darkMode.accent[900],
} as const;

export type DarkTheme = typeof darkTheme;
export type DarkThemeCSSValues = typeof darkThemeCSSValues;
