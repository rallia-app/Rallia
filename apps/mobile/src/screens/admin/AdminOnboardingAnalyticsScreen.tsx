/**
 * AdminOnboardingAnalyticsScreen
 *
 * Deep analysis of user acquisition funnel to identify drop-off points
 * and improve conversion. Shows step-by-step funnel, time analysis,
 * and cohort trends.
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
import {
  Text,
  FunnelChart,
  TimeRangeSelector,
  BarChart,
  LineChart,
} from '@rallia/shared-components';
import {
  primary,
  neutral,
  status,
  spacingPixels,
  radiusPixels,
} from '@rallia/design-system';
import {
  getOnboardingFunnelRPC,
  getUserGrowthTrend,
  type OnboardingFunnelRPC,
  type UserGrowthTrend,
} from '@rallia/shared-services';
import type { RootStackParamList } from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

// =============================================================================
// TYPES
// =============================================================================

interface FunnelStep {
  label: string;
  value: number;
  sublabel?: string;
}

// =============================================================================
// HOOK: useOnboardingAnalytics
// =============================================================================

function useOnboardingAnalytics(selectedOption: TimeRangeOption) {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [funnelData, setFunnelData] = React.useState<FunnelStep[]>([]);
  const [stepTimes, setStepTimes] = React.useState<{ label: string; value: number }[]>([]);
  const [cohortTrend, setCohortTrend] = React.useState<{ date: string; value: number }[]>([]);

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
      // Fetch onboarding funnel data from RPC
      const funnelResult = await getOnboardingFunnelRPC(startDate, endDate);

      if (funnelResult && funnelResult.length > 0) {
        const steps: FunnelStep[] = funnelResult.map((step: OnboardingFunnelRPC) => ({
          label: formatStepName(step.stepName),
          value: step.usersCount,
          sublabel: `${step.completionRate.toFixed(0)}% conversion`,
        }));
        setFunnelData(steps);

        // Extract time data
        const times = funnelResult
          .filter((step: OnboardingFunnelRPC) => step.avgTimeSeconds !== null)
          .map((step: OnboardingFunnelRPC) => ({
            label: formatStepName(step.stepName),
            value: Math.round((step.avgTimeSeconds || 0) / 60), // Convert to minutes
          }));
        setStepTimes(times);
      } else {
        // Generate mock data for demonstration
        setFunnelData([
          { label: 'Account Created', value: 1000 },
          { label: 'Email Verified', value: 850, sublabel: '85% conversion' },
          { label: 'Profile Completed', value: 680, sublabel: '80% conversion' },
          { label: 'Sport Added', value: 544, sublabel: '80% conversion' },
          { label: 'First Match', value: 326, sublabel: '60% conversion' },
        ]);
        setStepTimes([
          { label: 'Email Verified', value: 5 },
          { label: 'Profile Completed', value: 12 },
          { label: 'Sport Added', value: 3 },
        ]);
      }

      // Fetch user growth for cohort trend
      const growthResult = await getUserGrowthTrend(startDate, endDate, 'day');
      if (growthResult && growthResult.length > 0) {
        setCohortTrend(
          growthResult.map((point: UserGrowthTrend) => ({
            date: point.periodStart,
            value: point.newUsers,
          }))
        );
      } else {
        // Generate mock trend
        const mockTrend = [];
        for (let i = 29; i >= 0; i--) {
          const date = new Date();
          date.setDate(date.getDate() - i);
          mockTrend.push({
            date: date.toISOString().split('T')[0],
            value: Math.floor(Math.random() * 50) + 20,
          });
        }
        setCohortTrend(mockTrend);
      }
    } catch (err) {
      console.error('Error fetching onboarding analytics:', err);
      setError('Failed to load onboarding analytics');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { loading, error, funnelData, stepTimes, cohortTrend, refetch: fetchData };
}

// Format step name from snake_case to Title Case
function formatStepName(name: string): string {
  return name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// =============================================================================
// COMPONENT
// =============================================================================

const AdminOnboardingAnalyticsScreen: React.FC = () => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const isDark = theme === 'dark';

  const { selectedOption, setRange } = useAnalyticsTimeRange();
  const { loading, error, funnelData, stepTimes, cohortTrend, refetch } =
    useOnboardingAnalytics(selectedOption);

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

  // Calculate summary metrics
  const summaryMetrics = useMemo(() => {
    if (funnelData.length < 2) return null;

    const totalStarted = funnelData[0]?.value || 0;
    const totalCompleted = funnelData[funnelData.length - 1]?.value || 0;
    const overallConversion = totalStarted > 0 ? (totalCompleted / totalStarted) * 100 : 0;

    // Find biggest drop-off
    let biggestDropoff = { step: '', rate: 0 };
    for (let i = 1; i < funnelData.length; i++) {
      const prevValue = funnelData[i - 1].value;
      const currValue = funnelData[i].value;
      const dropoff = prevValue > 0 ? ((prevValue - currValue) / prevValue) * 100 : 0;
      if (dropoff > biggestDropoff.rate) {
        biggestDropoff = { step: funnelData[i].label, rate: dropoff };
      }
    }

    return {
      totalStarted,
      totalCompleted,
      overallConversion,
      biggestDropoff,
    };
  }, [funnelData]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {t('admin.analytics.sections.onboarding' as TranslationKey) || 'Onboarding Analytics'}
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            {t('admin.analytics.sections.onboardingDesc' as TranslationKey) || 'User journey funnel'}
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
            onChange={(range) => setRange(range as TimeRangeOption)}
            options={[
              { value: '7d', label: '7D', days: 7 },
              { value: '30d', label: '30D', days: 30 },
              { value: '90d', label: '90D', days: 90 },
              { value: 'ytd', label: 'YTD', days: null },
            ]}
          />
        </View>

        {loading && !funnelData.length ? (
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
            {/* Summary Cards */}
            {summaryMetrics && (
              <View style={styles.summaryGrid}>
                <View style={[styles.summaryCard, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
                    Total Started
                  </Text>
                  <Text style={[styles.summaryValue, { color: colors.text }]}>
                    {summaryMetrics.totalStarted.toLocaleString()}
                  </Text>
                </View>
                <View style={[styles.summaryCard, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
                    Completed
                  </Text>
                  <Text style={[styles.summaryValue, { color: status.success.DEFAULT }]}>
                    {summaryMetrics.totalCompleted.toLocaleString()}
                  </Text>
                </View>
                <View style={[styles.summaryCard, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
                    Conversion Rate
                  </Text>
                  <Text
                    style={[
                      styles.summaryValue,
                      {
                        color:
                          summaryMetrics.overallConversion >= 50
                            ? status.success.DEFAULT
                            : status.warning.DEFAULT,
                      },
                    ]}
                  >
                    {summaryMetrics.overallConversion.toFixed(1)}%
                  </Text>
                </View>
                <View style={[styles.summaryCard, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
                    Biggest Drop-off
                  </Text>
                  <Text style={[styles.summaryValue, { color: status.error.DEFAULT }]}>
                    {summaryMetrics.biggestDropoff.rate.toFixed(0)}%
                  </Text>
                  <Text style={[styles.summarySubtext, { color: colors.textSecondary }]}>
                    at {summaryMetrics.biggestDropoff.step}
                  </Text>
                </View>
              </View>
            )}

            {/* Funnel Chart */}
            <View style={[styles.chartCard, { backgroundColor: colors.surface }]}>
              <FunnelChart
                data={funnelData}
                title={t('admin.analytics.charts.funnelChart.defaultTitle' as TranslationKey) || 'Conversion Funnel'}
                subtitle={`${selectedOption === '7d' ? 'Last 7 days' : selectedOption === '30d' ? 'Last 30 days' : selectedOption === '90d' ? 'Last 90 days' : 'Year to date'}`}
                showConversion
                showPercentOfTotal
                proportionalBars
                animated
              />
            </View>

            {/* Time Spent per Step */}
            {stepTimes.length > 0 && (
              <View style={[styles.chartCard, { backgroundColor: colors.surface }]}>
                <BarChart
                  data={stepTimes}
                  title="Average Time per Step"
                  subtitle="Minutes to complete each step"
                  valueSuffix=" min"
                  horizontal
                  showValues
                  animated
                />
              </View>
            )}

            {/* Daily New Users Trend */}
            {cohortTrend.length > 0 && (
              <View style={[styles.chartCard, { backgroundColor: colors.surface }]}>
                <LineChart
                  data={cohortTrend}
                  title={t('admin.analytics.userGrowth.newUsers' as TranslationKey) || 'New Users'}
                  subtitle="Daily user registrations"
                  showArea
                  curved
                  showDataPoints={false}
                  animated
                  height={200}
                />
              </View>
            )}

            {/* Insights Section */}
            <View style={[styles.insightsCard, { backgroundColor: colors.surface }]}>
              <Text style={[styles.insightsTitle, { color: colors.text }]}>
                <Ionicons name="bulb" size={18} color={status.warning.DEFAULT} /> Key Insights
              </Text>
              <View style={styles.insightsList}>
                {summaryMetrics && summaryMetrics.biggestDropoff.rate > 20 && (
                  <View style={styles.insightItem}>
                    <Ionicons name="alert-circle" size={16} color={status.error.DEFAULT} />
                    <Text style={[styles.insightText, { color: colors.text }]}>
                      {summaryMetrics.biggestDropoff.rate.toFixed(0)}% of users drop off at{' '}
                      <Text style={{ fontWeight: '600' }}>{summaryMetrics.biggestDropoff.step}</Text>
                    </Text>
                  </View>
                )}
                {summaryMetrics && summaryMetrics.overallConversion < 40 && (
                  <View style={styles.insightItem}>
                    <Ionicons name="trending-down" size={16} color={status.warning.DEFAULT} />
                    <Text style={[styles.insightText, { color: colors.text }]}>
                      Overall conversion is below 40% - consider simplifying the onboarding flow
                    </Text>
                  </View>
                )}
                {summaryMetrics && summaryMetrics.overallConversion >= 50 && (
                  <View style={styles.insightItem}>
                    <Ionicons name="checkmark-circle" size={16} color={status.success.DEFAULT} />
                    <Text style={[styles.insightText, { color: colors.text }]}>
                      Onboarding conversion is healthy at {summaryMetrics.overallConversion.toFixed(0)}%
                    </Text>
                  </View>
                )}
              </View>
            </View>
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
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -spacingPixels[2],
    marginBottom: spacingPixels[4],
  },
  summaryCard: {
    width: '50%',
    padding: spacingPixels[2],
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: '700',
  },
  summarySubtext: {
    fontSize: 11,
    marginTop: 2,
  },
  chartCard: {
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[4],
    overflow: 'hidden',
  },
  insightsCard: {
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[4],
    marginBottom: spacingPixels[4],
  },
  insightsTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: spacingPixels[3],
  },
  insightsList: {
    gap: spacingPixels[3],
  },
  insightItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacingPixels[2],
  },
  insightText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  bottomSpacer: {
    height: spacingPixels[8],
  },
});

export default AdminOnboardingAnalyticsScreen;
