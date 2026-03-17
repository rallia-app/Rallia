/**
 * AdminCommunityAnalyticsScreen
 *
 * Comprehensive community analytics including network growth,
 * network size distribution, network activity, and match integration.
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
  getNetworkGrowth,
  getNetworkSizeDistribution,
  getTopNetworkActivity,
  getNetworkMatchIntegration,
  type NetworkGrowth,
  type NetworkSizeDistribution,
  type NetworkActivity,
  type NetworkMatchIntegration,
} from '@rallia/shared-services';
import type { RootStackParamList } from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

// =============================================================================
// HOOK: useCommunityAnalytics
// =============================================================================

function useCommunityAnalytics(selectedOption: TimeRangeOption) {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [networkGrowth, setNetworkGrowth] = React.useState<NetworkGrowth[]>([]);
  const [sizeDistribution, setSizeDistribution] = React.useState<NetworkSizeDistribution[]>([]);
  const [topNetworks, setTopNetworks] = React.useState<NetworkActivity[]>([]);
  const [matchIntegration, setMatchIntegration] = React.useState<NetworkMatchIntegration | null>(
    null
  );
  const [summaryMetrics, setSummaryMetrics] = React.useState<{
    totalNetworks: number;
    activeNetworks: number;
    avgMembers: number;
    networkPostRate: number;
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
      // Fetch network growth
      const growthResult = await getNetworkGrowth(startDate, endDate);
      if (growthResult && growthResult.length > 0) {
        setNetworkGrowth(growthResult);

        // Calculate summary from latest data point
        const latest = growthResult[growthResult.length - 1];

        setSummaryMetrics(prev => ({
          ...prev,
          totalNetworks: latest.totalNetworks,
          activeNetworks: latest.activeNetworks,
          avgMembers: prev?.avgMembers || 0,
          networkPostRate: prev?.networkPostRate || 0,
        }));
      }

      // Fetch size distribution
      const sizeResult = await getNetworkSizeDistribution();
      if (sizeResult) {
        setSizeDistribution(sizeResult);
      }

      // Fetch top networks
      const topResult = await getTopNetworkActivity(8);
      if (topResult) {
        setTopNetworks(topResult);

        // Calculate average members
        if (topResult.length > 0) {
          const avgMembers =
            topResult.reduce((sum: number, n: NetworkActivity) => sum + n.memberCount, 0) /
            topResult.length;
          setSummaryMetrics(prev =>
            prev ? { ...prev, avgMembers: Math.round(avgMembers) } : null
          );
        }
      }

      // Fetch match integration
      const integrationResult = await getNetworkMatchIntegration();
      if (integrationResult) {
        setMatchIntegration(integrationResult);
        setSummaryMetrics(prev =>
          prev ? { ...prev, networkPostRate: integrationResult.networkPostRate } : null
        );
      }
    } catch (err) {
      console.error('Error fetching community analytics:', err);
      setError('Failed to load community analytics data');
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
    networkGrowth,
    sizeDistribution,
    topNetworks,
    matchIntegration,
    summaryMetrics,
    refetch: fetchData,
  };
}

// =============================================================================
// COMPONENT: AdminCommunityAnalyticsScreen
// =============================================================================

export default function AdminCommunityAnalyticsScreen() {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const isDark = theme === 'dark';

  const { selectedOption, setRange } = useAnalyticsTimeRange();

  const {
    loading,
    error,
    networkGrowth,
    sizeDistribution,
    topNetworks,
    matchIntegration,
    summaryMetrics,
    refetch,
  } = useCommunityAnalytics(selectedOption);

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

  // Network growth line chart data
  const growthChartData = useMemo(() => {
    if (!networkGrowth || networkGrowth.length === 0) return [];

    return networkGrowth.map(item => ({
      value: item.totalNetworks,
      label: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    }));
  }, [networkGrowth]);

  // Size distribution bar chart data
  const sizeChartData = useMemo(() => {
    if (!sizeDistribution || sizeDistribution.length === 0) return [];

    return sizeDistribution.map((item, index) => ({
      value: item.count,
      label: item.bucket,
      frontColor: index % 2 === 0 ? chartColors.primary : chartColors.secondary,
    }));
  }, [sizeDistribution, chartColors]);

  // Pie chart data for network types
  const networkTypesData = useMemo(() => {
    if (!topNetworks || topNetworks.length === 0) return [];

    // Group by network type
    const typeMap = new Map<string, number>();
    topNetworks.forEach(network => {
      const count = typeMap.get(network.networkType) || 0;
      typeMap.set(network.networkType, count + 1);
    });

    const pieColors = [
      chartColors.primary,
      chartColors.secondary,
      chartColors.tertiary,
      chartColors.quaternary,
      chartColors.neutral,
    ];
    return Array.from(typeMap.entries()).map(([type, count], index) => ({
      value: count,
      text: type,
      color: pieColors[index % pieColors.length],
    }));
  }, [topNetworks, chartColors]);

  // Top networks activity bar chart
  const topNetworksChartData = useMemo(() => {
    if (!topNetworks || topNetworks.length === 0) return [];

    return topNetworks.slice(0, 6).map(network => ({
      value: network.activityScore,
      label:
        network.networkName.length > 12
          ? network.networkName.substring(0, 12) + '...'
          : network.networkName,
      frontColor: chartColors.primary,
    }));
  }, [topNetworks, chartColors]);

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
          {t('admin.analytics.sections.community' as TranslationKey) || 'Community Analytics'}
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
              {t('admin.analytics.community.overview' as TranslationKey) || 'Overview'}
            </Text>
            <View style={styles.metricsGrid}>
              <View style={[styles.metricCard, { backgroundColor: colors.card }]}>
                <Ionicons name="people" size={24} color={chartColors.primary} />
                <Text style={[styles.metricValue, { color: colors.text }]}>
                  {summaryMetrics.totalNetworks}
                </Text>
                <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
                  {t('admin.analytics.community.totalNetworks' as TranslationKey) ||
                    'Total Networks'}
                </Text>
              </View>
              <View style={[styles.metricCard, { backgroundColor: colors.card }]}>
                <Ionicons name="pulse" size={24} color={chartColors.secondary} />
                <Text style={[styles.metricValue, { color: colors.text }]}>
                  {summaryMetrics.activeNetworks}
                </Text>
                <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
                  {t('admin.analytics.community.activeNetworks' as TranslationKey) ||
                    'Active Networks'}
                </Text>
              </View>
              <View style={[styles.metricCard, { backgroundColor: colors.card }]}>
                <Ionicons name="person" size={24} color={chartColors.tertiary} />
                <Text style={[styles.metricValue, { color: colors.text }]}>
                  {summaryMetrics.avgMembers}
                </Text>
                <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
                  {t('admin.analytics.community.avgMembers' as TranslationKey) || 'Avg Members'}
                </Text>
              </View>
              <View style={[styles.metricCard, { backgroundColor: colors.card }]}>
                <Ionicons name="tennisball" size={24} color={chartColors.quaternary} />
                <Text style={[styles.metricValue, { color: colors.text }]}>
                  {summaryMetrics.networkPostRate.toFixed(1)}%
                </Text>
                <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
                  {t('admin.analytics.community.networkPostRate' as TranslationKey) ||
                    'Network Post Rate'}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Network Growth Chart */}
        {growthChartData.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('admin.analytics.community.networkGrowth' as TranslationKey) || 'Network Growth'}
            </Text>
            <View style={[styles.chartCard, { backgroundColor: colors.card }]}>
              <View style={styles.legendRow}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: chartColors.primary }]} />
                  <Text style={[styles.legendText, { color: colors.textSecondary }]}>
                    {t('admin.analytics.community.totalNetworks' as TranslationKey) ||
                      'Total Networks'}
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

        {/* Network Size Distribution */}
        {sizeChartData.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('admin.analytics.community.sizeDistribution' as TranslationKey) ||
                'Network Size Distribution'}
            </Text>
            <View style={[styles.chartCard, { backgroundColor: colors.card }]}>
              <BarChart
                data={sizeChartData}
                barWidth={32}
                spacing={24}
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
                  width: 60,
                  textAlign: 'center',
                }}
                noOfSections={4}
                maxValue={Math.max(...sizeChartData.map(d => d.value)) * 1.2}
                isAnimated
              />
            </View>
          </View>
        )}

        {/* Network Types Pie Chart */}
        {networkTypesData.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('admin.analytics.community.networkTypes' as TranslationKey) || 'Network Types'}
            </Text>
            <View style={[styles.chartCard, { backgroundColor: colors.card }]}>
              <View style={styles.pieChartContainer}>
                <PieChart
                  data={networkTypesData}
                  donut
                  radius={80}
                  innerRadius={50}
                  centerLabelComponent={() => (
                    <View style={styles.pieCenter}>
                      <Text style={[styles.pieCenterValue, { color: colors.text }]}>
                        {topNetworks.length}
                      </Text>
                      <Text style={[styles.pieCenterLabel, { color: colors.textSecondary }]}>
                        {t('admin.analytics.community.networks' as TranslationKey) || 'Networks'}
                      </Text>
                    </View>
                  )}
                />
                <View style={styles.pieLegend}>
                  {networkTypesData.map((item, index) => (
                    <View key={index} style={styles.pieLegendItem}>
                      <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                      <Text style={[styles.legendText, { color: colors.textSecondary }]}>
                        {item.text} ({item.value})
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Top Networks by Activity */}
        {topNetworksChartData.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('admin.analytics.community.topNetworks' as TranslationKey) ||
                'Most Active Networks'}
            </Text>
            <View style={[styles.chartCard, { backgroundColor: colors.card }]}>
              <BarChart
                data={topNetworksChartData}
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
                  width: 50,
                  textAlign: 'center',
                }}
                noOfSections={4}
                maxValue={100}
                isAnimated
              />
              <Text style={[styles.chartSubtitle, { color: colors.textSecondary }]}>
                {t('admin.analytics.community.activityScore' as TranslationKey) ||
                  'Activity Score (0-100)'}
              </Text>
            </View>
          </View>
        )}

        {/* Match Integration Metrics */}
        {matchIntegration && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('admin.analytics.community.matchIntegration' as TranslationKey) ||
                'Match Integration'}
            </Text>
            <View style={[styles.chartCard, { backgroundColor: colors.card }]}>
              <View style={styles.integrationGrid}>
                <View style={styles.integrationItem}>
                  <Text style={[styles.integrationValue, { color: colors.text }]}>
                    {matchIntegration.matchesPostedToNetworks.toLocaleString()}
                  </Text>
                  <Text style={[styles.integrationLabel, { color: colors.textSecondary }]}>
                    {t('admin.analytics.community.matchesPosted' as TranslationKey) ||
                      'Matches Posted to Networks'}
                  </Text>
                </View>
                <View style={styles.integrationItem}>
                  <Text style={[styles.integrationValue, { color: colors.text }]}>
                    {matchIntegration.networkPostRate.toFixed(1)}%
                  </Text>
                  <Text style={[styles.integrationLabel, { color: colors.textSecondary }]}>
                    {t('admin.analytics.community.postRate' as TranslationKey) ||
                      'Network Post Rate'}
                  </Text>
                </View>
                <View style={styles.integrationItem}>
                  <Text style={[styles.integrationValue, { color: colors.text }]}>
                    {matchIntegration.networkOriginatedMatches.toLocaleString()}
                  </Text>
                  <Text style={[styles.integrationLabel, { color: colors.textSecondary }]}>
                    {t('admin.analytics.community.networkOriginated' as TranslationKey) ||
                      'Network-Originated Matches'}
                  </Text>
                </View>
                <View style={styles.integrationItem}>
                  <Text style={[styles.integrationValue, { color: colors.text }]}>
                    {matchIntegration.avgParticipantsFromNetwork.toFixed(1)}
                  </Text>
                  <Text style={[styles.integrationLabel, { color: colors.textSecondary }]}>
                    {t('admin.analytics.community.avgParticipants' as TranslationKey) ||
                      'Avg Participants from Network'}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Top Networks List */}
        {topNetworks.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('admin.analytics.community.networkActivity' as TranslationKey) ||
                'Network Activity Details'}
            </Text>
            <View style={[styles.listCard, { backgroundColor: colors.card }]}>
              {topNetworks.map((network, index) => (
                <View
                  key={network.networkId}
                  style={[
                    styles.listItem,
                    index !== topNetworks.length - 1 && {
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
                        {network.networkName}
                      </Text>
                      <Text style={[styles.listItemSubtitle, { color: colors.textSecondary }]}>
                        {network.networkType} • {network.memberCount} members
                      </Text>
                    </View>
                  </View>
                  <View style={styles.listItemRight}>
                    <Text style={[styles.listItemStat, { color: colors.text }]}>
                      {network.matchesPosted}
                    </Text>
                    <Text style={[styles.listItemStatLabel, { color: colors.textSecondary }]}>
                      matches
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
    fontSize: 24,
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
  integrationGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[4],
  },
  integrationItem: {
    flex: 1,
    minWidth: '45%',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  integrationValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  integrationLabel: {
    fontSize: 11,
    textAlign: 'center',
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
