/**
 * CompeteList
 *
 * The COMPETE lane: header + sort lens chips + ranked rows + settling-in
 * footer. Sort logic happens client-side over the entries the RPC returns.
 */

import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { neutral, primary, radiusPixels, spacingPixels } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';
import type { NetworkPulseLeaderboardEntry } from '@rallia/shared-hooks';

import { useThemeStyles, useTranslation } from '../../../../hooks';
import type { TranslationKey } from '../../../../hooks';

import { LeaderboardRow } from './LeaderboardRow';

type SortLens = 'active' | 'winrate' | 'streak' | 'form';

const LENSES: ReadonlyArray<{
  value: SortLens;
  tk: TranslationKey;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { value: 'active', tk: 'groups.leaderboard.sortMostActive', icon: 'pulse-outline' },
  { value: 'winrate', tk: 'groups.leaderboard.sortWinRate', icon: 'trending-up-outline' },
  { value: 'streak', tk: 'groups.leaderboard.sortStreak', icon: 'flame-outline' },
  { value: 'form', tk: 'groups.leaderboard.sortForm', icon: 'flash-outline' },
];

interface CompeteListProps {
  entries: NetworkPulseLeaderboardEntry[];
  settlingInCount: number;
  currentPlayerId?: string;
  networkType: 'group' | 'community';
  onRowPress: (entry: NetworkPulseLeaderboardEntry) => void;
  onSettlingPress?: () => void;
}

export function CompeteList({
  entries,
  settlingInCount,
  currentPlayerId,
  networkType,
  onRowPress,
  onSettlingPress,
}: CompeteListProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();

  const defaultLens: SortLens = networkType === 'community' ? 'streak' : 'active';
  const [lens, setLens] = useState<SortLens>(defaultLens);

  const sorted = useMemo(() => sortEntries(entries, lens), [entries, lens]);

  const headerCopy = t(
    networkType === 'community'
      ? 'groups.leaderboard.compete.communityHeader'
      : 'groups.leaderboard.compete.groupHeader'
  );

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text size="lg" weight="bold" style={{ color: colors.text }}>
          {headerCopy}
        </Text>
      </View>

      {/* Sort lens chips (horizontally scrollable for long FR labels). */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.lensRow}
      >
        {LENSES.map((opt, idx) => {
          const selected = lens === opt.value;
          const bg = selected ? primary[500] : isDark ? neutral[800] : neutral[100];
          const fg = selected ? '#ffffff' : isDark ? neutral[300] : neutral[600];
          const border = selected ? primary[400] : isDark ? neutral[700] : neutral[200];
          return (
            <Chip
              key={opt.value}
              label={t(opt.tk)}
              icon={opt.icon}
              bg={bg}
              fg={fg}
              border={border}
              isFirst={idx === 0}
              onPress={() => {
                if (selected) return;
                void lightHaptic();
                setLens(opt.value);
              }}
            />
          );
        })}
      </ScrollView>

      {/* List */}
      <View
        style={[
          styles.listCard,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
      >
        {sorted.length === 0 && (
          <View style={styles.empty}>
            <Text size="sm" style={{ color: colors.textMuted, textAlign: 'center' }}>
              {t('groups.leaderboard.noActivity')}
            </Text>
          </View>
        )}
        {sorted.map((entry, idx) => (
          <LeaderboardRow
            key={entry.player_id}
            entry={entry}
            rank={idx + 1}
            isLast={idx === sorted.length - 1}
            isCurrentUser={entry.player_id === currentPlayerId}
            onPress={() => onRowPress(entry)}
          />
        ))}
        {settlingInCount > 0 && (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={onSettlingPress}
            style={[
              styles.settlingFooter,
              {
                borderTopColor: colors.border,
                backgroundColor: isDark ? neutral[900] : neutral[50],
              },
            ]}
          >
            <Ionicons name="people-outline" size={14} color={colors.textMuted} />
            <Text size="xs" style={{ color: colors.textMuted, marginLeft: 6, flex: 1 }}>
              {settlingInCount === 1
                ? t('groups.leaderboard.compete.settlingInFooterOne', { count: 1 })
                : t('groups.leaderboard.compete.settlingInFooter', { count: settlingInCount })}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

interface ChipProps {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  bg: string;
  fg: string;
  border: string;
  isFirst: boolean;
  onPress: () => void;
}

function Chip({ label, icon, bg, fg, border, isFirst, onPress }: ChipProps) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      style={[
        styles.chip,
        { backgroundColor: bg, borderColor: border },
        !isFirst && { marginLeft: spacingPixels[2] },
      ]}
    >
      <Ionicons name={icon} size={14} color={fg} style={{ marginRight: 6 }} />
      <Text size="xs" weight="semibold" style={{ color: fg }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function sortEntries(
  entries: NetworkPulseLeaderboardEntry[],
  lens: SortLens
): NetworkPulseLeaderboardEntry[] {
  const arr = [...entries];
  if (lens === 'active') {
    arr.sort(
      (a, b) =>
        b.games_played - a.games_played ||
        (b.last_match_date ?? '').localeCompare(a.last_match_date ?? '')
    );
  } else if (lens === 'winrate') {
    arr.sort((a, b) => {
      const aRanked = a.win_rate != null;
      const bRanked = b.win_rate != null;
      if (aRanked && !bRanked) return -1;
      if (!aRanked && bRanked) return 1;
      if (aRanked && bRanked) {
        const diff = (b.win_rate ?? 0) - (a.win_rate ?? 0);
        if (diff !== 0) return diff;
      }
      return b.games_played - a.games_played;
    });
  } else if (lens === 'streak') {
    arr.sort(
      (a, b) =>
        b.current_streak - a.current_streak ||
        (b.last_match_date ?? '').localeCompare(a.last_match_date ?? '')
    );
  } else {
    // form: count W's in last5
    const wins = (xs: NetworkPulseLeaderboardEntry) => xs.last5.filter(o => o === 'W').length;
    arr.sort(
      (a, b) =>
        wins(b) - wins(a) || (b.last_match_date ?? '').localeCompare(a.last_match_date ?? '')
    );
  }
  return arr;
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacingPixels[5],
  },
  sectionHeader: {
    marginBottom: spacingPixels[3],
  },
  lensRow: {
    paddingVertical: spacingPixels[1],
    marginBottom: spacingPixels[3],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  listCard: {
    borderRadius: radiusPixels.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  empty: {
    paddingVertical: spacingPixels[6],
    paddingHorizontal: spacingPixels[4],
  },
  settlingFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

export default CompeteList;
