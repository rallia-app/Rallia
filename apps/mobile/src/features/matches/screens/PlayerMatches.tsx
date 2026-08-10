/**
 * PlayerMatches Screen
 * Displays the user's matches with tabbed Upcoming/Past views and date-sectioned lists.
 */

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  SectionList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { EmptyState, MatchCard, Text } from '@rallia/shared-components';
import { useTheme, usePlayerMatches, usePlayerMatchFilters } from '@rallia/shared-hooks';
import {
  getUpcomingDateSection,
  getPastDateSection,
  UPCOMING_SECTION_ORDER,
  PAST_SECTION_ORDER,
  lightHaptic,
  type UpcomingDateSection,
  type PastDateSection,
} from '@rallia/shared-utils';
import type { MatchWithDetails } from '@rallia/shared-types';
import type { TranslationKey } from '@rallia/shared-translations';
import { Logger } from '@rallia/shared-services';
import { spacingPixels, neutral } from '@rallia/design-system';

import { useAuth, useThemeStyles, useTranslation } from '#/hooks';
import { useMatchDetailSheet, useSport } from '#/context';
import { PlayerMatchFilterChips, MatchCardSkeleton } from '#/features/matches/components';
import { SportIcon } from '#/components/SportIcon';

// =============================================================================
// TYPES
// =============================================================================

type TimeFilter = 'upcoming' | 'past';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function groupMatchesByDate(
  matches: MatchWithDetails[],
  timeFilter: TimeFilter,
  sectionLabels: Record<UpcomingDateSection | PastDateSection, string>
): { title: string; data: MatchWithDetails[] }[] {
  const order =
    timeFilter === 'upcoming'
      ? (UPCOMING_SECTION_ORDER as (UpcomingDateSection | PastDateSection)[])
      : (PAST_SECTION_ORDER as (UpcomingDateSection | PastDateSection)[]);

  const groups: Partial<Record<UpcomingDateSection | PastDateSection, MatchWithDetails[]>> = {};

  matches.forEach(match => {
    const key =
      timeFilter === 'upcoming'
        ? getUpcomingDateSection(match.match_date)
        : getPastDateSection(match.match_date);
    if (!groups[key]) groups[key] = [];
    groups[key].push(match);
  });

  return order
    .filter(key => (groups[key]?.length ?? 0) > 0)
    .map(key => ({ title: sectionLabels[key], data: groups[key]! }));
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function PlayerMatches() {
  const { session } = useAuth();
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const { colors } = useThemeStyles();
  const { openSheet: openMatchDetail } = useMatchDetailSheet();
  const { selectedSport } = useSport();
  const isDark = theme === 'dark';

  // Tab state
  const [activeTab, setActiveTab] = useState<TimeFilter>('upcoming');

  // Filter state
  const { upcomingFilter, pastFilter, toggleUpcomingFilter, togglePastFilter } =
    usePlayerMatchFilters();

  // Get current filter based on active tab
  const currentStatusFilter = activeTab === 'upcoming' ? upcomingFilter : pastFilter;

  // Handle tab change - preserve filter state when switching tabs
  const handleTabChange = useCallback(
    (tab: TimeFilter) => {
      if (tab !== activeTab) {
        void lightHaptic();
        setActiveTab(tab);
      }
    },
    [activeTab]
  );

  // Track manual pull-to-refresh so RefreshControl doesn't trigger on tab switch or background refetch
  const isManualRefresh = useRef(false);

  // Theme colors

  // Fetch matches based on active tab and filter
  const {
    matches,
    isLoading,
    isRefetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = usePlayerMatches({
    userId: session?.user?.id,
    timeFilter: activeTab,
    sportId: selectedSport?.id,
    statusFilter: currentStatusFilter,
    limit: 20,
    enabled: !!session?.user?.id,
  });

  // Track whether initial load has completed to avoid showing full-screen spinner on tab switch
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Mark initial load as done once first fetch completes
  useEffect(() => {
    if (isInitialLoad && !isLoading) {
      queueMicrotask(() => setIsInitialLoad(false));
    }
  }, [isInitialLoad, isLoading]);

  const sectionLabels = useMemo<Record<UpcomingDateSection | PastDateSection, string>>(
    () => ({
      today: t('playerMatches.time.today'),
      tomorrow: t('playerMatches.time.tomorrow'),
      thisWeek: t('playerMatches.time.thisWeek'),
      nextWeek: t('playerMatches.time.nextWeek'),
      later: t('playerMatches.time.later'),
      yesterday: t('playerMatches.time.yesterday'),
      lastWeek: t('playerMatches.time.lastWeek'),
      earlier: t('playerMatches.time.earlier'),
    }),
    [t]
  );

  // Group matches by date
  const sections = useMemo(
    () => groupMatchesByDate(matches, activeTab, sectionLabels),
    [matches, activeTab, sectionLabels]
  );

  // Handle load more
  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Render match card
  const renderMatchCard = useCallback(
    ({ item }: { item: MatchWithDetails }) => (
      <MatchCard
        match={item}
        isDark={isDark}
        t={t as (key: string, options?: Record<string, string | number | boolean>) => string}
        locale={locale}
        currentPlayerId={session?.user?.id}
        sportIcon={
          <SportIcon
            sportName={item.sport?.name ?? 'tennis'}
            size={100}
            color={isDark ? neutral[600] : neutral[400]}
          />
        }
        onPress={() => {
          Logger.logUserAction('player_match_pressed', { matchId: item.id });
          openMatchDetail(item, { source: 'my_matches' });
        }}
      />
    ),
    [isDark, t, locale, openMatchDetail, session?.user?.id]
  );

  // Render section header
  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string } }) => (
      <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
        <Text size="sm" weight="semibold" color={colors.textMuted}>
          {section.title}
        </Text>
      </View>
    ),
    [colors]
  );

  // Render empty state - shows filter-specific messages when a filter is active
  const renderEmptyState = () => {
    const isFiltered = currentStatusFilter !== 'all';

    // Determine icon based on filter or tab
    const getIcon = (): keyof typeof Ionicons.glyphMap => {
      if (!isFiltered) {
        return activeTab === 'upcoming' ? 'calendar-outline' : 'time-outline';
      }
      // Filter-specific icons
      switch (currentStatusFilter) {
        case 'hosting':
        case 'hosted':
          return 'person-outline';
        case 'confirmed':
          return 'checkmark-circle-outline';
        case 'waiting':
          return 'hourglass-outline';
        case 'needs_players':
          return 'people-outline';
        case 'feedback_needed':
          return 'chatbubble-outline';
        case 'completed':
          return 'trophy-outline';
        case 'unfilled':
          return 'time-outline';
        case 'cancelled':
          return 'close-circle-outline';
        case 'private':
          return 'lock-closed-outline';
        default:
          return 'search-outline';
      }
    };

    // Get appropriate translation keys
    const getEmptyContent = () => {
      if (!isFiltered) {
        const emptyKey = activeTab === 'upcoming' ? 'emptyUpcoming' : 'emptyPast';
        return {
          title: t(`playerMatches.${emptyKey}.title`),
          description: t(`playerMatches.${emptyKey}.description`),
        };
      }
      // Filter-specific empty state
      return {
        title: t(`playerMatches.emptyFiltered.title`),
        description: t(`playerMatches.emptyFiltered.description`, {
          filter: t(
            `playerMatches.filters.${currentStatusFilter === 'needs_players' ? 'needsPlayers' : currentStatusFilter === 'feedback_needed' ? 'feedbackNeeded' : currentStatusFilter}`
          ),
        }),
      };
    };

    const { title, description } = getEmptyContent();

    return (
      <EmptyState
        icon={<Ionicons name={getIcon()} size={64} color={colors.primary} />}
        title={title}
        description={description}
      />
    );
  };

  // Render footer
  const renderFooter = () => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  };

  // Render tab bar (pill style – matches Communities)
  const renderTabBar = () => (
    <View style={[styles.tabBar, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}>
      <TouchableOpacity
        style={[
          styles.tab,
          activeTab === 'upcoming' && [
            styles.activeTab,
            { backgroundColor: colors.cardBackground },
          ],
        ]}
        onPress={() => handleTabChange('upcoming')}
        activeOpacity={0.8}
      >
        <Ionicons
          name="calendar-outline"
          size={18}
          color={activeTab === 'upcoming' ? colors.primary : colors.textMuted}
        />
        <Text
          size="sm"
          weight={activeTab === 'upcoming' ? 'semibold' : 'medium'}
          style={{
            color: activeTab === 'upcoming' ? colors.primary : colors.textMuted,
            marginLeft: 6,
          }}
        >
          {t('playerMatches.tabs.upcoming')}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[
          styles.tab,
          activeTab === 'past' && [styles.activeTab, { backgroundColor: colors.cardBackground }],
        ]}
        onPress={() => handleTabChange('past')}
        activeOpacity={0.8}
      >
        <Ionicons
          name="time-outline"
          size={18}
          color={activeTab === 'past' ? colors.primary : colors.textMuted}
        />
        <Text
          size="sm"
          weight={activeTab === 'past' ? 'semibold' : 'medium'}
          style={{
            color: activeTab === 'past' ? colors.primary : colors.textMuted,
            marginLeft: 6,
          }}
        >
          {t('playerMatches.tabs.past')}
        </Text>
      </TouchableOpacity>
    </View>
  );

  // Render filter chips
  const renderFilterChips = () => (
    <PlayerMatchFilterChips
      timeFilter={activeTab}
      upcomingFilter={upcomingFilter}
      pastFilter={pastFilter}
      onUpcomingFilterToggle={toggleUpcomingFilter}
      onPastFilterToggle={togglePastFilter}
    />
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      {/* Tab Bar */}
      {renderTabBar()}

      {/* Filter Chips */}
      {renderFilterChips()}

      {/* Content */}
      {isLoading && isInitialLoad ? (
        <View style={styles.loadingContainer}>
          {[1, 2, 3, 4].map(i => (
            <MatchCardSkeleton key={i} />
          ))}
        </View>
      ) : (
        <SectionList
          sections={sections}
          renderItem={renderMatchCard}
          renderSectionHeader={renderSectionHeader}
          keyExtractor={item => item.id}
          contentContainerStyle={[
            styles.listContent,
            sections.length === 0 && styles.emptyListContent,
          ]}
          ListEmptyComponent={renderEmptyState}
          ListFooterComponent={renderFooter}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching && isManualRefresh.current}
              onRefresh={() => {
                isManualRefresh.current = true;
                refetch().finally(() => {
                  isManualRefresh.current = false;
                });
              }}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    paddingTop: spacingPixels[4],
    paddingHorizontal: spacingPixels[4],
    gap: spacingPixels[3],
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
  listContent: {
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[5],
    flexGrow: 1,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: '100%',
  },
  sectionHeader: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    marginBottom: spacingPixels[1],
  },
  footerLoader: {
    alignItems: 'center',
    paddingVertical: spacingPixels[4],
  },
});
