/**
 * Light Theme - Energy & Trust
 *
 * Semantic color tokens mapped from the base palette for light mode.
 * These are the CSS variable values used in globals.css.
 */

import { primary, secondary, accent, neutral, base, status } from '../tokens/colors';

/**
 * Light theme semantic tokens
 * Maps semantic names to actual color values
 */
export const lightTheme = {
  // Core colors
  background: neutral[50], // Slightly off-white for visual separation from cards
  foreground: neutral[950],

  // Card/Surface colors
  card: base.white,
  cardForeground: neutral[950],

  // Popover colors
  popover: base.white,
  popoverForeground: neutral[950],

  // Primary colors (buttons, links, etc.)
  primary: primary[600],
  primaryForeground: base.white,

  // Secondary colors (secondary buttons, less emphasis)
  secondary: neutral[100],
  secondaryForeground: neutral[900],

  // Muted colors (disabled, placeholder)
  muted: neutral[100],
  mutedForeground: neutral[500],

  // Accent colors (highlights, badges)
  accent: neutral[100],
  accentForeground: neutral[900],

  // Destructive colors (errors, warnings)
  destructive: status.error.DEFAULT,
  destructiveForeground: base.white,

  // Border and input colors
  border: neutral[200],
  input: neutral[200],
  ring: primary[600],

  // Sidebar specific
  sidebar: neutral[50],
  sidebarForeground: neutral[950],
  sidebarPrimary: primary[600],
  sidebarPrimaryForeground: base.white,
  sidebarAccent: neutral[100],
  sidebarAccentForeground: neutral[900],
  sidebarBorder: neutral[200],
  sidebarRing: primary[600],

  // Theme palette colors (for direct use)
  palette: {
    primary,
    secondary,
    accent,
  },

  // Background variations
  backgroundSecondary: primary[50],
  foregroundSecondary: primary[700],
} as const;

/**
 * Light theme CSS variable values (for generating CSS)
 * Uses oklch color space where appropriate
 */
export const lightThemeCSSValues = {
  '--background': 'oklch(0.985 0 0)', // neutral[50] - slightly off-white
  '--foreground': 'oklch(0.145 0 0)',
  '--card': 'oklch(1 0 0)',
  '--card-foreground': 'oklch(0.145 0 0)',
  '--popover': 'oklch(1 0 0)',
  '--popover-foreground': 'oklch(0.145 0 0)',
  '--primary': 'oklch(0.600 0.104 184.704)', // teal-600
  '--primary-foreground': 'oklch(1 0 0)',
  '--secondary': 'oklch(0.97 0 0)',
  '--secondary-foreground': 'oklch(0.205 0 0)',
  '--muted': 'oklch(0.97 0 0)',
  '--muted-foreground': 'oklch(0.556 0 0)',
  '--accent': 'oklch(0.97 0 0)',
  '--accent-foreground': 'oklch(0.205 0 0)',
  '--destructive': 'oklch(0.577 0.245 27.325)',
  '--border': 'oklch(0.922 0 0)',
  '--input': 'oklch(0.922 0 0)',
  '--ring': 'oklch(0.600 0.104 184.704)', // teal-600

  // Sidebar
  '--sidebar': 'oklch(0.985 0 0)',
  '--sidebar-foreground': 'oklch(0.145 0 0)',
  '--sidebar-primary': 'oklch(0.600 0.104 184.704)', // teal-600
  '--sidebar-primary-foreground': 'oklch(1 0 0)',
  '--sidebar-accent': 'oklch(0.97 0 0)',
  '--sidebar-accent-foreground': 'oklch(0.205 0 0)',
  '--sidebar-border': 'oklch(0.922 0 0)',
  '--sidebar-ring': 'oklch(0.600 0.104 184.704)', // teal-600

  // Theme-specific background
  '--background-secondary': primary[50],
  '--foreground-secondary': primary[700],

  // Primary scale
  '--primary-50': primary[50],
  '--primary-100': primary[100],
  '--primary-200': primary[200],
  '--primary-300': primary[300],
  '--primary-400': primary[400],
  '--primary-500': primary[500],
  '--primary-600': primary[600],
  '--primary-700': primary[700],
  '--primary-800': primary[800],
  '--primary-900': primary[900],
  '--primary-950': primary[950],

  // Secondary scale
  '--secondary-50': secondary[50],
  '--secondary-100': secondary[100],
  '--secondary-200': secondary[200],
  '--secondary-300': secondary[300],
  '--secondary-400': secondary[400],
  '--secondary-500': secondary[500],
  '--secondary-600': secondary[600],
  '--secondary-700': secondary[700],
  '--secondary-800': secondary[800],
  '--secondary-900': secondary[900],
  '--secondary-950': secondary[950],

  // Accent scale
  '--accent-50': accent[50],
  '--accent-100': accent[100],
  '--accent-200': accent[200],
  '--accent-300': accent[300],
  '--accent-400': accent[400],
  '--accent-500': accent[500],
  '--accent-600': accent[600],
  '--accent-700': accent[700],
  '--accent-800': accent[800],
  '--accent-900': accent[900],
  '--accent-950': accent[950],

  // Radius
  '--radius': '0.625rem',
} as const;

export type LightTheme = typeof lightTheme;
export type LightThemeCSSValues = typeof lightThemeCSSValues;
