/**
 * My Events
 *
 * The caller's event library for the active sport, across every format.
 * Replaces MyTournaments and MyLeagues, which split one question ("what am I
 * in?") across two screens by table.
 *
 * Keeps the tournament library's shape, which was the richer of the two:
 * Upcoming/Past pill tabs, single-select filter chips, skeleton initial load,
 * pull-to-refresh. Drafts and archived stay reachable — they are organizer
 * surfaces that exist nowhere else in the app.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { EmptyState, Text, EventCardSkeleton, useEventListColors } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, neutral, base } from '@rallia/design-system';
import {
  useTheme,
  useAuth,
  useMyEvents,
  useMyTournaments,
  useMyActiveRegistrations,
} from '@rallia/shared-hooks';
import { tournamentToEventSummary, type EventSummary } from '@rallia/shared-services';

import { EventSummaryCard } from '../features/events/components/EventSummaryCard';
import { useTranslation, useScrollBottomInset, type TranslationKey } from '../hooks';
import { useSport } from '../context';
import { lightHaptic } from '../utils/haptics';
import type { RootStackParamList } from '../navigation';

type TimeFilter = 'upcoming' | 'past';
type UpcomingFilter = 'all' | 'playing' | 'organizing' | 'drafts';
type PastFilter = 'all' | 'completed' | 'cancelled' | 'archived';
type EventFilter = UpcomingFilter | PastFilter;

const UPCOMING_FILTERS: UpcomingFilter[] = ['all', 'playing', 'organizing', 'drafts'];
const PAST_FILTERS: PastFilter[] = ['all', 'completed', 'cancelled', 'archived'];

const FILTER_LABEL_KEYS: Record<EventFilter, TranslationKey> = {
  all: 'myEvents.filters.all',
  playing: 'myEvents.filters.playing',
  organizing: 'myEvents.filters.organizing',
  drafts: 'myEvents.filters.drafts',
  completed: 'myEvents.filters.completed',
  cancelled: 'myEvents.filters.cancelled',
  archived: 'myEvents.filters.archived',
};

/** Is this event still ahead of the caller, in its own format's terms? */
function isUpcoming(event: EventSummary): boolean {
  if (event.engine === 'league') return event.league.status !== 'closed';
  const status = event.tournament.status;
  return (
    status === 'draft' ||
    status === 'registration_open' ||
    status === 'registration_closed' ||
    status === 'in_progress'
  );
}

/** Sort key: upcoming events lead with the soonest, past with the most recent. */
function timeKey(event: EventSummary): number {
  if (event.engine === 'league') return new Date(event.league.created_at).getTime();
  const t = event.tournament;
  return new Date(t.cancelled_at ?? t.start_date).getTime();
}

const FilterChip: React.FC<{
  label: string;
  isActive: boolean;
  onPress: () => void;
  isDark: boolean;
}> = ({ label, isActive, onPress, isDark }) => {
  const scaleAnim = useMemo(() => new Animated.Value(1), []);
  const bgColor = isActive ? primary[500] : isDark ? neutral[800] : neutral[100];
  const borderColor = isActive ? primary[400] : isDark ? neutral[700] : neutral[200];
  const textColor = isActive ? base.white : isDark ? neutral[300] : neutral[600];

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[styles.chip, { backgroundColor: bgColor, borderColor }]}
        onPress={() => {
          void lightHaptic();
          Animated.sequence([
            Animated.timing(scaleAnim, { toValue: 0.95, duration: 50, useNativeDriver: true }),
            Animated.timing(scaleAnim, { toValue: 1, duration: 50, useNativeDriver: true }),
          ]).start();
          onPress();
        }}
        activeOpacity={0.85}
      >
        <Text size="xs" weight={isActive ? 'semibold' : 'medium'} color={textColor}>
          {label}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

export const MyEvents: React.FC = () => {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { selectedSport } = useSport();
  const { session } = useAuth();
  const colors = useEventListColors();
  const bottomInset = useScrollBottomInset();
  const isDark = theme === 'dark';
  const userId = session?.user?.id;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [activeTab, setActiveTab] = useState<TimeFilter>('upcoming');
  const [upcomingFilter, setUpcomingFilter] = useState<UpcomingFilter>('all');
  const [pastFilter, setPastFilter] = useState<PastFilter>('all');
  const currentFilter: EventFilter = activeTab === 'upcoming' ? upcomingFilter : pastFilter;

  // Archived rows are excluded from the library query, so the archive chip
  // reads from its own query rather than filtering a list that never has them.
  // Only tournaments archive; leagues have no equivalent.
  const showArchived = activeTab === 'past' && pastFilter === 'archived';

  const live = useMyEvents(userId, selectedSport?.id);
  const {
    data: archivedTournaments = [],
    isLoading: isLoadingArchived,
    refetch: refetchArchived,
  } = useMyTournaments(userId, selectedSport?.id, { archived: true, enabled: showArchived });

  const archived = useMemo<EventSummary[]>(
    () => archivedTournaments.map(tournamentToEventSummary),
    [archivedTournaments]
  );

  const events = showArchived ? archived : live.data;
  const isLoading = showArchived ? isLoadingArchived : live.isLoading;
  const refetch = showArchived ? refetchArchived : live.refetch;

  const { data: myRegistrations = [], isLoading: isLoadingRegistrations } =
    useMyActiveRegistrations(userId);
  const registeredIds = useMemo(
    () => new Set(myRegistrations.map(r => r.tournament_id)),
    [myRegistrations]
  );

  const isManualRefresh = useRef(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const isFetchingInitial = isLoading || isLoadingRegistrations;
  useEffect(() => {
    if (isInitialLoad && !isFetchingInitial) {
      queueMicrotask(() => setIsInitialLoad(false));
    }
  }, [isInitialLoad, isFetchingInitial]);

  const visibleEvents = useMemo(() => {
    // Co-organizers run the event just like the organizer, so they belong in
    // the organizing and drafts buckets too.
    const isMine = (event: EventSummary) =>
      event.organizerId === userId ||
      (event.engine === 'tournament' && event.tournament.is_co_organizer === true);
    const isDraft = (event: EventSummary) =>
      event.engine === 'tournament' && event.tournament.status === 'draft';

    const visible = events.filter(event => {
      const inTab = showArchived
        ? true
        : activeTab === 'upcoming'
          ? isUpcoming(event)
          : !isUpcoming(event);
      if (!inTab) return false;

      switch (currentFilter) {
        case 'playing':
          // An organizer who also plays their own event belongs here too, so
          // this is keyed on the caller's own participation, not on !isMine.
          return event.engine === 'league' ? !isMine(event) : registeredIds.has(event.id);
        case 'organizing':
          return isMine(event) && !isDraft(event);
        case 'drafts':
          return isDraft(event);
        case 'completed':
          return event.engine === 'tournament'
            ? event.tournament.status === 'completed'
            : event.league.status === 'closed';
        case 'cancelled':
          return event.engine === 'tournament' && event.tournament.status === 'cancelled';
        case 'archived':
          return event.engine === 'tournament' && event.tournament.status === 'archived';
        default:
          return true;
      }
    });

    return visible.sort((a, b) =>
      activeTab === 'upcoming' ? timeKey(a) - timeKey(b) : timeKey(b) - timeKey(a)
    );
  }, [events, activeTab, currentFilter, registeredIds, userId, showArchived]);

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

  const handleRefresh = useCallback(async () => {
    isManualRefresh.current = true;
    setIsRefreshing(true);
    try {
      await refetch();
    } finally {
      setIsRefreshing(false);
      isManualRefresh.current = false;
    }
  }, [refetch]);

  const renderTab = (tab: TimeFilter, icon: keyof typeof Ionicons.glyphMap, label: string) => {
    const isActive = activeTab === tab;
    return (
      <TouchableOpacity
        style={[
          styles.tab,
          isActive && [styles.activeTab, { backgroundColor: isDark ? neutral[700] : base.white }],
        ]}
        onPress={() => {
          if (tab !== activeTab) {
            void lightHaptic();
            setActiveTab(tab);
          }
        }}
        activeOpacity={0.8}
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

  const chips = activeTab === 'upcoming' ? UPCOMING_FILTERS : PAST_FILTERS;

  return (
    <SafeAreaView edges={['bottom']} style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.tabBar, { backgroundColor: isDark ? neutral[800] : neutral[100] }]}>
        {renderTab('upcoming', 'calendar-outline', t('myEvents.tabs.upcoming'))}
        {renderTab('past', 'time-outline', t('myEvents.tabs.past'))}
      </View>

      <View style={styles.chipRow}>
        {chips.map(filter => (
          <FilterChip
            key={filter}
            label={t(FILTER_LABEL_KEYS[filter])}
            isActive={currentFilter === filter}
            onPress={() =>
              activeTab === 'upcoming'
                ? setUpcomingFilter(filter as UpcomingFilter)
                : setPastFilter(filter as PastFilter)
            }
            isDark={isDark}
          />
        ))}
      </View>

      {isInitialLoad ? (
        <View style={styles.skeletonList}>
          {[1, 2, 3, 4].map(i => (
            <EventCardSkeleton key={i} bannerAspect={2.4} />
          ))}
        </View>
      ) : (
        <FlatList
          data={visibleEvents}
          keyExtractor={event => event.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: bottomInset },
            visibleEvents.length === 0 && styles.emptyListContent,
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => void handleRefresh()}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <EmptyState
                icon={<Ionicons name="trophy-outline" size={64} color={colors.primary} />}
                title={t('myEvents.empty.title')}
                description={t('myEvents.empty.description')}
              />
            </View>
          }
          renderItem={({ item }) => (
            <EventSummaryCard
              event={item}
              currentUserId={userId}
              onPress={() => handlePress(item)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: spacingPixels[4],
    marginTop: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    padding: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: radiusPixels.md,
  },
  activeTab: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[1],
    gap: spacingPixels[2],
  },
  chip: {
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
  },
  listContent: {
    paddingTop: spacingPixels[2],
    flexGrow: 1,
  },
  emptyListContent: {
    minHeight: '100%',
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  skeletonList: {
    paddingTop: spacingPixels[3],
  },
});

export default MyEvents;
