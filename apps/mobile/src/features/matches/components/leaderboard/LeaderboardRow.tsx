/**
 * LeaderboardRow
 *
 * One row of the COMPETE list: rank pill, avatar, name, form line, optional
 * streak chip, optional skill rating, P / W / L / W% columns.
 */

import React from 'react';
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { neutral, primary, radiusPixels, spacingPixels, status } from '@rallia/design-system';
import { getHumanName } from '@rallia/shared-utils';
import type { NetworkPulseLeaderboardEntry } from '@rallia/shared-hooks';

import { useThemeStyles, useTranslation } from '../../../../hooks';
import RatingBadge from '../../../../components/RatingBadge';

import { FormLine } from './FormLine';

const MEDAL_COLORS = {
  gold: '#FFD700',
  silver: '#C0C0C0',
  bronze: '#CD7F32',
} as const;

interface LeaderboardRowProps {
  entry: NetworkPulseLeaderboardEntry;
  rank: number;
  isLast: boolean;
  isCurrentUser: boolean;
  onPress: () => void;
}

export function LeaderboardRow({
  entry,
  rank,
  isLast,
  isCurrentUser,
  onPress,
}: LeaderboardRowProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();

  const showStreak = Math.abs(entry.current_streak) >= 2;
  const winRateText = entry.win_rate == null ? '—' : `${Math.round(entry.win_rate * 100)}%`;
  const youBg = isDark ? `${primary[700]}1F` : primary[50];

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[
        styles.row,
        !isLast && {
          borderBottomColor: colors.border,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
        isCurrentUser && {
          backgroundColor: youBg,
          borderLeftWidth: 3,
          borderLeftColor: primary[500],
        },
      ]}
    >
      <RankPill rank={rank} isDark={isDark} />

      <View style={[styles.avatar, { backgroundColor: isDark ? neutral[800] : neutral[200] }]}>
        {entry.profile_picture_url ? (
          <Image source={{ uri: entry.profile_picture_url }} style={styles.avatarImage} />
        ) : (
          <Ionicons name="person-outline" size={16} color={colors.textMuted} />
        )}
      </View>

      <View style={styles.main}>
        <Text
          size="sm"
          weight={isCurrentUser ? 'semibold' : 'regular'}
          numberOfLines={1}
          style={{ color: colors.text }}
        >
          {getHumanName(entry, t('groups.recentGames.player'))}
        </Text>
        <View style={styles.subline}>
          <FormLine outcomes={entry.last5} size="sm" isDark={isDark} />
          {showStreak && (
            <View
              style={[
                styles.streak,
                {
                  backgroundColor:
                    entry.current_streak > 0
                      ? `${status.success.DEFAULT}22`
                      : `${status.info.DEFAULT}22`,
                },
              ]}
            >
              <Ionicons
                name={entry.current_streak > 0 ? 'flame' : 'snow-outline'}
                size={10}
                color={entry.current_streak > 0 ? status.success.DEFAULT : status.info.DEFAULT}
                style={{ marginRight: 2 }}
              />
              <Text
                size="xs"
                weight="semibold"
                style={{
                  color: entry.current_streak > 0 ? status.success.DEFAULT : status.info.DEFAULT,
                }}
              >
                {entry.current_streak > 0
                  ? t('groups.leaderboard.streakWins', { count: entry.current_streak })
                  : t('groups.leaderboard.streakLosses', { count: -entry.current_streak })}
              </Text>
            </View>
          )}
          {entry.skill_rating && (
            <RatingBadge
              ratingValue={entry.skill_rating.value}
              certificationStatus={entry.skill_rating.certification_status}
              isDark={isDark}
              size="sm"
            />
          )}
        </View>
      </View>

      <Text size="sm" weight="semibold" style={[styles.colNum, { color: colors.text }]}>
        {entry.games_played}
      </Text>
      <Text size="sm" style={[styles.colNum, { color: colors.text }]}>
        {entry.wins}
      </Text>
      <Text size="sm" style={[styles.colNum, { color: colors.textMuted }]}>
        {entry.losses}
      </Text>
      <Text
        size="sm"
        weight={entry.win_rate != null ? 'semibold' : 'regular'}
        style={[
          styles.colWinRate,
          { color: entry.win_rate != null ? colors.text : colors.textMuted },
        ]}
      >
        {winRateText}
      </Text>
    </TouchableOpacity>
  );
}

interface RankPillProps {
  rank: number;
  isDark: boolean;
}

function RankPill({ rank, isDark }: RankPillProps) {
  const { colors } = useThemeStyles();
  if (rank <= 3) {
    const color =
      rank === 1 ? MEDAL_COLORS.gold : rank === 2 ? MEDAL_COLORS.silver : MEDAL_COLORS.bronze;
    return (
      <View style={[styles.pill, { backgroundColor: color }]}>
        <Text size="xs" weight="bold" style={{ color: '#ffffff' }}>
          {rank}
        </Text>
      </View>
    );
  }
  if (rank <= 10) {
    return (
      <View style={[styles.pill, { backgroundColor: isDark ? `${primary[700]}55` : primary[100] }]}>
        <Text size="xs" weight="semibold" style={{ color: isDark ? primary[200] : primary[700] }}>
          {rank}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.pill}>
      <Text size="xs" style={{ color: colors.textMuted }}>
        {rank}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[3],
    gap: spacingPixels[2],
  },
  pill: {
    width: 28,
    height: 24,
    borderRadius: radiusPixels.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  main: {
    flex: 1,
    marginLeft: spacingPixels[1],
  },
  subline: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 4,
    gap: 6,
  },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radiusPixels.full,
  },
  colNum: {
    width: 28,
    textAlign: 'center',
  },
  colWinRate: {
    width: 48,
    textAlign: 'right',
  },
});

export default LeaderboardRow;
