/**
 * ScoreDistributionCard
 *
 * Mini horizontal bar chart of how often each set score appears in the
 * caller's wins. Reveals their "fingerprint" — blowout vs grinder.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@rallia/shared-components';
import { primary, radiusPixels, spacingPixels } from '@rallia/design-system';
import type { NetworkPulseScoreDistEntry } from '@rallia/shared-hooks';

import { useThemeStyles, useTranslation } from '../../../../hooks';

import { StatCard } from './StatCard';

interface ScoreDistributionCardProps {
  distribution: NetworkPulseScoreDistEntry[];
}

export function ScoreDistributionCard({ distribution }: ScoreDistributionCardProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();

  if (!distribution.length) {
    return (
      <StatCard title={t('groups.leaderboard.myStats.scoreDistTitle')}>
        <Text size="xs" style={{ color: colors.textMuted }}>
          {t('groups.leaderboard.myStats.scoreDistEmpty')}
        </Text>
      </StatCard>
    );
  }

  const maxCount = distribution.reduce((m, d) => Math.max(m, d.count), 0) || 1;
  // Show top 5 to fit.
  const rows = distribution.slice(0, 5);

  return (
    <StatCard title={t('groups.leaderboard.myStats.scoreDistTitle')}>
      {rows.map((d, i) => {
        const widthPct = (d.count / maxCount) * 100;
        return (
          <View key={d.set_score} style={[styles.row, i > 0 && { marginTop: 6 }]}>
            <Text size="xs" weight="semibold" style={{ color: colors.text, width: 32 }}>
              {d.set_score}
            </Text>
            <View
              style={[
                styles.track,
                { backgroundColor: isDark ? `${primary[700]}40` : primary[100] },
              ]}
            >
              <View
                style={[styles.bar, { width: `${widthPct}%`, backgroundColor: primary[500] }]}
              />
            </View>
            <Text size="xs" style={{ color: colors.textMuted, width: 18, textAlign: 'right' }}>
              {d.count}
            </Text>
          </View>
        );
      })}
    </StatCard>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  track: {
    flex: 1,
    height: 8,
    borderRadius: radiusPixels.full,
    marginHorizontal: spacingPixels[2],
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: radiusPixels.full,
  },
});

export default ScoreDistributionCard;
