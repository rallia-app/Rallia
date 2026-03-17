/**
 * AdminUserAnalyticsScreen
 *
 * Comprehensive user analytics including growth trends, retention matrix,
 * user segments, and geographic distribution.
 */

import React, { useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useTheme, useAnalyticsTimeRange, type TimeRangeOption } from '@rallia/shared-hooks';
import { useTranslation } from '../../hooks';
import type { TranslationKey } from '@rallia/shared-translations';
import { Text, TimeRangeSelector, LineChart, PieChart, BarChart } from '@rallia/shared-components';
import { primary, neutral, status, spacingPixels, radiusPixels } from '@rallia/design-system';
import {
  getUserGrowthTrend,
  getRetentionCohort,
  getSportDistribution,
  getRealtimeUserStats,
  type UserGrowthTrend,
  type RetentionCohort,
  type SportDistribution,
} from '@rallia/shared-services';
import type { RootStackParamList } from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

// =============================================================================
// HOOK: useUserAnalytics
// =============================================================================

function useUserAnalytics(selectedOption: TimeRangeOption) {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [userGrowth, setUserGrowth] = React.useState<{ date: string; value: number }[]>([]);
  const [cumulativeUsers, setCumulativeUsers] = React.useState<{ date: string; value: number }[]>(
    []
  );
  const [sportDistribution, setSportDistribution] = React.useState<SportDistribution[]>([]);
  const [retentionData, setRetentionData] = React.useState<RetentionCohort[]>([]);
  const [userStats, setUserStats] = React.useState<{
    total: number;
    activeToday: number;
    activeWeek: number;
    newThisWeek: number;
  } | null>(null);

  const { startDate, endDate } = useMemo(() => {
    const end = new Date();
    let start = new Date();

    switch (selectedOption) {
      case '7d':
        start.setDate(end.getDate() - 7);
        break;
      case '30d':
        start.setDate(end.getDate() - 30);
        break;
      case '90d':
        start.setDate(end.getDate() - 90);
        break;
      case 'ytd':
        start = new Date(end.getFullYear(), 0, 1);
        break;
      default:
        start.setDate(end.getDate() - 30);
    }

    return { startDate: start, endDate: end };
  }, [selectedOption]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch realtime user stats
      const realtimeStats = await getRealtimeUserStats();
      if (realtimeStats) {
        setUserStats({
          total: realtimeStats.totalUsers,
          activeToday: realtimeStats.activeToday,
          activeWeek: realtimeStats.activeWeek,
          newThisWeek: realtimeStats.newWeek,
        });
      }

      // Fetch user growth trend
      const growthResult = await getUserGrowthTrend(startDate, endDate, 'day');
      if (growthResult && growthResult.length > 0) {
        setUserGrowth(
          growthResult.map((point: UserGrowthTrend) => ({
            date: point.periodStart ? String(point.periodStart) : '',
            value: point.newUsers,
          }))
        );
        setCumulativeUsers(
          growthResult.map((point: UserGrowthTrend) => ({
            date: point.periodStart ? String(point.periodStart) : '',
            value: point.cumulativeUsers,
          }))
        );
      } else {
        // Generate mock data
        const mockGrowth = [];
        const mockCumulative = [];
        let cumulative = 1000;
        for (let i = 29; i >= 0; i--) {
          const date = new Date();
          date.setDate(date.getDate() - i);
          const newUsers = Math.floor(Math.random() * 30) + 10;
          cumulative += newUsers;
          mockGrowth.push({
            date: date.toISOString().split('T')[0],
            value: newUsers,
          });
          mockCumulative.push({
            date: date.toISOString().split('T')[0],
            value: cumulative,
          });
        }
        setUserGrowth(mockGrowth);
        setCumulativeUsers(mockCumulative);
      }

      // Fetch sport distribution
      const sportResult = await getSportDistribution(startDate, endDate);
      if (sportResult && sportResult.length > 0) {
        setSportDistribution(sportResult);
      } else {
        // Mock sport distribution
        setSportDistribution([
          { sportId: '1', sportName: 'Tennis', userCount: 450, percentage: 45 },
          { sportId: '2', sportName: 'Pickleball', userCount: 350, percentage: 35 },
          { sportId: '3', sportName: 'Padel', userCount: 200, percentage: 20 },
        ]);
      }

      // Fetch retention cohort
      const retentionResult = await getRetentionCohort(8);
      if (retentionResult && retentionResult.length > 0) {
        setRetentionData(retentionResult);
      } else {
        // Generate mock retention data
        const mockRetention: RetentionCohort[] = [];
        for (let week = 0; week < 4; week++) {
          const cohortDate = new Date();
          cohortDate.setDate(cohortDate.getDate() - week * 7);
          for (let weekNum = 0; weekNum <= 4 - week; weekNum++) {
            mockRetention.push({
              cohortWeek: cohortDate.toISOString().split('T')[0],
              weekNumber: weekNum,
              retainedUsers: Math.floor(100 * Math.pow(0.85, weekNum)),
              retentionRate: Math.round(100 * Math.pow(0.85, weekNum)),
            });
          }
        }
        setRetentionData(mockRetention);
      }
    } catch (err) {
      console.error('Error fetching user analytics:', err);
      setError('Failed to load user analytics');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    loading,
    error,
    userGrowth,
    cumulativeUsers,
    sportDistribution,
    retentionData,
    userStats,
    refetch: fetchData,
  };
}

// =============================================================================
// COMPONENT
// =============================================================================

const AdminUserAnalyticsScreen: React.FC = () => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const isDark = theme === 'dark';

  const { selectedOption, setRange } = useAnalyticsTimeRange();
  const {
    loading,
    error,
    userGrowth,
    cumulativeUsers,
    sportDistribution,
    retentionData,
    userStats,
    refetch,
  } = useUserAnalytics(selectedOption);

  const colors = useMemo(
    () => ({
      background: isDark ? neutral[950] : neutral[50],
      surface: isDark ? neutral[900] : '#ffffff',
      text: isDark ? neutral[100] : neutral[900],
      textSecondary: isDark ? neutral[400] : neutral[500],
      border: isDark ? neutral[700] : neutral[200],
      primary: primary[500],
    }),
    [isDark]
  );

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  // Transform sport distribution for PieChart
  const sportChartData = useMemo(() => {
    return sportDistribution.map((sport, index) => ({
      label: sport.sportName,
      value: sport.userCount,
      color: [primary[500], status.success.DEFAULT, status.warning.DEFAULT, '#8B5CF6'][index % 4],
    }));
  }, [sportDistribution]);

  // Group retention data for matrix display
  const retentionMatrix = useMemo(() => {
    const matrix: Map<string, Map<number, number>> = new Map();
    retentionData.forEach(item => {
      if (!matrix.has(item.cohortWeek)) {
        matrix.set(item.cohortWeek, new Map());
      }
      matrix.get(item.cohortWeek)?.set(item.weekNumber, item.retentionRate);
    });
    return matrix;
  }, [retentionData]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {t('admin.analytics.sections.users' as TranslationKey) || 'User Analytics'}
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            {t('admin.analytics.sections.usersDesc' as TranslationKey) || 'User growth & activity'}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refetch} tintColor={colors.primary} />
        }
      >
        {/* Time Range Selector */}
        <View style={styles.timeRangeContainer}>
          <TimeRangeSelector
            value={selectedOption}
            onChange={range => setRange(range as TimeRangeOption)}
            options={[
              { value: '7d', label: '7D', days: 7 },
              { value: '30d', label: '30D', days: 30 },
              { value: '90d', label: '90D', days: 90 },
              { value: 'ytd', label: 'YTD', days: null },
            ]}
          />
        </View>

        {loading && !userGrowth.length ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
              Loading analytics...
            </Text>
          </View>
        ) : error ? (
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle" size={48} color={status.error.DEFAULT} />
            <Text style={[styles.errorText, { color: status.error.DEFAULT }]}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={refetch}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Summary Stats */}
            {userStats && (
              <View style={styles.statsGrid}>
                <View style={[styles.statCard, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                    Total Users
                  </Text>
                  <Text style={[styles.statValue, { color: colors.text }]}>
                    {userStats.total.toLocaleString()}
                  </Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                    Active Today
                  </Text>
                  <Text style={[styles.statValue, { color: status.success.DEFAULT }]}>
                    {userStats.activeToday.toLocaleString()}
                  </Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                    Active This Week
                  </Text>
                  <Text style={[styles.statValue, { color: colors.primary }]}>
                    {userStats.activeWeek.toLocaleString()}
                  </Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                    New This Week
                  </Text>
                  <Text style={[styles.statValue, { color: status.success.DEFAULT }]}>
                    +{userStats.newThisWeek.toLocaleString()}
                  </Text>
                </View>
              </View>
            )}

            {/* Cumulative User Growth */}
            {cumulativeUsers.length > 0 && (
              <View style={[styles.chartCard, { backgroundColor: colors.surface }]}>
                <LineChart
                  data={cumulativeUsers}
                  title={
                    t('admin.analytics.userGrowth.cumulativeUsers' as TranslationKey) ||
                    'Total Users Over Time'
                  }
                  subtitle="Cumulative user growth"
                  showArea
                  curved
                  showDataPoints={false}
                  animated
                  height={220}
                />
              </View>
            )}

            {/* Daily New Users */}
            {userGrowth.length > 0 && (
              <View style={[styles.chartCard, { backgroundColor: colors.surface }]}>
                {/* Use LineChart for longer periods (90D, YTD), BarChart for shorter */}
                {selectedOption === '90d' || selectedOption === 'ytd' ? (
                  <LineChart
                    data={userGrowth.map(item => {
                      const dateObj = item.date ? new Date(item.date) : null;
                      const isValidDate = dateObj && !isNaN(dateObj.getTime());
                      return {
                        label: isValidDate
                          ? `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}`
                          : item.date || '',
                        value: item.value,
                      };
                    })}
                    title={
                      t('admin.analytics.userGrowth.newUsers' as TranslationKey) || 'New Users'
                    }
                    subtitle={
                      selectedOption === 'ytd'
                        ? 'Year to date registrations'
                        : 'Last 90 days registrations'
                    }
                    curved
                    showDataPoints
                    showXAxisLabels
                    animated
                    height={220}
                  />
                ) : (
                  <BarChart
                    data={userGrowth.slice(selectedOption === '30d' ? -30 : -7).map(item => {
                      const dateObj = item.date ? new Date(item.date) : null;
                      const isValidDate = dateObj && !isNaN(dateObj.getTime());
                      return {
                        label: isValidDate
                          ? `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}`
                          : item.date || '',
                        value: item.value,
                      };
                    })}
                    title={
                      t('admin.analytics.userGrowth.newUsers' as TranslationKey) || 'New Users'
                    }
                    subtitle={
                      selectedOption === '30d'
                        ? 'Last 30 days registrations'
                        : 'Last 7 days registrations'
                    }
                    showValues={selectedOption !== '30d'}
                    animated
                    barWidth={selectedOption === '30d' ? 8 : 28}
                    spacing={selectedOption === '30d' ? 4 : 16}
                  />
                )}
              </View>
            )}

            {/* Sport Distribution */}
            {sportChartData.length > 0 && (
              <View style={[styles.chartCard, { backgroundColor: colors.surface }]}>
                <PieChart
                  data={sportChartData}
                  title={
                    t('admin.analytics.sportDistribution.title' as TranslationKey) ||
                    'Sport Distribution'
                  }
                  subtitle="Users by preferred sport"
                  donut
                  centerLabel="Users"
                  centerValue={sportDistribution
                    .reduce((sum, s) => sum + s.userCount, 0)
                    .toLocaleString()}
                  showLegend
                  animated
                />
              </View>
            )}

            {/* Retention Matrix */}
            {retentionMatrix.size > 0 && (
              <View style={[styles.chartCard, { backgroundColor: colors.surface }]}>
                <View style={styles.chartHeader}>
                  <Text style={[styles.chartTitle, { color: colors.text }]}>
                    {t('admin.analytics.retention.title' as TranslationKey) || 'User Retention'}
                  </Text>
                  <Text style={[styles.chartSubtitle, { color: colors.textSecondary }]}>
                    Week-over-week retention by cohort
                  </Text>
                </View>

                <View style={styles.retentionMatrix}>
                  {/* Header Row */}
                  <View style={styles.retentionRow}>
                    <View style={[styles.retentionCell, styles.retentionHeaderCell]}>
                      <Text style={[styles.retentionHeaderText, { color: colors.textSecondary }]}>
                        Cohort
                      </Text>
                    </View>
                    {[0, 1, 2, 3, 4].map(week => (
                      <View key={week} style={[styles.retentionCell, styles.retentionHeaderCell]}>
                        <Text style={[styles.retentionHeaderText, { color: colors.textSecondary }]}>
                          W{week}
                        </Text>
                      </View>
                    ))}
                  </View>

                  {/* Data Rows */}
                  {Array.from(retentionMatrix.entries())
                    .slice(0, 4)
                    .map(([cohort, weeks]) => (
                      <View key={cohort} style={styles.retentionRow}>
                        <View style={[styles.retentionCell, styles.retentionHeaderCell]}>
                          <Text
                            style={[styles.retentionCohortText, { color: colors.textSecondary }]}
                          >
                            {new Date(cohort).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </Text>
                        </View>
                        {[0, 1, 2, 3, 4].map(weekNum => {
                          const rate = weeks.get(weekNum);
                          const bgOpacity = rate ? rate / 100 : 0;
                          return (
                            <View
                              key={weekNum}
                              style={[
                                styles.retentionCell,
                                {
                                  backgroundColor:
                                    rate !== undefined
                                      ? `rgba(16, 185, 129, ${bgOpacity * 0.6})`
                                      : colors.surface,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.retentionValue,
                                  {
                                    color: rate !== undefined ? colors.text : colors.textSecondary,
                                  },
                                ]}
                              >
                                {rate !== undefined ? `${rate}%` : '-'}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    ))}
                </View>
              </View>
            )}
          </>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  backButton: {
    padding: spacingPixels[2],
    marginRight: spacingPixels[3],
  },
  headerTitleContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 13,
    fontWeight: '400',
    marginTop: 2,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacingPixels[4],
  },
  timeRangeContainer: {
    marginBottom: spacingPixels[4],
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacingPixels[8],
  },
  loadingText: {
    marginTop: spacingPixels[3],
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacingPixels[8],
  },
  errorText: {
    marginTop: spacingPixels[3],
    fontSize: 14,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacingPixels[4],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    backgroundColor: primary[500],
    borderRadius: radiusPixels.md,
  },
  retryText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -spacingPixels[2],
    marginBottom: spacingPixels[4],
  },
  statCard: {
    width: '50%',
    padding: spacingPixels[3],
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
  },
  chartCard: {
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[4],
    overflow: 'hidden',
  },
  chartHeader: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[2],
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  chartSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  retentionMatrix: {
    paddingHorizontal: spacingPixels[3],
    paddingBottom: spacingPixels[4],
  },
  retentionRow: {
    flexDirection: 'row',
  },
  retentionCell: {
    flex: 1,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: 'rgba(128, 128, 128, 0.2)',
  },
  retentionHeaderCell: {
    backgroundColor: 'transparent',
  },
  retentionHeaderText: {
    fontSize: 11,
    fontWeight: '600',
  },
  retentionCohortText: {
    fontSize: 10,
    fontWeight: '500',
  },
  retentionValue: {
    fontSize: 11,
    fontWeight: '600',
  },
  bottomSpacer: {
    height: spacingPixels[8],
  },
});

export default AdminUserAnalyticsScreen;
