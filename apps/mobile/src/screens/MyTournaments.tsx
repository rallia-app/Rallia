/**
 * My Tournaments
 *
 * The caller's personal tournament library for the active sport, mirroring
 * the PlayerMatches UX: pill Upcoming/Past tabs, single-select filter chips,
 * date-bucketed SectionList, skeleton initial load, pull-to-refresh.
 * Upcoming = drafts + registration/in-progress; Past = completed + cancelled.
 * Reached from the Tournaments discovery screen. Tap a row → TournamentDetail.
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
import { EmptyState, Text } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
} from '@rallia/design-system';
import {
  useTheme,
  useAuth,
  useMyTournaments,
  useMyActiveRegistrations,
} from '@rallia/shared-hooks';
import type { TournamentListItem } from '@rallia/shared-services';

import {
  TournamentCard,
  TournamentCardSkeleton,
  useTournamentListColors,
} from '../features/tournaments/components/TournamentListScaffold';
import { useTranslation, useScrollBottomInset, type TranslationKey } from '../hooks';
import { useSport } from '../context';
import { lightHaptic } from '../utils/haptics';
import type { RootStackParamList } from '../navigation';

type Tournament = TournamentListItem;

type TimeFilter = 'upcoming' | 'past';
type UpcomingTournamentFilter = 'all' | 'registered' | 'organizing' | 'drafts';
type PastTournamentFilter = 'all' | 'completed' | 'cancelled' | 'archived';
type TournamentFilter = UpcomingTournamentFilter | PastTournamentFilter;

const UPCOMING_STATUSES = new Set([
  'draft',
  'registration_open',
  'registration_closed',
  'in_progress',
]);

interface FilterOption {
  value: TournamentFilter;
  labelKey: TranslationKey;
  icon?: keyof typeof Ionicons.glyphMap;
}

const UPCOMING_OPTIONS: FilterOption[] = [
  { value: 'all', labelKey: 'tournamentList.filters.all' },
  {
    value: 'registered',
    labelKey: 'tournamentList.filters.registered',
    icon: 'checkmark-circle-outline',
  },
  {
    value: 'organizing',
    labelKey: 'tournamentList.filters.organizing',
    icon: 'person-outline',
  },
  {
    value: 'drafts',
    labelKey: 'tournamentList.filters.drafts',
    icon: 'document-text-outline',
  },
];

const PAST_OPTIONS: FilterOption[] = [
  { value: 'all', labelKey: 'tournamentList.filters.all' },
  {
    value: 'completed',
    labelKey: 'tournamentList.filters.completed',
    icon: 'trophy-outline',
  },
  {
    value: 'cancelled',
    labelKey: 'tournamentList.filters.cancelled',
    icon: 'close-circle-outline',
  },
  // Its own chip rather than a row mixed into "all": archiving is how an
  // organizer clears the library, so the archive should stay out of it.
  {
    value: 'archived',
    labelKey: 'tournamentList.filters.archived',
    icon: 'archive-outline',
  },
];

const FILTER_EMPTY_ICONS: Record<TournamentFilter, keyof typeof Ionicons.glyphMap> = {
  all: 'trophy-outline',
  registered: 'checkmark-circle-outline',
  organizing: 'person-outline',
  drafts: 'document-text-outline',
  completed: 'trophy-outline',
  cancelled: 'close-circle-outline',
  archived: 'archive-outline',
};

// =============================================================================
// FILTER CHIP (mirrors PlayerMatchFilterChips styling)
// =============================================================================

const FilterChip: React.FC<{
  label: string;
  isActive: boolean;
  isDark: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}> = ({ label, isActive, isDark, icon, onPress }) => {
  const scaleAnim = useMemo(() => new Animated.Value(1), []);

  const bgColor = isActive ? primary[500] : isDark ? neutral[800] : neutral[100];
  const borderColor = isActive ? primary[400] : isDark ? neutral[700] : neutral[200];
  const textColor = isActive ? '#ffffff' : isDark ? neutral[300] : neutral[600];

  const handlePress = () => {
    lightHaptic();
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.95, duration: 50, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 50, useNativeDriver: true }),
    ]).start();
    onPress();
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[styles.chip, { backgroundColor: bgColor, borderColor }]}
        onPress={handlePress}
        activeOpacity={0.85}
      >
        {icon && <Ionicons name={icon} size={14} color={textColor} />}
        <Text size="xs" weight={isActive ? 'semibold' : 'medium'} color={textColor}>
          {label}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const MyTournaments: React.FC = () => {
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const { selectedSport } = useSport();
  const { session } = useAuth();
  const colors = useTournamentListColors();
  const bottomInset = useScrollBottomInset();
  const isDark = theme === 'dark';
  const userId = session?.user?.id;

  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [activeTab, setActiveTab] = useState<TimeFilter>('upcoming');
  const [upcomingFilter, setUpcomingFilter] = useState<UpcomingTournamentFilter>('all');
  const [pastFilter, setPastFilter] = useState<PastTournamentFilter>('all');
  const currentFilter: TournamentFilter = activeTab === 'upcoming' ? upcomingFilter : pastFilter;

  // Archived rows are excluded from the library query, so the archive chip
  // reads from its own query rather than filtering a list that never has them.
  const showArchived = activeTab === 'past' && pastFilter === 'archived';

  const {
    data: liveTournaments = [],
    isLoading: isLoadingLive,
    isRefetching: isRefetchingLive,
    refetch: refetchLive,
  } = useMyTournaments(userId, selectedSport?.id);
  const {
    data: archivedTournaments = [],
    isLoading: isLoadingArchived,
    isRefetching: isRefetchingArchived,
    refetch: refetchArchived,
  } = useMyTournaments(userId, selectedSport?.id, { archived: true, enabled: showArchived });

  const tournaments = showArchived ? archivedTournaments : liveTournaments;
  const isLoading = showArchived ? isLoadingArchived : isLoadingLive;
  const isRefetching = showArchived ? isRefetchingArchived : isRefetchingLive;
  const refetch = showArchived ? refetchArchived : refetchLive;
  const { data: myRegistrations = [], isLoading: isLoadingRegistrations } =
    useMyActiveRegistrations(userId);
  const registeredIds = useMemo(
    () => new Set(myRegistrations.map(r => r.tournament_id)),
    [myRegistrations]
  );

  // Track manual pull-to-refresh so RefreshControl doesn't spin on background refetches
  const isManualRefresh = useRef(false);

  // Full-screen skeletons only on the very first load, not on tab switches
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const isFetchingInitial = isLoading || isLoadingRegistrations;
  useEffect(() => {
    if (isInitialLoad && !isFetchingInitial) {
      queueMicrotask(() => setIsInitialLoad(false));
    }
  }, [isInitialLoad, isFetchingInitial]);

  const visibleTournaments = useMemo(() => {
    // Co-organizers run the event just like the organizer, so they belong in
    // the organizing/drafts buckets too.
    const isMine = (tn: Tournament) => tn.organizer_id === userId || tn.is_co_organizer === true;

    const visible = tournaments.filter(tn => {
      const inTab =
        activeTab === 'upcoming'
          ? UPCOMING_STATUSES.has(tn.status)
          : showArchived
            ? tn.status === 'archived'
            : tn.status === 'completed' || tn.status === 'cancelled';
      if (!inTab) return false;
      switch (currentFilter) {
        case 'registered':
          // An organizer who also plays their own event belongs here too, so
          // this is keyed on the caller's own registration, not on !isMine.
          return registeredIds.has(tn.id);
        case 'organizing':
          return isMine(tn) && tn.status !== 'draft';
        case 'drafts':
          return isMine(tn) && tn.status === 'draft';
        case 'completed':
          return tn.status === 'completed';
        case 'cancelled':
          return tn.status === 'cancelled';
        case 'archived':
          return tn.status === 'archived';
        default:
          return true;
      }
    });

    // Upcoming: soonest first (live tournaments sort naturally to the top);
    // Past: most recent first.
    return visible.sort((a, b) =>
      activeTab === 'upcoming'
        ? new Date(a.start_date).getTime() - new Date(b.start_date).getTime()
        : new Date(b.cancelled_at ?? b.end_date).getTime() -
          new Date(a.cancelled_at ?? a.end_date).getTime()
    );
  }, [tournaments, activeTab, currentFilter, registeredIds, userId, showArchived]);

  const handlePress = useCallback(
    (tournament: Tournament) => {
      navigation.navigate('TournamentDetail', {
        tournamentId: tournament.id,
        tournamentName: tournament.name,
      });
    },
    [navigation]
  );

  const renderTab = (tab: TimeFilter, icon: keyof typeof Ionicons.glyphMap, label: string) => {
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

  const renderEmptyState = () => {
    const isFiltered = currentFilter !== 'all';
    const icon = isFiltered
      ? FILTER_EMPTY_ICONS[currentFilter]
      : activeTab === 'upcoming'
        ? 'calendar-outline'
        : 'time-outline';
    const title = isFiltered
      ? t('tournamentList.emptyFiltered.title')
      : activeTab === 'upcoming'
        ? t('tournamentList.emptyUpcoming.title')
        : t('tournamentList.emptyPast.title');
    const description = isFiltered
      ? t('tournamentList.emptyFiltered.description', {
          filter: t(`tournamentList.filters.${currentFilter}`),
        })
      : activeTab === 'upcoming'
        ? t('tournamentList.emptyUpcoming.description')
        : t('tournamentList.emptyPast.description');

    return (
      <EmptyState
        icon={<Ionicons name={icon} size={64} color={colors.primary} />}
        title={title}
        description={description}
      />
    );
  };

  const options = activeTab === 'upcoming' ? UPCOMING_OPTIONS : PAST_OPTIONS;

  // Bottom inset goes in the list's contentContainerStyle, not on the wrapper,
  // so the list scrolls under the home indicator instead of stopping above it.
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      <View style={[styles.tabBar, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}>
        {renderTab('upcoming', 'calendar-outline', t('playerMatches.tabs.upcoming'))}
        {renderTab('past', 'time-outline', t('playerMatches.tabs.past'))}
      </View>

      <View style={styles.chipsRow}>
        {options.map(option => (
          <FilterChip
            key={option.value}
            label={t(option.labelKey)}
            isActive={currentFilter === option.value}
            isDark={isDark}
            icon={option.value !== 'all' ? option.icon : undefined}
            onPress={() =>
              activeTab === 'upcoming'
                ? setUpcomingFilter(option.value as UpcomingTournamentFilter)
                : setPastFilter(option.value as PastTournamentFilter)
            }
          />
        ))}
      </View>

      {isFetchingInitial && isInitialLoad ? (
        <View style={styles.loadingContainer}>
          {[1, 2, 3, 4, 5].map(i => (
            <TournamentCardSkeleton key={i} />
          ))}
        </View>
      ) : (
        <FlatList
          data={visibleTournaments}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <TournamentCard
              tournament={item}
              colors={colors}
              locale={locale}
              t={t}
              isOrganizer={item.organizer_id === userId || item.is_co_organizer === true}
              onPress={() => handlePress(item)}
            />
          )}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: bottomInset },
            visibleTournaments.length === 0 && styles.emptyListContent,
          ]}
          ListEmptyComponent={renderEmptyState}
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

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  chipsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    gap: spacingPixels[2],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
    gap: spacingPixels[1],
  },
  loadingContainer: {
    flex: 1,
    paddingTop: spacingPixels[2],
  },
  listContent: {
    paddingTop: spacingPixels[2],
    flexGrow: 1,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: '100%',
  },
});

export default MyTournaments;
