/**
 * Colour language for event list cards (tournaments, leagues, and the formats
 * that follow). MatchCard's recipe: primary-tinted card, translucent chips.
 *
 * Lived in TournamentListScaffold until leagues started importing it across
 * feature folders; it is format-neutral, so it belongs in the registry.
 */

import { useMemo } from 'react';
import { lightTheme, darkTheme, primary, secondary, accent, neutral } from '@rallia/design-system';
import { useTheme } from '@rallia/shared-hooks';

export type EventTone = 'neutral' | 'positive' | 'active' | 'muted';

export interface EventListColors {
  background: string;
  cardBackground: string;
  cardBorder: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  avatarPlaceholder: string;
  avatarPlaceholderIcon: string;
  positiveBg: string;
  positiveText: string;
  activeBg: string;
  activeText: string;
  neutralBg: string;
  neutralText: string;
  mutedBg: string;
  mutedText: string;
  chipPrimaryBg: string;
  chipPrimaryText: string;
  chipSecondaryBg: string;
  chipSecondaryText: string;
  chipAccentBg: string;
  chipAccentText: string;
}

export function useEventListColors(): EventListColors {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const themeColors = isDark ? darkTheme : lightTheme;
  return useMemo<EventListColors>(() => {
    const chipAlpha = isDark ? '30' : '15';
    const chipPrimary = isDark ? primary[400] : primary[500];
    const chipSecondary = isDark ? secondary[400] : secondary[500];
    const chipAccent = isDark ? accent[400] : accent[500];
    return {
      background: themeColors.background,
      cardBackground: isDark ? primary[950] : primary[50],
      cardBorder: isDark ? `${primary[400]}40` : `${primary[500]}20`,
      text: themeColors.foreground,
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      primary: isDark ? primary[400] : primary[500],
      avatarPlaceholder: isDark ? neutral[700] : neutral[200],
      avatarPlaceholderIcon: isDark ? neutral[400] : neutral[500],
      positiveBg: isDark ? '#16a34a30' : '#dcfce7',
      positiveText: isDark ? '#86efac' : '#15803d',
      activeBg: isDark ? `${primary[500]}30` : `${primary[600]}20`,
      activeText: isDark ? primary[300] : primary[700],
      neutralBg: isDark ? neutral[700] : neutral[200],
      neutralText: isDark ? neutral[100] : neutral[700],
      mutedBg: isDark ? neutral[800] : neutral[100],
      mutedText: isDark ? neutral[400] : neutral[500],
      chipPrimaryBg: `${chipPrimary}${chipAlpha}`,
      chipPrimaryText: chipPrimary,
      chipSecondaryBg: `${chipSecondary}${chipAlpha}`,
      chipSecondaryText: chipSecondary,
      chipAccentBg: `${chipAccent}${chipAlpha}`,
      chipAccentText: chipAccent,
    };
  }, [themeColors, isDark]);
}

/**
 * Rating band as a single fact: "3.0", "3.0–4.5", "3.0+", "≤ 4.5".
 * Always one decimal, per the app-wide rating display rule.
 */
export function formatEventRatingRange(min: number | null, max: number | null): string | null {
  const fmt = (v: number) => Number(v).toFixed(1);
  if (min != null && max != null) return min === max ? fmt(min) : `${fmt(min)}–${fmt(max)}`;
  if (min != null) return `${fmt(min)}+`;
  if (max != null) return `≤ ${fmt(max)}`;
  return null;
}
