/**
 * SetStatsCard
 *
 * Tennis/pickleball signature stats: 1st-set / 3rd-set win rate, sets won,
 * tiebreak record. A small stat-chip grid.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@rallia/shared-components';
import { spacingPixels } from '@rallia/design-system';
import type { NetworkPulseSetStats } from '@rallia/shared-hooks';

import { useThemeStyles, useTranslation } from '../../../../hooks';

import { StatCard } from './StatCard';

interface SetStatsCardProps {
  setStats: NetworkPulseSetStats;
}

export function SetStatsCard({ setStats }: SetStatsCardProps) {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();

  const lines: string[] = [];
  if (setStats.first_set_win_pct != null) {
    lines.push(
      t('groups.leaderboard.myStats.firstSetWinRate', {
        pct: setStats.first_set_win_pct,
      })
    );
  }
  if (setStats.third_set_win_pct != null) {
    lines.push(
      t('groups.leaderboard.myStats.thirdSetWinRate', {
        pct: setStats.third_set_win_pct,
      })
    );
  }
  if (setStats.sets_won_pct != null) {
    lines.push(
      t('groups.leaderboard.myStats.setsWonRate', {
        pct: setStats.sets_won_pct,
      })
    );
  }
  if (setStats.tiebreaks) {
    lines.push(
      t('groups.leaderboard.myStats.tiebreakRecord', {
        wins: setStats.tiebreaks.wins,
        losses: setStats.tiebreaks.losses,
      })
    );
  }

  if (lines.length === 0) return null;

  return (
    <StatCard title={t('groups.leaderboard.myStats.setsTitle')}>
      <View style={styles.list}>
        {lines.map((line, i) => (
          <View key={i} style={[styles.row, i > 0 && { marginTop: 6 }]}>
            <View style={[styles.bullet, { backgroundColor: colors.primary }]} />
            <Text size="xs" weight="semibold" style={{ color: colors.text, flex: 1 }}>
              {line}
            </Text>
          </View>
        ))}
      </View>
    </StatCard>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingTop: spacingPixels[1],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bullet: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginRight: spacingPixels[2],
  },
});

export default SetStatsCard;
