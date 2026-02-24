/**
 * AdminDashboardScreen
 *
 * Analytics dashboard for administrators showing:
 * - KPI widgets with sparkline trends
 * - Time range selector (7d, 30d, 90d, YTD)
 * - Navigation cards to detailed sections
 * - Sport-specific metrics
 * - Onboarding funnel visualization
 *
 * Access Requirements:
 * - User must have admin role (any level)
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
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Text,
  SparklineChart,
  TimeRangeSelector,
  AnalyticsSectionCard,
} from '@rallia/shared-components';
import {
  useTheme,
  useAdminAnalytics,
  useAdminStatus,
  useAnalyticsTimeRange,
  type DashboardWidget,
  type SportStatistics,
  type OnboardingFunnelStep,
} from '@rallia/shared-hooks';
import { useTranslation } from '../hooks';
import type { TranslationKey } from '@rallia/shared-translations';
import type { RootStackParamList } from '../navigation/types';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
  status,
} from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;


// =============================================================================
// COMPONENT
// =============================================================================

const AdminDashboardScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { isAdmin } = useAdminStatus();

  // Time range management
  const { selectedOption, timeRange, setRange } = useAnalyticsTimeRange({
    defaultRange: '7d',
  });

  // Fetch analytics data with trends
  const {
    kpi,
    widgets,
    trends,
    loading,
    trendsLoading,
    error,
    lastUpdated,
    refetch,
    refetchTrends,
  } = useAdminAnalytics({
    includeTrends: true,
    trendDays: timeRange.days,
  });

  // Handle time range change
  const handleTimeRangeChange = useCallback(
    async (option: '7d' | '30d' | '90d' | 'ytd') => {
      lightHaptic();
      await setRange(option);
      // Refetch trends with new day count
      const days = option === '7d' ? 7 : option === '30d' ? 30 : option === '90d' ? 90 : timeRange.days;
      await refetchTrends(days);
    },
    [setRange, refetchTrends, timeRange.days]
  );

  // Theme-aware colors
  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = useMemo(
    () => ({
      background: themeColors.background,
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textSecondary: isDark ? primary[300] : neutral[600],
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      icon: themeColors.foreground,
      accent: isDark ? primary[500] : primary[600],
      accentLight: isDark ? `${primary[500]}20` : `${primary[600]}10`,
      successBg: isDark ? `${status.success.DEFAULT}20` : `${status.success.light}15`,
      successText: status.success.DEFAULT,
      warningBg: isDark ? `${status.warning.DEFAULT}20` : `${status.warning.light}15`,
      warningText: status.warning.DEFAULT,
      errorBg: isDark ? `${status.error.DEFAULT}20` : `${status.error.light}15`,
      errorText: status.error.DEFAULT,
    }),
    [isDark, themeColors]
  );

  // Format last updated time
  const formatLastUpdated = useCallback((date: Date | null): string => {
    if (!date) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, []);

  // Handle back navigation
  const handleBack = useCallback(() => {
    lightHaptic();
    navigation.goBack();
  }, [navigation]);

  // Access check
  if (!isAdmin) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.errorContainer}>
          <Ionicons name="lock-closed" size={48} color={colors.errorText} />
          <Text style={[styles.errorText, { color: colors.text }]}>
            {t('admin.accessDenied' as TranslationKey)}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Render KPI widget card with sparkline
  const renderWidgetCard = (widget: DashboardWidget) => {
    const getChangeColor = () => {
      if (widget.changeType === 'increase') return colors.successText;
      if (widget.changeType === 'decrease') return colors.errorText;
      return colors.textMuted;
    };

    const getChangeIcon = () => {
      if (widget.changeType === 'increase') return 'arrow-up';
      if (widget.changeType === 'decrease') return 'arrow-down';
      return 'remove';
    };

    // Get trend type for sparkline color
    const getTrendType = (): 'positive' | 'negative' | 'neutral' => {
      if (widget.changeType === 'increase') return 'positive';
      if (widget.changeType === 'decrease') return 'negative';
      return 'neutral';
    };

    // Get trend data for this widget
    const trendData = widget.trend || trends[widget.id] || [];

    return (
      <View
        key={widget.id}
        style={[
          styles.widgetCard,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.widgetTitle, { color: colors.textSecondary }]}>
          {t(`admin.analytics.widgets.${widget.id.replace(/-/g, '_')}` as TranslationKey) || widget.title}
        </Text>
        <View style={styles.widgetValueRow}>
          <Text style={[styles.widgetValue, { color: colors.text }]}>
            {typeof widget.value === 'number' ? widget.value.toLocaleString() : widget.value}
          </Text>
          {/* Sparkline chart */}
          {trendData.length > 0 && (
            <View style={styles.sparklineContainer}>
              <SparklineChart
                data={trendData}
                width={60}
                height={28}
                trend={getTrendType()}
              />
            </View>
          )}
        </View>
        {widget.change !== undefined && (
          <View style={styles.widgetChange}>
            <Ionicons name={getChangeIcon()} size={14} color={getChangeColor()} />
            <Text style={[styles.widgetChangeText, { color: getChangeColor() }]}>
              {widget.change > 0 ? '+' : ''}{widget.change}
            </Text>
          </View>
        )}
      </View>
    );
  };

  // Render sport statistics card
  const renderSportCard = (sport: SportStatistics) => {
    return (
      <View
        key={sport.sportId}
        style={[
          styles.sportCard,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
      >
        <View style={styles.sportHeader}>
          <Ionicons
            name={sport.sportName.toLowerCase() === 'tennis' ? 'tennisball' : 'ellipse'}
            size={24}
            color={colors.accent}
          />
          <Text style={[styles.sportName, { color: colors.text }]}>
            {sport.sportName}
          </Text>
        </View>
        <View style={styles.sportStats}>
          <View style={styles.sportStatItem}>
            <Text style={[styles.sportStatValue, { color: colors.text }]}>
              {sport.totalPlayers.toLocaleString()}
            </Text>
            <Text style={[styles.sportStatLabel, { color: colors.textMuted }]}>
              {t('admin.analytics.players' as TranslationKey)}
            </Text>
          </View>
          <View style={styles.sportStatItem}>
            <Text style={[styles.sportStatValue, { color: colors.text }]}>
              {sport.matchesCreated.toLocaleString()}
            </Text>
            <Text style={[styles.sportStatLabel, { color: colors.textMuted }]}>
              {t('admin.analytics.matches' as TranslationKey)}
            </Text>
          </View>
          <View style={styles.sportStatItem}>
            <Text style={[styles.sportStatValue, { color: colors.successText }]}>
              {sport.matchesCompleted.toLocaleString()}
            </Text>
            <Text style={[styles.sportStatLabel, { color: colors.textMuted }]}>
              {t('admin.analytics.completed' as TranslationKey)}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  // Render onboarding funnel step
  const renderFunnelStep = (step: OnboardingFunnelStep, index: number) => {
    const completionWidth = Math.min(step.completionRate, 100);
    const barColor = step.completionRate >= 70
      ? colors.successText
      : step.completionRate >= 40
        ? colors.warningText
        : colors.errorText;

    return (
      <View key={step.screenName} style={styles.funnelStep}>
        <View style={styles.funnelStepHeader}>
          <Text style={[styles.funnelStepNumber, { color: colors.textMuted }]}>
            {index + 1}.
          </Text>
          <Text style={[styles.funnelStepName, { color: colors.text }]}>
            {t(`admin.analytics.onboarding.${step.screenName}` as TranslationKey) || step.screenName}
          </Text>
          <Text style={[styles.funnelStepRate, { color: colors.textSecondary }]}>
            {step.completionRate.toFixed(1)}%
          </Text>
        </View>
        <View style={[styles.funnelBar, { backgroundColor: colors.border }]}>
          <View
            style={[
              styles.funnelBarFill,
              { width: `${completionWidth}%`, backgroundColor: barColor },
            ]}
          />
        </View>
        <View style={styles.funnelStepMeta}>
          <Text style={[styles.funnelMetaText, { color: colors.textMuted }]}>
            {step.totalViews} {t('admin.analytics.views' as TranslationKey)}
          </Text>
          <Text style={[styles.funnelMetaText, { color: colors.textMuted }]}>
            {step.avgTimeSeconds > 0 ? `~${Math.round(step.avgTimeSeconds)}s` : '-'}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.icon} />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {t('admin.analytics.title' as TranslationKey)}
          </Text>
          {lastUpdated && (
            <Text style={[styles.headerSubtitle, { color: colors.textMuted }]}>
              {t('admin.analytics.lastUpdated' as TranslationKey)}: {formatLastUpdated(lastUpdated)}
            </Text>
          )}
        </View>
        <TouchableOpacity onPress={refetch} style={styles.refreshButton} disabled={loading}>
          {loading ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Ionicons name="refresh" size={24} color={colors.accent} />
          )}
        </TouchableOpacity>
      </View>

      {/* Content */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refetch} tintColor={colors.accent} />
        }
      >
        {/* Time Range Selector */}
        <View style={styles.timeRangeSection}>
          <TimeRangeSelector
            value={selectedOption as '7d' | '30d' | '90d' | 'ytd'}
            onChange={(range) => handleTimeRangeChange(range as '7d' | '30d' | '90d' | 'ytd')}
            size="md"
            disabled={trendsLoading}
          />
        </View>

        {/* Error State */}
        {error && (
          <View style={[styles.errorBanner, { backgroundColor: colors.errorBg }]}>
            <Ionicons name="alert-circle" size={20} color={colors.errorText} />
            <Text style={[styles.errorBannerText, { color: colors.errorText }]}>
              {t('admin.analytics.errorLoading' as TranslationKey)}
            </Text>
          </View>
        )}

        {/* KPI Widgets Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {t('admin.analytics.overview' as TranslationKey)}
          </Text>
          <View style={styles.widgetsGrid}>
            {widgets.slice(0, 5).map(renderWidgetCard)}
          </View>
        </View>

        {/* Sport Statistics Section */}
        {kpi?.sportStats && kpi.sportStats.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('admin.analytics.sportStatistics' as TranslationKey)}
            </Text>
            {kpi.sportStats.map(renderSportCard)}
          </View>
        )}

        {/* Onboarding Funnel Section */}
        {kpi?.onboardingFunnel && kpi.onboardingFunnel.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('admin.analytics.onboardingFunnel' as TranslationKey)}
            </Text>
            <View
              style={[
                styles.funnelCard,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
            >
              {kpi.onboardingFunnel.map(renderFunnelStep)}
            </View>
          </View>
        )}

        {/* Match Statistics Section */}
        {kpi?.matches && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('admin.analytics.matchStatistics' as TranslationKey)}
            </Text>
            <View
              style={[
                styles.matchStatsCard,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <View style={styles.matchStatRow}>
                <View style={styles.matchStatItem}>
                  <Ionicons name="calendar" size={20} color={colors.accent} />
                  <Text style={[styles.matchStatValue, { color: colors.text }]}>
                    {kpi.matches.scheduledMatches}
                  </Text>
                  <Text style={[styles.matchStatLabel, { color: colors.textMuted }]}>
                    {t('admin.analytics.scheduled' as TranslationKey)}
                  </Text>
                </View>
                <View style={styles.matchStatItem}>
                  <Ionicons name="checkmark-circle" size={20} color={colors.successText} />
                  <Text style={[styles.matchStatValue, { color: colors.text }]}>
                    {kpi.matches.completedMatches}
                  </Text>
                  <Text style={[styles.matchStatLabel, { color: colors.textMuted }]}>
                    {t('admin.analytics.completed' as TranslationKey)}
                  </Text>
                </View>
                <View style={styles.matchStatItem}>
                  <Ionicons name="close-circle" size={20} color={colors.errorText} />
                  <Text style={[styles.matchStatValue, { color: colors.text }]}>
                    {kpi.matches.cancelledMatches}
                  </Text>
                  <Text style={[styles.matchStatLabel, { color: colors.textMuted }]}>
                    {t('admin.analytics.cancelled' as TranslationKey)}
                  </Text>
                </View>
              </View>
              <View style={[styles.matchStatDivider, { backgroundColor: colors.border }]} />
              <View style={styles.matchStatRow}>
                <View style={styles.matchStatItemWide}>
                  <Text style={[styles.matchStatLabel, { color: colors.textMuted }]}>
                    {t('admin.analytics.avgParticipants' as TranslationKey)}
                  </Text>
                  <Text style={[styles.matchStatValue, { color: colors.text }]}>
                    {kpi.matches.avgParticipants.toFixed(1)}
                  </Text>
                </View>
                <View style={styles.matchStatItemWide}>
                  <Text style={[styles.matchStatLabel, { color: colors.textMuted }]}>
                    {t('admin.analytics.completionRate' as TranslationKey)}
                  </Text>
                  <Text style={[styles.matchStatValue, { color: colors.successText }]}>
                    {kpi.matches.totalMatches > 0
                      ? ((kpi.matches.completedMatches / kpi.matches.totalMatches) * 100).toFixed(1)
                      : 0}%
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {t('admin.analytics.quickActions' as TranslationKey)}
          </Text>
          
          {/* Analytics Section Navigation Cards - Full Width Layout */}
          <AnalyticsSectionCard
            title={t('admin.analytics.sections.users' as TranslationKey) || 'User Analytics'}
            description={t('admin.analytics.sections.usersFullDesc' as TranslationKey) || 'Monitor user growth, retention, and activity patterns across the platform.'}
            icon="people"
            onPress={() => {
              lightHaptic();
              navigation.navigate('AdminUserAnalytics');
            }}
            size="fullWidth"
          />
          <AnalyticsSectionCard
            title={t('admin.analytics.sections.matches' as TranslationKey) || 'Match Analytics'}
            description={t('admin.analytics.sections.matchesFullDesc' as TranslationKey) || 'Track match creation, completion rates, and scheduling trends.'}
            icon="tennisball"
            onPress={() => {
              lightHaptic();
              navigation.navigate('AdminMatchAnalytics');
            }}
            size="fullWidth"
          />
          <AnalyticsSectionCard
            title={t('admin.analytics.sections.onboarding' as TranslationKey) || 'Onboarding Analytics'}
            description={t('admin.analytics.sections.onboardingFullDesc' as TranslationKey) || 'Analyze the user journey funnel and identify drop-off points.'}
            icon="git-branch"
            onPress={() => {
              lightHaptic();
              navigation.navigate('AdminOnboardingAnalytics');
            }}
            size="fullWidth"
          />
          <AnalyticsSectionCard
            title={t('admin.analytics.sections.engagement' as TranslationKey) || 'Engagement Analytics'}
            description={t('admin.analytics.sections.engagementFullDesc' as TranslationKey) || 'Understand user behavior, session metrics, and feature adoption.'}
            icon="analytics"
            onPress={() => {
              lightHaptic();
              navigation.navigate('AdminEngagementAnalytics');
            }}
            size="fullWidth"
          />
          <AnalyticsSectionCard
            title={t('admin.analytics.sections.messaging' as TranslationKey) || 'Messaging Analytics'}
            description={t('admin.analytics.sections.messagingFullDesc' as TranslationKey) || 'Review communication patterns, message volume, and chat health.'}
            icon="chatbubbles"
            onPress={() => {
              lightHaptic();
              navigation.navigate('AdminMessagingAnalytics');
            }}
            size="fullWidth"
          />
          <AnalyticsSectionCard
            title={t('admin.analytics.sections.rating' as TranslationKey) || 'Rating & Reputation'}
            description={t('admin.analytics.sections.ratingFullDesc' as TranslationKey) || 'Explore player ratings, certification progress, and reputation trends.'}
            icon="star"
            onPress={() => {
              lightHaptic();
              navigation.navigate('AdminRatingAnalytics');
            }}
            size="fullWidth"
          />
          <AnalyticsSectionCard
            title={t('admin.analytics.sections.moderation' as TranslationKey) || 'Moderation & Safety'}
            description={t('admin.analytics.sections.moderationFullDesc' as TranslationKey) || 'Monitor reports, bans, and platform safety metrics.'}
            icon="shield-checkmark"
            onPress={() => {
              lightHaptic();
              navigation.navigate('AdminModerationAnalytics');
            }}
            size="fullWidth"
          />
          <AnalyticsSectionCard
            title={t('admin.analytics.sections.community' as TranslationKey) || 'Community Analytics'}
            description={t('admin.analytics.sections.communityFullDesc' as TranslationKey) || 'Analyze network growth, group activity, and community engagement.'}
            icon="people-circle"
            onPress={() => {
              lightHaptic();
              navigation.navigate('AdminCommunityAnalytics');
            }}
            size="fullWidth"
          />
          <AnalyticsSectionCard
            title={t('admin.analytics.sections.sports' as TranslationKey) || 'Sport Analytics'}
            description={t('admin.analytics.sections.sportsFullDesc' as TranslationKey) || 'Compare sport popularity, facility usage, and growth trends.'}
            icon="tennisball"
            onPress={() => {
              lightHaptic();
              navigation.navigate('AdminSportAnalytics');
            }}
            size="fullWidth"
          />
          <AnalyticsSectionCard
            title={t('admin.analytics.sections.settings' as TranslationKey) || 'Admin Panel'}
            description={t('admin.analytics.sections.settingsFullDesc' as TranslationKey) || 'Access system settings, user management, and admin configuration.'}
            icon="settings"
            onPress={() => {
              lightHaptic();
              navigation.navigate('AdminPanel');
            }}
            size="fullWidth"
          />
        </View>

        {/* Bottom spacing */}
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
    fontSize: 20,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  refreshButton: {
    padding: spacingPixels[2],
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: spacingPixels[4],
  },
  timeRangeSection: {
    marginBottom: spacingPixels[5],
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacingPixels[6],
  },
  errorText: {
    fontSize: 16,
    marginTop: spacingPixels[4],
    textAlign: 'center',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.md,
    marginBottom: spacingPixels[4],
  },
  errorBannerText: {
    marginLeft: spacingPixels[3],
    fontSize: 14,
  },
  section: {
    marginBottom: spacingPixels[5],
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: spacingPixels[4],
  },
  widgetsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -spacingPixels[2],
  },
  widgetCard: {
    width: '48%',
    marginHorizontal: '1%',
    marginBottom: spacingPixels[3],
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  widgetTitle: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: spacingPixels[2],
  },
  widgetValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  widgetValue: {
    fontSize: 28,
    fontWeight: '700',
    flex: 1,
  },
  sparklineContainer: {
    marginLeft: spacingPixels[2],
  },
  widgetChange: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacingPixels[2],
  },
  widgetChangeText: {
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 4,
  },
  sectionCardsGrid: {
    flexDirection: 'row',
    gap: spacingPixels[3],
    marginBottom: spacingPixels[3],
  },
  sportCard: {
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginBottom: spacingPixels[3],
  },
  sportHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[4],
  },
  sportName: {
    fontSize: 18,
    fontWeight: '600',
    marginLeft: spacingPixels[3],
  },
  sportStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  sportStatItem: {
    alignItems: 'center',
  },
  sportStatValue: {
    fontSize: 24,
    fontWeight: '700',
  },
  sportStatLabel: {
    fontSize: 12,
    marginTop: 4,
  },
  funnelCard: {
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  funnelStep: {
    marginBottom: spacingPixels[4],
  },
  funnelStepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[2],
  },
  funnelStepNumber: {
    fontSize: 12,
    fontWeight: '600',
    width: 20,
  },
  funnelStepName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  funnelStepRate: {
    fontSize: 14,
    fontWeight: '600',
  },
  funnelBar: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  funnelBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  funnelStepMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  funnelMetaText: {
    fontSize: 11,
  },
  matchStatsCard: {
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  matchStatRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacingPixels[3],
  },
  matchStatItem: {
    alignItems: 'center',
    flex: 1,
  },
  matchStatItemWide: {
    alignItems: 'center',
    flex: 1,
  },
  matchStatValue: {
    fontSize: 20,
    fontWeight: '700',
    marginVertical: 4,
  },
  matchStatLabel: {
    fontSize: 12,
    textAlign: 'center',
  },
  matchStatDivider: {
    height: 1,
    marginVertical: spacingPixels[3],
  },
  quickActionsRow: {
    flexDirection: 'row',
    gap: spacingPixels[3],
  },
  quickActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    gap: spacingPixels[3],
  },
  quickActionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  bottomSpacer: {
    height: spacingPixels[6],
  },
});

export default AdminDashboardScreen;
