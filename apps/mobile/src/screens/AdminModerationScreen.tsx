/**
 * AdminModerationScreen
 *
 * Admin moderation screen for managing player reports and bans.
 * Features tabs for Reports and Bans management with filtering and actions.
 *
 * Access Requirements:
 * - User must have admin role with 'support' or higher level
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  TextInput,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text, useToast } from '@rallia/shared-components';
import {
  useTheme,
  useReports,
  useBans,
  useAdminStatus,
  hasMinimumRole,
  type PlayerReport,
  type PlayerBan,
  type BanType,
} from '@rallia/shared-hooks';
import { moderationService, type CreateBanParams } from '@rallia/shared-services';
import { useTranslation, type TranslationKey } from '../hooks';
import type { RootStackParamList } from '../navigation/types';
import {
  ModerationFiltersBar,
  type ModerationFilters,
  DEFAULT_MODERATION_FILTERS,
} from '../components/ModerationFiltersBar';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  fontSizePixels,
  fontWeightNumeric,
  primary,
  neutral,
  status,
} from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';

// Spacing aliases for this screen (mapping semantic names to spacingPixels keys)
const spacing = {
  xs: spacingPixels[1], // 4px
  sm: spacingPixels[2], // 8px
  md: spacingPixels[4], // 16px
  lg: spacingPixels[6], // 24px
};

// Font size alias for 'md' which doesn't exist in fontSizePixels
const fontSize = {
  md: fontSizePixels.base, // 16px
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

type TabType = 'reports' | 'bans';

const BASE_WHITE = '#ffffff';

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

interface TabButtonProps {
  label: string;
  active: boolean;
  count?: number;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
  isDark: boolean;
}

const TabButton: React.FC<TabButtonProps> = ({
  label,
  active,
  count,
  icon,
  onPress,
  colors,
  isDark,
}) => (
  <TouchableOpacity
    style={[
      styles.tab,
      active && [
        styles.activeTab,
        { backgroundColor: isDark ? colors.cardBackground : BASE_WHITE },
      ],
    ]}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <Ionicons
      name={icon}
      size={18}
      color={active ? colors.accent : colors.textMuted}
      style={styles.tabIcon}
    />
    <Text
      size="sm"
      weight={active ? 'semibold' : 'medium'}
      style={[styles.tabLabel, { color: active ? colors.accent : colors.textMuted }]}
    >
      {label}
    </Text>
    {count !== undefined && count > 0 && (
      <View style={[styles.tabBadge, { backgroundColor: active ? colors.accent : neutral[400] }]}>
        <Text style={styles.tabBadgeText}>{count > 99 ? '99+' : count}</Text>
      </View>
    )}
  </TouchableOpacity>
);

interface ReportCardProps {
  report: PlayerReport;
  colors: ReturnType<typeof useColors>;
  onReview: (report: PlayerReport) => void;
  onDismiss: (report: PlayerReport) => void;
  onBan: (report: PlayerReport) => void;
  t: (key: TranslationKey) => string;
}

const ReportCard: React.FC<ReportCardProps> = ({
  report,
  colors,
  onReview,
  onDismiss,
  onBan,
  t,
}) => {
  const typeIcon = moderationService.getReportTypeIcon(report.report_type);
  const priorityColor = moderationService.getPriorityColor(report.priority);
  const statusColor = moderationService.getReportStatusColor(report.status);
  const isPending = report.status === 'pending' || report.status === 'under_review';

  return (
    <View
      style={[styles.card, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}
    >
      {/* Header */}
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View style={[styles.typeIcon, { backgroundColor: `${priorityColor}20` }]}>
            <Ionicons
              name={typeIcon as keyof typeof Ionicons.glyphMap}
              size={18}
              color={priorityColor}
            />
          </View>
          <View style={styles.cardTitles}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              {moderationService.getReportTypeLabel(report.report_type)}
            </Text>
            <Text style={[styles.cardSubtitle, { color: colors.textMuted }]}>
              {new Date(report.created_at).toLocaleDateString()}
            </Text>
          </View>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: `${statusColor}20` }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>
            {report.status.replace('_', ' ')}
          </Text>
        </View>
      </View>

      {/* Content */}
      <View style={styles.cardContent}>
        <Text style={[styles.cardDescription, { color: colors.textSecondary }]} numberOfLines={3}>
          {report.description || t('admin.moderation.noDescription')}
        </Text>

        {/* Reporter/Reported */}
        <View style={styles.cardMeta}>
          <View style={styles.metaRow}>
            <Text style={[styles.metaLabel, { color: colors.textMuted }]}>
              {t('admin.moderation.reportedPlayer')}:
            </Text>
            <Text style={[styles.metaValue, { color: colors.text }]}>
              {report.reported_player_name}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={[styles.metaLabel, { color: colors.textMuted }]}>
              {t('admin.moderation.reporter')}:
            </Text>
            <Text style={[styles.metaValue, { color: colors.text }]}>{report.reporter_name}</Text>
          </View>
        </View>

        {/* Evidence Images */}
        {report.evidence_urls && report.evidence_urls.length > 0 && (
          <View style={styles.evidenceSection}>
            <View style={styles.evidenceLabelRow}>
              <Ionicons name="image-outline" size={14} color={colors.textMuted} />
              <Text style={[styles.evidenceLabel, { color: colors.textMuted }]}>
                {t('admin.moderation.evidence' as TranslationKey)} ({report.evidence_urls.length})
              </Text>
            </View>
            <View style={styles.evidenceGrid}>
              {report.evidence_urls.map((url, index) => (
                <TouchableOpacity
                  key={index}
                  style={[styles.evidenceImageContainer, { borderColor: colors.border }]}
                  onPress={() => {
                    // TODO: Open full-screen image viewer
                    Alert.alert(t('admin.moderation.evidenceImage' as TranslationKey), url, [
                      { text: 'OK' },
                    ]);
                  }}
                  activeOpacity={0.8}
                >
                  <Image source={{ uri: url }} style={styles.evidenceImage} resizeMode="cover" />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </View>

      {/* Actions */}
      {isPending && (
        <View style={styles.cardActions}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.accentLight }]}
            onPress={() => onReview(report)}
            activeOpacity={0.7}
          >
            <Ionicons name="eye-outline" size={16} color={colors.accent} />
            <Text style={[styles.actionText, { color: colors.accent }]}>
              {t('admin.moderation.review')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.warningBg }]}
            onPress={() => onBan(report)}
            activeOpacity={0.7}
          >
            <Ionicons name="ban-outline" size={16} color={colors.warningText} />
            <Text style={[styles.actionText, { color: colors.warningText }]}>
              {t('admin.moderation.ban')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.errorBg }]}
            onPress={() => onDismiss(report)}
            activeOpacity={0.7}
          >
            <Ionicons name="close-outline" size={16} color={colors.errorText} />
            <Text style={[styles.actionText, { color: colors.errorText }]}>
              {t('admin.moderation.dismiss')}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

interface BanCardProps {
  ban: PlayerBan;
  colors: ReturnType<typeof useColors>;
  onRevoke: (ban: PlayerBan) => void;
  t: (key: TranslationKey) => string;
}

const BanCard: React.FC<BanCardProps> = ({ ban, colors, onRevoke, t }) => {
  const isActive = ban.is_active && (!ban.end_date || new Date(ban.end_date) > new Date());
  const banTypeIcon = ban.ban_type === 'permanent' ? 'lock-closed' : 'time-outline';

  return (
    <View
      style={[styles.card, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}
    >
      {/* Header */}
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View
            style={[
              styles.typeIcon,
              { backgroundColor: isActive ? colors.errorBg : colors.successBg },
            ]}
          >
            <Ionicons
              name={banTypeIcon as keyof typeof Ionicons.glyphMap}
              size={18}
              color={isActive ? colors.errorText : colors.successText}
            />
          </View>
          <View style={styles.cardTitles}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>{ban.player_name}</Text>
            <Text style={[styles.cardSubtitle, { color: colors.textMuted }]}>
              {t(`admin.moderation.banType.${ban.ban_type}`)}
            </Text>
          </View>
        </View>
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: isActive ? colors.errorBg : colors.successBg },
          ]}
        >
          <Text
            style={[styles.statusText, { color: isActive ? colors.errorText : colors.successText }]}
          >
            {isActive ? t('admin.moderation.active') : t('admin.moderation.revoked')}
          </Text>
        </View>
      </View>

      {/* Content */}
      <View style={styles.cardContent}>
        <Text style={[styles.cardDescription, { color: colors.textSecondary }]} numberOfLines={2}>
          {ban.reason || t('admin.moderation.noReason')}
        </Text>

        <View style={styles.cardMeta}>
          <View style={styles.metaRow}>
            <Text style={[styles.metaLabel, { color: colors.textMuted }]}>
              {t('admin.moderation.bannedOn')}:
            </Text>
            <Text style={[styles.metaValue, { color: colors.text }]}>
              {new Date(ban.created_at).toLocaleDateString()}
            </Text>
          </View>
          {ban.end_date && (
            <View style={styles.metaRow}>
              <Text style={[styles.metaLabel, { color: colors.textMuted }]}>
                {t('admin.moderation.expiresOn')}:
              </Text>
              <Text style={[styles.metaValue, { color: colors.text }]}>
                {new Date(ban.end_date).toLocaleDateString()}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Actions */}
      {isActive && (
        <View style={styles.cardActions}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.successBg }]}
            onPress={() => onRevoke(ban)}
            activeOpacity={0.7}
          >
            <Ionicons name="checkmark-circle-outline" size={16} color={colors.successText} />
            <Text style={[styles.actionText, { color: colors.successText }]}>
              {t('admin.moderation.revokeBan')}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

// =============================================================================
// COLORS HOOK
// =============================================================================

function useColors() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const themeColors = isDark ? darkTheme : lightTheme;

  return useMemo(
    () => ({
      background: themeColors.background,
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textSecondary: isDark ? primary[300] : neutral[600],
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      icon: themeColors.foreground,
      iconMuted: themeColors.mutedForeground,
      accent: isDark ? primary[500] : primary[600],
      accentLight: isDark ? `${primary[500]}20` : `${primary[600]}10`,
      successBg: isDark ? `${status.success.DEFAULT}20` : `${status.success.light}15`,
      successText: status.success.DEFAULT,
      warningBg: isDark ? `${status.warning.DEFAULT}20` : `${status.warning.light}15`,
      warningText: status.warning.DEFAULT,
      errorBg: isDark ? `${status.error.DEFAULT}20` : `${status.error.light}15`,
      errorText: status.error.DEFAULT,
      inputBackground: isDark ? `${neutral[800]}` : `${neutral[100]}`,
    }),
    [themeColors, isDark]
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const AdminModerationScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const colors = useColors();
  const toast = useToast();
  const { isAdmin, role } = useAdminStatus();

  // State
  const [activeTab, setActiveTab] = useState<TabType>('reports');
  const [showBanModal, setShowBanModal] = useState(false);
  const [selectedReport, setSelectedReport] = useState<PlayerReport | null>(null);
  const [banReason, setBanReason] = useState('');
  const [banType, setBanType] = useState<BanType>('temporary');
  const [banDuration, setBanDuration] = useState('7'); // days

  // Filter state
  const [filters, setFilters] = useState<ModerationFilters>(DEFAULT_MODERATION_FILTERS);

  // Reports hook
  const {
    reports,
    counts,
    isLoading: reportsLoading,
    isLoadingMore: reportsLoadingMore,
    refetch: refetchReports,
    loadMore: loadMoreReports,
    dismissReport,
    reviewReport,
    setFilters: setReportFilters,
  } = useReports({ pageSize: 20 });

  // Bans hook
  const {
    bans,
    activeBansCount,
    isLoading: bansLoading,
    isLoadingMore: bansLoadingMore,
    refetch: refetchBans,
    loadMore: loadMoreBans,
    createBan,
    revokeBan,
  } = useBans({ pageSize: 20, filters: { isActive: true } });

  // Access check
  const hasAccess = isAdmin && hasMinimumRole(role, 'support');

  // Handle filter change from ModerationFiltersBar
  const handleFiltersChange = useCallback((newFilters: ModerationFilters) => {
    setFilters(newFilters);
  }, []);

  // Clear all filters
  const handleClearFilters = useCallback(() => {
    setFilters(DEFAULT_MODERATION_FILTERS);
    setReportFilters({});
  }, [setReportFilters]);

  // Auto-apply server-side filters when filter state changes
  useEffect(() => {
    setReportFilters({
      status: filters.status || undefined,
      reportType: filters.reportType || undefined,
      priority: filters.priority || undefined,
    });
  }, [filters.status, filters.reportType, filters.priority, setReportFilters]);

  // Filter reports by search query (client-side)
  const filteredReports = useMemo(() => {
    if (!filters.searchQuery.trim()) return reports;
    const query = filters.searchQuery.toLowerCase().trim();
    return reports.filter(
      report =>
        report.reporter_name?.toLowerCase().includes(query) ||
        report.reported_player_name?.toLowerCase().includes(query)
    );
  }, [reports, filters.searchQuery]);

  // Tab switch
  const handleTabChange = useCallback((tab: TabType) => {
    lightHaptic();
    setActiveTab(tab);
  }, []);

  // Handle dismiss report
  const handleDismissReport = useCallback(
    async (report: PlayerReport) => {
      Alert.alert(t('admin.moderation.dismissTitle'), t('admin.moderation.dismissConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('admin.moderation.dismiss'),
          style: 'destructive',
          onPress: async () => {
            const success = await dismissReport(report.id);
            if (success) {
              toast.success(t('admin.moderation.dismissSuccess'));
            } else {
              toast.error(t('admin.moderation.dismissError'));
            }
          },
        },
      ]);
    },
    [dismissReport, t, toast]
  );

  // Handle review report
  const handleReviewReport = useCallback(
    async (report: PlayerReport) => {
      // Mark as under review
      const success = await reviewReport(report.id, 'under_review');
      if (success) {
        toast.info(t('admin.moderation.reviewStarted'));
      }
    },
    [reviewReport, t, toast]
  );

  // Open ban modal for report
  const handleOpenBanModal = useCallback((report: PlayerReport) => {
    setSelectedReport(report);
    setBanReason(report.description || '');
    setShowBanModal(true);
  }, []);

  // Create ban from report
  const handleCreateBan = useCallback(async () => {
    if (!selectedReport) return;

    const params: CreateBanParams = {
      playerId: selectedReport.reported_player_id,
      reason: banReason,
      banType,
      endDate:
        banType === 'temporary'
          ? new Date(Date.now() + parseInt(banDuration) * 24 * 60 * 60 * 1000).toISOString()
          : undefined,
    };

    const ban = await createBan(params);
    if (ban) {
      // Also mark report as action taken
      await reviewReport(selectedReport.id, 'action_taken', 'Player banned');
      toast.success(t('admin.moderation.banSuccess'));
      setShowBanModal(false);
      setSelectedReport(null);
      setBanReason('');
    } else {
      toast.error(t('admin.moderation.banError'));
    }
  }, [selectedReport, banReason, banType, banDuration, createBan, reviewReport, t, toast]);

  // Handle revoke ban
  const handleRevokeBan = useCallback(
    async (ban: PlayerBan) => {
      Alert.alert(t('admin.moderation.revokeTitle'), t('admin.moderation.revokeConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('admin.moderation.revokeBan'),
          onPress: async () => {
            const success = await revokeBan(ban.id, 'Admin revoked');
            if (success) {
              toast.success(t('admin.moderation.revokeSuccess'));
            } else {
              toast.error(t('admin.moderation.revokeError'));
            }
          },
        },
      ]);
    },
    [revokeBan, t, toast]
  );

  // Render report item
  const renderReportItem = useCallback(
    ({ item }: { item: PlayerReport }) => (
      <ReportCard
        report={item}
        colors={colors}
        onReview={handleReviewReport}
        onDismiss={handleDismissReport}
        onBan={handleOpenBanModal}
        t={t}
      />
    ),
    [colors, handleReviewReport, handleDismissReport, handleOpenBanModal, t]
  );

  // Render ban item
  const renderBanItem = useCallback(
    ({ item }: { item: PlayerBan }) => (
      <BanCard ban={item} colors={colors} onRevoke={handleRevokeBan} t={t} />
    ),
    [colors, handleRevokeBan, t]
  );

  // Render empty state
  const renderEmpty = useCallback(
    (loading: boolean, message: string) => {
      if (loading) return null;
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="shield-checkmark-outline" size={64} color={colors.textMuted} />
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>{message}</Text>
        </View>
      );
    },
    [colors]
  );

  // Render footer (loading indicator)
  const renderFooter = useCallback(
    (loading: boolean) => {
      if (!loading) return null;
      return (
        <View style={styles.footer}>
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      );
    },
    [colors]
  );

  // Access denied
  if (!hasAccess) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.accessDenied}>
          <Ionicons name="lock-closed-outline" size={64} color={colors.textMuted} />
          <Text style={[styles.accessDeniedText, { color: colors.textMuted }]}>
            {t('admin.accessDenied' as TranslationKey)}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.icon} />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {t('admin.moderation.title')}
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.textMuted }]}>
            {t('admin.sections.moderation.description')}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => {
            refetchReports();
            refetchBans();
          }}
          style={styles.refreshButton}
          disabled={reportsLoading || bansLoading}
        >
          {reportsLoading || bansLoading ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Ionicons name="refresh" size={24} color={colors.accent} />
          )}
        </TouchableOpacity>
      </View>

      {/* Stats Summary - Modern Quick Stats */}
      <View style={styles.quickStatsRow}>
        <View style={[styles.quickStat, { backgroundColor: `${status.warning.light}30` }]}>
          <Ionicons name="alert-circle" size={24} color={status.warning.DEFAULT} />
          <Text style={[styles.quickStatValue, { color: status.warning.DEFAULT }]}>
            {counts.pending}
          </Text>
          <Text style={[styles.quickStatLabel, { color: colors.textMuted }]}>
            {t('admin.moderation.pending')}
          </Text>
        </View>

        <View style={[styles.quickStat, { backgroundColor: `${status.success.light}30` }]}>
          <Ionicons name="time" size={24} color={status.success.DEFAULT} />
          <Text style={[styles.quickStatValue, { color: status.success.DEFAULT }]}>
            {counts.under_review}
          </Text>
          <Text style={[styles.quickStatLabel, { color: colors.textMuted }]}>
            {t('admin.moderation.underReview')}
          </Text>
        </View>

        <View style={[styles.quickStat, { backgroundColor: `${status.error.light}30` }]}>
          <Ionicons name="ban" size={24} color={status.error.DEFAULT} />
          <Text style={[styles.quickStatValue, { color: status.error.DEFAULT }]}>
            {activeBansCount}
          </Text>
          <Text style={[styles.quickStatLabel, { color: colors.textMuted }]}>
            {t('admin.moderation.activeBans')}
          </Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={[styles.tabsContainer, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}>
        <TabButton
          label={t('admin.moderation.reports')}
          active={activeTab === 'reports'}
          count={counts.pending}
          icon="flag-outline"
          onPress={() => handleTabChange('reports')}
          colors={colors}
          isDark={isDark}
        />
        <TabButton
          label={t('admin.moderation.bans')}
          active={activeTab === 'bans'}
          count={activeBansCount}
          icon="ban-outline"
          onPress={() => handleTabChange('bans')}
          colors={colors}
          isDark={isDark}
        />
      </View>

      {/* Filters Section (only for reports tab) */}
      {activeTab === 'reports' && (
        <ModerationFiltersBar
          filters={filters}
          onFiltersChange={handleFiltersChange}
          onReset={handleClearFilters}
        />
      )}

      {/* Content */}
      {activeTab === 'reports' ? (
        <FlatList
          data={filteredReports}
          renderItem={renderReportItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={reportsLoading}
              onRefresh={refetchReports}
              tintColor={colors.accent}
            />
          }
          onEndReached={loadMoreReports}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={() => renderEmpty(reportsLoading, t('admin.moderation.noReports'))}
          ListFooterComponent={() => renderFooter(reportsLoadingMore)}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <FlatList
          data={bans}
          renderItem={renderBanItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={bansLoading}
              onRefresh={refetchBans}
              tintColor={colors.accent}
            />
          }
          onEndReached={loadMoreBans}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={() => renderEmpty(bansLoading, t('admin.moderation.noBans'))}
          ListFooterComponent={() => renderFooter(bansLoadingMore)}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Ban Modal */}
      <Modal visible={showBanModal} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setShowBanModal(false)}>
          <Pressable
            style={[styles.modalContent, { backgroundColor: colors.cardBackground }]}
            onPress={e => e.stopPropagation()}
          >
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {t('admin.moderation.createBan')}
            </Text>

            {selectedReport && (
              <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]}>
                {t('admin.moderation.banningPlayer')}: {selectedReport.reported_player_name}
              </Text>
            )}

            {/* Ban Type */}
            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>
                {t('admin.moderation.banTypeLabel')}
              </Text>
              <View style={styles.banTypeRow}>
                <TouchableOpacity
                  style={[
                    styles.banTypeButton,
                    {
                      backgroundColor:
                        banType === 'temporary' ? colors.accentLight : colors.inputBackground,
                      borderColor: banType === 'temporary' ? colors.accent : colors.border,
                    },
                  ]}
                  onPress={() => setBanType('temporary')}
                >
                  <Text
                    style={[
                      styles.banTypeText,
                      { color: banType === 'temporary' ? colors.accent : colors.textSecondary },
                    ]}
                  >
                    {t('admin.moderation.banType.temporary')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.banTypeButton,
                    {
                      backgroundColor:
                        banType === 'permanent' ? colors.errorBg : colors.inputBackground,
                      borderColor: banType === 'permanent' ? colors.errorText : colors.border,
                    },
                  ]}
                  onPress={() => setBanType('permanent')}
                >
                  <Text
                    style={[
                      styles.banTypeText,
                      { color: banType === 'permanent' ? colors.errorText : colors.textSecondary },
                    ]}
                  >
                    {t('admin.moderation.banType.permanent')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Duration (for temporary) */}
            {banType === 'temporary' && (
              <View style={styles.formGroup}>
                <Text style={[styles.formLabel, { color: colors.text }]}>
                  {t('admin.moderation.durationDays')}
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.inputBackground,
                      color: colors.text,
                      borderColor: colors.border,
                    },
                  ]}
                  value={banDuration}
                  onChangeText={setBanDuration}
                  keyboardType="number-pad"
                  placeholder="7"
                  placeholderTextColor={colors.textMuted}
                />
              </View>
            )}

            {/* Reason */}
            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>
                {t('admin.moderation.reasonLabel')}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  styles.textArea,
                  {
                    backgroundColor: colors.inputBackground,
                    color: colors.text,
                    borderColor: colors.border,
                  },
                ]}
                value={banReason}
                onChangeText={setBanReason}
                multiline
                numberOfLines={3}
                placeholder={t('admin.moderation.reasonPlaceholder')}
                placeholderTextColor={colors.textMuted}
              />
            </View>

            {/* Actions */}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.inputBackground }]}
                onPress={() => setShowBanModal(false)}
              >
                <Text style={[styles.modalButtonText, { color: colors.textSecondary }]}>
                  {t('common.cancel')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.errorBg }]}
                onPress={handleCreateBan}
              >
                <Text style={[styles.modalButtonText, { color: colors.errorText }]}>
                  {t('admin.moderation.confirmBan')}
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: spacing.xs,
    marginRight: spacing.sm,
  },
  headerTitleContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: fontSizePixels.xl,
    fontWeight: fontWeightNumeric.semibold,
  },
  headerSubtitle: {
    fontSize: fontSizePixels.xs,
    marginTop: 2,
  },
  refreshButton: {
    padding: spacing.xs,
  },
  // Modern Quick Stats styles (matching Moderation & Safety screen)
  quickStatsRow: {
    flexDirection: 'row',
    gap: spacingPixels[2],
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
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
    marginTop: 2,
  },
  tabsContainer: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
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
  tabIcon: {
    marginRight: 6,
  },
  tabLabel: {
    fontSize: fontSizePixels.sm,
  },
  tabBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  tabBadgeText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '600',
    color: BASE_WHITE,
  },
  listContent: {
    padding: spacing.md,
    paddingBottom: spacingPixels[12],
  },
  card: {
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    paddingBottom: spacing.sm,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  typeIcon: {
    width: 36,
    height: 36,
    borderRadius: radiusPixels.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  cardTitles: {
    flex: 1,
  },
  cardTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeightNumeric.semibold,
  },
  cardSubtitle: {
    fontSize: fontSizePixels.xs,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radiusPixels.full,
  },
  statusText: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.medium,
    textTransform: 'capitalize',
  },
  cardContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  cardDescription: {
    fontSize: fontSizePixels.sm,
    lineHeight: 20,
  },
  cardMeta: {
    marginTop: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  metaLabel: {
    fontSize: fontSizePixels.xs,
    width: 100,
  },
  metaValue: {
    fontSize: fontSizePixels.xs,
    flex: 1,
  },
  evidenceSection: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: neutral[200],
  },
  evidenceLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: spacing.sm,
  },
  evidenceLabel: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.medium,
  },
  evidenceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  evidenceImageContainer: {
    width: 64,
    height: 64,
    borderRadius: radiusPixels.md,
    overflow: 'hidden',
    borderWidth: 1,
  },
  evidenceImage: {
    width: '100%',
    height: '100%',
  },
  cardActions: {
    flexDirection: 'row',
    padding: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radiusPixels.md,
    gap: 4,
  },
  actionText: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.medium,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[20],
  },
  emptyText: {
    fontSize: fontSize.md,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  footer: {
    padding: spacing.md,
    alignItems: 'center',
  },
  accessDenied: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accessDeniedText: {
    fontSize: fontSize.md,
    marginTop: spacing.md,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    borderRadius: radiusPixels.xl,
    padding: spacing.lg,
  },
  modalTitle: {
    fontSize: fontSizePixels.xl,
    fontWeight: fontWeightNumeric.bold,
    marginBottom: spacing.xs,
  },
  modalSubtitle: {
    fontSize: fontSizePixels.sm,
    marginBottom: spacing.lg,
  },
  formGroup: {
    marginBottom: spacing.md,
  },
  formLabel: {
    fontSize: fontSizePixels.sm,
    fontWeight: fontWeightNumeric.medium,
    marginBottom: spacing.xs,
  },
  banTypeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  banTypeButton: {
    flex: 1,
    padding: spacing.sm,
    borderRadius: radiusPixels.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  banTypeText: {
    fontSize: fontSizePixels.sm,
    fontWeight: fontWeightNumeric.medium,
  },
  input: {
    borderWidth: 1,
    borderRadius: radiusPixels.md,
    padding: spacing.sm,
    fontSize: fontSize.md,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  modalButton: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radiusPixels.md,
    alignItems: 'center',
  },
  modalButtonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeightNumeric.semibold,
  },
});

export default AdminModerationScreen;
