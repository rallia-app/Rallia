/**
 * MyBookingsScreen
 * Displays the user's court bookings with tabbed Upcoming/Past views and date-sectioned lists.
 * Mirrors PlayerMatches screen structure with infinite scroll, filter chips, and pull-to-refresh.
 */

import React, { useCallback, useMemo, useState, useRef } from 'react';
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
import { Text, Skeleton } from '@rallia/shared-components';
import { useTheme, usePlayerBookingsByTab, usePlayerBookingFilters } from '@rallia/shared-hooks';
import type { BookingWithDetails, BookingTab } from '@rallia/shared-services';
import { useAuth, useThemeStyles, useTranslation } from '../../../hooks';
import type { TranslationKey } from '@rallia/shared-translations';
import { spacingPixels } from '@rallia/design-system';
import { BookingCard, BookingFilterChips, BookingEmptyState } from '../components';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

interface TranslationOptions {
  [key: string]: string | number | boolean;
}

function getUpcomingDateSectionKey(
  bookingDate: string,
  t: (key: TranslationKey, options?: TranslationOptions) => string
): string {
  const date = new Date(bookingDate + 'T00:00:00');
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
    return t('myBookings.time.today');
  } else if (matchDateOnly.getTime() === tomorrow.getTime()) {
    return t('myBookings.time.tomorrow');
  } else if (matchDateOnly < thisWeekEnd) {
    return t('myBookings.time.thisWeek');
  } else if (matchDateOnly < nextWeekEnd) {
    return t('myBookings.time.nextWeek');
  } else {
    return t('myBookings.time.later');
  }
}

function getPastDateSectionKey(
  bookingDate: string,
  t: (key: TranslationKey, options?: TranslationOptions) => string
): string {
  const date = new Date(bookingDate + 'T00:00:00');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const lastWeekStart = new Date(today);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  const matchDateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (matchDateOnly.getTime() === today.getTime()) {
    return t('myBookings.time.today');
  } else if (matchDateOnly.getTime() === yesterday.getTime()) {
    return t('myBookings.time.yesterday');
  } else if (matchDateOnly >= lastWeekStart) {
    return t('myBookings.time.lastWeek');
  } else {
    return t('myBookings.time.earlier');
  }
}

function groupBookingsByDate(
  bookings: BookingWithDetails[],
  timeFilter: BookingTab,
  t: (key: TranslationKey, options?: TranslationOptions) => string
): { title: string; data: BookingWithDetails[] }[] {
  const getSectionKey =
    timeFilter === 'upcoming' ? getUpcomingDateSectionKey : getPastDateSectionKey;

  const order =
    timeFilter === 'upcoming'
      ? [
          t('myBookings.time.today'),
          t('myBookings.time.tomorrow'),
          t('myBookings.time.thisWeek'),
          t('myBookings.time.nextWeek'),
          t('myBookings.time.later'),
        ]
      : [
          t('myBookings.time.today'),
          t('myBookings.time.yesterday'),
          t('myBookings.time.lastWeek'),
          t('myBookings.time.earlier'),
        ];

  const groups: Record<string, BookingWithDetails[]> = {};

  bookings.forEach(booking => {
    const key = getSectionKey(booking.booking_date, t);
    if (!groups[key]) groups[key] = [];
    groups[key].push(booking);
  });

  const sortBookingsInSection = (a: BookingWithDetails, b: BookingWithDetails) => {
    const dateCmp = a.booking_date.localeCompare(b.booking_date);
    if (dateCmp !== 0) return timeFilter === 'upcoming' ? dateCmp : -dateCmp;
    return timeFilter === 'upcoming'
      ? a.start_time.localeCompare(b.start_time)
      : b.start_time.localeCompare(a.start_time);
  };

  return order
    .filter(key => groups[key]?.length > 0)
    .map(key => ({ title: key, data: [...groups[key]].sort(sortBookingsInSection) }));
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function MyBookingsScreen() {
  const { session } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { colors } = useThemeStyles();
  const isDark = theme === 'dark';

  // Tab state
  const [activeTab, setActiveTab] = useState<BookingTab>('upcoming');

  // Filter state
  const {
    upcomingFilter,
    pastFilter,
    toggleUpcomingFilter,
    togglePastFilter,
    resetUpcomingFilter,
    resetPastFilter,
  } = usePlayerBookingFilters();

  const currentStatusFilter = activeTab === 'upcoming' ? upcomingFilter : pastFilter;

  const handleTabChange = useCallback(
    (tab: BookingTab) => {
      if (tab !== activeTab) {
        setActiveTab(tab);
        if (activeTab === 'upcoming') {
          resetUpcomingFilter();
        } else {
          resetPastFilter();
        }
      }
    },
    [activeTab, resetUpcomingFilter, resetPastFilter]
  );

  // Fetch bookings
  const isManualRefresh = useRef(false);
  const {
    bookings,
    isLoading,
    isRefetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = usePlayerBookingsByTab({
    playerId: session?.user?.id,
    timeFilter: activeTab,
    statusFilter: currentStatusFilter,
    limit: 20,
    enabled: !!session?.user?.id,
  });

  // Group bookings by date
  const sections = useMemo(
    () => groupBookingsByDate(bookings, activeTab, t),
    [bookings, activeTab, t]
  );

  // Handle load more
  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Render booking card
  const renderBookingCard = useCallback(
    ({ item }: { item: BookingWithDetails }) => <BookingCard booking={item} />,
    []
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

  // Render empty state
  const renderEmptyState = () => (
    <BookingEmptyState activeTab={activeTab} currentStatusFilter={currentStatusFilter} />
  );

  // Render footer
  const renderFooter = () => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  };

  // Render tab bar
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
          {t('myBookings.tabs.upcoming')}
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
          {t('myBookings.tabs.past')}
        </Text>
      </TouchableOpacity>
    </View>
  );

  // Render filter chips
  const renderFilterChips = () => (
    <BookingFilterChips
      timeFilter={activeTab}
      upcomingFilter={upcomingFilter}
      pastFilter={pastFilter}
      onUpcomingFilterToggle={toggleUpcomingFilter}
      onPastFilterToggle={togglePastFilter}
    />
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      {renderTabBar()}
      {renderFilterChips()}

      {isLoading ? (
        <View style={styles.loadingContainer}>
          {[1, 2, 3, 4, 5].map(i => {
            const skBg = isDark ? '#2C2C2E' : '#E1E9EE';
            const skHl = isDark ? '#3C3C3E' : '#F2F8FC';
            return (
              <View
                key={i}
                style={[
                  styles.skeletonBookingCard,
                  { backgroundColor: isDark ? '#1C1C1E' : '#FAFAFA', borderColor: colors.border },
                ]}
              >
                {/* Facility name + status badge row */}
                <View style={styles.skeletonBookingRow}>
                  <Skeleton width="50%" height={16} backgroundColor={skBg} highlightColor={skHl} />
                  <Skeleton
                    width={60}
                    height={20}
                    borderRadius={10}
                    backgroundColor={skBg}
                    highlightColor={skHl}
                  />
                </View>
                {/* Court row */}
                <View style={styles.skeletonBookingIconRow}>
                  <Skeleton
                    width={14}
                    height={14}
                    circle
                    backgroundColor={skBg}
                    highlightColor={skHl}
                  />
                  <Skeleton
                    width="40%"
                    height={13}
                    backgroundColor={skBg}
                    highlightColor={skHl}
                    style={{ marginLeft: 8 }}
                  />
                </View>
                {/* Date & time row */}
                <View style={styles.skeletonBookingIconRow}>
                  <Skeleton
                    width={14}
                    height={14}
                    circle
                    backgroundColor={skBg}
                    highlightColor={skHl}
                  />
                  <Skeleton
                    width="55%"
                    height={13}
                    backgroundColor={skBg}
                    highlightColor={skHl}
                    style={{ marginLeft: 8 }}
                  />
                </View>
                {/* Price row */}
                <View style={styles.skeletonBookingIconRow}>
                  <Skeleton
                    width={14}
                    height={14}
                    circle
                    backgroundColor={skBg}
                    highlightColor={skHl}
                  />
                  <Skeleton
                    width={50}
                    height={13}
                    backgroundColor={skBg}
                    highlightColor={skHl}
                    style={{ marginLeft: 8 }}
                  />
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <SectionList
          sections={sections}
          renderItem={renderBookingCard}
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
    paddingTop: 16,
    paddingHorizontal: 16,
    gap: 12,
  },
  skeletonBookingCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  skeletonBookingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  skeletonBookingIconRow: {
    flexDirection: 'row',
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
  footerLoader: {
    alignItems: 'center',
    paddingVertical: spacingPixels[4],
  },
});
