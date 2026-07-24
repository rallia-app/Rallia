/**
 * My Leagues — leagues the user organizes or belongs to (V6).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text } from '@rallia/shared-components';
import { spacingPixels } from '@rallia/design-system';
import { useAuth, useMyLeagues } from '@rallia/shared-hooks';
import type { LeagueListItem } from '@rallia/shared-services';

import { LeagueCard, LeagueCardSkeleton } from '../features/leagues/components/LeagueListScaffold';
import { useTournamentListColors } from '../features/tournaments/components/TournamentListScaffold';
import { useTranslation } from '../hooks';
import { useSport } from '../context';
import { lightHaptic } from '../utils/haptics';
import type { RootStackParamList } from '../navigation';

export const MyLeagues: React.FC = () => {
  const { t } = useTranslation();
  const { selectedSport } = useSport();
  const { session } = useAuth();
  const userId = session?.user?.id;
  const colors = useTournamentListColors();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const {
    data: leagues = [],
    isLoading,
    isRefetching,
    refetch,
  } = useMyLeagues(userId, selectedSport?.id);
  const isManualRefresh = useRef(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  useEffect(() => {
    if (isInitialLoad && !isLoading) queueMicrotask(() => setIsInitialLoad(false));
  }, [isInitialLoad, isLoading]);

  const handlePress = useCallback(
    (league: LeagueListItem) => {
      lightHaptic();
      navigation.navigate('LeagueDetail', { leagueId: league.id, leagueName: league.name });
    },
    [navigation]
  );

  const empty = (
    <View style={styles.empty}>
      <Ionicons name="ribbon-outline" size={48} color={colors.textMuted} />
      <Text size="base" weight="semibold" color={colors.text} style={styles.emptyTitle}>
        {t('leagueList.emptyMy.title')}
      </Text>
      <Text size="sm" color={colors.textMuted} style={styles.emptyDescription}>
        {t('leagueList.emptyMy.description')}
      </Text>
    </View>
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['bottom']}
    >
      {isInitialLoad && isLoading ? (
        <View style={styles.loadingContainer}>
          {[1, 2, 3, 4, 5].map(i => (
            <LeagueCardSkeleton key={i} />
          ))}
        </View>
      ) : (
        <FlatList
          data={leagues}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <LeagueCard
              league={item}
              colors={colors}
              t={t}
              isOrganizer={item.organizer_id === userId}
              onPress={() => handlePress(item)}
            />
          )}
          contentContainerStyle={[
            styles.listContent,
            leagues.length === 0 && styles.emptyListContent,
          ]}
          ListEmptyComponent={empty}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching && isManualRefresh.current}
              onRefresh={() => {
                isManualRefresh.current = true;
                void refetch().finally(() => {
                  isManualRefresh.current = false;
                });
              }}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: {
    flex: 1,
    paddingTop: spacingPixels[5],
  },
  listContent: {
    paddingTop: spacingPixels[5],
    paddingBottom: spacingPixels[5],
    flexGrow: 1,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: '100%',
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[8],
  },
  emptyTitle: { marginTop: spacingPixels[3], textAlign: 'center' },
  emptyDescription: { marginTop: spacingPixels[2], textAlign: 'center' },
});

export default MyLeagues;
