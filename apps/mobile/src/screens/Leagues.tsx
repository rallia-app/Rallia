/**
 * Leagues List — public discovery
 *
 * Shows public leagues for the active sport, mirroring Tournaments discovery:
 * search + filter chips above a list grouped by join mode. Leagues the caller
 * organizes or already belongs to are hidden (those live in MyLeagues).
 *
 * Spec: specs/17-leagues-tournaments/rollout.md §V6
 */

import React, { useMemo, useCallback, useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, accent } from '@rallia/design-system';
import {
  useAuth,
  useDebounce,
  usePublicLeagues,
  useMyLeagues,
  useRatingScoresForSport,
} from '@rallia/shared-hooks';
import type { LeagueListItem } from '@rallia/shared-services';

import {
  LeagueListScaffold,
  type LeagueSection,
} from '../features/leagues/components/LeagueListScaffold';
import {
  LeagueFiltersBar,
  type LeagueJoinModeFilter,
} from '../features/leagues/components/LeagueFiltersBar';
import { SearchBar } from '../features/matches/components';
import { useTournamentListColors } from '../features/tournaments/components/TournamentListScaffold';
import { useTranslation } from '../hooks';
import { useSport } from '../context';
import { lightHaptic } from '../utils/haptics';
import type { RootStackParamList } from '../navigation';

type League = LeagueListItem;

export const Leagues: React.FC = () => {
  const { t } = useTranslation();
  const { selectedSport } = useSport();
  const { session } = useAuth();
  const colors = useTournamentListColors();
  const userId = session?.user?.id;

  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data: leagues = [], isLoading, isError, refetch } = usePublicLeagues(selectedSport?.id);
  const { data: myLeagues = [] } = useMyLeagues(userId, selectedSport?.id);
  const myLeagueIds = useMemo(() => new Set(myLeagues.map(l => l.id)), [myLeagues]);

  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const [joinModeFilter, setJoinModeFilter] = useState<LeagueJoinModeFilter>('all');
  const [myRatingOnly, setMyRatingOnly] = useState(false);

  const { ratingScores, playerRatingScoreId } = useRatingScoresForSport(
    selectedSport?.name,
    selectedSport?.id,
    userId
  );
  const playerRatingValue = useMemo(() => {
    if (!playerRatingScoreId) return null;
    return ratingScores.find(rs => rs.id === playerRatingScoreId)?.value ?? null;
  }, [ratingScores, playerRatingScoreId]);
  const ratingFilterValue = myRatingOnly ? playerRatingValue : null;

  const hasActiveFilters = joinModeFilter !== 'all' || (myRatingOnly && playerRatingValue != null);
  const isFilteredView = hasActiveFilters || debouncedSearchQuery.length > 0;

  const sections = useMemo<LeagueSection[]>(() => {
    const query = debouncedSearchQuery.trim().toLowerCase();
    const visible = leagues.filter(league => {
      if (userId && league.organizer_id === userId) return false;
      if (myLeagueIds.has(league.id)) return false;
      if (joinModeFilter !== 'all' && league.join_mode !== joinModeFilter) return false;
      if (
        ratingFilterValue != null &&
        ((league.min_rating != null && ratingFilterValue < Number(league.min_rating)) ||
          (league.max_rating != null && ratingFilterValue > Number(league.max_rating)))
      )
        return false;
      if (
        query &&
        !league.name.toLowerCase().includes(query) &&
        !(league.venue_name ?? '').toLowerCase().includes(query)
      )
        return false;
      return true;
    });

    const openJoin: League[] = [];
    const approval: League[] = [];
    const inviteOnly: League[] = [];
    for (const league of visible) {
      if (league.join_mode === 'open') openJoin.push(league);
      else if (league.join_mode === 'approval') approval.push(league);
      else inviteOnly.push(league);
    }

    const sortByMembers = (a: League, b: League) => b.member_count - a.member_count;
    openJoin.sort(sortByMembers);
    approval.sort(sortByMembers);
    inviteOnly.sort(sortByMembers);

    const out: LeagueSection[] = [];
    if (openJoin.length) out.push({ titleKey: 'leagueList.sectionOpenJoin', items: openJoin });
    if (approval.length) out.push({ titleKey: 'leagueList.sectionApproval', items: approval });
    if (inviteOnly.length)
      out.push({ titleKey: 'leagueList.sectionInviteOnly', items: inviteOnly });
    return out;
  }, [leagues, userId, myLeagueIds, debouncedSearchQuery, joinModeFilter, ratingFilterValue]);

  const handlePress = useCallback(
    (league: League) => {
      navigation.navigate('LeagueDetail', { leagueId: league.id, leagueName: league.name });
    },
    [navigation]
  );

  const header = (
    <View style={styles.headerContainer}>
      <TouchableOpacity
        onPress={() => {
          void lightHaptic();
          navigation.navigate('MyLeagues');
        }}
        activeOpacity={0.85}
        style={styles.myLeaguesButton}
      >
        <View style={styles.myLeaguesIcon}>
          <Ionicons name="ribbon-outline" size={24} color="#ffffff" />
        </View>
        <Text size="base" weight="semibold" color="#ffffff" style={styles.myLeaguesLabel}>
          {t('leagueList.myLeagues')}
        </Text>
      </TouchableOpacity>

      <View style={styles.searchRow}>
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t('leagueList.searchPlaceholder')}
          onClear={() => setSearchQuery('')}
        />
      </View>

      <LeagueFiltersBar
        joinMode={joinModeFilter}
        myRatingOnly={myRatingOnly}
        showMyRatingFilter={playerRatingValue != null}
        onJoinModeChange={setJoinModeFilter}
        onMyRatingChange={setMyRatingOnly}
        onReset={() => {
          setJoinModeFilter('all');
          setMyRatingOnly(false);
        }}
        hasActiveFilters={hasActiveFilters}
      />
    </View>
  );

  return (
    <LeagueListScaffold
      sections={sections}
      isLoading={isLoading}
      isError={isError}
      refetch={refetch}
      emptyIcon={isFilteredView ? 'filter-outline' : 'ribbon-outline'}
      emptyTitleKey={isFilteredView ? 'leagueList.emptySearch.title' : 'leagueList.empty'}
      emptyDescriptionKey={
        isFilteredView ? 'leagueList.emptySearch.description' : 'leagueList.emptyDescription'
      }
      header={header}
      currentUserId={userId}
      onPressLeague={handlePress}
    />
  );
};

const styles = StyleSheet.create({
  headerContainer: {
    paddingTop: spacingPixels[5],
  },
  myLeaguesButton: {
    flexDirection: 'row',
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[4],
    borderRadius: radiusPixels.xl,
    borderWidth: 1.5,
    borderColor: accent[500],
    backgroundColor: accent[400],
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[3],
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
  },
  myLeaguesIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  myLeaguesLabel: {
    textAlign: 'center',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[2],
    gap: spacingPixels[2],
  },
});

export default Leagues;
