/**
 * Tournaments List — public discovery
 *
 * Shows upcoming/live public tournaments for the active sport, mirroring
 * the PublicMatches UX: fixed search bar + filter chips (status, entry
 * format, open spots) above a list grouped by actionability — Open for
 * registration (soonest-closing deadline first), In progress, Starting
 * soon. Completed, cancelled, self-organized and already-registered
 * tournaments never surface here (those live in MyTournaments, like
 * PublicMatches hiding own matches). Reached from the Home quick-nav FAB
 * row. Tap a row →
 * TournamentDetail. The top button leads to MyTournaments.
 *
 * Spec: specs/17-leagues-tournaments/rollout.md §V2 (discovery slice)
 */

import React, { useMemo, useCallback, useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary } from '@rallia/design-system';
import {
  useTheme,
  useAuth,
  useDebounce,
  usePublicTournaments,
  useMyActiveRegistrations,
  useRatingScoresForSport,
} from '@rallia/shared-hooks';
import type { TournamentListItem } from '@rallia/shared-services';

import {
  TournamentListScaffold,
  useTournamentListColors,
  type TournamentSection,
} from '../features/tournaments/components/TournamentListScaffold';
import {
  TournamentFiltersBar,
  type TournamentStatusFilter,
  type TournamentFormatFilter,
} from '../features/tournaments/components/TournamentFiltersBar';
import { SearchBar } from '../features/matches/components';
import { SportIcon } from '../components/SportIcon';
import { useTranslation } from '../hooks';
import { useSport } from '../context';
import { lightHaptic } from '../utils/haptics';
import type { RootStackParamList } from '../navigation';

type Tournament = TournamentListItem;

export const Tournaments: React.FC = () => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { selectedSport } = useSport();
  const { session } = useAuth();
  const colors = useTournamentListColors();
  const isDark = theme === 'dark';
  const userId = session?.user?.id;

  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {
    data: tournaments = [],
    isLoading,
    isError,
    refetch,
  } = usePublicTournaments(selectedSport?.id);
  const { data: myRegistrations = [] } = useMyActiveRegistrations(userId);
  const registeredTournamentIds = useMemo(
    () => new Set(myRegistrations.map(r => r.tournament_id)),
    [myRegistrations]
  );

  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const [statusFilter, setStatusFilter] = useState<TournamentStatusFilter>('all');
  const [formatFilter, setFormatFilter] = useState<TournamentFormatFilter>('all');
  const [myRatingOnly, setMyRatingOnly] = useState(false);
  const [openSpotsOnly, setOpenSpotsOnly] = useState(false);

  // Active rating read path: player_sport.active_rating_score_id → scale value
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

  const hasActiveFilters =
    statusFilter !== 'all' ||
    formatFilter !== 'all' ||
    (myRatingOnly && playerRatingValue != null) ||
    openSpotsOnly;
  const isFilteredView = hasActiveFilters || debouncedSearchQuery.length > 0;

  const sections = useMemo<TournamentSection[]>(() => {
    const query = debouncedSearchQuery.trim().toLowerCase();
    const visible = tournaments.filter(tn => {
      if (userId && tn.organizer_id === userId) return false;
      if (registeredTournamentIds.has(tn.id)) return false;
      if (statusFilter !== 'all' && tn.status !== statusFilter) return false;
      if (formatFilter !== 'all' && tn.entry_format !== formatFilter) return false;
      if (
        ratingFilterValue != null &&
        ((tn.min_rating != null && ratingFilterValue < Number(tn.min_rating)) ||
          (tn.max_rating != null && ratingFilterValue > Number(tn.max_rating)))
      )
        return false;
      if (
        openSpotsOnly &&
        (tn.status !== 'registration_open' || tn.registration_count >= tn.max_participants)
      )
        return false;
      if (
        query &&
        !tn.name.toLowerCase().includes(query) &&
        !(tn.venue_name ?? '').toLowerCase().includes(query)
      )
        return false;
      return true;
    });

    // Actionability grouping: joinable first, soonest-closing deadline on top.
    const open: Tournament[] = [];
    const inProgress: Tournament[] = [];
    const startingSoon: Tournament[] = [];
    for (const tn of visible) {
      if (tn.status === 'registration_open') open.push(tn);
      else if (tn.status === 'in_progress') inProgress.push(tn);
      else if (tn.status === 'registration_closed') startingSoon.push(tn);
    }
    open.sort(
      (a, b) =>
        new Date(a.registration_closes_at ?? a.start_date).getTime() -
        new Date(b.registration_closes_at ?? b.start_date).getTime()
    );

    const out: TournamentSection[] = [];
    if (open.length) out.push({ titleKey: 'tournamentList.sectionOpen', items: open });
    if (inProgress.length)
      out.push({ titleKey: 'tournamentList.sectionInProgress', items: inProgress });
    if (startingSoon.length)
      out.push({ titleKey: 'tournamentList.sectionStartingSoon', items: startingSoon });
    return out;
  }, [
    tournaments,
    userId,
    registeredTournamentIds,
    debouncedSearchQuery,
    statusFilter,
    formatFilter,
    ratingFilterValue,
    openSpotsOnly,
  ]);

  const handlePress = useCallback(
    (tournament: Tournament) => {
      navigation.navigate('TournamentDetail', {
        tournamentId: tournament.id,
        tournamentName: tournament.name,
      });
    },
    [navigation]
  );

  const header = (
    <View style={styles.headerContainer}>
      <TouchableOpacity
        onPress={() => {
          void lightHaptic();
          navigation.navigate('MyTournaments');
        }}
        activeOpacity={0.85}
        style={[
          styles.myTournamentsButton,
          {
            backgroundColor: isDark ? primary[950] : primary[50],
            borderColor: isDark ? `${primary[400]}40` : `${primary[500]}20`,
          },
        ]}
      >
        <View
          style={[
            styles.myTournamentsIcon,
            { backgroundColor: isDark ? `${primary[400]}20` : `${primary[500]}15` },
          ]}
        >
          <Ionicons name="ribbon-outline" size={24} color={isDark ? primary[400] : primary[500]} />
        </View>
        <Text
          size="base"
          weight="semibold"
          color={isDark ? primary[300] : primary[600]}
          style={styles.myTournamentsLabel}
        >
          {t('tournamentList.myTournaments')}
        </Text>
      </TouchableOpacity>

      <View style={styles.searchRow}>
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t('tournamentList.searchPlaceholder')}
          onClear={() => setSearchQuery('')}
        />
      </View>

      <TournamentFiltersBar
        status={statusFilter}
        format={formatFilter}
        myRatingOnly={myRatingOnly}
        showMyRatingFilter={playerRatingValue != null}
        openSpotsOnly={openSpotsOnly}
        onStatusChange={setStatusFilter}
        onFormatChange={setFormatFilter}
        onMyRatingChange={setMyRatingOnly}
        onOpenSpotsChange={setOpenSpotsOnly}
        onReset={() => {
          setStatusFilter('all');
          setFormatFilter('all');
          setMyRatingOnly(false);
          setOpenSpotsOnly(false);
        }}
        hasActiveFilters={hasActiveFilters}
      />
    </View>
  );

  return (
    <TournamentListScaffold
      sections={sections}
      isLoading={isLoading}
      isError={isError}
      refetch={refetch}
      emptyIcon={isFilteredView ? 'filter-outline' : 'trophy-outline'}
      emptyTitleKey={isFilteredView ? 'tournamentList.emptySearch.title' : 'tournamentList.empty'}
      emptyDescriptionKey={
        isFilteredView
          ? 'tournamentList.emptySearch.description'
          : 'tournamentList.emptyDescription'
      }
      header={header}
      cardWatermark={
        <SportIcon sportName={selectedSport?.name ?? 'tennis'} size={96} color={colors.textMuted} />
      }
      onPressTournament={handlePress}
    />
  );
};

const styles = StyleSheet.create({
  headerContainer: {
    paddingTop: spacingPixels[5],
  },
  myTournamentsButton: {
    flexDirection: 'row',
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[4],
    borderRadius: radiusPixels.xl,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[3],
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
  },
  myTournamentsIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  myTournamentsLabel: {
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

export default Tournaments;
