/**
 * PersonalRecordsCard
 *
 * Career-firsts list: biggest beat, best streak, best comeback, fastest win.
 * Server picks which records the user has earned; we render a tight stack.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels } from '@rallia/design-system';
import type { NetworkPulsePersonalRecord } from '@rallia/shared-hooks';

import { useThemeStyles, useTranslation } from '#/hooks';
import type { TranslationKey } from '#/hooks';

import { StatCard } from './StatCard';

interface PersonalRecordsCardProps {
  records: NetworkPulsePersonalRecord[];
}

const ICON_BY_TYPE: Record<NetworkPulsePersonalRecord['type'], keyof typeof Ionicons.glyphMap> = {
  biggest_beat: 'trophy-outline',
  best_streak: 'flame-outline',
  best_comeback: 'sunny-outline',
  fastest_win: 'flash-outline',
};

export function PersonalRecordsCard({ records }: PersonalRecordsCardProps) {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();

  if (!records.length) return null;

  return (
    <StatCard title={t('groups.leaderboard.myStats.recordsTitle')} width={240}>
      {records.slice(0, 3).map(r => (
        <View key={r.type} style={styles.row}>
          <Ionicons
            name={ICON_BY_TYPE[r.type]}
            size={14}
            color={colors.primary}
            style={styles.icon}
          />
          <View style={{ flex: 1 }}>
            <Text size="xs" weight="semibold" style={{ color: colors.text }}>
              {t(r.title_key as TranslationKey)}
            </Text>
            <Text size="xs" style={{ color: colors.textSecondary }} numberOfLines={1}>
              {recordSubtitle(r, t)}
            </Text>
          </View>
        </View>
      ))}
    </StatCard>
  );
}

function recordSubtitle(
  r: NetworkPulsePersonalRecord,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): string {
  switch (r.type) {
    case 'biggest_beat':
      return r.opponent_rating
        ? t('groups.leaderboard.myStats.recordBiggestBeatCopy', {
            name: r.opponent_name ?? '',
            rating: r.opponent_rating,
          })
        : t('groups.leaderboard.myStats.recordBiggestBeatCopyNoRating', {
            name: r.opponent_name ?? '',
          });
    case 'best_streak':
      return t('groups.leaderboard.myStats.recordBestStreakCopy', {
        count: r.streak_len ?? 0,
      });
    default:
      return r.opponent_name ?? '';
  }
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: spacingPixels[2],
  },
  icon: {
    marginRight: spacingPixels[2],
    marginTop: 1,
  },
});

export default PersonalRecordsCard;
