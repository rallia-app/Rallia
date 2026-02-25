/**
 * AdminModerationAnalyticsScreen
 *
 * Displays moderation and safety analytics including:
 * - Report volume trends
 * - Report type distribution
 * - Resolution metrics
 * - Ban statistics
 * - User feedback sentiment
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
  getReportVolume,
  getReportTypes,
  getResolutionMetrics,
  getBanStatistics,
  getFeedbackSentiment,
  type ReportVolume,
  type ReportTypeDistribution,
  type ResolutionMetrics,
  type BanStatistics,
  type FeedbackSentiment,
} from '@rallia/shared-services';
import type { RootStackParamList } from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const { width: screenWidth } = Dimensions.get('window');
const chartWidth = screenWidth - spacingPixels[4] * 2 - spacingPixels[4] * 2;

// =============================================================================
// HOOK
// =============================================================================

interface ModerationAnalyticsData {
  reportVolume: ReportVolume[];
  reportTypes: ReportTypeDistribution[];
  resolutionMetrics: ResolutionMetrics;
  banStatistics: BanStatistics;
  feedbackSentiment: FeedbackSentiment[];
}

function useModerationAnalytics() {
  const [data, setData] = useState<ModerationAnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [
        reportVolume,
        reportTypes,
        resolutionMetrics,
        banStatistics,
        feedbackSentiment,
      ] = await Promise.all([
        getReportVolume(),
        getReportTypes(),
        getResolutionMetrics(),
        getBanStatistics(),
        getFeedbackSentiment(),
      ]);

      setData({
        reportVolume,
        reportTypes,
        resolutionMetrics,
        banStatistics,
        feedbackSentiment,
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
// GAUGE COMPONENT
// =============================================================================

interface GaugeMetricProps {
  value: number;
  max: number;
  label: string;
  unit?: string;
  color?: string;
  thresholds?: { warning: number; danger: number };
  subtextColor: string;
}

function GaugeMetric({
  value,
  max,
  label,
  unit = '%',
  color,
  thresholds,
  subtextColor,
}: GaugeMetricProps) {
  const percentage = Math.min((value / max) * 100, 100);

  let gaugeColor = color || primary[500];
  if (thresholds) {
    if (value >= thresholds.danger) {
      gaugeColor = status.error.DEFAULT;
    } else if (value >= thresholds.warning) {
      gaugeColor = status.warning.DEFAULT;
    } else {
      gaugeColor = status.success.DEFAULT;
    }
  }

  return (
    <View style={styles.gaugeContainer}>
      <View style={styles.gaugeTrack}>
        <View
          style={[
            styles.gaugeFill,
            { width: `${percentage}%`, backgroundColor: gaugeColor },
          ]}
        />
      </View>
      <View style={styles.gaugeLabels}>
        <Text style={[styles.gaugeValue, { color: gaugeColor }]}>
          {value.toFixed(1)}
          {unit}
        </Text>
        <Text style={[styles.gaugeLabel, { color: subtextColor }]}>{label}</Text>
      </View>
    </View>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function AdminModerationAnalyticsScreen() {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const { data, isLoading, error, refetch } = useModerationAnalytics();

  const isDark = theme === 'dark';
  const bgColor = isDark ? neutral[900] : neutral[100];
  const cardBgColor = isDark ? neutral[800] : neutral[50];
  const textColor = isDark ? neutral[100] : neutral[900];
  const subtextColor = isDark ? neutral[400] : neutral[600];
  const borderColor = isDark ? neutral[700] : neutral[200];

  // Memoized chart data transformations
  const reportVolumeChartData = useMemo(() => {
    if (!data?.reportVolume) return [];

    return data.reportVolume.map((point) => ({
      label:
        point.date.length > 5 ? point.date.slice(5).replace('-', '/') : point.date,
      value: point.reportCount,
      frontColor: status.warning.DEFAULT,
    }));
  }, [data]);

  const reportTypesChartData = useMemo(() => {
    if (!data?.reportTypes) return [];

    const priorityColors: Record<ReportTypeDistribution['priority'], string> = {
      high: status.error.DEFAULT,
      medium: status.warning.DEFAULT,
      low: primary[400],
    };

    return data.reportTypes.map((type) => ({
      value: type.percentage,
      color: priorityColors[type.priority],
      text: `${type.percentage}%`,
    }));
  }, [data]);

  const feedbackChartData = useMemo(() => {
    if (!data?.feedbackSentiment) return [];

    return data.feedbackSentiment.map((item) => ({
      label: item.category.length > 10 ? item.category.slice(0, 10) + '...' : item.category,
      stacks: [
        { value: item.bugReports, color: status.error.DEFAULT },
        { value: item.featureRequests, color: primary[400] },
      ],
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
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color={textColor} />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={[styles.headerTitle, { color: textColor }]}>
            {t('admin.analytics.sections.moderation' as TranslationKey) || 'Moderation & Safety'}
          </Text>
          <Text style={[styles.headerSubtitle, { color: subtextColor }]}>
            {t('admin.analytics.sections.moderationDesc' as TranslationKey) || 'Reports & safety metrics'}
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
        {/* Quick Stats Row */}
        <View style={styles.quickStatsRow}>
          <View style={[styles.quickStat, { backgroundColor: status.warning.light + '30' }]}>
            <Ionicons name="flag" size={24} color={status.warning.DEFAULT} />
            <Text style={[styles.quickStatValue, { color: status.warning.DEFAULT }]}>
              {data?.resolutionMetrics?.openReports || 0}
            </Text>
            <Text style={[styles.quickStatLabel, { color: subtextColor }]}>
              Open Reports
            </Text>
          </View>

          <View style={[styles.quickStat, { backgroundColor: status.error.light + '30' }]}>
            <Ionicons name="ban" size={24} color={status.error.DEFAULT} />
            <Text style={[styles.quickStatValue, { color: status.error.DEFAULT }]}>
              {data?.banStatistics?.activeBans || 0}
            </Text>
            <Text style={[styles.quickStatLabel, { color: subtextColor }]}>
              Active Bans
            </Text>
          </View>

          <View style={[styles.quickStat, { backgroundColor: status.success.light + '30' }]}>
            <Ionicons name="checkmark-done" size={24} color={status.success.DEFAULT} />
            <Text style={[styles.quickStatValue, { color: status.success.DEFAULT }]}>
              {data?.resolutionMetrics?.withinSlaPercent.toFixed(0) || 0}%
            </Text>
            <Text style={[styles.quickStatLabel, { color: subtextColor }]}>
              Within SLA
            </Text>
          </View>
        </View>

        {/* Report Volume Trend */}
        <View style={[styles.card, { backgroundColor: cardBgColor }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="trending-up" size={20} color={primary[500]} />
            <Text style={[styles.cardTitle, { color: textColor }]}>
              Report Volume Trend
            </Text>
          </View>

          <View style={styles.chartContainer}>
            {reportVolumeChartData.length > 0 ? (
              <BarChart
                data={reportVolumeChartData}
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
                No data available
              </Text>
            )}
          </View>

          <View style={styles.lineChartLegend}>
            <View style={styles.lineChartLegendItem}>
              <View
                style={[styles.lineChartLegendDot, { backgroundColor: status.warning.DEFAULT }]}
              />
              <Text style={[styles.lineChartLegendText, { color: subtextColor }]}>
                Reports Submitted
              </Text>
            </View>
          </View>
        </View>

        {/* Report Types Distribution */}
        <View style={[styles.card, { backgroundColor: cardBgColor }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="pie-chart" size={20} color={primary[500]} />
            <Text style={[styles.cardTitle, { color: textColor }]}>
              Report Types
            </Text>
          </View>

          <View style={styles.pieChartContainer}>
            {reportTypesChartData.length > 0 ? (
              <>
                <PieChart
                  data={reportTypesChartData}
                  donut
                  radius={80}
                  innerRadius={50}
                  innerCircleColor={cardBgColor}
                  centerLabelComponent={() => (
                    <View style={styles.pieCenterLabel}>
                      <Text style={[styles.pieCenterValue, { color: textColor }]}>
                        {data?.reportTypes?.reduce((sum: number, rt: ReportTypeDistribution) => sum + rt.count, 0) || 0}
                      </Text>
                      <Text style={[styles.pieCenterSubtext, { color: subtextColor }]}>
                        Total
                      </Text>
                    </View>
                  )}
                />
                <View style={styles.reportTypeLegend}>
                  {data?.reportTypes?.map((type) => (
                    <View key={type.type} style={styles.reportTypeLegendItem}>
                      <View
                        style={[
                          styles.reportTypePriorityBadge,
                          {
                            backgroundColor:
                              type.priority === 'high'
                                ? status.error.light + '30'
                                : type.priority === 'medium'
                                  ? status.warning.light + '30'
                                  : primary[400] + '30',
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.reportTypePriorityText,
                            {
                              color:
                                type.priority === 'high'
                                  ? status.error.DEFAULT
                                  : type.priority === 'medium'
                                    ? status.warning.DEFAULT
                                    : primary[600],
                            },
                          ]}
                        >
                          {type.priority.toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.reportTypeInfo}>
                        <Text style={[styles.reportTypeName, { color: textColor }]}>
                          {type.type}
                        </Text>
                        <Text style={[styles.reportTypeCount, { color: subtextColor }]}>
                          {type.count} ({type.percentage}%)
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            ) : (
              <Text style={[styles.noDataText, { color: subtextColor }]}>
                No data available
              </Text>
            )}
          </View>
        </View>

        {/* Resolution Metrics */}
        <View style={[styles.card, { backgroundColor: cardBgColor }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="speedometer" size={20} color={primary[500]} />
            <Text style={[styles.cardTitle, { color: textColor }]}>
              Resolution Metrics
            </Text>
          </View>

          <View style={styles.gaugesContainer}>
            <GaugeMetric
              value={data?.resolutionMetrics?.avgResolutionTimeHours || 0}
              max={data?.resolutionMetrics?.slaTargetHours || 24}
              label="Avg Resolution Time (hrs)"
              unit=" hrs"
              thresholds={{
                warning: (data?.resolutionMetrics?.slaTargetHours || 24) * 0.75,
                danger: data?.resolutionMetrics?.slaTargetHours || 24,
              }}
              subtextColor={subtextColor}
            />

            <GaugeMetric
              value={data?.resolutionMetrics?.withinSlaPercent || 0}
              max={100}
              label="Within SLA Target"
              color={status.success.DEFAULT}
              subtextColor={subtextColor}
            />

            <GaugeMetric
              value={data?.resolutionMetrics?.escalationRate || 0}
              max={100}
              label="Escalation Rate"
              thresholds={{ warning: 15, danger: 25 }}
              subtextColor={subtextColor}
            />
          </View>

          <View style={[styles.slaInfo, { borderTopColor: borderColor }]}>
            <Ionicons name="information-circle" size={16} color={primary[500]} />
            <Text style={[styles.slaInfoText, { color: primary[600] }]}>
              {`SLA Target: ${data?.resolutionMetrics?.slaTargetHours || 24} hours`}
            </Text>
          </View>
        </View>

        {/* Ban Statistics */}
        <View style={[styles.card, { backgroundColor: cardBgColor }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="ban" size={20} color={status.error.DEFAULT} />
            <Text style={[styles.cardTitle, { color: textColor }]}>
              Ban Statistics
            </Text>
          </View>

          <View style={styles.banStatsGrid}>
            <View style={[styles.banStatBox, { backgroundColor: isDark ? neutral[700] : neutral[100] }]}>
              <View style={styles.banStatHeader}>
                <Ionicons name="time" size={16} color={status.warning.DEFAULT} />
                <Text style={[styles.banStatLabel, { color: subtextColor }]}>
                  Temporary
                </Text>
              </View>
              <Text style={[styles.banStatValue, { color: status.warning.DEFAULT }]}>
                {data?.banStatistics?.temporaryBans || 0}
              </Text>
            </View>

            <View style={[styles.banStatBox, { backgroundColor: isDark ? neutral[700] : neutral[100] }]}>
              <View style={styles.banStatHeader}>
                <Ionicons name="close-circle" size={16} color={status.error.DEFAULT} />
                <Text style={[styles.banStatLabel, { color: subtextColor }]}>
                  Permanent
                </Text>
              </View>
              <Text style={[styles.banStatValue, { color: status.error.DEFAULT }]}>
                {data?.banStatistics?.permanentBans || 0}
              </Text>
            </View>

            <View style={[styles.banStatBox, { backgroundColor: isDark ? neutral[700] : neutral[100] }]}>
              <View style={styles.banStatHeader}>
                <Ionicons name="refresh" size={16} color={secondary[500]} />
                <Text style={[styles.banStatLabel, { color: subtextColor }]}>
                  Recidivism
                </Text>
              </View>
              <Text style={[styles.banStatValue, { color: secondary[500] }]}>
                {data?.banStatistics?.recidivismRate.toFixed(1) || 0}%
              </Text>
            </View>

            <View style={[styles.banStatBox, { backgroundColor: isDark ? neutral[700] : neutral[100] }]}>
              <View style={styles.banStatHeader}>
                <Ionicons name="trending-up" size={16} color={subtextColor} />
                <Text style={[styles.banStatLabel, { color: subtextColor }]}>
                  This Month
                </Text>
              </View>
              <View style={styles.banMonthStats}>
                <Text style={[styles.banMonthItem, { color: textColor }]}>
                  <Text style={{ color: status.error.DEFAULT }}>
                    +{data?.banStatistics?.bansThisMonth || 0}
                  </Text>
                  {' / '}
                  <Text style={{ color: status.success.DEFAULT }}>
                    -{data?.banStatistics?.unbansThisMonth || 0}
                  </Text>
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Feedback Sentiment */}
        <View style={[styles.card, { backgroundColor: cardBgColor }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="chatbubbles" size={20} color={primary[500]} />
            <Text style={[styles.cardTitle, { color: textColor }]}>
              User Feedback
            </Text>
          </View>

          <View style={styles.chartContainer}>
            {feedbackChartData.length > 0 ? (
              <BarChart
                stackData={feedbackChartData}
                width={chartWidth - 40}
                height={180}
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
                No data available
              </Text>
            )}
          </View>

          <View style={styles.lineChartLegend}>
            <View style={styles.lineChartLegendItem}>
              <View
                style={[styles.lineChartLegendDot, { backgroundColor: status.error.DEFAULT }]}
              />
              <Text style={[styles.lineChartLegendText, { color: subtextColor }]}>
                Bug Reports
              </Text>
            </View>
            <View style={styles.lineChartLegendItem}>
              <View
                style={[styles.lineChartLegendDot, { backgroundColor: primary[400] }]}
              />
              <Text style={[styles.lineChartLegendText, { color: subtextColor }]}>
                Feature Requests
              </Text>
            </View>
          </View>

          {/* Feedback status breakdown */}
          <View style={[styles.feedbackStatusSection, { borderTopColor: borderColor }]}>
            <Text style={[styles.feedbackStatusTitle, { color: textColor }]}>
              Status Breakdown
            </Text>
            {data?.feedbackSentiment?.map((item) => (
              <View key={item.category} style={styles.feedbackStatusRow}>
                <Text style={[styles.feedbackCategory, { color: subtextColor }]}>
                  {item.category}
                </Text>
                <View style={styles.feedbackStatusBadges}>
                  <View style={[styles.statusBadge, { backgroundColor: status.warning.light + '30' }]}>
                    <Text style={[styles.statusBadgeText, { color: status.warning.DEFAULT }]}>
                      {item.status.open} open
                    </Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: primary[400] + '30' }]}>
                    <Text style={[styles.statusBadgeText, { color: primary[600] }]}>
                      {item.status.inProgress} in progress
                    </Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: status.success.light + '30' }]}>
                    <Text style={[styles.statusBadgeText, { color: status.success.DEFAULT }]}>
                      {item.status.resolved} resolved
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Action Items */}
        <View style={[styles.actionCard, { backgroundColor: status.warning.light + '15' }]}>
          <Text style={[styles.actionTitle, { color: status.warning.DEFAULT }]}>
            Action Items
          </Text>

          {(data?.resolutionMetrics?.openReports || 0) > 0 && (
            <View style={styles.actionItem}>
              <Ionicons name="alert-circle" size={20} color={status.warning.DEFAULT} />
              <Text style={[styles.actionText, { color: textColor }]}>
                {`${data?.resolutionMetrics?.openReports || 0} reports pending review`}
              </Text>
            </View>
          )}

          {(data?.resolutionMetrics?.escalationRate || 0) > 15 && (
            <View style={styles.actionItem}>
              <Ionicons name="trending-up" size={20} color={status.error.DEFAULT} />
              <Text style={[styles.actionText, { color: textColor }]}>
                {`High escalation rate (${data?.resolutionMetrics?.escalationRate.toFixed(1) || 0}%) - Review moderation guidelines`}
              </Text>
            </View>
          )}

          {(data?.banStatistics?.recidivismRate || 0) > 10 && (
            <View style={styles.actionItem}>
              <Ionicons name="repeat" size={20} color={secondary[500]} />
              <Text style={[styles.actionText, { color: textColor }]}>
                {`Recidivism rate at ${data?.banStatistics?.recidivismRate.toFixed(1) || 0}% - Consider ban policy review`}
              </Text>
            </View>
          )}

          {(data?.resolutionMetrics?.openReports || 0) === 0 &&
            (data?.resolutionMetrics?.escalationRate || 0) <= 15 &&
            (data?.banStatistics?.recidivismRate || 0) <= 10 && (
              <View style={styles.actionItem}>
                <Ionicons name="checkmark-circle" size={20} color={status.success.DEFAULT} />
                <Text style={[styles.actionText, { color: textColor }]}>
                  All moderation metrics are within healthy ranges
                </Text>
              </View>
            )}
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
  quickStatsRow: {
    flexDirection: 'row',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[3],
  },
  quickStat: {
    flex: 1,
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.md,
  },
  quickStatValue: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: spacingPixels[1],
  },
  quickStatLabel: {
    fontSize: 11,
    textAlign: 'center',
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
  lineChartLegend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacingPixels[4],
    marginTop: spacingPixels[2],
  },
  lineChartLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[4],
  },
  lineChartLegendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  lineChartLegendText: {
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
  reportTypeLegend: {
    marginTop: spacingPixels[4],
    gap: spacingPixels[2],
    width: '100%',
  },
  reportTypeLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[8],
  },
  reportTypePriorityBadge: {
    paddingVertical: 2,
    paddingHorizontal: spacingPixels[8],
    borderRadius: 4,
    minWidth: 60,
    alignItems: 'center',
  },
  reportTypePriorityText: {
    fontSize: 10,
    fontWeight: '700',
  },
  reportTypeInfo: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reportTypeName: {
    fontSize: 14,
  },
  reportTypeCount: {
    fontSize: 12,
  },
  gaugesContainer: {
    gap: spacingPixels[3],
  },
  gaugeContainer: {
    gap: spacingPixels[4],
  },
  gaugeTrack: {
    height: 12,
    backgroundColor: neutral[200],
    borderRadius: 6,
    overflow: 'hidden',
  },
  gaugeFill: {
    height: '100%',
    borderRadius: 6,
  },
  gaugeLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  gaugeValue: {
    fontSize: 16,
    fontWeight: '600',
  },
  gaugeLabel: {
    fontSize: 12,
  },
  slaInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    marginTop: spacingPixels[3],
    paddingTop: spacingPixels[2],
    borderTopWidth: 1,
  },
  slaInfoText: {
    fontSize: 12,
  },
  banStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[2],
  },
  banStatBox: {
    flex: 1,
    minWidth: (screenWidth - spacingPixels[4] * 2 - spacingPixels[4] * 2 - spacingPixels[2]) / 2 - spacingPixels[2],
    borderRadius: radiusPixels.md,
    padding: spacingPixels[3],
  },
  banStatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[4],
    marginBottom: spacingPixels[4],
  },
  banStatLabel: {
    fontSize: 12,
  },
  banStatValue: {
    fontSize: 24,
    fontWeight: '700',
  },
  banMonthStats: {
    marginTop: spacingPixels[4],
  },
  banMonthItem: {
    fontSize: 14,
    fontWeight: '600',
  },
  feedbackStatusSection: {
    marginTop: spacingPixels[3],
    paddingTop: spacingPixels[3],
    borderTopWidth: 1,
  },
  feedbackStatusTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: spacingPixels[2],
  },
  feedbackStatusRow: {
    marginBottom: spacingPixels[2],
  },
  feedbackCategory: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: spacingPixels[4],
  },
  feedbackStatusBadges: {
    flexDirection: 'row',
    gap: spacingPixels[4],
    flexWrap: 'wrap',
  },
  statusBadge: {
    paddingVertical: 2,
    paddingHorizontal: spacingPixels[8],
    borderRadius: 4,
  },
  statusBadgeText: {
    fontSize: 10,
  },
  actionCard: {
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[4],
    borderLeftWidth: 4,
    borderLeftColor: status.warning.DEFAULT,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: spacingPixels[3],
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[2],
  },
  actionText: {
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },
  bottomPadding: {
    height: spacingPixels[8],
  },
});
