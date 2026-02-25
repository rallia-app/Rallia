/**
 * AdminRatingAnalyticsScreen
 *
 * Rating & reputation analytics including distribution,
 * certification funnel, reputation scores, and peer activity.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BarChart, PieChart } from 'react-native-gifted-charts';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useTheme } from '@rallia/shared-hooks';
import { useTranslation } from '../../hooks';
import type { TranslationKey } from '@rallia/shared-translations';
import { Text } from '@rallia/shared-components';
import {
  primary,
  secondary,
  neutral,
  status,
  spacingPixels,
  radiusPixels,
} from '@rallia/design-system';
import {
  getRatingDistribution,
  getCertificationFunnel,
  getReputationDistribution,
  getReputationEvents,
  getPeerRatingActivity,
  type RatingDistribution,
  type CertificationFunnelStep,
  type ReputationDistribution,
  type ReputationEventData,
  type PeerRatingActivity,
} from '@rallia/shared-services';
import type { RootStackParamList } from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const { width: screenWidth } = Dimensions.get('window');
const chartWidth = screenWidth - spacingPixels[4] * 2 - spacingPixels[4] * 2;

// =============================================================================
// HOOK: useRatingAnalytics
// =============================================================================

interface RatingAnalyticsData {
  ratingDistribution: RatingDistribution[];
  certificationFunnel: CertificationFunnelStep[];
  reputationDistribution: ReputationDistribution[];
  reputationEvents: ReputationEventData[];
  peerRatingActivity: PeerRatingActivity;
}

function useRatingAnalytics() {
  const [data, setData] = useState<RatingAnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [
        ratingDistribution,
        certificationFunnel,
        reputationDistribution,
        reputationEvents,
        peerRatingActivity,
      ] = await Promise.all([
        getRatingDistribution(),
        getCertificationFunnel(),
        getReputationDistribution(),
        getReputationEvents(),
        getPeerRatingActivity(),
      ]);

      setData({
        ratingDistribution,
        certificationFunnel,
        reputationDistribution,
        reputationEvents,
        peerRatingActivity,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, isLoading, error, refetch: fetchData };
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function AdminRatingAnalyticsScreen() {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const { data, isLoading, error, refetch } = useRatingAnalytics();
  const [selectedSportIndex, setSelectedSportIndex] = useState(0);

  const isDark = theme === 'dark';
  const bgColor = isDark ? neutral[900] : neutral[100];
  const cardBgColor = isDark ? neutral[800] : neutral[50];
  const textColor = isDark ? neutral[100] : neutral[900];
  const subtextColor = isDark ? neutral[400] : neutral[600];
  const borderColor = isDark ? neutral[700] : neutral[200];

  // Memoized chart data transformations
  const ratingChartData = useMemo(() => {
    if (!data?.ratingDistribution || data.ratingDistribution.length === 0) {
      return [];
    }
    const sport = data.ratingDistribution[selectedSportIndex];
    if (!sport) return [];

    const colorOptions = [primary[400], primary[500], primary[600], primary[700], primary[800]];
    return sport.buckets.map((bucket, index) => ({
      value: bucket.count,
      label: bucket.range,
      frontColor: colorOptions[index % colorOptions.length],
    }));
  }, [data?.ratingDistribution, selectedSportIndex]);

  const certificationChartData = useMemo(() => {
    if (!data?.certificationFunnel) return [];

    const stageColors = [
      primary[400],
      primary[500],
      primary[600],
      secondary[500],
      status.success.DEFAULT,
    ];

    return data.certificationFunnel.map((step, index) => ({
      value: step.count,
      label: step.stage,
      frontColor: stageColors[index % stageColors.length],
    }));
  }, [data]);

  const reputationDistributionData = useMemo(() => {
    if (!data?.reputationDistribution) return [];

    const tierColors: Record<ReputationDistribution['tier'], string> = {
      excellent: status.success.DEFAULT,
      good: primary[500],
      fair: status.warning.DEFAULT,
      poor: status.error.DEFAULT,
    };

    return data.reputationDistribution.map(item => ({
      value: item.percentage,
      color: tierColors[item.tier],
      text: `${item.percentage}%`,
    }));
  }, [data]);

  const reputationEventsChartData = useMemo(() => {
    if (!data?.reputationEvents) return [];

    return data.reputationEvents.map(event => ({
      value: event.positiveEvents,
      label: event.date.length > 5 ? event.date.slice(5).replace('-', '/') : event.date,
      frontColor: status.success.DEFAULT,
    }));
  }, [data]);

  if (isLoading && !data) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: bgColor }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={primary[500]} />
          <Text style={[styles.loadingText, { color: subtextColor }]}>
            {t('common.loading' as TranslationKey) || 'Loading...'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: bgColor }]}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={48} color={status.error.DEFAULT} />
          <Text style={[styles.errorText, { color: status.error.DEFAULT }]}>{error}</Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: primary[500] }]}
            onPress={refetch}
          >
            <Text style={styles.retryButtonText}>
              {t('common.retry' as TranslationKey) || 'Retry'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bgColor }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: borderColor }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={textColor} />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={[styles.headerTitle, { color: textColor }]}>
            {t('admin.analytics.sections.rating' as TranslationKey) || 'Rating Analytics'}
          </Text>
          <Text style={[styles.headerSubtitle, { color: subtextColor }]}>
            {t('admin.analytics.sections.ratingDesc' as TranslationKey) ||
              'Player ratings & reputation'}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refetch}
            colors={[primary[500]]}
            tintColor={primary[500]}
          />
        }
      >
        {/* Rating Distribution */}
        <View style={[styles.card, { backgroundColor: cardBgColor }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="stats-chart" size={20} color={primary[500]} />
            <Text style={[styles.cardTitle, { color: textColor }]}>
              {t('admin.analytics.rating.ratingDistribution' as TranslationKey) ||
                'Rating Distribution'}
            </Text>
          </View>

          {/* Sport selector */}
          {data?.ratingDistribution && data.ratingDistribution.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.sportSelector}
            >
              {data.ratingDistribution.map((sport, index) => (
                <TouchableOpacity
                  key={sport.sportId}
                  style={[
                    styles.sportTab,
                    { backgroundColor: isDark ? neutral[700] : neutral[200] },
                    selectedSportIndex === index && { backgroundColor: primary[500] },
                  ]}
                  onPress={() => setSelectedSportIndex(index)}
                >
                  <Text
                    style={[
                      styles.sportTabText,
                      { color: selectedSportIndex === index ? neutral[50] : subtextColor },
                    ]}
                  >
                    {sport.sportName}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          <View style={styles.chartContainer}>
            {ratingChartData.length > 0 ? (
              <BarChart
                data={ratingChartData}
                width={chartWidth}
                height={200}
                barWidth={32}
                spacing={24}
                noOfSections={5}
                yAxisThickness={1}
                xAxisThickness={1}
                xAxisColor={borderColor}
                yAxisColor={borderColor}
                yAxisTextStyle={[styles.axisLabel, { color: subtextColor }]}
                xAxisLabelTextStyle={[styles.axisLabel, { color: subtextColor }]}
                isAnimated
                barBorderRadius={4}
              />
            ) : (
              <Text style={[styles.noDataText, { color: subtextColor }]}>
                {t('admin.analytics.rating.noDataAvailable' as TranslationKey) ||
                  'No data available'}
              </Text>
            )}
          </View>

          {/* Legend */}
          {data?.ratingDistribution?.[selectedSportIndex] && (
            <View style={styles.legendContainer}>
              {data.ratingDistribution[selectedSportIndex].buckets.map(bucket => (
                <View key={bucket.range} style={styles.legendItem}>
                  <Text style={[styles.legendLabel, { color: subtextColor }]}>{bucket.range}</Text>
                  <Text style={[styles.legendValue, { color: textColor }]}>
                    {bucket.count} ({bucket.percentage}%)
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Certification Funnel */}
        <View style={[styles.card, { backgroundColor: cardBgColor }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="ribbon" size={20} color={primary[500]} />
            <Text style={[styles.cardTitle, { color: textColor }]}>
              {t('admin.analytics.rating.certificationFunnel' as TranslationKey) ||
                'Certification Funnel'}
            </Text>
          </View>

          <View style={styles.funnelContainer}>
            {data?.certificationFunnel?.map((step, index) => (
              <View key={step.stage} style={styles.funnelStep}>
                <View
                  style={[
                    styles.funnelBar,
                    {
                      width: `${step.percentage}%`,
                      backgroundColor: certificationChartData[index]?.frontColor || primary[500],
                    },
                  ]}
                />
                <View style={styles.funnelLabels}>
                  <Text style={[styles.funnelStageLabel, { color: textColor }]}>{step.stage}</Text>
                  <Text style={[styles.funnelValue, { color: subtextColor }]}>
                    {step.count.toLocaleString()} ({step.percentage}%)
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Reputation Distribution */}
        <View style={[styles.card, { backgroundColor: cardBgColor }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="shield" size={20} color={primary[500]} />
            <Text style={[styles.cardTitle, { color: textColor }]}>
              {t('admin.analytics.rating.reputationDistribution' as TranslationKey) ||
                'Reputation Distribution'}
            </Text>
          </View>

          <View style={styles.pieChartContainer}>
            {reputationDistributionData.length > 0 ? (
              <>
                <PieChart
                  data={reputationDistributionData}
                  donut
                  radius={80}
                  innerRadius={50}
                  innerCircleColor={cardBgColor}
                  centerLabelComponent={() => (
                    <View style={styles.pieCenterLabel}>
                      <Text style={[styles.pieCenterValue, { color: textColor }]}>
                        {data?.reputationDistribution?.reduce((sum, item) => sum + item.count, 0)}
                      </Text>
                      <Text style={[styles.pieCenterSubtext, { color: subtextColor }]}>
                        {t('admin.analytics.rating.totalUsers' as TranslationKey) || 'Total Users'}
                      </Text>
                    </View>
                  )}
                />
                <View style={styles.pieLegend}>
                  {data?.reputationDistribution?.map(item => (
                    <View key={item.tier} style={styles.pieLegendItem}>
                      <View
                        style={[
                          styles.pieLegendDot,
                          {
                            backgroundColor:
                              item.tier === 'excellent'
                                ? status.success.DEFAULT
                                : item.tier === 'good'
                                  ? primary[500]
                                  : item.tier === 'fair'
                                    ? status.warning.DEFAULT
                                    : status.error.DEFAULT,
                          },
                        ]}
                      />
                      <View>
                        <Text style={[styles.pieLegendLabel, { color: textColor }]}>
                          {item.tier.charAt(0).toUpperCase() + item.tier.slice(1)} (
                          {item.scoreRange})
                        </Text>
                        <Text style={[styles.pieLegendValue, { color: subtextColor }]}>
                          {item.count.toLocaleString()} ({item.percentage}%)
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            ) : (
              <Text style={[styles.noDataText, { color: subtextColor }]}>
                {t('admin.analytics.rating.noDataAvailable' as TranslationKey) ||
                  'No data available'}
              </Text>
            )}
          </View>
        </View>

        {/* Reputation Events Timeline */}
        <View style={[styles.card, { backgroundColor: cardBgColor }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="time" size={20} color={primary[500]} />
            <Text style={[styles.cardTitle, { color: textColor }]}>
              {t('admin.analytics.rating.reputationEvents' as TranslationKey) ||
                'Reputation Events'}
            </Text>
          </View>

          <View style={styles.chartContainer}>
            {reputationEventsChartData.length > 0 ? (
              <BarChart
                data={reputationEventsChartData}
                width={chartWidth - 40}
                height={180}
                barWidth={24}
                spacing={16}
                noOfSections={5}
                yAxisThickness={1}
                xAxisThickness={1}
                xAxisColor={borderColor}
                yAxisColor={borderColor}
                yAxisTextStyle={[styles.axisLabel, { color: subtextColor }]}
                xAxisLabelTextStyle={[styles.axisLabel, { color: subtextColor }]}
                isAnimated
                barBorderRadius={4}
              />
            ) : (
              <Text style={[styles.noDataText, { color: subtextColor }]}>
                {t('admin.analytics.rating.noDataAvailable' as TranslationKey) ||
                  'No data available'}
              </Text>
            )}
          </View>

          <View style={styles.lineChartLegend}>
            <View style={styles.lineChartLegendItem}>
              <View
                style={[styles.lineChartLegendDot, { backgroundColor: status.success.DEFAULT }]}
              />
              <Text style={[styles.lineChartLegendText, { color: subtextColor }]}>
                {t('admin.analytics.rating.positiveEvents' as TranslationKey) || 'Positive Events'}
              </Text>
            </View>
            <View style={styles.lineChartLegendItem}>
              <View
                style={[styles.lineChartLegendDot, { backgroundColor: status.error.DEFAULT }]}
              />
              <Text style={[styles.lineChartLegendText, { color: subtextColor }]}>
                {t('admin.analytics.rating.negativeEvents' as TranslationKey) || 'Negative Events'}
              </Text>
            </View>
          </View>
        </View>

        {/* Peer Rating Activity */}
        <View style={[styles.card, { backgroundColor: cardBgColor }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="people" size={20} color={primary[500]} />
            <Text style={[styles.cardTitle, { color: textColor }]}>
              {t('admin.analytics.rating.peerRatingActivity' as TranslationKey) ||
                'Peer Rating Activity'}
            </Text>
          </View>

          <View style={styles.metricsGrid}>
            <View
              style={[styles.metricBox, { backgroundColor: isDark ? neutral[700] : neutral[100] }]}
            >
              <Text style={[styles.metricValue, { color: textColor }]}>
                {data?.peerRatingActivity?.requestsSent.toLocaleString()}
              </Text>
              <Text style={[styles.metricLabel, { color: subtextColor }]}>
                {t('admin.analytics.rating.requestsSent' as TranslationKey) || 'Requests Sent'}
              </Text>
            </View>

            <View
              style={[styles.metricBox, { backgroundColor: isDark ? neutral[700] : neutral[100] }]}
            >
              <Text style={[styles.metricValue, { color: textColor }]}>
                {data?.peerRatingActivity?.requestsCompleted.toLocaleString()}
              </Text>
              <Text style={[styles.metricLabel, { color: subtextColor }]}>
                {t('admin.analytics.rating.requestsCompleted' as TranslationKey) || 'Completed'}
              </Text>
            </View>

            <View
              style={[styles.metricBox, { backgroundColor: isDark ? neutral[700] : neutral[100] }]}
            >
              <Text style={[styles.metricValue, { color: primary[500] }]}>
                {data?.peerRatingActivity?.completionRate.toFixed(1)}%
              </Text>
              <Text style={[styles.metricLabel, { color: subtextColor }]}>
                {t('admin.analytics.rating.completionRate' as TranslationKey) || 'Completion Rate'}
              </Text>
            </View>

            <View
              style={[styles.metricBox, { backgroundColor: isDark ? neutral[700] : neutral[100] }]}
            >
              <Text style={[styles.metricValue, { color: secondary[500] }]}>
                ±{data?.peerRatingActivity?.avgRatingDifference.toFixed(2)}
              </Text>
              <Text style={[styles.metricLabel, { color: subtextColor }]}>
                {t('admin.analytics.rating.avgRatingDiff' as TranslationKey) || 'Avg Rating Diff'}
              </Text>
            </View>

            <View
              style={[
                styles.metricBox,
                styles.metricBoxWide,
                { backgroundColor: isDark ? neutral[700] : neutral[100] },
              ]}
            >
              <Text style={[styles.metricValue, { color: status.success.DEFAULT }]}>
                {data?.peerRatingActivity?.referenceSupportRate.toFixed(1)}%
              </Text>
              <Text style={[styles.metricLabel, { color: subtextColor }]}>
                {t('admin.analytics.rating.referenceSupportRate' as TranslationKey) ||
                  'Reference Support Rate'}
              </Text>
            </View>
          </View>
        </View>

        {/* Key Insights */}
        <View style={[styles.summaryCard, { backgroundColor: `${primary[500]}15` }]}>
          <Text style={[styles.summaryTitle, { color: primary[700] }]}>
            {t('admin.analytics.rating.keyInsights' as TranslationKey) || 'Key Insights'}
          </Text>
          <View style={styles.insightsList}>
            <View style={styles.insightItem}>
              <Ionicons name="checkmark-circle" size={20} color={status.success.DEFAULT} />
              <Text style={[styles.insightText, { color: textColor }]}>
                {t('admin.analytics.rating.insightCertification' as TranslationKey, {
                  percentage:
                    data?.certificationFunnel?.find(s => s.stage === 'Proof Submitted')
                      ?.percentage || 0,
                }) ||
                  `${data?.certificationFunnel?.find(s => s.stage === 'Proof Submitted')?.percentage || 0}% of users have submitted rating proofs`}
              </Text>
            </View>
            <View style={styles.insightItem}>
              <Ionicons name="trending-up" size={20} color={primary[500]} />
              <Text style={[styles.insightText, { color: textColor }]}>
                {t('admin.analytics.rating.insightReputation' as TranslationKey, {
                  percentage: (
                    (data?.reputationDistribution?.find(r => r.tier === 'excellent')?.percentage ||
                      0) +
                    (data?.reputationDistribution?.find(r => r.tier === 'good')?.percentage || 0)
                  ).toFixed(1),
                }) ||
                  `${((data?.reputationDistribution?.find(r => r.tier === 'excellent')?.percentage || 0) + (data?.reputationDistribution?.find(r => r.tier === 'good')?.percentage || 0)).toFixed(1)}% of users have good or excellent reputation`}
              </Text>
            </View>
            <View style={styles.insightItem}>
              <Ionicons name="star" size={20} color={status.warning.DEFAULT} />
              <Text style={[styles.insightText, { color: textColor }]}>
                {t('admin.analytics.rating.insightPeerRating' as TranslationKey, {
                  rate: data?.peerRatingActivity?.completionRate.toFixed(1) || 0,
                }) ||
                  `Peer rating completion rate: ${data?.peerRatingActivity?.completionRate.toFixed(1) || 0}%`}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.bottomPadding} />
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
  scrollContent: {
    padding: spacingPixels[4],
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  loadingText: {
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacingPixels[6],
    gap: spacingPixels[3],
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
  },
  retryButton: {
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.sm,
  },
  retryButtonText: {
    color: neutral[50],
    fontWeight: '600',
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
  card: {
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[4],
    marginBottom: spacingPixels[4],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[4],
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  chartContainer: {
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
  },
  axisLabel: {
    fontSize: 10,
  },
  noDataText: {
    fontSize: 14,
    textAlign: 'center',
    padding: spacingPixels[6],
  },
  sportSelector: {
    flexDirection: 'row',
    marginBottom: spacingPixels[3],
  },
  sportTab: {
    paddingVertical: spacingPixels[1.5],
    paddingHorizontal: spacingPixels[3],
    borderRadius: radiusPixels.sm,
    marginRight: spacingPixels[2],
  },
  sportTabText: {
    fontSize: 12,
    fontWeight: '500',
  },
  legendContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacingPixels[3],
    marginTop: spacingPixels[3],
  },
  legendItem: {
    alignItems: 'center',
  },
  legendLabel: {
    fontSize: 12,
  },
  legendValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  funnelContainer: {
    gap: spacingPixels[2],
  },
  funnelStep: {
    marginBottom: spacingPixels[1],
  },
  funnelBar: {
    height: 28,
    borderRadius: 4,
    marginBottom: 2,
  },
  funnelLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
  },
  funnelStageLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  funnelValue: {
    fontSize: 12,
  },
  pieChartContainer: {
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
  },
  pieCenterLabel: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pieCenterValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  pieCenterSubtext: {
    fontSize: 11,
  },
  pieLegend: {
    marginTop: spacingPixels[4],
    gap: spacingPixels[2],
  },
  pieLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  pieLegendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  pieLegendLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  pieLegendValue: {
    fontSize: 11,
  },
  lineChartLegend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacingPixels[4],
    marginTop: spacingPixels[2],
  },
  lineChartLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  lineChartLegendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  lineChartLegendText: {
    fontSize: 12,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[2],
  },
  metricBox: {
    flex: 1,
    minWidth:
      (screenWidth - spacingPixels[4] * 2 - spacingPixels[4] * 2 - spacingPixels[2]) / 2 -
      spacingPixels[2],
    borderRadius: radiusPixels.md,
    padding: spacingPixels[3],
    alignItems: 'center',
  },
  metricBoxWide: {
    minWidth: '100%',
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  metricLabel: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacingPixels[1],
  },
  summaryCard: {
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[4],
    borderLeftWidth: 4,
    borderLeftColor: primary[500],
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: spacingPixels[3],
  },
  insightsList: {
    gap: spacingPixels[2],
  },
  insightItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacingPixels[2],
  },
  insightText: {
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },
  bottomPadding: {
    height: spacingPixels[8],
  },
});
