/**
 * Web stub for useThemeStyles
 *
 * This hook is only available on React Native.
 * For web apps, use CSS variables or `next-themes` for theme detection.
 *
 * Note: This file exists for web bundler compatibility. The actual implementation
 * is in useThemeStyles.native.ts which Metro picks up for React Native builds.
 */

import type { ResolvedTheme } from './useTheme';

export interface ThemeColors {
  background: string;
  foreground: string;
  card: string;
  cardBackground: string;
  cardForeground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  primary: string;
  primaryForeground: string;
  buttonActive: string;
  buttonInactive: string;
  buttonTextActive: string;
  buttonTextInactive: string;
  border: string;
  borderFocus: string;
  input: string;
  inputBorder: string;
  inputBorderFocused: string;
  error: string;
  success: string;
  warning: string;
  info: string;
  headerBackground: string;
  headerForeground: string;
  icon: string;
  iconMuted: string;
  progressActive: string;
  progressInactive: string;
  inputBackground: string;
  divider: string;
  segmentTrack: string;
  segmentActive: string;
  skeletonBackground: string;
  skeletonHighlight: string;
  skeletonTintedBackground: string;
  skeletonTintedHighlight: string;
}

interface ThemeStylesResult {
  colors: ThemeColors;
  shadows: Record<string, unknown>;
  isDark: boolean;
  theme: ResolvedTheme;
}

/**
 * Web stub - throws at runtime. Use CSS variables or next-themes for web apps.
 */
export function useThemeStyles(): ThemeStylesResult {
  throw new Error(
    'useThemeStyles from @rallia/shared-hooks is only available on React Native. ' +
      'For web apps, use CSS variables from @rallia/design-system or `useTheme` from `next-themes` instead.'
  );
}
