/**
 * PlayerMatches Screen
 * Displays the user's matches with tabbed Upcoming/Past views and date-sectioned lists.
 *
 * Also handles deep linking from push notifications:
 * - When a match-related notification is tapped, this screen opens
 * - The screen checks for a pending match ID and opens the detail sheet
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
import { MatchCard, Text } from '@rallia/shared-components';
import { SportIcon } from '../../../components/SportIcon';
import { useTheme, usePlayerMatches, useMatch, usePlayerMatchFilters } from '@rallia/shared-hooks';
import type { MatchWithDetails } from '@rallia/shared-types';
import { useAuth, useThemeStyles, useTranslation } from '../../../hooks';
import type { TranslationKey } from '@rallia/shared-translations';
import { useMatchDetailSheet, useDeepLink, useSport } from '../../../context';
import { Logger } from '@rallia/shared-services';
import { PlayerMatchFilterChips } from '../components';
import { spacingPixels, neutral } from '@rallia/design-system';

// =============================================================================
// TYPES
// =============================================================================

type TimeFilter = 'upcoming' | 'past';

interface TranslationOptions {
  [key: string]: string | number | boolean;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the section key for a match date (for upcoming matches)
 */
function getUpcomingDateSectionKey(
  matchDate: string,
  t: (key: TranslationKey, options?: TranslationOptions) => string
): string {
  const date = new Date(matchDate + 'T00:00:00');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const thisWeekEnd = new Date(today);
  thisWeekEnd.setDate(thisWeekEnd.getDate() + 7);
  const nextWeekEnd = new Date(today);
  nextWeekEnd.setDate(nextWeekEnd.getDate() + 14);

  const matchDateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (matchDateOnly.getTime() === today.getTime()) {
    return t('playerMatches.time.today');
  } else if (matchDateOnly.getTime() === tomorrow.getTime()) {
    return t('playerMatches.time.tomorrow');
  } else if (matchDateOnly < thisWeekEnd) {
    return t('playerMatches.time.thisWeek');
  } else if (matchDateOnly < nextWeekEnd) {
    return t('playerMatches.time.nextWeek');
  } else {
    return t('playerMatches.time.later');
  }
}

/**
 * Get the section key for a match date (for past matches)
 * Now includes "Today" since matches can be past once their end_time has passed
 */
function getPastDateSectionKey(
  matchDate: string,
  t: (key: TranslationKey, options?: TranslationOptions) => string
): string {
  const date = new Date(matchDate + 'T00:00:00');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const lastWeekStart = new Date(today);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  const matchDateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  // Check for today first (matches that ended earlier today)
  if (matchDateOnly.getTime() === today.getTime()) {
    return t('playerMatches.time.today');
  } else if (matchDateOnly.getTime() === yesterday.getTime()) {
    return t('playerMatches.time.yesterday');
  } else if (matchDateOnly >= lastWeekStart) {
    return t('playerMatches.time.lastWeek');
  } else {
    return t('playerMatches.time.earlier');
  }
}

/**
 * Group matches by date section
 */
function groupMatchesByDate(
  matches: MatchWithDetails[],
  timeFilter: TimeFilter,
  t: (key: TranslationKey, options?: TranslationOptions) => string
): { title: string; data: MatchWithDetails[] }[] {
  const getSectionKey =
    timeFilter === 'upcoming' ? getUpcomingDateSectionKey : getPastDateSectionKey;

  // Define section order based on filter
  const order =
    timeFilter === 'upcoming'
      ? [
          t('playerMatches.time.today'),
          t('playerMatches.time.tomorrow'),
          t('playerMatches.time.thisWeek'),
          t('playerMatches.time.nextWeek'),
          t('playerMatches.time.later'),
        ]
      : [
          t('playerMatches.time.today'),
          t('playerMatches.time.yesterday'),
          t('playerMatches.time.lastWeek'),
          t('playerMatches.time.earlier'),
        ];

  const groups: Record<string, MatchWithDetails[]> = {};

  matches.forEach(match => {
    const key = getSectionKey(match.match_date, t);
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(match);
  });

  return order
    .filter(key => groups[key]?.length > 0)
    .map(key => ({ title: key, data: groups[key] }));
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
  const { consumePendingMatchId } = useDeepLink();
  const { selectedSport } = useSport();
  const isDark = theme === 'dark';

  // Tab state
  const [activeTab, setActiveTab] = useState<TimeFilter>('upcoming');

  // Filter state
  const {
    upcomingFilter,
    pastFilter,
    toggleUpcomingFilter,
    togglePastFilter,
    resetUpcomingFilter,
    resetPastFilter,
  } = usePlayerMatchFilters();

  // Get current filter based on active tab
  const currentStatusFilter = activeTab === 'upcoming' ? upcomingFilter : pastFilter;

  // Handle tab change - reset filters when switching tabs
  const handleTabChange = useCallback(
    (tab: TimeFilter) => {
      if (tab !== activeTab) {
        setActiveTab(tab);
        // Reset the filter for the tab we're leaving
        if (activeTab === 'upcoming') {
          resetUpcomingFilter();
        } else {
          resetPastFilter();
        }
      }
    },
    [activeTab, resetUpcomingFilter, resetPastFilter]
  );

  // Deep link handling - use ref to avoid cascading renders from setState in effect
  const pendingMatchIdRef = useRef<string | null>(null);
  const [pendingMatchId, setPendingMatchId] = useState<string | null>(null);

  // Fetch match data when we have a pending deep link
  const { match: deepLinkMatch, isLoading: isLoadingDeepLinkMatch } = useMatch(
    pendingMatchId ?? undefined,
    { enabled: !!pendingMatchId }
  );

  // Check for pending deep link on mount - deferred to avoid cascading renders
  useEffect(() => {
    const matchId = consumePendingMatchId();
    if (matchId) {
      Logger.logUserAction('deep_link_match_opening', { matchId });
      pendingMatchIdRef.current = matchId;
      // Use queueMicrotask to defer state update and avoid cascading render warning
      queueMicrotask(() => {
        setPendingMatchId(matchId);
      });
    }
  }, [consumePendingMatchId]);

  // Open match detail sheet when deep link match data is loaded
  useEffect(() => {
    if (deepLinkMatch && !isLoadingDeepLinkMatch && pendingMatchIdRef.current) {
      Logger.logUserAction('deep_link_match_opened', { matchId: pendingMatchIdRef.current });
      openMatchDetail(deepLinkMatch);
      // Clear the pending match ID after opening
      pendingMatchIdRef.current = null;
      queueMicrotask(() => {
        setPendingMatchId(null);
      });
    }
  }, [deepLinkMatch, isLoadingDeepLinkMatch, openMatchDetail]);

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

  // Group matches by date
  const sections = useMemo(
    () => groupMatchesByDate(matches, activeTab, t),
    [matches, activeTab, t]
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
          openMatchDetail(item);
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
        case 'pending':
          return 'hourglass-outline';
        case 'requested':
          return 'paper-plane-outline';
        case 'waitlisted':
          return 'list-outline';
        case 'needs_players':
          return 'people-outline';
        case 'ready_to_play':
          return 'checkmark-done-outline';
        case 'feedback_needed':
          return 'chatbubble-outline';
        case 'played':
          return 'trophy-outline';
        case 'as_participant':
          return 'people-outline';
        case 'expired':
          return 'time-outline';
        case 'cancelled':
          return 'close-circle-outline';
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
            `playerMatches.filters.${currentStatusFilter === 'needs_players' ? 'needsPlayers' : currentStatusFilter === 'ready_to_play' ? 'readyToPlay' : currentStatusFilter === 'feedback_needed' ? 'feedbackNeeded' : currentStatusFilter === 'as_participant' ? 'asParticipant' : currentStatusFilter}`
          ),
        }),
      };
    };

    const { title, description } = getEmptyContent();

    return (
      <View style={styles.emptyContainer}>
        <Ionicons name={getIcon()} size={64} color={colors.textMuted} />
        <Text size="lg" weight="semibold" color={colors.textMuted} style={styles.emptyTitle}>
          {title}
        </Text>
        <Text size="sm" color={colors.textMuted} style={styles.emptyDescription}>
          {description}
        </Text>
      </View>
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
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
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
              refreshing={isRefetching}
              onRefresh={refetch}
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
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: spacingPixels[3],
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
  emptyContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[8],
    paddingTop: spacingPixels[8],
    paddingBottom: spacingPixels[8],
  },
  emptyTitle: {
    marginTop: spacingPixels[4],
    marginBottom: spacingPixels[2],
    textAlign: 'center',
  },
  emptyDescription: {
    textAlign: 'center',
    lineHeight: 20,
  },
  footerLoader: {
    alignItems: 'center',
    paddingVertical: spacingPixels[4],
  },
});
