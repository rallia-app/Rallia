/**
 * AdminModerationScreen
 *
 * Admin moderation screen for managing player reports and bans.
 * Features tabs for Reports and Bans management with filtering and actions.
 *
 * Access Requirements:
 * - User must have admin role with 'support' or higher level
 */

import React, { useState, useCallback, useMemo } from 'react';
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
  type ReportStatus,
  type ReportType,
  type BanType,
} from '@rallia/shared-hooks';
import { moderationService, type CreateBanParams } from '@rallia/shared-services';
import { useTranslation, type TranslationKey } from '../hooks';
import type { RootStackParamList } from '../navigation/types';
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
  xs: spacingPixels[1],   // 4px
  sm: spacingPixels[2],   // 8px
  md: spacingPixels[4],   // 16px
  lg: spacingPixels[6],   // 24px
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
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}

const TabButton: React.FC<TabButtonProps> = ({ label, active, count, onPress, colors }) => (
  <TouchableOpacity
    style={[
      styles.tabButton,
      {
        borderBottomColor: active ? colors.accent : 'transparent',
        borderBottomWidth: active ? 2 : 0,
      },
    ]}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <Text style={[styles.tabLabel, { color: active ? colors.accent : colors.textSecondary }]}>
      {label}
    </Text>
    {count !== undefined && count > 0 && (
      <View style={[styles.tabBadge, { backgroundColor: colors.errorBg }]}>
        <Text style={[styles.tabBadgeText, { color: colors.errorText }]}>
          {count > 99 ? '99+' : count}
        </Text>
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
            <Text style={[styles.metaValue, { color: colors.text }]}>
              {report.reporter_name}
            </Text>
          </View>
        </View>
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
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              {ban.player_name}
            </Text>
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

  // Reports hook
  const {
    reports,
    counts,
    isLoading: reportsLoading,
    isLoadingMore: reportsLoadingMore,
    hasMore: reportsHasMore,
    refetch: refetchReports,
    loadMore: loadMoreReports,
    dismissReport,
    reviewReport,
  } = useReports({ pageSize: 20 });

  // Bans hook
  const {
    bans,
    activeBansCount,
    isLoading: bansLoading,
    isLoadingMore: bansLoadingMore,
    hasMore: bansHasMore,
    refetch: refetchBans,
    loadMore: loadMoreBans,
    createBan,
    revokeBan,
  } = useBans({ pageSize: 20, filters: { isActive: false } });

  // Access check
  const hasAccess = isAdmin && hasMinimumRole(role, 'support');

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
      edges={['top']}
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

      {/* Stats Summary */}
      <View style={[styles.statsContainer, { backgroundColor: colors.cardBackground }]}>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.errorText }]}>{counts.pending}</Text>
          <Text style={[styles.statLabel, { color: colors.textMuted }]}>
            {t('admin.moderation.pending')}
          </Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.warningText }]}>
            {counts.under_review}
          </Text>
          <Text style={[styles.statLabel, { color: colors.textMuted }]}>
            {t('admin.moderation.underReview')}
          </Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.accent }]}>{activeBansCount}</Text>
          <Text style={[styles.statLabel, { color: colors.textMuted }]}>
            {t('admin.moderation.activeBans')}
          </Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={[styles.tabsContainer, { borderBottomColor: colors.border }]}>
        <TabButton
          label={t('admin.moderation.reports')}
          active={activeTab === 'reports'}
          count={counts.pending}
          onPress={() => handleTabChange('reports')}
          colors={colors}
        />
        <TabButton
          label={t('admin.moderation.bans')}
          active={activeTab === 'bans'}
          count={activeBansCount}
          onPress={() => handleTabChange('bans')}
          colors={colors}
        />
      </View>

      {/* Content */}
      {activeTab === 'reports' ? (
        <FlatList
          data={reports}
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
  statsContainer: {
    flexDirection: 'row',
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    borderRadius: radiusPixels.lg,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: fontSizePixels['2xl'],
    fontWeight: fontWeightNumeric.bold,
  },
  statLabel: {
    fontSize: fontSizePixels.xs,
    marginTop: spacing.xs,
  },
  statDivider: {
    width: 1,
    marginVertical: spacing.xs,
  },
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    marginTop: spacing.md,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  tabLabel: {
    fontSize: fontSize.md,
    fontWeight: fontWeightNumeric.medium,
  },
  tabBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radiusPixels.full,
    minWidth: 20,
    alignItems: 'center',
  },
  tabBadgeText: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.semibold,
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
