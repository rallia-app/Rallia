/**
 * ActivityHeatmapCard
 *
 * Mini calendar grid (one cell per day in the window). Cell color intensity
 * proportional to the day's match count. Github-contribution-style.
 */

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@rallia/shared-components';
import { neutral, primary, radiusPixels } from '@rallia/design-system';
import type { NetworkPulseHeatmapDay } from '@rallia/shared-hooks';

import { useThemeStyles, useTranslation } from '../../../../hooks';

import { StatCard } from './StatCard';

interface ActivityHeatmapCardProps {
  heatmap: NetworkPulseHeatmapDay[];
  daysBack: number;
}

const COLS = 7; // weeks across
const CELL = 14; // px

export function ActivityHeatmapCard({ heatmap, daysBack }: ActivityHeatmapCardProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();

  const grid = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days: { iso: string; count: number }[] = [];
    const map = new Map(heatmap.map(d => [d.date, d.match_count]));
    // Cap at 28 days (4 cols × 7 rows) to fit comfortably in the card.
    const span = Math.min(daysBack, 28);
    for (let i = span - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().split('T')[0];
      days.push({ iso, count: map.get(iso) ?? 0 });
    }
    return days;
  }, [heatmap, daysBack]);

  const totalMatches = heatmap.reduce((s, d) => s + d.match_count, 0);
  const idleColor = isDark ? neutral[800] : neutral[100];
  const activeColors = [
    isDark ? `${primary[500]}55` : primary[100],
    isDark ? `${primary[500]}88` : primary[300],
    isDark ? primary[500] : primary[500],
    isDark ? primary[300] : primary[700],
  ];

  return (
    <StatCard title={t('groups.leaderboard.myStats.heatmapTitle')}>
      <View style={styles.grid}>
        {(() => {
          // Render as N columns × 7 rows (each col = a week). Newest col on the right.
          const cols: { iso: string; count: number }[][] = [];
          for (let i = 0; i < grid.length; i += COLS) {
            cols.push(grid.slice(i, i + COLS));
          }
          return cols.map((col, ci) => (
            <View key={ci} style={styles.col}>
              {col.map(d => {
                let bg: string = idleColor;
                if (d.count > 0) {
                  bg = activeColors[Math.min(d.count - 1, activeColors.length - 1)];
                }
                return (
                  <View
                    key={d.iso}
                    style={[styles.cell, { width: CELL, height: CELL, backgroundColor: bg }]}
                  />
                );
              })}
            </View>
          ));
        })()}
      </View>
      <Text size="xs" style={{ color: colors.textSecondary, marginTop: 8 }}>
        {t('groups.leaderboard.myStats.heatmapSummary', {
          count: totalMatches,
          days: daysBack,
        })}
      </Text>
    </StatCard>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    gap: 3,
  },
  col: {
    gap: 3,
  },
  cell: {
    borderRadius: radiusPixels.sm,
  },
});

export default ActivityHeatmapCard;
