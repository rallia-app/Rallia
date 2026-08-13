/**
 * Monthly Challenge — GMA per-sport participation rankings
 *
 * Participation-based rankings (games played) over the canonical
 * qualifying_played_game definition. Hosted as the "Défi du mois" tab of
 * Classements; shares its visual kit with the Points Rallia board.
 */

import React, { useCallback, useMemo } from 'react';
import { View, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text } from '@rallia/shared-components';
import { spacingPixels, primary } from '@rallia/design-system';
import {
  useAuth,
  useSportLeaderboard,
  useMySportRank,
  type SportLeaderboardEntry,
} from '@rallia/shared-hooks';

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

export const Leaderboard: React.FC = () => {
  const { t, locale } = useTranslation();
  const { colors, isDark } = useThemeStyles();
  const bottomInset = useScrollBottomInset();
  const { session } = useAuth();
  const { selectedSport } = useSport();
  const userId = session?.user?.id;
  const sportId = selectedSport?.id;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { guardAction } = useRequireOnboarding();

  const { items, isLoading, isError, isRefetching, isFetchingNextPage, fetchNextPage, refetch } =
    useSportLeaderboard(sportId);
  const { data: myRank } = useMySportRank(sportId);

  const accentColor = isDark ? primary[300] : primary[600];
  const monthLabel = useMemo(() => {
    const label = new Date().toLocaleDateString(locale, { month: 'long', year: 'numeric' });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }, [locale]);

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

  const toEntry = useCallback(
    (item: SportLeaderboardEntry): BoardEntry => ({
      id: item.playerId,
      rank: item.rank,
      name:
        item.playerId === userId
          ? `${item.displayName} ${t('leaderboard.youSuffix')}`
          : item.displayName,
      avatarUrl: item.avatarUrl,
      value: item.games,
      isMe: item.playerId === userId,
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
        icon="calendar"
        title={t('leaderboard.title')}
        subtitle={t('leaderboard.subtitle', { month: monthLabel })}
        note={t('leaderboard.pointsNote')}
        theme={theme}
      />

      {myRank ? (
        <MyStandingCard
          rank={myRank.rank}
          title={t('leaderboard.yourRank', { rank: myRank.rank })}
          subtitle={t('leaderboard.gamesPlayed', { count: myRank.games })}
          value={myRank.games}
          valueLabel={t('leaderboard.games')}
        />
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
          {t('leaderboard.error')}
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
      keyExtractor={e => e.playerId}
      renderItem={({ item }) => (
        <BoardRow
          entry={toEntry(item)}
          valueLabel={t('leaderboard.games')}
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
          icon="calendar-outline"
          title={t('leaderboard.empty.title')}
          description={t('leaderboard.empty.description')}
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
    padding: spacingPixels[4],
    flexGrow: 1,
  },
  header: {
    gap: spacingPixels[1],
    marginBottom: spacingPixels[2],
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

export default Leaderboard;
