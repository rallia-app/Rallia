/**
 * Monthly Challenge — GMA per-sport participation rankings
 *
 * Participation-based rankings (games played) over the canonical
 * qualifying_played_game definition. Standalone board shown to non-admins
 * while the Circuit Rallia / Classements hub stays admin-gated.
 */

import React, { useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Image,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, shadowsNative } from '@rallia/design-system';
import {
  useAuth,
  useSportLeaderboard,
  useMySportRank,
  type SportLeaderboardEntry,
} from '@rallia/shared-hooks';

import { useTranslation, useThemeStyles } from '../hooks';
import { useSport } from '../context';
import type { RootStackParamList } from '../navigation';

function RankBadge({
  rank,
  isDark,
  mutedColor,
}: {
  rank: number;
  isDark: boolean;
  mutedColor: string;
}) {
  if (rank <= 10) {
    return (
      <View
        style={[styles.rankBadge, { backgroundColor: isDark ? `${primary[700]}55` : primary[100] }]}
      >
        <Text size="sm" weight="semibold" color={isDark ? primary[200] : primary[700]}>
          {rank}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.rankBadge}>
      <Text size="sm" weight="medium" color={mutedColor}>
        {rank}
      </Text>
    </View>
  );
}

export const MonthlyChallengeBoard: React.FC = () => {
  const { t, locale } = useTranslation();
  const { colors, isDark } = useThemeStyles();
  const { session } = useAuth();
  const { selectedSport } = useSport();
  const userId = session?.user?.id;
  const sportId = selectedSport?.id;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const { items, isLoading, isError, isRefetching, isFetchingNextPage, fetchNextPage, refetch } =
    useSportLeaderboard(sportId);
  const { data: myRank } = useMySportRank(sportId);

  const accentColor = isDark ? primary[300] : primary[600];
  const sportLabel = selectedSport?.name
    ? selectedSport.name.charAt(0).toUpperCase() + selectedSport.name.slice(1)
    : '';
  const monthLabel = useMemo(
    () => new Date().toLocaleDateString(locale, { month: 'long', year: 'numeric' }),
    [locale]
  );

  const renderItem = ({ item }: { item: SportLeaderboardEntry }) => {
    const isMe = item.playerId === userId;
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => navigation.navigate('PlayerProfile', { playerId: item.playerId })}
        style={[
          styles.row,
          { backgroundColor: colors.card, borderColor: colors.border },
          isMe
            ? {
                backgroundColor: isDark ? `${primary[700]}33` : primary[50],
                borderColor: primary[400],
              }
            : null,
        ]}
      >
        <RankBadge rank={item.rank} isDark={isDark} mutedColor={colors.textMuted} />

        {item.avatarUrl ? (
          <Image source={{ uri: item.avatarUrl }} style={styles.avatar} />
        ) : (
          <View
            style={[
              styles.avatar,
              styles.avatarFallback,
              { backgroundColor: isDark ? colors.input : colors.border },
            ]}
          >
            <Ionicons name="person" size={18} color={colors.textMuted} />
          </View>
        )}

        <View style={styles.nameCol}>
          <Text size="base" weight="semibold" color={colors.text} numberOfLines={1}>
            {item.displayName}
            {isMe ? ` ${t('leaderboard.youSuffix')}` : ''}
          </Text>
        </View>

        <View style={styles.gamesCol}>
          <Text size="xl" weight="bold" color={accentColor}>
            {item.games}
          </Text>
          <Text size="xs" color={colors.textMuted} style={styles.gamesLabel}>
            {t('leaderboard.games')}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const header = (
    <View style={styles.header}>
      <Text size="sm" weight="semibold" color={accentColor}>
        {t('leaderboard.subtitle', { month: monthLabel, sport: sportLabel })}
      </Text>
      <Text size="xs" color={colors.textMuted} style={styles.note}>
        {t('leaderboard.pointsNote')}
      </Text>

      {myRank ? (
        <View
          style={[
            styles.yourCard,
            {
              backgroundColor: isDark ? `${primary[700]}33` : primary[50],
              borderColor: isDark ? primary[700] : primary[200],
            },
          ]}
        >
          <View style={styles.yourBadge}>
            <Text size="base" weight="bold" color="#ffffff">
              {`#${myRank.rank}`}
            </Text>
          </View>
          <View style={styles.yourTextCol}>
            <Text size="base" weight="bold" color={colors.text}>
              {t('leaderboard.yourRank', { rank: myRank.rank })}
            </Text>
            <Text size="sm" color={colors.textMuted}>
              {t('leaderboard.gamesPlayed', { count: myRank.games })}
            </Text>
          </View>
          <View style={styles.gamesCol}>
            <Text size="xl" weight="bold" color={accentColor}>
              {myRank.games}
            </Text>
            <Text size="xs" color={colors.textMuted} style={styles.gamesLabel}>
              {t('leaderboard.games')}
            </Text>
          </View>
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
          {t('leaderboard.error')}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.listContent}
      data={items}
      keyExtractor={e => e.playerId}
      renderItem={renderItem}
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
        <View style={styles.center}>
          <Ionicons name="trophy-outline" size={40} color={colors.textMuted} />
          <Text size="base" weight="semibold" color={colors.text}>
            {t('leaderboard.empty.title')}
          </Text>
          <Text size="sm" color={colors.textMuted} style={styles.centerText}>
            {t('leaderboard.empty.description')}
          </Text>
        </View>
      }
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={accentColor} />
      }
    />
  );
};

const styles = StyleSheet.create({
  listContent: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[8],
  },
  header: {
    gap: spacingPixels[1],
    marginBottom: spacingPixels[3],
  },
  note: {
    lineHeight: 17,
    marginBottom: spacingPixels[1],
  },
  yourCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    padding: spacingPixels[3],
    borderRadius: radiusPixels.xl,
    borderWidth: 1.5,
    marginTop: spacingPixels[2],
    ...shadowsNative.sm,
  },
  yourBadge: {
    minWidth: 46,
    height: 46,
    paddingHorizontal: spacingPixels[2],
    borderRadius: radiusPixels.lg,
    backgroundColor: primary[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
  yourTextCol: {
    flex: 1,
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginBottom: spacingPixels[2],
    ...shadowsNative.sm,
  },
  rankBadge: {
    width: 30,
    height: 26,
    borderRadius: radiusPixels.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radiusPixels.full,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameCol: {
    flex: 1,
    gap: 2,
  },
  gamesCol: {
    alignItems: 'flex-end',
    minWidth: 46,
  },
  gamesLabel: {
    marginTop: -2,
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

export default MonthlyChallengeBoard;
