/**
 * MyStatsCarousel
 *
 * Horizontal swipe of sport-specific stat cards. Each card is its own
 * widget. Cards self-hide when their data is empty.
 */

import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@rallia/shared-components';
import { spacingPixels } from '@rallia/design-system';
import type { NetworkPulseYourSummary } from '@rallia/shared-hooks';

import { useThemeStyles, useTranslation } from '#/hooks';

import { ActivityHeatmapCard } from './ActivityHeatmapCard';
import { PersonalRecordsCard } from './PersonalRecordsCard';
import { SetStatsCard } from './SetStatsCard';
import { ScoreDistributionCard } from './ScoreDistributionCard';

interface MyStatsCarouselProps {
  stats: NetworkPulseYourSummary['stats'];
  daysBack: number;
}

export function MyStatsCarousel({ stats, daysBack }: MyStatsCarouselProps) {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();

  const hasHeatmap = stats.activity_heatmap.length > 0;
  const hasRecords = stats.personal_records.length > 0;
  const hasSetStats =
    stats.set_stats &&
    (stats.set_stats.first_set_win_pct != null ||
      stats.set_stats.sets_won_pct != null ||
      stats.set_stats.tiebreaks != null);
  const hasScoreDist = stats.score_distribution.length > 0;

  const anyCard = hasHeatmap || hasRecords || hasSetStats || hasScoreDist;
  if (!anyCard) return null;

  return (
    <View style={styles.section}>
      <Text size="lg" weight="bold" style={[styles.title, { color: colors.text }]}>
        {t('groups.leaderboard.myStats.title')}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {hasHeatmap && <ActivityHeatmapCard heatmap={stats.activity_heatmap} daysBack={daysBack} />}
        {hasRecords && <PersonalRecordsCard records={stats.personal_records} />}
        {hasSetStats && <SetStatsCard setStats={stats.set_stats} />}
        {hasScoreDist && <ScoreDistributionCard distribution={stats.score_distribution} />}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacingPixels[5],
  },
  title: {
    marginBottom: spacingPixels[3],
  },
  row: {
    gap: spacingPixels[3],
    paddingVertical: spacingPixels[1],
  },
});

export default MyStatsCarousel;
