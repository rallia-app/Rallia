/**
 * AdminSportAnalyticsScreen
 *
 * Comprehensive sport analytics including sport popularity,
 * activity comparison, growth trends, and facility data.
 */

import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BarChart, PieChart } from 'react-native-gifted-charts';

import { useTheme, useAnalyticsTimeRange, type TimeRangeOption } from '@rallia/shared-hooks';
import { useTranslation } from '../../hooks';
import type { TranslationKey } from '@rallia/shared-translations';
import { Text, TimeRangeSelector, LineChart } from '@rallia/shared-components';
import { primary, neutral, status, spacingPixels, radiusPixels } from '@rallia/design-system';
import {
  getSportPopularity,
  getSportActivityComparison,
  getSportGrowthTrends,
  getSportFacilityData,
  type SportPopularity,
  type SportActivityComparison,
  type SportGrowthTrend,
  type SportFacilityData,
} from '@rallia/shared-services';
import type { RootStackParamList } from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

// =============================================================================
// HOOK: useSportAnalytics
// =============================================================================

function useSportAnalytics(selectedOption: TimeRangeOption) {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [sportPopularity, setSportPopularity] = React.useState<SportPopularity[]>([]);
  const [activityComparison, setActivityComparison] = React.useState<SportActivityComparison[]>([]);
  const [growthTrends, setGrowthTrends] = React.useState<SportGrowthTrend[]>([]);
  const [facilityData, setFacilityData] = React.useState<SportFacilityData[]>([]);
  const [summaryMetrics, setSummaryMetrics] = React.useState<{
    totalSports: number;
    totalMatches: number;
    totalFacilities: number;
    avgGrowth: number;
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
      // Fetch sport popularity
      const popularityResult = await getSportPopularity();
      if (popularityResult && popularityResult.length > 0) {
        setSportPopularity(popularityResult);

        // Calculate summary metrics from popularity data
        const totalMatches = popularityResult.reduce((sum, s) => sum + (s.totalMatches || 0), 0);
        const avgGrowth =
          popularityResult.reduce((sum, s) => sum + (s.growthPercent || 0), 0) /
          popularityResult.length;
        setSummaryMetrics(prev => ({
          totalSports: popularityResult.length,
          totalMatches,
          totalFacilities: prev?.totalFacilities || 0,
          avgGrowth,
        }));
      }

      // Fetch activity comparison (use static filtering based on date range)
      const comparisonResult = await getSportActivityComparison(startDate, endDate);
      if (comparisonResult) {
        setActivityComparison(comparisonResult);
      }

      // Fetch growth trends
      const trendsResult = await getSportGrowthTrends();
      if (trendsResult && trendsResult.length > 0) {
        setGrowthTrends(trendsResult);
      }

      // Fetch facility data
      const facilityResult = await getSportFacilityData();
      if (facilityResult && facilityResult.length > 0) {
        setFacilityData(facilityResult);

        // Calculate total facilities
        const totalFacilities = facilityResult.reduce((sum, f) => sum + (f.facilityCount || 0), 0);
        setSummaryMetrics(prev => (prev ? { ...prev, totalFacilities } : null));
      }
    } catch (err) {
      console.error('Error fetching sport analytics:', err);
      setError('Failed to load sport analytics data');
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
    sportPopularity,
    activityComparison,
    growthTrends,
    facilityData,
    summaryMetrics,
    refetch: fetchData,
  };
}

// =============================================================================
// COMPONENT: AdminSportAnalyticsScreen
// =============================================================================

export default function AdminSportAnalyticsScreen() {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const isDark = theme === 'dark';

  const { selectedOption, setRange } = useAnalyticsTimeRange();

  const {
    loading,
    error,
    sportPopularity,
    activityComparison,
    growthTrends,
    facilityData,
    summaryMetrics,
    refetch,
  } = useSportAnalytics(selectedOption);

  // Colors based on theme
  const colors = useMemo(
    () => ({
      background: isDark ? neutral[950] : neutral[50],
      card: isDark ? neutral[900] : '#ffffff',
      text: isDark ? neutral[100] : neutral[900],
      textSecondary: isDark ? neutral[400] : neutral[500],
      border: isDark ? neutral[700] : neutral[200],
    }),
    [isDark]
  );

  // Chart colors
  const chartColors = useMemo(
    () => ({
      primary: primary[500],
      secondary: status.success.DEFAULT,
      tertiary: status.warning.DEFAULT,
      quaternary: status.error.DEFAULT,
      neutral: neutral[400],
    }),
    []
  );

  // Sport popularity pie chart data
  const popularityChartData = useMemo(() => {
    if (!sportPopularity || sportPopularity.length === 0) return [];

    const pieColors = [
      chartColors.primary,
      chartColors.secondary,
      chartColors.tertiary,
      chartColors.quaternary,
      chartColors.neutral,
      primary[300],
      primary[700],
    ];

    return sportPopularity.slice(0, 6).map((sport, index) => ({
      value: sport.playerCount,
      text: sport.sportName,
      color: pieColors[index % pieColors.length],
    }));
  }, [sportPopularity, chartColors]);

  // Activity comparison bar chart data
  const activityChartData = useMemo(() => {
    if (!activityComparison || activityComparison.length === 0) return [];

    return activityComparison.slice(0, 6).map(sport => ({
      value: sport.totalMatches,
      label:
        sport.sportName.length > 10 ? sport.sportName.substring(0, 10) + '...' : sport.sportName,
      frontColor: chartColors.primary,
    }));
  }, [activityComparison, chartColors]);

  // Growth trends line chart data - show total matches over time
  const growthChartData = useMemo(() => {
    if (!growthTrends || growthTrends.length === 0) return [];

    // Aggregate total matches per date across all sports
    return growthTrends.slice(-14).map(trend => {
      const totalMatches = trend.sports?.reduce((sum, s) => sum + (s.matchCount || 0), 0) || 0;
      return {
        value: totalMatches,
        label: new Date(trend.date)
          .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          .split(' ')[0],
      };
    });
  }, [growthTrends]);

  // Growth rates bar chart - use sportPopularity growth data
  const growthRatesChartData = useMemo(() => {
    if (!sportPopularity || sportPopularity.length === 0) return [];

    return sportPopularity.map(sport => ({
      value: Math.max(0, sport.growthPercent || 0), // Only positive for bar chart
      label: sport.sportName.length > 8 ? sport.sportName.substring(0, 8) + '...' : sport.sportName,
      frontColor: (sport.growthPercent || 0) >= 0 ? chartColors.secondary : chartColors.quaternary,
    }));
  }, [sportPopularity, chartColors]);

  // Facility utilization chart data
  const facilityChartData = useMemo(() => {
    if (!facilityData || facilityData.length === 0) return [];

    return facilityData.map(facility => ({
      value: facility.avgUtilization,
      label:
        facility.sportName.length > 8
          ? facility.sportName.substring(0, 8) + '...'
          : facility.sportName,
      frontColor:
        facility.avgUtilization >= 70
          ? chartColors.secondary
          : facility.avgUtilization >= 40
            ? chartColors.tertiary
            : chartColors.quaternary,
    }));
  }, [facilityData, chartColors]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {t('admin.analytics.sections.sports' as TranslationKey) || 'Sports Analytics'}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={refetch}
            tintColor={chartColors.primary}
          />
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

        {/* Error State */}
        {error && (
          <View style={[styles.errorContainer, { backgroundColor: status.error.light }]}>
            <Ionicons name="alert-circle" size={20} color={status.error.DEFAULT} />
            <Text style={[styles.errorText, { color: status.error.DEFAULT }]}>{error}</Text>
          </View>
        )}

        {/* Summary Metrics */}
        {summaryMetrics && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('admin.analytics.sports.overview' as TranslationKey) || 'Overview'}
            </Text>
            <View style={styles.metricsGrid}>
              <View style={[styles.metricCard, { backgroundColor: colors.card }]}>
                <Ionicons name="basketball" size={24} color={chartColors.primary} />
                <Text style={[styles.metricValue, { color: colors.text }]}>
                  {summaryMetrics.totalSports || 0}
                </Text>
                <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
                  {t('admin.analytics.sports.totalSports' as TranslationKey) || 'Sports'}
                </Text>
              </View>
              <View style={[styles.metricCard, { backgroundColor: colors.card }]}>
                <Ionicons name="trophy" size={24} color={chartColors.secondary} />
                <Text style={[styles.metricValue, { color: colors.text }]}>
                  {(summaryMetrics.totalMatches || 0).toLocaleString()}
                </Text>
                <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
                  {t('admin.analytics.sports.totalMatches' as TranslationKey) || 'Total Matches'}
                </Text>
              </View>
              <View style={[styles.metricCard, { backgroundColor: colors.card }]}>
                <Ionicons name="location" size={24} color={chartColors.tertiary} />
                <Text style={[styles.metricValue, { color: colors.text }]}>
                  {summaryMetrics.totalFacilities || 0}
                </Text>
                <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
                  {t('admin.analytics.sports.facilities' as TranslationKey) || 'Facilities'}
                </Text>
              </View>
              <View style={[styles.metricCard, { backgroundColor: colors.card }]}>
                <Ionicons name="trending-up" size={24} color={chartColors.quaternary} />
                <Text style={[styles.metricValue, { color: colors.text }]}>
                  {(summaryMetrics.avgGrowth || 0) >= 0 ? '+' : ''}
                  {(summaryMetrics.avgGrowth || 0).toFixed(1)}%
                </Text>
                <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
                  {t('admin.analytics.sports.avgGrowth' as TranslationKey) || 'Avg Growth'}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Sport Popularity Pie Chart */}
        {popularityChartData.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('admin.analytics.sports.popularity' as TranslationKey) || 'Sport Popularity'}
            </Text>
            <View style={[styles.chartCard, { backgroundColor: colors.card }]}>
              <View style={styles.pieChartContainer}>
                <PieChart
                  data={popularityChartData}
                  donut
                  radius={80}
                  innerRadius={50}
                  centerLabelComponent={() => (
                    <View style={styles.pieCenter}>
                      <Text style={[styles.pieCenterValue, { color: colors.text }]}>
                        {sportPopularity
                          .reduce((sum, s) => sum + s.playerCount, 0)
                          .toLocaleString()}
                      </Text>
                      <Text style={[styles.pieCenterLabel, { color: colors.textSecondary }]}>
                        {t('admin.analytics.sports.players' as TranslationKey) || 'Players'}
                      </Text>
                    </View>
                  )}
                />
                <View style={styles.pieLegend}>
                  {popularityChartData.map((item, index) => (
                    <View key={index} style={styles.pieLegendItem}>
                      <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                      <Text style={[styles.legendText, { color: colors.textSecondary }]}>
                        {item.text}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Activity Comparison Bar Chart */}
        {activityChartData.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('admin.analytics.sports.activityComparison' as TranslationKey) ||
                'Activity Comparison'}
            </Text>
            <View style={[styles.chartCard, { backgroundColor: colors.card }]}>
              <BarChart
                data={activityChartData}
                barWidth={32}
                spacing={20}
                roundedTop
                roundedBottom
                hideRules
                xAxisThickness={1}
                yAxisThickness={0}
                xAxisColor={colors.border}
                yAxisTextStyle={{ color: colors.textSecondary, fontSize: 10 }}
                xAxisLabelTextStyle={{
                  color: colors.textSecondary,
                  fontSize: 9,
                  width: 50,
                  textAlign: 'center',
                }}
                noOfSections={4}
                maxValue={Math.max(...activityChartData.map(d => d.value)) * 1.2}
                isAnimated
              />
              <Text style={[styles.chartSubtitle, { color: colors.textSecondary }]}>
                {t('admin.analytics.sports.matchesBySport' as TranslationKey) || 'Matches by Sport'}
              </Text>
            </View>
          </View>
        )}

        {/* Growth Trends Line Chart */}
        {growthChartData.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('admin.analytics.sports.growthTrends' as TranslationKey) || 'Monthly Match Trend'}
            </Text>
            <View style={[styles.chartCard, { backgroundColor: colors.card }]}>
              <View style={styles.legendRow}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: chartColors.primary }]} />
                  <Text style={[styles.legendText, { color: colors.textSecondary }]}>
                    {growthTrends[0]?.sports?.[0]?.sportName || 'Top Sport'}
                  </Text>
                </View>
              </View>
              <LineChart
                data={growthChartData}
                height={180}
                lineColor={chartColors.primary}
                showDataPoints
                showGrid
                curved
              />
            </View>
          </View>
        )}

        {/* Growth Rates Bar Chart */}
        {growthRatesChartData.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('admin.analytics.sports.growthRates' as TranslationKey) || 'Sport Growth Rates'}
            </Text>
            <View style={[styles.chartCard, { backgroundColor: colors.card }]}>
              <BarChart
                data={growthRatesChartData}
                barWidth={28}
                spacing={16}
                roundedTop
                roundedBottom
                hideRules
                xAxisThickness={1}
                yAxisThickness={0}
                xAxisColor={colors.border}
                yAxisTextStyle={{ color: colors.textSecondary, fontSize: 10 }}
                xAxisLabelTextStyle={{
                  color: colors.textSecondary,
                  fontSize: 8,
                  width: 45,
                  textAlign: 'center',
                }}
                noOfSections={4}
                maxValue={Math.max(...growthRatesChartData.map(d => d.value), 20) * 1.2}
                isAnimated
              />
              <View style={styles.legendRow}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: chartColors.secondary }]} />
                  <Text style={[styles.legendText, { color: colors.textSecondary }]}>
                    {t('admin.analytics.sports.positiveGrowth' as TranslationKey) || 'Positive'}
                  </Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: chartColors.quaternary }]} />
                  <Text style={[styles.legendText, { color: colors.textSecondary }]}>
                    {t('admin.analytics.sports.negativeGrowth' as TranslationKey) || 'Negative'}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Facility Utilization */}
        {facilityChartData.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('admin.analytics.sports.facilityUtilization' as TranslationKey) ||
                'Facility Utilization'}
            </Text>
            <View style={[styles.chartCard, { backgroundColor: colors.card }]}>
              <BarChart
                data={facilityChartData}
                barWidth={32}
                spacing={20}
                roundedTop
                roundedBottom
                hideRules
                xAxisThickness={1}
                yAxisThickness={0}
                xAxisColor={colors.border}
                yAxisTextStyle={{ color: colors.textSecondary, fontSize: 10 }}
                xAxisLabelTextStyle={{
                  color: colors.textSecondary,
                  fontSize: 9,
                  width: 50,
                  textAlign: 'center',
                }}
                noOfSections={4}
                maxValue={100}
                isAnimated
              />
              <Text style={[styles.chartSubtitle, { color: colors.textSecondary }]}>
                {t('admin.analytics.sports.utilizationPercent' as TranslationKey) ||
                  'Utilization %'}
              </Text>
            </View>
          </View>
        )}

        {/* Sport Details List */}
        {sportPopularity.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('admin.analytics.sports.sportDetails' as TranslationKey) || 'Sport Details'}
            </Text>
            <View style={[styles.listCard, { backgroundColor: colors.card }]}>
              {sportPopularity.map((sport, index) => (
                <View
                  key={sport.sportId}
                  style={[
                    styles.listItem,
                    index !== sportPopularity.length - 1 && {
                      borderBottomColor: colors.border,
                      borderBottomWidth: 1,
                    },
                  ]}
                >
                  <View style={styles.listItemLeft}>
                    <Text style={[styles.listItemRank, { color: chartColors.primary }]}>
                      #{index + 1}
                    </Text>
                    <View>
                      <Text style={[styles.listItemTitle, { color: colors.text }]}>
                        {sport.sportName}
                      </Text>
                      <Text style={[styles.listItemSubtitle, { color: colors.textSecondary }]}>
                        {sport.playerCount.toLocaleString()} players •{' '}
                        {sport.totalMatches.toLocaleString()} matches
                      </Text>
                    </View>
                  </View>
                  <View style={styles.listItemRight}>
                    <Text
                      style={[
                        styles.listItemStat,
                        {
                          color:
                            sport.growthPercent >= 0
                              ? chartColors.secondary
                              : chartColors.quaternary,
                        },
                      ]}
                    >
                      {sport.growthPercent >= 0 ? '+' : ''}
                      {sport.growthPercent.toFixed(1)}%
                    </Text>
                    <Text style={[styles.listItemStatLabel, { color: colors.textSecondary }]}>
                      growth
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Facility Details List */}
        {facilityData.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('admin.analytics.sports.facilityDetails' as TranslationKey) || 'Facility Details'}
            </Text>
            <View style={[styles.listCard, { backgroundColor: colors.card }]}>
              {facilityData.map((facility, index) => (
                <View
                  key={facility.sportId}
                  style={[
                    styles.listItem,
                    index !== facilityData.length - 1 && {
                      borderBottomColor: colors.border,
                      borderBottomWidth: 1,
                    },
                  ]}
                >
                  <View style={styles.listItemLeft}>
                    <Ionicons
                      name="location"
                      size={20}
                      color={
                        facility.avgUtilization >= 70
                          ? chartColors.secondary
                          : facility.avgUtilization >= 40
                            ? chartColors.tertiary
                            : chartColors.quaternary
                      }
                    />
                    <View>
                      <Text style={[styles.listItemTitle, { color: colors.text }]}>
                        {facility.sportName}
                      </Text>
                      <Text style={[styles.listItemSubtitle, { color: colors.textSecondary }]}>
                        {facility.facilityCount} facilities • Peak: {facility.peakHours}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.listItemRight}>
                    <Text style={[styles.listItemStat, { color: colors.text }]}>
                      {facility.avgUtilization.toFixed(0)}%
                    </Text>
                    <Text style={[styles.listItemStatLabel, { color: colors.textSecondary }]}>
                      utilization
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Bottom spacing */}
        <View style={styles.bottomSpacer} />
      </ScrollView>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  backButton: {
    padding: spacingPixels[2],
    marginRight: spacingPixels[2],
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
  },
  headerSpacer: {
    width: 40,
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
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.md,
    marginBottom: spacingPixels[4],
    gap: spacingPixels[2],
  },
  errorText: {
    fontSize: 14,
    flex: 1,
  },
  section: {
    marginBottom: spacingPixels[5],
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: spacingPixels[3],
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[3],
  },
  metricCard: {
    flex: 1,
    minWidth: '45%',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  metricValue: {
    fontSize: 24,
    fontWeight: '700',
  },
  metricLabel: {
    fontSize: 12,
    textAlign: 'center',
  },
  chartCard: {
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
  },
  chartSubtitle: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacingPixels[2],
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacingPixels[4],
    marginBottom: spacingPixels[3],
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 12,
  },
  pieChartContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  pieCenter: {
    alignItems: 'center',
  },
  pieCenterValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  pieCenterLabel: {
    fontSize: 11,
  },
  pieLegend: {
    gap: spacingPixels[2],
  },
  pieLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  listCard: {
    borderRadius: radiusPixels.lg,
    overflow: 'hidden',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacingPixels[3],
  },
  listItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    flex: 1,
  },
  listItemRank: {
    fontSize: 14,
    fontWeight: '700',
    width: 28,
  },
  listItemTitle: {
    fontSize: 14,
    fontWeight: '500',
  },
  listItemSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  listItemRight: {
    alignItems: 'flex-end',
  },
  listItemStat: {
    fontSize: 16,
    fontWeight: '600',
  },
  listItemStatLabel: {
    fontSize: 10,
  },
  bottomSpacer: {
    height: spacingPixels[8],
  },
});
