/**
 * My Leagues — leagues the user organizes or belongs to (V6).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text } from '@rallia/shared-components';
import { spacingPixels, lightTheme, darkTheme } from '@rallia/design-system';
import { useAuth, useMyLeagues } from '@rallia/shared-hooks';
import type { LeagueListItem } from '@rallia/shared-services';

import { LeagueCard, LeagueCardSkeleton } from '../features/leagues/components/LeagueListScaffold';
import { useTournamentListColors } from '../features/tournaments/components/TournamentListScaffold';
import { useTranslation, useScrollBottomInset, useThemeStyles } from '../hooks';
import { useSport } from '../context';
import { lightHaptic } from '../utils/haptics';
import type { RootStackParamList } from '../navigation';

type LeagueTab = 'active' | 'closed';

export const MyLeagues: React.FC = () => {
  const { t } = useTranslation();
  const { isDark } = useThemeStyles();
  const { selectedSport } = useSport();
  const { session } = useAuth();
  const userId = session?.user?.id;
  const colors = useTournamentListColors();
  const bottomInset = useScrollBottomInset();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const {
    data: leagues = [],
    isLoading,
    isRefetching,
    refetch,
  } = useMyLeagues(userId, selectedSport?.id);
  const isManualRefresh = useRef(false);
  const [activeTab, setActiveTab] = useState<LeagueTab>('active');

  // listMyLeagues now returns closed leagues too, so a member keeps their
  // history instead of the league vanishing from every list. Split here rather
  // than filtering server-side, so switching tabs costs no request.
  const visibleLeagues = useMemo(
    () =>
      leagues.filter(l => (activeTab === 'closed' ? l.status === 'closed' : l.status !== 'closed')),
    [leagues, activeTab]
  );
  const closedCount = useMemo(() => leagues.filter(l => l.status === 'closed').length, [leagues]);
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

  const renderTab = (tab: LeagueTab, icon: keyof typeof Ionicons.glyphMap, label: string) => {
    const isActive = activeTab === tab;
    return (
      <TouchableOpacity
        style={[
          styles.tab,
          isActive && [
            styles.activeTab,
            { backgroundColor: isDark ? darkTheme.card : lightTheme.card },
          ],
        ]}
        onPress={() => {
          if (tab !== activeTab) {
            void lightHaptic();
            setActiveTab(tab);
          }
        }}
        activeOpacity={0.8}
        testID={`my-leagues-tab-${tab}`}
      >
        <Ionicons name={icon} size={18} color={isActive ? colors.primary : colors.textMuted} />
        <Text
          size="sm"
          weight={isActive ? 'semibold' : 'medium'}
          style={{ color: isActive ? colors.primary : colors.textMuted, marginLeft: 6 }}
        >
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

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

  // Bottom inset goes in the list's contentContainerStyle, not on the wrapper,
  // so the list scrolls under the home indicator instead of stopping above it.
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      {isInitialLoad && isLoading ? (
        <View style={styles.loadingContainer}>
          {[1, 2, 3, 4, 5].map(i => (
            <LeagueCardSkeleton key={i} />
          ))}
        </View>
      ) : (
        <>
          {closedCount > 0 ? (
            <View style={[styles.tabBar, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}>
              {renderTab('active', 'ribbon-outline', t('leagueList.tabs.active'))}
              {renderTab('closed', 'archive-outline', t('leagueList.tabs.closed'))}
            </View>
          ) : null}
          <FlatList
            data={visibleLeagues}
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
              { paddingBottom: bottomInset },
              visibleLeagues.length === 0 && styles.emptyListContent,
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
        </>
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
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: spacingPixels[5],
    marginBottom: 12,
    borderRadius: 12,
    padding: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
  },
  activeTab: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  emptyTitle: { marginTop: spacingPixels[3], textAlign: 'center' },
  emptyDescription: { marginTop: spacingPixels[2], textAlign: 'center' },
});

export default MyLeagues;
