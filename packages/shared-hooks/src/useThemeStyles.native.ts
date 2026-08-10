import { useMemo } from 'react';
import { useTheme } from './useTheme';
import {
  lightTheme,
  darkTheme,
  primary,
  neutral,
  status,
  shadowsNative,
  shadowsNativeDark,
} from '@rallia/design-system';

// Using string literals for base colors to avoid runtime import issues
const BASE_WHITE = '#ffffff';
const BASE_BLACK = '#000000';

/**
 * Theme colors interface exported for type usage
 */
export interface ThemeColors {
  // Core
  background: string;
  foreground: string;

  // Surfaces
  card: string;
  cardBackground: string;
  cardForeground: string;

  // Text hierarchy
  text: string;
  textSecondary: string;
  textMuted: string;

  // Interactive
  primary: string;
  primaryForeground: string;
  buttonActive: string;
  buttonInactive: string;
  buttonTextActive: string;
  buttonTextInactive: string;

  // Borders
  border: string;
  borderFocus: string;
  input: string;
  inputBorder: string;
  inputBorderFocused: string;

  // Status
  error: string;
  success: string;
  warning: string;
  info: string;

  // Header (app-specific)
  headerBackground: string;
  headerForeground: string;

  // Icon colors
  icon: string;
  iconMuted: string;

  // Extended colors for overlays/wizards
  progressActive: string;
  progressInactive: string;
  inputBackground: string;
  divider: string;

  // Skeleton shimmer palette — `skeleton*` for neutral surfaces (colors.card),
  // `skeletonTinted*` for primary-tinted card surfaces (MatchCard-style).
  skeletonBackground: string;
  skeletonHighlight: string;
  skeletonTintedBackground: string;
  skeletonTintedHighlight: string;
}

/**
 * Comprehensive theme styles hook that provides all theme-aware values
 * from the design system package.
 *
 * @returns Object containing colors, shadows, isDark flag, and theme
 *
 * @example
 * ```tsx
 * const { colors, shadows, isDark } = useThemeStyles();
 *
 * <View style={{ backgroundColor: colors.background }}>
 *   <Text style={{ color: colors.text }}>Hello</Text>
 * </View>
 * ```
 */
export function useThemeStyles() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const colors = useMemo(() => {
    const themeColors = isDark ? darkTheme : lightTheme;
    return {
      // Core
      background: themeColors.background,
      foreground: themeColors.foreground,

      // Surfaces
      card: themeColors.card,
      cardBackground: themeColors.card,
      cardForeground: themeColors.cardForeground,

      // Text hierarchy (neutral in both modes; accent text is opt-in, not the default)
      text: themeColors.foreground,
      textSecondary: isDark ? neutral[300] : neutral[600],
      textMuted: themeColors.mutedForeground,

      // Interactive (dark mode: bright Court Teal with dark ink on top)
      primary: isDark ? primary[400] : primary[600],
      primaryForeground: isDark ? primary[950] : BASE_WHITE,
      buttonActive: isDark ? primary[400] : primary[600],
      buttonInactive: themeColors.muted,
      buttonTextActive: isDark ? primary[950] : BASE_WHITE,
      buttonTextInactive: themeColors.mutedForeground,

      // Borders
      border: themeColors.border,
      borderFocus: isDark ? primary[400] : primary[600],
      input: themeColors.input,
      inputBorder: isDark ? neutral[700] : neutral[200],
      inputBorderFocused: isDark ? primary[400] : primary[600],

      // Status
      error: status.error.DEFAULT,
      success: status.success.DEFAULT,
      warning: status.warning.DEFAULT,
      info: status.info.DEFAULT,

      // Header (app-specific) — sits on the tinted neutral ground, no teal wash
      headerBackground: isDark ? neutral[900] : neutral[100],
      headerForeground: isDark ? neutral[50] : neutral[900],

      // Icon colors
      icon: themeColors.foreground,
      iconMuted: themeColors.mutedForeground,

      // Extended colors for overlays/wizards
      progressActive: isDark ? primary[400] : primary[600],
      progressInactive: themeColors.muted,
      inputBackground: isDark ? neutral[800] : neutral[100],
      divider: isDark ? neutral[700] : neutral[200],

      // Skeleton shimmer palette. Neutral pair matches the Skeleton
      // primitive's historical defaults (kept verbatim so existing screens
      // don't shift); tinted pair matches the primary-tinted card surfaces.
      skeletonBackground: isDark ? '#2C2C2E' : '#E1E9EE',
      skeletonHighlight: isDark ? '#3C3C3E' : '#F2F8FC',
      skeletonTintedBackground: isDark ? primary[900] : primary[100],
      skeletonTintedHighlight: isDark ? primary[800] : primary[50],
    };
  }, [isDark]);

  const shadows = useMemo(() => {
    return isDark ? shadowsNativeDark : shadowsNative;
  }, [isDark]);

  return { colors, shadows, isDark, theme };
}
