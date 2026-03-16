/**
 * AdminMessagingAnalyticsScreen
 *
 * Comprehensive messaging analytics including message volume trends,
 * conversation health, engagement distribution, and match chat adoption.
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
import { Text, TimeRangeSelector, LineChart, BarChart, PieChart } from '@rallia/shared-components';
import { primary, neutral, status, spacingPixels, radiusPixels } from '@rallia/design-system';
import {
  getMessageVolume,
  getConversationHealth,
  getEngagementDistribution,
  getMatchChatAdoption,
  type MessageVolume,
  type ConversationHealth,
  type EngagementDistribution,
  type MatchChatAdoption,
} from '@rallia/shared-services';
import type { RootStackParamList } from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

// =============================================================================
// HOOK: useMessagingAnalytics
// =============================================================================

function useMessagingAnalytics(selectedOption: TimeRangeOption) {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [messageVolume, setMessageVolume] = React.useState<MessageVolume[]>([]);
  const [conversationHealth, setConversationHealth] = React.useState<ConversationHealth | null>(
    null
  );
  const [engagementDist, setEngagementDist] = React.useState<EngagementDistribution[]>([]);
  const [matchChatAdoption, setMatchChatAdoption] = React.useState<MatchChatAdoption | null>(null);
  const [totalMessages, setTotalMessages] = React.useState(0);

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
      // Fetch message volume
      const volumeResult = await getMessageVolume(startDate, endDate);
      if (volumeResult && volumeResult.length > 0) {
        setMessageVolume(volumeResult);
        const total = volumeResult.reduce(
          (sum: number, v: MessageVolume) => sum + v.totalMessages,
          0
        );
        setTotalMessages(total);
      }

      // Fetch conversation health
      const healthResult = await getConversationHealth();
      if (healthResult) {
        setConversationHealth(healthResult);
      }

      // Fetch engagement distribution
      const distResult = await getEngagementDistribution();
      if (distResult && distResult.length > 0) {
        setEngagementDist(distResult);
      }

      // Fetch match chat adoption
      const adoptionResult = await getMatchChatAdoption(startDate, endDate);
      if (adoptionResult) {
        setMatchChatAdoption(adoptionResult);
      }
    } catch (err) {
      console.error('Error fetching messaging analytics:', err);
      setError('Failed to load messaging analytics');
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
    messageVolume,
    conversationHealth,
    engagementDist,
    matchChatAdoption,
    totalMessages,
    refetch: fetchData,
  };
}

// =============================================================================
// COMPONENT
// =============================================================================

const AdminMessagingAnalyticsScreen: React.FC = () => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const isDark = theme === 'dark';

  const { selectedOption, setRange } = useAnalyticsTimeRange();
  const {
    loading,
    error,
    messageVolume,
    conversationHealth,
    engagementDist,
    matchChatAdoption,
    totalMessages,
    refetch,
  } = useMessagingAnalytics(selectedOption);

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

  // Transform message volume for stacked area chart using LineChart
  const totalMessageChartData = useMemo(() => {
    return messageVolume.map(volume => ({
      label: volume.date.slice(5), // MM-DD
      value: volume.totalMessages,
    }));
  }, [messageVolume]);

  // Message type breakdown for PieChart
  const messageTypeData = useMemo(() => {
    if (messageVolume.length === 0) return [];

    const totals = messageVolume.reduce(
      (acc, v) => ({
        direct: acc.direct + v.directMessages,
        group: acc.group + v.groupMessages,
        match: acc.match + v.matchMessages,
      }),
      { direct: 0, group: 0, match: 0 }
    );

    return [
      { label: 'Direct', value: totals.direct, color: primary[500] },
      { label: 'Group', value: totals.group, color: status.success.DEFAULT },
      { label: 'Match', value: totals.match, color: status.warning.DEFAULT },
    ];
  }, [messageVolume]);

  // Engagement distribution for BarChart
  const engagementChartData = useMemo(() => {
    return engagementDist.map(bucket => ({
      label: bucket.bucket,
      value: bucket.userCount,
    }));
  }, [engagementDist]);

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
            {t('admin.analytics.screens.messaging.title' as TranslationKey) ||
              'Messaging Analytics'}
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            {t('admin.analytics.screens.messaging.subtitle' as TranslationKey) ||
              'Communication patterns & engagement'}
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
        <View style={styles.metricsGrid}>
          <View style={[styles.metricCard, { backgroundColor: colors.surface }]}>
            <View style={[styles.metricIcon, { backgroundColor: primary[100] }]}>
              <Ionicons name="chatbubbles" size={20} color={primary[600]} />
            </View>
            <Text style={[styles.metricValue, { color: colors.text }]}>
              {totalMessages.toLocaleString()}
            </Text>
            <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
              {t('admin.analytics.screens.messaging.totalMessages' as TranslationKey) ||
                'Total Messages'}
            </Text>
          </View>

          <View style={[styles.metricCard, { backgroundColor: colors.surface }]}>
            <View style={[styles.metricIcon, { backgroundColor: status.success.light }]}>
              <Ionicons name="chatbox-ellipses" size={20} color={status.success.DEFAULT} />
            </View>
            <Text style={[styles.metricValue, { color: colors.text }]}>
              {conversationHealth?.activeConversations.toLocaleString() || '0'}
            </Text>
            <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
              {t('admin.analytics.screens.messaging.activeConversations' as TranslationKey) ||
                'Active Convos'}
            </Text>
          </View>

          <View style={[styles.metricCard, { backgroundColor: colors.surface }]}>
            <View style={[styles.metricIcon, { backgroundColor: status.warning.light }]}>
              <Ionicons name="return-up-forward" size={20} color={status.warning.DEFAULT} />
            </View>
            <Text style={[styles.metricValue, { color: colors.text }]}>
              {conversationHealth?.responseRate.toFixed(1) || '0'}%
            </Text>
            <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
              {t('admin.analytics.screens.messaging.responseRate' as TranslationKey) ||
                'Response Rate'}
            </Text>
          </View>

          <View style={[styles.metricCard, { backgroundColor: colors.surface }]}>
            <View style={[styles.metricIcon, { backgroundColor: '#8B5CF620' }]}>
              <Ionicons name="time" size={20} color="#8B5CF6" />
            </View>
            <Text style={[styles.metricValue, { color: colors.text }]}>
              {conversationHealth?.avgResponseTimeMinutes || 0}m
            </Text>
            <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
              {t('admin.analytics.screens.messaging.avgResponseTime' as TranslationKey) ||
                'Avg Response'}
            </Text>
          </View>
        </View>

        {/* Message Volume Trend */}
        <View style={[styles.chartCard, { backgroundColor: colors.surface }]}>
          <Text style={[styles.chartTitle, { color: colors.text }]}>
            {t('admin.analytics.screens.messaging.volumeTrend' as TranslationKey) ||
              'Message Volume'}
          </Text>
          <Text style={[styles.chartSubtitle, { color: colors.textSecondary }]}>
            {t('admin.analytics.screens.messaging.volumeTrendDesc' as TranslationKey) ||
              'Daily message count across all conversations'}
          </Text>
          {totalMessageChartData.length > 0 ? (
            <View style={styles.chartContainer}>
              <LineChart
                data={totalMessageChartData}
                height={200}
                lineColor={primary[500]}
                showDataPoints
                showGrid
                showArea
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

        {/* Message Types Distribution */}
        <View style={[styles.chartCard, { backgroundColor: colors.surface }]}>
          <Text style={[styles.chartTitle, { color: colors.text }]}>
            {t('admin.analytics.screens.messaging.messageTypes' as TranslationKey) ||
              'Message Types'}
          </Text>
          <Text style={[styles.chartSubtitle, { color: colors.textSecondary }]}>
            {t('admin.analytics.screens.messaging.messageTypesDesc' as TranslationKey) ||
              'Distribution by conversation type'}
          </Text>
          {messageTypeData.length > 0 ? (
            <View style={styles.pieChartContainer}>
              <PieChart data={messageTypeData} radius={80} showLegend={false} innerRadius={40} />
              <View style={styles.messageTypeLegend}>
                {messageTypeData.map(type => (
                  <View key={type.label} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: type.color }]} />
                    <Text style={[styles.legendLabel, { color: colors.text }]}>{type.label}</Text>
                    <Text style={[styles.legendValue, { color: colors.textSecondary }]}>
                      {type.value.toLocaleString()}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : (
            <View style={styles.noDataContainer}>
              <Text style={[styles.noDataText, { color: colors.textSecondary }]}>
                {t('admin.analytics.noData' as TranslationKey) || 'No data available'}
              </Text>
            </View>
          )}
        </View>

        {/* Conversation Health Gauges */}
        {conversationHealth && (
          <View style={[styles.chartCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.chartTitle, { color: colors.text }]}>
              {t('admin.analytics.screens.messaging.conversationHealth' as TranslationKey) ||
                'Conversation Health'}
            </Text>
            <Text style={[styles.chartSubtitle, { color: colors.textSecondary }]}>
              {t('admin.analytics.screens.messaging.conversationHealthDesc' as TranslationKey) ||
                'Key conversation metrics and health indicators'}
            </Text>

            <View style={styles.healthMetricsContainer}>
              {/* Active Rate Gauge */}
              <View style={styles.gaugeItem}>
                <View style={styles.gaugeCircle}>
                  <View
                    style={[
                      styles.gaugeProgress,
                      {
                        width: `${Math.min(
                          (conversationHealth.activeConversations /
                            Math.max(conversationHealth.totalConversations, 1)) *
                            100,
                          100
                        )}%`,
                        backgroundColor: status.success.DEFAULT,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.gaugeValue, { color: colors.text }]}>
                  {Math.round(
                    (conversationHealth.activeConversations /
                      Math.max(conversationHealth.totalConversations, 1)) *
                      100
                  )}
                  %
                </Text>
                <Text style={[styles.gaugeLabel, { color: colors.textSecondary }]}>
                  Active Rate
                </Text>
              </View>

              {/* Response Rate Gauge */}
              <View style={styles.gaugeItem}>
                <View style={styles.gaugeCircle}>
                  <View
                    style={[
                      styles.gaugeProgress,
                      {
                        width: `${Math.min(conversationHealth.responseRate, 100)}%`,
                        backgroundColor: primary[500],
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.gaugeValue, { color: colors.text }]}>
                  {conversationHealth.responseRate.toFixed(1)}%
                </Text>
                <Text style={[styles.gaugeLabel, { color: colors.textSecondary }]}>
                  Response Rate
                </Text>
              </View>

              {/* Activity Rate Gauge */}
              <View style={styles.gaugeItem}>
                <View style={styles.gaugeCircle}>
                  <View
                    style={[
                      styles.gaugeProgress,
                      {
                        width: `${Math.min(
                          (conversationHealth.conversationsWithActivity /
                            Math.max(conversationHealth.totalConversations, 1)) *
                            100,
                          100
                        )}%`,
                        backgroundColor: status.warning.DEFAULT,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.gaugeValue, { color: colors.text }]}>
                  {Math.round(
                    (conversationHealth.conversationsWithActivity /
                      Math.max(conversationHealth.totalConversations, 1)) *
                      100
                  )}
                  %
                </Text>
                <Text style={[styles.gaugeLabel, { color: colors.textSecondary }]}>
                  Weekly Activity
                </Text>
              </View>
            </View>

            <View style={[styles.healthStats, { borderTopColor: colors.border }]}>
              <View style={styles.healthStatItem}>
                <Text style={[styles.healthStatValue, { color: colors.text }]}>
                  {conversationHealth.totalConversations.toLocaleString()}
                </Text>
                <Text style={[styles.healthStatLabel, { color: colors.textSecondary }]}>
                  Total Conversations
                </Text>
              </View>
              <View style={styles.healthStatItem}>
                <Text style={[styles.healthStatValue, { color: colors.text }]}>
                  {conversationHealth.avgResponseTimeMinutes}m
                </Text>
                <Text style={[styles.healthStatLabel, { color: colors.textSecondary }]}>
                  Avg Response Time
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* User Engagement Distribution */}
        <View style={[styles.chartCard, { backgroundColor: colors.surface }]}>
          <Text style={[styles.chartTitle, { color: colors.text }]}>
            {t('admin.analytics.screens.messaging.engagementDist' as TranslationKey) ||
              'User Engagement'}
          </Text>
          <Text style={[styles.chartSubtitle, { color: colors.textSecondary }]}>
            {t('admin.analytics.screens.messaging.engagementDistDesc' as TranslationKey) ||
              'Distribution of users by message count'}
          </Text>
          {engagementChartData.length > 0 ? (
            <View style={styles.chartContainer}>
              <BarChart
                data={engagementChartData}
                height={220}
                barColor={primary[500]}
                showValues
              />
            </View>
          ) : (
            <View style={styles.noDataContainer}>
              <Text style={[styles.noDataText, { color: colors.textSecondary }]}>
                {t('admin.analytics.noData' as TranslationKey) || 'No data available'}
              </Text>
            </View>
          )}

          {/* Engagement Stats */}
          <View style={[styles.engagementStats, { borderTopColor: colors.border }]}>
            {engagementDist.map((bucket, index) => (
              <View key={bucket.bucket} style={styles.engagementStatItem}>
                <View
                  style={[styles.engagementDot, { backgroundColor: getEngagementColor(index) }]}
                />
                <Text style={[styles.engagementLabel, { color: colors.textSecondary }]}>
                  {bucket.bucket}
                </Text>
                <Text style={[styles.engagementValue, { color: colors.text }]}>
                  {bucket.percentage}%
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Match Chat Adoption */}
        {matchChatAdoption && (
          <View style={[styles.chartCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.chartTitle, { color: colors.text }]}>
              {t('admin.analytics.screens.messaging.matchChatAdoption' as TranslationKey) ||
                'Match Chat Adoption'}
            </Text>
            <Text style={[styles.chartSubtitle, { color: colors.textSecondary }]}>
              {t('admin.analytics.screens.messaging.matchChatAdoptionDesc' as TranslationKey) ||
                'How often match participants use chat'}
            </Text>

            <View style={styles.adoptionContainer}>
              <View style={styles.adoptionGauge}>
                <View style={styles.adoptionCircleOuter}>
                  <View
                    style={[
                      styles.adoptionCircleProgress,
                      {
                        transform: [
                          { rotate: `${(matchChatAdoption.adoptionRate / 100) * 180 - 90}deg` },
                        ],
                      },
                    ]}
                  />
                  <View style={[styles.adoptionCircleInner, { backgroundColor: colors.surface }]}>
                    <Text style={[styles.adoptionPercent, { color: colors.text }]}>
                      {matchChatAdoption.adoptionRate.toFixed(1)}%
                    </Text>
                    <Text style={[styles.adoptionLabel, { color: colors.textSecondary }]}>
                      Adoption
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.adoptionStats}>
                <View style={styles.adoptionStatRow}>
                  <View style={styles.adoptionStatItem}>
                    <Ionicons name="tennisball" size={16} color={status.success.DEFAULT} />
                    <Text style={[styles.adoptionStatValue, { color: colors.text }]}>
                      {matchChatAdoption.matchesWithChat.toLocaleString()}
                    </Text>
                    <Text style={[styles.adoptionStatLabel, { color: colors.textSecondary }]}>
                      Matches with Chat
                    </Text>
                  </View>
                  <View style={styles.adoptionStatItem}>
                    <Ionicons name="calendar" size={16} color={primary[500]} />
                    <Text style={[styles.adoptionStatValue, { color: colors.text }]}>
                      {matchChatAdoption.totalEligibleMatches.toLocaleString()}
                    </Text>
                    <Text style={[styles.adoptionStatLabel, { color: colors.textSecondary }]}>
                      Eligible Matches
                    </Text>
                  </View>
                </View>
                <View
                  style={[
                    styles.adoptionAvgContainer,
                    { backgroundColor: isDark ? neutral[800] : neutral[100] },
                  ]}
                >
                  <Ionicons name="chatbubble" size={16} color={status.warning.DEFAULT} />
                  <Text style={[styles.adoptionAvgText, { color: colors.text }]}>
                    {matchChatAdoption.avgMessagesPerMatch.toFixed(1)} avg messages/match
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}

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

function getEngagementColor(index: number): string {
  const colors = [
    neutral[300],
    '#94A3B8',
    status.warning.DEFAULT,
    status.success.DEFAULT,
    primary[500],
    '#8B5CF6',
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
  pieChartContainer: {
    alignItems: 'center',
  },
  messageTypeLegend: {
    marginTop: spacingPixels[4],
    width: '100%',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[2],
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: spacingPixels[2],
  },
  legendLabel: {
    flex: 1,
    fontSize: 14,
  },
  legendValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  healthMetricsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: spacingPixels[4],
  },
  gaugeItem: {
    alignItems: 'center',
  },
  gaugeCircle: {
    width: 80,
    height: 8,
    backgroundColor: neutral[200],
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: spacingPixels[2],
  },
  gaugeProgress: {
    height: '100%',
    borderRadius: 4,
  },
  gaugeValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  gaugeLabel: {
    fontSize: 11,
    marginTop: 2,
  },
  healthStats: {
    flexDirection: 'row',
    paddingTop: spacingPixels[4],
    borderTopWidth: 1,
    marginTop: spacingPixels[2],
  },
  healthStatItem: {
    flex: 1,
    alignItems: 'center',
  },
  healthStatValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  healthStatLabel: {
    fontSize: 12,
    marginTop: 4,
  },
  engagementStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingTop: spacingPixels[4],
    borderTopWidth: 1,
    marginTop: spacingPixels[4],
  },
  engagementStatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '50%',
    paddingVertical: spacingPixels[1],
  },
  engagementDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacingPixels[2],
  },
  engagementLabel: {
    flex: 1,
    fontSize: 12,
  },
  engagementValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  adoptionContainer: {
    alignItems: 'center',
  },
  adoptionGauge: {
    marginBottom: spacingPixels[4],
  },
  adoptionCircleOuter: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: primary[100],
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  adoptionCircleProgress: {
    position: 'absolute',
    width: 60,
    height: 120,
    backgroundColor: primary[500],
    left: 0,
    transformOrigin: 'right center',
  },
  adoptionCircleInner: {
    width: 90,
    height: 90,
    borderRadius: 45,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adoptionPercent: {
    fontSize: 24,
    fontWeight: '700',
  },
  adoptionLabel: {
    fontSize: 11,
  },
  adoptionStats: {
    width: '100%',
  },
  adoptionStatRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: spacingPixels[3],
  },
  adoptionStatItem: {
    alignItems: 'center',
  },
  adoptionStatValue: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: spacingPixels[1],
  },
  adoptionStatLabel: {
    fontSize: 11,
    marginTop: 2,
  },
  adoptionAvgContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.md,
    gap: spacingPixels[2],
  },
  adoptionAvgText: {
    fontSize: 14,
    fontWeight: '500',
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

export default AdminMessagingAnalyticsScreen;
