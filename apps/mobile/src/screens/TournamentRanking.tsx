/**
 * Circuit Rallia — season-based tournament ranking board
 *
 * Points Rallia earned by entering and advancing in tournaments, per sport,
 * over the current ranking season. Separate currency from the monthly
 * challenge (see Leaderboard). Follows the global selected sport. Two
 * mutually exclusive filter chips, both resolved off the player's CURRENT
 * active rating so they share one axis (exact rating ⊆ level): "my level"
 * (beg/int/adv bucket) and "my rating" (the exact rating_score, by id).
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SheetManager } from 'react-native-actions-sheet';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SelectableChip, Text } from '@rallia/shared-components';
import { base, spacingPixels, primary, shadowsNative } from '@rallia/design-system';
import {
  useAuth,
  useTournamentRanking,
  useMyTournamentRanking,
  useMyPointsToDefend,
  useRatingScoresForSport,
  type TournamentRankingEntry,
  type RankingBoard,
} from '@rallia/shared-hooks';

import { lightHaptic } from '#/utils/haptics';

import {
  useTranslation,
  useThemeStyles,
  useScrollBottomInset,
  useRequireOnboarding,
} from '../hooks';
import { useSport } from '../context';
import type { RootStackParamList } from '../navigation';
import {
  BoardRow,
  MyStandingCard,
  BoardHeader,
  BoardEmptyState,
  type BoardEntry,
  type ThemeBits,
} from '../components/classements/BoardKit';
import { PointsToDefendCard } from '../components/classements/PointsToDefendCard';

export const TournamentRanking: React.FC = () => {
  const { t } = useTranslation();
  const { colors, isDark } = useThemeStyles();
  const bottomInset = useScrollBottomInset();
  const { session } = useAuth();
  const { selectedSport } = useSport();
  const userId = session?.user?.id;
  const sportId = selectedSport?.id;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { guardAction } = useRequireOnboarding();

  // Doubles ranks on its own board, so the two never mix in one list.
  const [board, setBoard] = useState<RankingBoard>('singles');

  const { data: myRank } = useMyTournamentRanking(sportId, undefined, board);
  const { items: toDefend, pointsAtStake } = useMyPointsToDefend(sportId);

  // Caller's exact active rating (by rating_score id — the canonical compare).
  const { ratingScores, playerRatingScoreId } = useRatingScoresForSport(
    selectedSport?.name,
    sportId,
    userId
  );
  const myRatingValue = useMemo(() => {
    if (!playerRatingScoreId) return null;
    return ratingScores.find(rs => rs.id === playerRatingScoreId)?.value ?? null;
  }, [ratingScores, playerRatingScoreId]);

  // Mutually exclusive board filters, both off the current active rating:
  // level bucket (beg/int/adv) vs exact rating (4.0, 4.5…).
  const [filterMode, setFilterMode] = useState<'none' | 'level' | 'rating'>('none');
  const levelFilter =
    filterMode === 'level' && myRank?.levelBucket ? myRank.levelBucket : undefined;
  const ratingFilter =
    filterMode === 'rating' && playerRatingScoreId ? playerRatingScoreId : undefined;

  const { items, isLoading, isError, isRefetching, isFetchingNextPage, fetchNextPage, refetch } =
    useTournamentRanking(sportId, undefined, levelFilter, ratingFilter, board);

  const accentColor = isDark ? primary[300] : primary[600];
  // primary[300] is pale enough that white text on it fails contrast, so the
  // selected label goes near-black in dark mode instead.
  const selectedLabel = isDark ? primary[950] : base.white;

  const theme: ThemeBits = useMemo(
    () => ({
      isDark,
      cardColor: colors.card,
      borderColor: colors.border,
      textColor: colors.text,
      mutedColor: colors.textMuted,
      inputColor: colors.input,
    }),
    [isDark, colors]
  );

  const defendItems = useMemo(
    () =>
      toDefend.map(row => ({
        id: row.ledgerId,
        name: row.tournamentName,
        points: row.points,
        daysRemaining: row.daysRemaining,
      })),
    [toDefend]
  );

  const toEntry = useCallback(
    (item: TournamentRankingEntry): BoardEntry => ({
      id: item.userId,
      rank: item.rank,
      name:
        item.userId === userId
          ? `${item.fullName} ${t('tournamentRanking.youSuffix')}`
          : item.fullName,
      avatarUrl: item.avatarUrl,
      value: item.points,
      subtitle: t('tournamentRanking.events', { count: item.eventsPlayed }),
      isMe: item.userId === userId,
    }),
    [userId, t]
  );

  // The board reads for everyone; opening a player stays behind the guard the
  // player directory uses.
  const openProfile = useCallback(
    (entry: BoardEntry) => {
      if (!guardAction()) return;
      navigation.navigate('PlayerProfile', { playerId: entry.id });
    },
    [navigation, guardAction]
  );

  const header = (
    <View style={styles.header}>
      <BoardHeader
        icon="trophy"
        title={t('tournamentRanking.title')}
        subtitle={t('tournamentRanking.subtitle')}
        note={t('tournamentRanking.pointsNote')}
        noteCtaLabel={t('tournamentRanking.howItWorks')}
        onNotePress={() => {
          void lightHaptic();
          void SheetManager.show('circuit-ranking-explainer');
        }}
        theme={theme}
      />

      {myRank ? (
        <MyStandingCard
          rank={myRank.rank}
          title={t('tournamentRanking.yourRank', { rank: myRank.rank })}
          subtitle={t('tournamentRanking.events', { count: myRank.eventsPlayed })}
          value={myRank.points}
          valueLabel={t('tournamentRanking.points')}
        />
      ) : null}

      <PointsToDefendCard
        items={defendItems}
        pointsAtStake={pointsAtStake}
        title={t('tournamentRanking.pointsToDefend.title')}
        note={t('tournamentRanking.pointsToDefend.note')}
        valueLabel={t('tournamentRanking.pointsToDefend.atStake')}
        formatDays={days => t('tournamentRanking.pointsToDefend.inDays', { count: days })}
        formatMore={count => t('tournamentRanking.pointsToDefend.more', { count })}
        theme={theme}
      />

      <View style={styles.filterRow}>
        <SelectableChip
          label={t('tournamentRanking.boards.singles')}
          selected={board === 'singles'}
          accentColor={accentColor}
          selectedLabelColor={selectedLabel}
          style={styles.filterChip}
          icon={
            <Ionicons
              name={board === 'singles' ? 'checkmark' : 'person-outline'}
              size={14}
              color={board === 'singles' ? selectedLabel : colors.textMuted}
            />
          }
          onPress={() => {
            void lightHaptic();
            setBoard('singles');
          }}
        />
        <SelectableChip
          label={t('tournamentRanking.boards.doubles')}
          selected={board === 'doubles'}
          accentColor={accentColor}
          selectedLabelColor={selectedLabel}
          style={styles.filterChip}
          icon={
            <Ionicons
              name={board === 'doubles' ? 'checkmark' : 'people-outline'}
              size={14}
              color={board === 'doubles' ? selectedLabel : colors.textMuted}
            />
          }
          onPress={() => {
            void lightHaptic();
            setBoard('doubles');
          }}
        />
      </View>

      {myRank && (myRank.levelBucket || myRatingValue != null) ? (
        <View style={styles.filterRow}>
          {myRank?.levelBucket ? (
            <SelectableChip
              label={t('tournamentRanking.filterMyLevel', {
                level: t(`tournamentRanking.levels.${myRank.levelBucket}`),
              })}
              selected={filterMode === 'level'}
              accentColor={accentColor}
              selectedLabelColor={selectedLabel}
              style={styles.filterChip}
              icon={
                <Ionicons
                  name={filterMode === 'level' ? 'checkmark' : 'layers-outline'}
                  size={14}
                  color={filterMode === 'level' ? selectedLabel : colors.textMuted}
                />
              }
              onPress={() => {
                void lightHaptic();
                setFilterMode(m => (m === 'level' ? 'none' : 'level'));
              }}
            />
          ) : null}
          {myRatingValue != null ? (
            <SelectableChip
              label={t('tournamentRanking.filterMyRating', {
                rating: Number(myRatingValue).toFixed(1),
              })}
              selected={filterMode === 'rating'}
              accentColor={accentColor}
              selectedLabelColor={selectedLabel}
              style={styles.filterChip}
              icon={
                <Ionicons
                  name={filterMode === 'rating' ? 'checkmark' : 'speedometer-outline'}
                  size={14}
                  color={filterMode === 'rating' ? selectedLabel : colors.textMuted}
                />
              }
              onPress={() => {
                void lightHaptic();
                setFilterMode(m => (m === 'rating' ? 'none' : 'rating'));
              }}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );

  if (!sportId || isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={accentColor} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
        <Text size="base" color={colors.textMuted} style={styles.centerText}>
          {t('tournamentRanking.error')}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      // Bottom inset lives here, not on the Classements wrapper, so the list
      // scrolls under the home indicator instead of stopping above it.
      contentContainerStyle={[styles.listContent, { paddingBottom: bottomInset }]}
      data={items}
      keyExtractor={e => e.userId}
      renderItem={({ item }) => (
        <BoardRow
          entry={toEntry(item)}
          valueLabel={t('tournamentRanking.points')}
          theme={theme}
          onPress={openProfile}
        />
      )}
      ListHeaderComponent={header}
      showsVerticalScrollIndicator={false}
      onEndReached={() => fetchNextPage()}
      onEndReachedThreshold={0.5}
      ListFooterComponent={
        isFetchingNextPage ? (
          <View style={styles.footer}>
            <ActivityIndicator size="small" color={accentColor} />
          </View>
        ) : null
      }
      ListEmptyComponent={
        <BoardEmptyState
          icon="trophy-outline"
          title={t('tournamentRanking.empty.title')}
          description={t('tournamentRanking.empty.description')}
          theme={theme}
        />
      }
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={() => void refetch()}
          tintColor={accentColor}
        />
      }
    />
  );
};

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: spacingPixels[4],
    // 8 here + the tab bar's 4 = the same 12 below the tabs as the Events tab.
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[4],
    flexGrow: 1,
  },
  header: {
    gap: spacingPixels[1],
    marginBottom: spacingPixels[2],
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacingPixels[2],
    marginTop: spacingPixels[2],
    marginBottom: spacingPixels[2],
  },
  filterChip: {
    // Boards share the row evenly, and the pill is raised off the page.
    flex: 1,
    justifyContent: 'center',
    ...shadowsNative.sm,
  },
  footer: {
    paddingVertical: spacingPixels[4],
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[6],
    gap: spacingPixels[2],
  },
  centerText: {
    textAlign: 'center',
  },
});

export default TournamentRanking;
