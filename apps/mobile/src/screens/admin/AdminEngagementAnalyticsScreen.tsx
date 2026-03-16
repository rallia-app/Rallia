/**
 * AdminEngagementAnalyticsScreen
 *
 * Comprehensive engagement analytics including session metrics,
 * feature adoption rates, and screen analytics.
 */

import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useTheme, useAnalyticsTimeRange, type TimeRangeOption } from '@rallia/shared-hooks';
import { useTranslation } from '../../hooks';
import type { TranslationKey } from '@rallia/shared-translations';
import { Text, TimeRangeSelector, LineChart, BarChart } from '@rallia/shared-components';
import { primary, neutral, status, spacingPixels, radiusPixels } from '@rallia/design-system';
import {
  getSessionMetrics,
  getFeatureAdoption,
  getScreenAnalytics,
  type SessionMetrics,
  type FeatureAdoption,
  type ScreenAnalytics,
} from '@rallia/shared-services';
import type { RootStackParamList } from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

// =============================================================================
// HOOK: useEngagementAnalytics
// =============================================================================

function useEngagementAnalytics(selectedOption: TimeRangeOption) {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [sessionMetrics, setSessionMetrics] = React.useState<SessionMetrics[]>([]);
  const [featureAdoption, setFeatureAdoption] = React.useState<FeatureAdoption[]>([]);
  const [screenStats, setScreenStats] = React.useState<ScreenAnalytics[]>([]);
  const [summaryMetrics, setSummaryMetrics] = React.useState<{
    avgSessions: number;
    avgDuration: number;
    avgScreens: number;
    avgBounceRate: number;
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
      // Fetch session metrics
      const sessionsResult = await getSessionMetrics(startDate, endDate);
      if (sessionsResult && sessionsResult.length > 0) {
        setSessionMetrics(sessionsResult);

        // Calculate summary metrics
        const totalSessions = sessionsResult.reduce(
          (sum: number, s: SessionMetrics) => sum + s.sessionsCount,
          0
        );
        const totalDuration = sessionsResult.reduce(
          (sum: number, s: SessionMetrics) => sum + s.avgSessionDuration * s.sessionsCount,
          0
        );
        const totalScreens = sessionsResult.reduce(
          (sum: number, s: SessionMetrics) => sum + s.screensPerSession * s.sessionsCount,
          0
        );
        const totalBounceRate = sessionsResult.reduce(
          (sum: number, s: SessionMetrics) => sum + s.bounceRate,
          0
        );

        setSummaryMetrics({
          avgSessions: Math.round(totalSessions / sessionsResult.length),
          avgDuration: totalSessions > 0 ? Math.round(totalDuration / totalSessions) : 0,
          avgScreens: totalSessions > 0 ? Math.round((totalScreens / totalSessions) * 10) / 10 : 0,
          avgBounceRate: Math.round(totalBounceRate / sessionsResult.length),
        });
      }

      // Fetch feature adoption
      const adoptionResult = await getFeatureAdoption(startDate, endDate);
      if (adoptionResult && adoptionResult.length > 0) {
        setFeatureAdoption(adoptionResult);
      }

      // Fetch screen analytics
      const screenResult = await getScreenAnalytics(startDate, endDate, 10);
      if (screenResult && screenResult.length > 0) {
        setScreenStats(screenResult);
      }
    } catch (err) {
      console.error('Error fetching engagement analytics:', err);
      setError('Failed to load engagement analytics');
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
    sessionMetrics,
    featureAdoption,
    screenStats,
    summaryMetrics,
    refetch: fetchData,
  };
}

// =============================================================================
// COMPONENT
// =============================================================================

const AdminEngagementAnalyticsScreen: React.FC = () => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const isDark = theme === 'dark';

  const { selectedOption, setRange } = useAnalyticsTimeRange();
  const { loading, error, sessionMetrics, featureAdoption, screenStats, summaryMetrics, refetch } =
    useEngagementAnalytics(selectedOption);

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

  // Transform session metrics for LineChart
  const sessionChartData = useMemo(() => {
    return sessionMetrics.map(session => ({
      label: session.date.slice(5), // MM-DD
      value: session.sessionsCount,
    }));
  }, [sessionMetrics]);

  const durationChartData = useMemo(() => {
    return sessionMetrics.map(session => ({
      label: session.date.slice(5),
      value: Math.round(session.avgSessionDuration / 60), // Convert to minutes
    }));
  }, [sessionMetrics]);

  // Transform feature adoption for horizontal bar chart
  const featureChartData = useMemo(() => {
    return featureAdoption.map(feature => ({
      label: formatFeatureName(feature.featureName),
      value: feature.adoptionRate,
    }));
  }, [featureAdoption]);

  // Transform screen stats for bar chart
  const screenChartData = useMemo(() => {
    return screenStats.slice(0, 8).map(screen => ({
      label: formatScreenName(screen.screenName),
      value: screen.totalViews,
    }));
  }, [screenStats]);

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
            {t('admin.analytics.screens.engagement.title' as TranslationKey) ||
              'Engagement Analytics'}
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            {t('admin.analytics.screens.engagement.subtitle' as TranslationKey) ||
              'User behavior & feature adoption'}
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
              { value: 'ytd', label: 'YTD', days: 365 },
            ]}
          />
        </View>

        {/* Summary Metrics */}
        {summaryMetrics && (
          <View style={styles.metricsGrid}>
            <View style={[styles.metricCard, { backgroundColor: colors.surface }]}>
              <View style={[styles.metricIcon, { backgroundColor: primary[100] }]}>
                <Ionicons name="analytics" size={20} color={primary[600]} />
              </View>
              <Text style={[styles.metricValue, { color: colors.text }]}>
                {summaryMetrics.avgSessions.toLocaleString()}
              </Text>
              <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
                {t('admin.analytics.screens.engagement.avgSessions' as TranslationKey) ||
                  'Avg Daily Sessions'}
              </Text>
            </View>

            <View style={[styles.metricCard, { backgroundColor: colors.surface }]}>
              <View style={[styles.metricIcon, { backgroundColor: status.success.light }]}>
                <Ionicons name="time" size={20} color={status.success.DEFAULT} />
              </View>
              <Text style={[styles.metricValue, { color: colors.text }]}>
                {formatDuration(summaryMetrics.avgDuration)}
              </Text>
              <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
                {t('admin.analytics.screens.engagement.avgDuration' as TranslationKey) ||
                  'Avg Duration'}
              </Text>
            </View>

            <View style={[styles.metricCard, { backgroundColor: colors.surface }]}>
              <View style={[styles.metricIcon, { backgroundColor: status.warning.light }]}>
                <Ionicons name="layers" size={20} color={status.warning.DEFAULT} />
              </View>
              <Text style={[styles.metricValue, { color: colors.text }]}>
                {summaryMetrics.avgScreens}
              </Text>
              <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
                {t('admin.analytics.screens.engagement.screensPerSession' as TranslationKey) ||
                  'Screens/Session'}
              </Text>
            </View>

            <View style={[styles.metricCard, { backgroundColor: colors.surface }]}>
              <View style={[styles.metricIcon, { backgroundColor: status.error.light }]}>
                <Ionicons name="exit" size={20} color={status.error.DEFAULT} />
              </View>
              <Text style={[styles.metricValue, { color: colors.text }]}>
                {summaryMetrics.avgBounceRate}%
              </Text>
              <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
                {t('admin.analytics.screens.engagement.bounceRate' as TranslationKey) ||
                  'Bounce Rate'}
              </Text>
            </View>
          </View>
        )}

        {/* Sessions Trend */}
        <View style={[styles.chartCard, { backgroundColor: colors.surface }]}>
          <Text style={[styles.chartTitle, { color: colors.text }]}>
            {t('admin.analytics.screens.engagement.sessionsTrend' as TranslationKey) ||
              'Daily Sessions'}
          </Text>
          <Text style={[styles.chartSubtitle, { color: colors.textSecondary }]}>
            {t('admin.analytics.screens.engagement.sessionsTrendDesc' as TranslationKey) ||
              'Number of user sessions per day'}
          </Text>
          {sessionChartData.length > 0 ? (
            <View style={styles.chartContainer}>
              <LineChart
                data={sessionChartData}
                height={200}
                lineColor={primary[500]}
                showDataPoints
                showGrid
                curved
              />
            </View>
          ) : (
            <View style={styles.noDataContainer}>
              <Text style={[styles.noDataText, { color: colors.textSecondary }]}>
                {t('admin.analytics.noData' as TranslationKey) || 'No data available'}
              </Text>
            </View>
          )}
        </View>

        {/* Session Duration Trend */}
        <View style={[styles.chartCard, { backgroundColor: colors.surface }]}>
          <Text style={[styles.chartTitle, { color: colors.text }]}>
            {t('admin.analytics.screens.engagement.durationTrend' as TranslationKey) ||
              'Session Duration'}
          </Text>
          <Text style={[styles.chartSubtitle, { color: colors.textSecondary }]}>
            {t('admin.analytics.screens.engagement.durationTrendDesc' as TranslationKey) ||
              'Average session duration in minutes'}
          </Text>
          {durationChartData.length > 0 ? (
            <View style={styles.chartContainer}>
              <LineChart
                data={durationChartData}
                height={200}
                lineColor={status.success.DEFAULT}
                showDataPoints
                showGrid
                curved
              />
            </View>
          ) : (
            <View style={styles.noDataContainer}>
              <Text style={[styles.noDataText, { color: colors.textSecondary }]}>
                {t('admin.analytics.noData' as TranslationKey) || 'No data available'}
              </Text>
            </View>
          )}
        </View>

        {/* Feature Adoption */}
        <View style={[styles.chartCard, { backgroundColor: colors.surface }]}>
          <Text style={[styles.chartTitle, { color: colors.text }]}>
            {t('admin.analytics.screens.engagement.featureAdoption' as TranslationKey) ||
              'Feature Adoption'}
          </Text>
          <Text style={[styles.chartSubtitle, { color: colors.textSecondary }]}>
            {t('admin.analytics.screens.engagement.featureAdoptionDesc' as TranslationKey) ||
              'Percentage of users using each feature'}
          </Text>
          {featureChartData.length > 0 ? (
            <View style={styles.featureListContainer}>
              {featureAdoption.map((feature, index) => (
                <View key={feature.featureName} style={styles.featureItem}>
                  <View style={styles.featureInfo}>
                    <Text style={[styles.featureName, { color: colors.text }]}>
                      {formatFeatureName(feature.featureName)}
                    </Text>
                    <Text style={[styles.featureUsers, { color: colors.textSecondary }]}>
                      {feature.usersAdopted.toLocaleString()} users
                    </Text>
                  </View>
                  <View style={styles.featureBarContainer}>
                    <View
                      style={[
                        styles.featureBar,
                        {
                          width: `${feature.adoptionRate}%`,
                          backgroundColor: getFeatureColor(index),
                        },
                      ]}
                    />
                    <Text style={[styles.featurePercentage, { color: colors.text }]}>
                      {feature.adoptionRate}%
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.noDataContainer}>
              <Text style={[styles.noDataText, { color: colors.textSecondary }]}>
                {t('admin.analytics.noData' as TranslationKey) || 'No data available'}
              </Text>
            </View>
          )}
        </View>

        {/* Most Viewed Screens */}
        <View style={[styles.chartCard, { backgroundColor: colors.surface }]}>
          <Text style={[styles.chartTitle, { color: colors.text }]}>
            {t('admin.analytics.screens.engagement.topScreens' as TranslationKey) || 'Top Screens'}
          </Text>
          <Text style={[styles.chartSubtitle, { color: colors.textSecondary }]}>
            {t('admin.analytics.screens.engagement.topScreensDesc' as TranslationKey) ||
              'Most viewed screens by total views'}
          </Text>
          {screenChartData.length > 0 ? (
            <View style={styles.chartContainer}>
              <BarChart
                data={screenChartData}
                height={250}
                barColor={primary[500]}
                showValues
                horizontal
              />
            </View>
          ) : (
            <View style={styles.noDataContainer}>
              <Text style={[styles.noDataText, { color: colors.textSecondary }]}>
                {t('admin.analytics.noData' as TranslationKey) || 'No data available'}
              </Text>
            </View>
          )}
        </View>

        {/* Screen Details Table */}
        <View style={[styles.chartCard, { backgroundColor: colors.surface }]}>
          <Text style={[styles.chartTitle, { color: colors.text }]}>
            {t('admin.analytics.screens.engagement.screenDetails' as TranslationKey) ||
              'Screen Details'}
          </Text>
          <Text style={[styles.chartSubtitle, { color: colors.textSecondary }]}>
            {t('admin.analytics.screens.engagement.screenDetailsDesc' as TranslationKey) ||
              'Detailed screen performance metrics'}
          </Text>

          {/* Table Header */}
          <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.tableHeaderCell, styles.screenNameCell, { color: colors.text }]}>
              Screen
            </Text>
            <Text style={[styles.tableHeaderCell, styles.numberCell, { color: colors.text }]}>
              Views
            </Text>
            <Text style={[styles.tableHeaderCell, styles.numberCell, { color: colors.text }]}>
              Avg Time
            </Text>
            <Text style={[styles.tableHeaderCell, styles.numberCell, { color: colors.text }]}>
              Bounce
            </Text>
          </View>

          {/* Table Rows */}
          {screenStats.slice(0, 10).map((screen, index) => (
            <View
              key={screen.screenName}
              style={[
                styles.tableRow,
                { borderBottomColor: colors.border },
                index % 2 === 0 && { backgroundColor: isDark ? neutral[800] : neutral[50] },
              ]}
            >
              <Text
                style={[styles.tableCell, styles.screenNameCell, { color: colors.text }]}
                numberOfLines={1}
              >
                {formatScreenName(screen.screenName)}
              </Text>
              <Text style={[styles.tableCell, styles.numberCell, { color: colors.text }]}>
                {screen.totalViews.toLocaleString()}
              </Text>
              <Text style={[styles.tableCell, styles.numberCell, { color: colors.text }]}>
                {screen.avgTimeOnScreen}s
              </Text>
              <Text style={[styles.tableCell, styles.numberCell, { color: colors.text }]}>
                {screen.bounceRate}%
              </Text>
            </View>
          ))}
        </View>

        {/* Error State */}
        {error && (
          <View style={[styles.errorCard, { backgroundColor: status.error.light }]}>
            <Ionicons name="alert-circle" size={24} color={status.error.DEFAULT} />
            <Text style={[styles.errorText, { color: status.error.DEFAULT }]}>{error}</Text>
          </View>
        )}

        {/* Bottom Padding */}
        <View style={styles.bottomPadding} />
      </ScrollView>
    </SafeAreaView>
  );
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function formatFeatureName(name: string): string {
  const names: Record<string, string> = {
    match_creation: 'Match Creation',
    messaging: 'Messaging',
    player_directory: 'Player Directory',
    groups_networks: 'Groups & Networks',
    rating_verification: 'Rating Verification',
    match_sharing: 'Match Sharing',
  };
  return names[name] || name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function formatScreenName(name: string): string {
  // CamelCase to Title Case
  return name.replace(/([A-Z])/g, ' $1').trim();
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
}

function getFeatureColor(index: number): string {
  const colors = [
    primary[500],
    status.success.DEFAULT,
    status.warning.DEFAULT,
    '#8B5CF6',
    '#EC4899',
    '#06B6D4',
  ];
  return colors[index % colors.length];
}

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
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -spacingPixels[1],
    marginBottom: spacingPixels[4],
  },
  metricCard: {
    width: '50%',
    paddingHorizontal: spacingPixels[1],
    marginBottom: spacingPixels[2],
  },
  metricIcon: {
    width: 36,
    height: 36,
    borderRadius: radiusPixels.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[2],
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: spacingPixels[1],
  },
  metricLabel: {
    fontSize: 12,
  },
  chartCard: {
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[4],
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: spacingPixels[1],
  },
  chartSubtitle: {
    fontSize: 13,
    marginBottom: spacingPixels[4],
  },
  chartContainer: {
    marginTop: spacingPixels[2],
  },
  noDataContainer: {
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noDataText: {
    fontSize: 14,
  },
  featureListContainer: {
    marginTop: spacingPixels[2],
  },
  featureItem: {
    marginBottom: spacingPixels[3],
  },
  featureInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacingPixels[1],
  },
  featureName: {
    fontSize: 14,
    fontWeight: '500',
  },
  featureUsers: {
    fontSize: 12,
  },
  featureBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 24,
    backgroundColor: neutral[200],
    borderRadius: radiusPixels.sm,
    overflow: 'hidden',
  },
  featureBar: {
    height: '100%',
    borderRadius: radiusPixels.sm,
  },
  featurePercentage: {
    position: 'absolute',
    right: spacingPixels[2],
    fontSize: 12,
    fontWeight: '600',
  },
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: spacingPixels[2],
    borderBottomWidth: 1,
  },
  tableHeaderCell: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: spacingPixels[2.5],
    borderBottomWidth: 1,
  },
  tableCell: {
    fontSize: 13,
  },
  screenNameCell: {
    flex: 1,
    paddingRight: spacingPixels[2],
  },
  numberCell: {
    width: 60,
    textAlign: 'right',
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[4],
    gap: spacingPixels[3],
  },
  errorText: {
    flex: 1,
    fontSize: 14,
  },
  bottomPadding: {
    height: spacingPixels[8],
  },
});

export default AdminEngagementAnalyticsScreen;
