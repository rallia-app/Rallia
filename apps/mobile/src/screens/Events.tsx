/**
 * Events — public discovery for every format.
 *
 * Replaces the separate Tournaments and Leagues directories. A reader looking
 * for something to enter no longer has to know which of two screens holds it;
 * the format is a filter chip cutting by the three formats Rallia runs, and the
 * sections are ordered by how actionable each event is rather than by which
 * table it came from.
 *
 * Spec: specs/navigation-ia/README.md (Compete hub), and
 * specs/17-leagues-tournaments/rollout.md
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { spacingPixels } from '@rallia/design-system';
import {
  useAuth,
  useAdminStatus,
  useDebounce,
  usePublicEvents,
  useMyActiveRegistrations,
  useRatingScoresForSport,
} from '@rallia/shared-hooks';
import {
  hasOpenSpots,
  isLiveEvent,
  matchesRatingBand,
  type EventSummary,
} from '@rallia/shared-services';

import {
  EventListScaffold,
  type EventListSection,
} from '../features/events/components/EventListScaffold';
import {
  EventFiltersBar,
  type EventFormatFilter,
  type EventPhaseFilter,
} from '../features/events/components/EventFiltersBar';
import { EventSummaryCard } from '../features/events/components/EventSummaryCard';
import { SearchBar } from '../features/matches/components';
import { PrimaryEntryButton, RowEntryButton } from '../components/HubEntryButton';
import { useTranslation, useRequireOnboarding } from '../hooks';
import { useSport, useActionsSheet } from '../context';
import { lightHaptic } from '../utils/haptics';
import type { RootStackParamList } from '../navigation';

export const Events: React.FC = () => {
  const { t } = useTranslation();
  const { selectedSport } = useSport();
  const { session } = useAuth();
  const { isAdmin } = useAdminStatus();
  const userId = session?.user?.id;
  const { guardAction } = useRequireOnboarding();
  const { openSheetForEventCreation } = useActionsSheet();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const handleCreate = useCallback(() => {
    void lightHaptic();
    if (!guardAction()) return;
    openSheetForEventCreation();
  }, [guardAction, openSheetForEventCreation]);

  const { data: events, isLoading, isError, refetch } = usePublicEvents(selectedSport?.id);
  const { data: myRegistrations = [] } = useMyActiveRegistrations(userId);
  const registeredIds = useMemo(
    () => new Set(myRegistrations.map(r => r.tournament_id)),
    [myRegistrations]
  );

  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const [formatFilter, setFormatFilter] = useState<EventFormatFilter>('all');
  const [phaseFilter, setPhaseFilter] = useState<EventPhaseFilter>('all');
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
    formatFilter !== 'all' ||
    phaseFilter !== 'all' ||
    (myRatingOnly && playerRatingValue != null) ||
    openSpotsOnly;
  const isFilteredView = hasActiveFilters || debouncedSearchQuery.length > 0;

  const sections = useMemo<EventListSection<EventSummary>[]>(() => {
    const query = debouncedSearchQuery.trim().toLowerCase();
    const visible = events.filter(event => {
      if (!isLiveEvent(event)) return false;
      // Already yours: it belongs on My Events, not on discovery.
      if (userId && event.organizerId === userId) return false;
      if (event.engine === 'tournament' && registeredIds.has(event.id)) return false;
      if (formatFilter !== 'all' && event.format !== formatFilter) return false;
      if (phaseFilter !== 'all' && event.phase !== phaseFilter) return false;
      if (!matchesRatingBand(event, ratingFilterValue)) return false;
      if (openSpotsOnly && !hasOpenSpots(event)) return false;
      if (
        query &&
        !event.name.toLowerCase().includes(query) &&
        !(event.locationLabel ?? '').toLowerCase().includes(query)
      )
        return false;
      return true;
    });

    // Actionability order, the tournament screen's grouping generalized:
    // what you can enter now, then what is about to start, then what is under
    // way. Inside the joinable bucket, the soonest deadline leads; events with
    // no deadline (leagues) fall to the end of it.
    const buckets: Record<'joinable' | 'startingSoon' | 'running', EventSummary[]> = {
      joinable: [],
      startingSoon: [],
      running: [],
    };
    for (const event of visible) {
      if (event.phase !== 'closed') buckets[event.phase].push(event);
    }
    buckets.joinable.sort((a, b) => {
      if (a.nextDeadline == null) return b.nextDeadline == null ? 0 : 1;
      if (b.nextDeadline == null) return -1;
      return new Date(a.nextDeadline).getTime() - new Date(b.nextDeadline).getTime();
    });

    const out: EventListSection<EventSummary>[] = [];
    if (buckets.joinable.length)
      out.push({ titleKey: 'eventList.sections.joinable', items: buckets.joinable });
    if (buckets.startingSoon.length)
      out.push({ titleKey: 'eventList.sections.startingSoon', items: buckets.startingSoon });
    if (buckets.running.length)
      out.push({ titleKey: 'eventList.sections.running', items: buckets.running });
    return out;
  }, [
    events,
    userId,
    registeredIds,
    debouncedSearchQuery,
    formatFilter,
    phaseFilter,
    ratingFilterValue,
    openSpotsOnly,
  ]);

  const handlePress = useCallback(
    (event: EventSummary) => {
      if (event.engine === 'league') {
        navigation.navigate('LeagueDetail', { leagueId: event.id, leagueName: event.name });
      } else {
        navigation.navigate('TournamentDetail', {
          tournamentId: event.id,
          tournamentName: event.name,
        });
      }
    },
    [navigation]
  );

  const header = (
    <View style={styles.headerContainer}>
      {isAdmin && (
        <PrimaryEntryButton
          icon="add"
          title={t('eventList.create')}
          subtitle={t('eventList.createSubtitle')}
          onPress={handleCreate}
          testID="cta-create-event"
        />
      )}

      <RowEntryButton
        icon="trophy"
        label={t('eventList.myEvents')}
        onPress={() => navigation.navigate('MyEvents')}
        testID="cta-my-events"
      />

      <View style={styles.searchRow}>
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t('eventList.searchPlaceholder')}
          onClear={() => setSearchQuery('')}
        />
      </View>

      <EventFiltersBar
        format={formatFilter}
        phase={phaseFilter}
        myRatingOnly={myRatingOnly}
        showMyRatingFilter={playerRatingValue != null}
        openSpotsOnly={openSpotsOnly}
        onFormatChange={setFormatFilter}
        onPhaseChange={setPhaseFilter}
        onMyRatingChange={setMyRatingOnly}
        onOpenSpotsChange={setOpenSpotsOnly}
        onReset={() => {
          setFormatFilter('all');
          setPhaseFilter('all');
          setMyRatingOnly(false);
          setOpenSpotsOnly(false);
        }}
        hasActiveFilters={hasActiveFilters}
      />
    </View>
  );

  return (
    <EventListScaffold
      sections={sections}
      isLoading={isLoading}
      isError={isError}
      refetch={refetch}
      emptyIcon={isFilteredView ? 'filter-outline' : 'trophy-outline'}
      emptyTitleKey={isFilteredView ? 'eventList.emptySearch.title' : 'eventList.empty'}
      emptyDescriptionKey={
        isFilteredView ? 'eventList.emptySearch.description' : 'eventList.emptyDescription'
      }
      loadErrorKey="eventList.loadError"
      retryKey="eventList.retry"
      header={header}
      skeletonBannerAspect={2.4}
      renderCard={event => (
        <EventSummaryCard event={event} currentUserId={userId} onPress={() => handlePress(event)} />
      )}
    />
  );
};

const styles = StyleSheet.create({
  // No top padding of its own: the tab bar's 4 plus the list scaffold's 8
  // already land the first block on the screen's 12 rhythm.
  headerContainer: {},
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[2],
    gap: spacingPixels[2],
  },
});

export default Events;
