/**
 * AdminActivityLogScreen
 *
 * Displays the audit trail of admin actions with filtering capabilities.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  Modal,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@rallia/shared-hooks';
import {
  spacingPixels,
  radiusPixels,
  lightTheme,
  darkTheme,
  primary,
  neutral,
  status,
} from '@rallia/design-system';
import { useAuditLog, useAuditStats } from '@rallia/shared-hooks';
import { useToast } from '@rallia/shared-components';
import {
  auditService,
  Logger,
  type AuditLogEntry,
  type AuditActionType,
  type AuditEntityType,
  type AuditSeverity,
} from '@rallia/shared-services';
import { exportService } from '../services/exportService';

// =============================================================================
// TYPES
// =============================================================================

interface FilterOption {
  value: string | null;
  label: string;
}

// =============================================================================
// FILTER OPTIONS
// =============================================================================

const ACTION_TYPE_OPTIONS: FilterOption[] = [
  { value: null, label: 'All Actions' },
  { value: 'view', label: 'View' },
  { value: 'create', label: 'Create' },
  { value: 'update', label: 'Update' },
  { value: 'delete', label: 'Delete' },
  { value: 'ban', label: 'Ban' },
  { value: 'unban', label: 'Unban' },
  { value: 'export', label: 'Export' },
  { value: 'login', label: 'Login' },
  { value: 'search', label: 'Search' },
  { value: 'config_change', label: 'Config Change' },
];

const ENTITY_TYPE_OPTIONS: FilterOption[] = [
  { value: null, label: 'All Entities' },
  { value: 'player', label: 'Players' },
  { value: 'match', label: 'Matches' },
  { value: 'admin', label: 'Admins' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'settings', label: 'Settings' },
  { value: 'system', label: 'System' },
];

const SEVERITY_OPTIONS: FilterOption[] = [
  { value: null, label: 'All Severities' },
  { value: 'info', label: 'Info' },
  { value: 'warning', label: 'Warning' },
  { value: 'critical', label: 'Critical' },
];

// =============================================================================
// COMPONENT
// =============================================================================

const AdminActivityLogScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const toast = useToast();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
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
      success: status.success.DEFAULT,
      warning: status.warning.DEFAULT,
      error: status.error.DEFAULT,
    }),
    [isDark, themeColors]
  );

  // Filter state
  const [actionFilter, setActionFilter] = useState<AuditActionType | null>(null);
  const [entityFilter, setEntityFilter] = useState<AuditEntityType | null>(null);
  const [severityFilter, setSeverityFilter] = useState<AuditSeverity | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [activeFilterModal, setActiveFilterModal] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Data hooks
  const { logs, isLoading, hasMore, refetch, loadMore, setFilters } = useAuditLog({
    autoFetch: true,
    filters: {
      actionType: actionFilter || undefined,
      entityType: entityFilter || undefined,
      severity: severityFilter || undefined,
      limit: 30,
    },
  });

  const { stats, isLoading: statsLoading } = useAuditStats(7);

  // Clear filters
  const clearFilters = useCallback(() => {
    setActionFilter(null);
    setEntityFilter(null);
    setSeverityFilter(null);
    setFilters({ limit: 30 });
    setShowFilters(false);
  }, [setFilters]);

  // Check if any filters are active
  const hasActiveFilters = actionFilter || entityFilter || severityFilter;

  // Handle export
  const handleExport = useCallback(
    async (format: 'csv' | 'pdf') => {
      if (exporting || logs.length === 0) return;

      setExporting(true);
      setShowExportMenu(false);

      try {
        // Map logs to export format
        const exportData = logs.map(log => ({
          id: log.id,
          admin_id: log.admin_id,
          admin_name: log.admin_name || 'Unknown',
          action_type: log.action_type,
          entity_type: log.entity_type,
          entity_id: log.entity_id,
          description: `${log.action_type} on ${log.entity_type}${log.entity_name ? ` (${log.entity_name})` : ''}`,
          severity: log.severity,
          created_at: log.created_at,
          ip_address: ((log.metadata as Record<string, unknown>)?.ip_address as string) || null,
        }));

        let success: boolean;
        if (format === 'pdf') {
          success = await exportService.exportAuditLogsToPDF(exportData);
        } else {
          success = await exportService.exportAuditLogs(exportData);
        }

        if (success) {
          toast.success(t('admin.audit.exportSuccess'));
        }
      } catch (error) {
        Logger.error('Failed to export audit logs', error as Error);
        toast.error(t('admin.audit.exportError'));
      } finally {
        setExporting(false);
      }
    },
    [exporting, logs, toast, t]
  );

  // Show export menu
  const handleExportPress = useCallback(() => {
    if (exporting || logs.length === 0) return;
    setShowExportMenu(true);
  }, [exporting, logs.length]);

  // Format timestamp
  const formatTime = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t('admin.audit.justNow');
    if (diffMins < 60) return t('admin.audit.minutesAgo', { count: diffMins });
    if (diffHours < 24) return t('admin.audit.hoursAgo', { count: diffHours });
    if (diffDays < 7) return t('admin.audit.daysAgo', { count: diffDays });
    return date.toLocaleDateString();
  };

  // Get severity color
  const getSeverityColor = (severity: AuditSeverity): string => {
    switch (severity) {
      case 'critical':
        return colors.error;
      case 'warning':
        return colors.warning;
      default:
        return colors.success;
    }
  };

  // Render stats card
  const renderStatsCard = () => {
    if (statsLoading || !stats) return null;

    return (
      <View
        style={[
          styles.statsCard,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.statsTitle, { color: colors.text }]}>
          {t('admin.audit.last7Days')}
        </Text>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.accent }]}>{stats.total_actions}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
              {t('admin.audit.totalActions')}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.success }]}>
              {stats.actions_by_severity?.info || 0}
            </Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
              {t('admin.audit.info')}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.warning }]}>
              {stats.actions_by_severity?.warning || 0}
            </Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
              {t('admin.audit.warnings')}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.error }]}>
              {stats.actions_by_severity?.critical || 0}
            </Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
              {t('admin.audit.critical')}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  // Render log entry
  const renderLogEntry = ({ item }: { item: AuditLogEntry }) => {
    const iconName = auditService.getActionTypeIcon(item.action_type);
    const severityColor = getSeverityColor(item.severity);

    return (
      <View
        style={[
          styles.logEntry,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
      >
        <View style={[styles.logIcon, { backgroundColor: `${severityColor}15` }]}>
          <Ionicons name={iconName as never} size={20} color={severityColor} />
        </View>
        <View style={styles.logContent}>
          <View style={styles.logHeader}>
            <Text style={[styles.logAction, { color: colors.text }]} numberOfLines={1}>
              {auditService.getActionTypeLabel(item.action_type)}
            </Text>
            <Text style={[styles.logTime, { color: colors.textSecondary }]}>
              {formatTime(item.created_at)}
            </Text>
          </View>
          <Text style={[styles.logEntity, { color: colors.textSecondary }]} numberOfLines={1}>
            {item.entity_type}: {item.entity_name || item.entity_id || '-'}
          </Text>
          <View style={styles.logMeta}>
            <Text style={[styles.logAdmin, { color: colors.textMuted }]} numberOfLines={1}>
              {item.admin_name || item.admin_email || 'System'}
            </Text>
            {item.severity !== 'info' && (
              <View style={[styles.severityBadge, { backgroundColor: `${severityColor}20` }]}>
                <Text style={[styles.severityText, { color: severityColor }]}>{item.severity}</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    );
  };

  // Render filter modal
  const renderFilterModal = () => {
    let options: FilterOption[] = [];
    let currentValue: string | null = null;
    let onSelect: (value: string | null) => void = () => {};
    let title = '';

    switch (activeFilterModal) {
      case 'action':
        options = ACTION_TYPE_OPTIONS;
        currentValue = actionFilter;
        onSelect = v => setActionFilter(v as AuditActionType | null);
        title = t('admin.audit.filterByAction');
        break;
      case 'entity':
        options = ENTITY_TYPE_OPTIONS;
        currentValue = entityFilter;
        onSelect = v => setEntityFilter(v as AuditEntityType | null);
        title = t('admin.audit.filterByEntity');
        break;
      case 'severity':
        options = SEVERITY_OPTIONS;
        currentValue = severityFilter;
        onSelect = v => setSeverityFilter(v as AuditSeverity | null);
        title = t('admin.audit.filterBySeverity');
        break;
    }

    return (
      <Modal
        visible={activeFilterModal !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveFilterModal(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setActiveFilterModal(null)}
        >
          <View
            style={[styles.modalContent, { backgroundColor: colors.cardBackground }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.modalTitle, { color: colors.text }]}>{title}</Text>
            <ScrollView style={styles.modalOptions}>
              {options.map(option => (
                <TouchableOpacity
                  key={option.value || 'all'}
                  style={[
                    styles.modalOption,
                    currentValue === option.value && {
                      backgroundColor: `${colors.accent}15`,
                    },
                  ]}
                  onPress={() => {
                    onSelect(option.value);
                    setActiveFilterModal(null);
                  }}
                >
                  <Text
                    style={[
                      styles.modalOptionText,
                      { color: currentValue === option.value ? colors.accent : colors.text },
                    ]}
                  >
                    {option.label}
                  </Text>
                  {currentValue === option.value && (
                    <Ionicons name="checkmark" size={20} color={colors.accent} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    );
  };

  // Render empty state
  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Ionicons name="document-text-outline" size={48} color={colors.textMuted} />
      <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('admin.audit.noLogs')}</Text>
      <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
        {hasActiveFilters ? t('admin.audit.tryDifferentFilters') : t('admin.audit.noActivityYet')}
      </Text>
      {hasActiveFilters && (
        <TouchableOpacity
          style={[styles.clearButton, { backgroundColor: colors.accent }]}
          onPress={clearFilters}
        >
          <Text style={styles.clearButtonText}>{t('admin.audit.clearFilters')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={colors.icon} />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('admin.audit.title')}</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textMuted }]}>
            {t('admin.audit.subtitle')}
          </Text>
        </View>
        <TouchableOpacity
          style={[
            styles.filterButton,
            hasActiveFilters && { backgroundColor: `${colors.accent}15` },
          ]}
          onPress={() => setShowFilters(!showFilters)}
        >
          <Ionicons
            name={hasActiveFilters ? 'filter' : 'filter-outline'}
            size={24}
            color={hasActiveFilters ? colors.accent : colors.icon}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.filterButton}
          onPress={handleExportPress}
          disabled={exporting || logs.length === 0}
        >
          {exporting ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Ionicons
              name="download-outline"
              size={24}
              color={logs.length > 0 ? colors.accent : colors.textMuted}
            />
          )}
        </TouchableOpacity>
      </View>

      {/* Filter bar */}
      {showFilters && (
        <View
          style={[
            styles.filterBar,
            { backgroundColor: colors.cardBackground, borderColor: colors.border },
          ]}
        >
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <TouchableOpacity
              style={[
                styles.filterChip,
                { borderColor: actionFilter ? colors.accent : colors.border },
              ]}
              onPress={() => setActiveFilterModal('action')}
            >
              <Text
                style={[
                  styles.filterChipText,
                  { color: actionFilter ? colors.accent : colors.text },
                ]}
              >
                {actionFilter
                  ? ACTION_TYPE_OPTIONS.find(o => o.value === actionFilter)?.label
                  : t('admin.audit.action')}
              </Text>
              <Ionicons
                name="chevron-down"
                size={16}
                color={actionFilter ? colors.accent : colors.textSecondary}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.filterChip,
                { borderColor: entityFilter ? colors.accent : colors.border },
              ]}
              onPress={() => setActiveFilterModal('entity')}
            >
              <Text
                style={[
                  styles.filterChipText,
                  { color: entityFilter ? colors.accent : colors.text },
                ]}
              >
                {entityFilter
                  ? ENTITY_TYPE_OPTIONS.find(o => o.value === entityFilter)?.label
                  : t('admin.audit.entity')}
              </Text>
              <Ionicons
                name="chevron-down"
                size={16}
                color={entityFilter ? colors.accent : colors.textSecondary}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.filterChip,
                { borderColor: severityFilter ? colors.accent : colors.border },
              ]}
              onPress={() => setActiveFilterModal('severity')}
            >
              <Text
                style={[
                  styles.filterChipText,
                  { color: severityFilter ? colors.accent : colors.text },
                ]}
              >
                {severityFilter
                  ? SEVERITY_OPTIONS.find(o => o.value === severityFilter)?.label
                  : t('admin.audit.severity')}
              </Text>
              <Ionicons
                name="chevron-down"
                size={16}
                color={severityFilter ? colors.accent : colors.textSecondary}
              />
            </TouchableOpacity>

            {hasActiveFilters && (
              <TouchableOpacity
                style={[styles.filterChip, { borderColor: colors.error }]}
                onPress={clearFilters}
              >
                <Ionicons name="close" size={16} color={colors.error} />
                <Text style={[styles.filterChipText, { color: colors.error }]}>
                  {t('admin.audit.clear')}
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      )}

      {/* Content */}
      <FlatList
        data={logs}
        keyExtractor={item => item.id}
        renderItem={renderLogEntry}
        ListHeaderComponent={renderStatsCard}
        ListEmptyComponent={!isLoading ? renderEmptyState : null}
        contentContainerStyle={[styles.listContent, logs.length === 0 && styles.emptyContent]}
        refreshControl={
          <RefreshControl
            refreshing={isLoading && logs.length === 0}
            onRefresh={refetch}
            colors={[colors.accent]}
            tintColor={colors.accent}
          />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          isLoading && logs.length > 0 ? (
            <View style={styles.loadingMore}>
              <ActivityIndicator size="small" color={colors.accent} />
            </View>
          ) : hasMore && logs.length > 0 ? (
            <View style={styles.loadMoreHint}>
              <Text style={[styles.loadMoreText, { color: colors.textMuted }]}>
                {t('admin.audit.scrollForMore')}
              </Text>
            </View>
          ) : null
        }
      />

      {/* Filter Modal */}
      {renderFilterModal()}

      {/* Export Format Menu */}
      <Modal
        visible={showExportMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowExportMenu(false)}
      >
        <Pressable style={styles.exportModalOverlay} onPress={() => setShowExportMenu(false)}>
          <View style={[styles.exportMenu, { backgroundColor: colors.cardBackground }]}>
            <Text style={[styles.exportMenuTitle, { color: colors.text }]}>
              {t('admin.export.selectFormat')}
            </Text>

            <TouchableOpacity
              style={[styles.exportOption, { borderBottomColor: colors.border }]}
              onPress={() => handleExport('csv')}
              activeOpacity={0.7}
            >
              <Ionicons name="document-text-outline" size={24} color={colors.accent} />
              <View style={styles.exportOptionText}>
                <Text style={[styles.exportOptionTitle, { color: colors.text }]}>CSV</Text>
                <Text style={[styles.exportOptionDesc, { color: colors.textSecondary }]}>
                  {t('admin.export.csvDescription')}
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.exportOption}
              onPress={() => handleExport('pdf')}
              activeOpacity={0.7}
            >
              <Ionicons name="document-outline" size={24} color={colors.error} />
              <View style={styles.exportOptionText}>
                <Text style={[styles.exportOptionTitle, { color: colors.text }]}>PDF</Text>
                <Text style={[styles.exportOptionDesc, { color: colors.textSecondary }]}>
                  {t('admin.export.pdfDescription')}
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.exportCancelButton, { backgroundColor: `${colors.textSecondary}15` }]}
              onPress={() => setShowExportMenu(false)}
              activeOpacity={0.7}
            >
              <Text style={[styles.exportCancelText, { color: colors.textSecondary }]}>
                {t('common.cancel')}
              </Text>
            </TouchableOpacity>
          </View>
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
  filterButton: {
    padding: spacingPixels[2],
    borderRadius: radiusPixels.lg,
  },
  filterBar: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
    marginRight: spacingPixels[2],
    gap: 4,
  },
  filterChipText: {
    fontSize: 14,
    fontWeight: '500',
  },
  listContent: {
    padding: spacingPixels[4],
  },
  emptyContent: {
    flex: 1,
    justifyContent: 'center',
  },
  statsCard: {
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginBottom: spacingPixels[4],
  },
  statsTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: spacingPixels[3],
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 4,
  },
  logEntry: {
    flexDirection: 'row',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginBottom: spacingPixels[3],
  },
  logIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[3],
  },
  logContent: {
    flex: 1,
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  logAction: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  logTime: {
    fontSize: 12,
    marginLeft: spacingPixels[2],
  },
  logEntity: {
    fontSize: 13,
    marginBottom: 4,
  },
  logMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logAdmin: {
    fontSize: 12,
    flex: 1,
  },
  severityBadge: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: 2,
    borderRadius: radiusPixels.sm,
  },
  severityText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[6],
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: spacingPixels[4],
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: spacingPixels[2],
  },
  clearButton: {
    marginTop: spacingPixels[4],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
  },
  clearButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  loadingMore: {
    paddingVertical: spacingPixels[4],
    alignItems: 'center',
  },
  loadMoreHint: {
    paddingVertical: spacingPixels[3],
    alignItems: 'center',
  },
  loadMoreText: {
    fontSize: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacingPixels[4],
  },
  modalContent: {
    width: '100%',
    maxWidth: 320,
    borderRadius: radiusPixels.lg,
    overflow: 'hidden',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    padding: spacingPixels[4],
  },
  modalOptions: {
    maxHeight: 300,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
  },
  modalOptionText: {
    fontSize: 16,
  },
  exportModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacingPixels[4],
  },
  exportMenu: {
    width: '100%',
    maxWidth: 320,
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[4],
    gap: spacingPixels[3],
  },
  exportMenuTitle: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  exportOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    gap: spacingPixels[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  exportOptionText: {
    flex: 1,
    gap: 2,
  },
  exportOptionTitle: {
    fontSize: 16,
    fontWeight: '500',
  },
  exportOptionDesc: {
    fontSize: 13,
  },
  exportCancelButton: {
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    marginTop: spacingPixels[2],
  },
  exportCancelText: {
    fontSize: 16,
    fontWeight: '500',
  },
});

export default AdminActivityLogScreen;
