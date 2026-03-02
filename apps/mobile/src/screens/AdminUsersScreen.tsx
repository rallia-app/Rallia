/**
 * AdminUsersScreen
 *
 * Admin-level user management screen with search, filters, and pagination.
 * Displays user list with key information and allows navigation to detail view.
 *
 * Access Requirements:
 * - User must have admin role with 'support' or higher level
 *
 * Features:
 * - Searchable user list
 * - Filter by status (active, inactive, banned)
 * - Pagination with load more
 * - Pull-to-refresh
 * - Navigate to user detail
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text, useToast } from '@rallia/shared-components';
import { Logger } from '@rallia/shared-services';
import { exportService } from '../services/exportService';
import {
  useTheme,
  useAdminUsers,
  useAdminStatus,
  hasMinimumRole,
  type AdminUserInfo,
  type AdminUserStatus,
} from '@rallia/shared-hooks';
import { useTranslation } from '../hooks';
import type { TranslationKey } from '@rallia/shared-translations';
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

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const BASE_WHITE = '#ffffff';
const DEFAULT_AVATAR = 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';

// =============================================================================
// TYPES
// =============================================================================

type FilterStatus = AdminUserStatus;

interface FilterOption {
  value: FilterStatus;
  labelKey: string;
  icon: keyof typeof Ionicons.glyphMap;
}

// =============================================================================
// COMPONENT
// =============================================================================

const AdminUsersScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const toast = useToast();
  const isDark = theme === 'dark';
  const { isAdmin, role } = useAdminStatus();

  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<FilterStatus>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

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

  // Filter options
  const filterOptions: FilterOption[] = useMemo(
    () => [
      { value: 'all', labelKey: 'admin.users.filters.all', icon: 'people-outline' },
      { value: 'active', labelKey: 'admin.users.filters.active', icon: 'checkmark-circle-outline' },
      { value: 'inactive', labelKey: 'admin.users.filters.inactive', icon: 'time-outline' },
      { value: 'banned', labelKey: 'admin.users.filters.banned', icon: 'ban-outline' },
    ],
    []
  );

  // Admin users hook
  const { users, totalCount, loading, error, hasMore, loadMore, refetch, setFilters } =
    useAdminUsers({
      filters: {
        status: selectedStatus,
        searchQuery: searchQuery.trim() || undefined,
      },
      pageSize: 20,
    });

  // Access check
  const hasAccess = isAdmin && hasMinimumRole(role, 'support');

  // Handle search
  const handleSearch = useCallback(
    (text: string) => {
      setSearchQuery(text);
      // Debounced search handled by setting filters
      const timer = setTimeout(() => {
        setFilters({
          status: selectedStatus,
          searchQuery: text.trim() || undefined,
        });
      }, 300);
      return () => clearTimeout(timer);
    },
    [selectedStatus, setFilters]
  );

  // Handle filter change
  const handleFilterChange = useCallback(
    (newStatus: FilterStatus) => {
      lightHaptic();
      setSelectedStatus(newStatus);
      setFilters({
        status: newStatus,
        searchQuery: searchQuery.trim() || undefined,
      });
      setShowFilters(false);
      Logger.logUserAction('admin_users_filter_changed', { status: newStatus });
    },
    [searchQuery, setFilters]
  );

  // Handle user press
  const handleUserPress = useCallback(
    (user: AdminUserInfo) => {
      lightHaptic();
      Logger.logUserAction('admin_user_detail_pressed', { userId: user.id });
      navigation.navigate('AdminUserDetail', { userId: user.id });
    },
    [navigation]
  );

  // Handle load more
  const handleLoadMore = useCallback(() => {
    if (hasMore && !loading) {
      loadMore();
    }
  }, [hasMore, loading, loadMore]);

  // Handle refresh
  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  // Handle export
  const handleExport = useCallback(
    async (format: 'csv' | 'pdf') => {
      if (exporting || users.length === 0) return;

      lightHaptic();
      setExporting(true);
      setShowExportMenu(false);

      try {
        // Map users to export format
        const exportData = users.map(user => ({
          id: user.id,
          email: user.email || '',
          first_name: user.first_name,
          last_name: user.last_name,
          created_at: user.created_at,
          last_active: user.last_sign_in_at,
          status: user.active_ban ? 'banned' : user.is_active ? 'active' : 'inactive',
          email_verified: !!user.email,
        }));

        let success: boolean;
        if (format === 'pdf') {
          success = await exportService.exportUsersToPDF(exportData);
        } else {
          success = await exportService.exportUsers(exportData);
        }

        if (success) {
          toast.success(t('admin.users.exportSuccess'));
        }
      } catch (error) {
        Logger.error('Failed to export users', error as Error);
        toast.error(t('admin.users.exportError'));
      } finally {
        setExporting(false);
      }
    },
    [exporting, users, toast, t]
  );

  // Show export menu
  const handleExportPress = useCallback(() => {
    if (exporting || users.length === 0) return;
    lightHaptic();
    setShowExportMenu(true);
  }, [exporting, users.length]);

  // Get user display name
  const getUserDisplayName = useCallback(
    (user: AdminUserInfo): string => {
      if (user.display_name) return user.display_name;
      if (user.first_name || user.last_name) {
        return `${user.first_name || ''} ${user.last_name || ''}`.trim();
      }
      return t('admin.users.anonymous' as TranslationKey);
    },
    [t]
  );

  // Get user status badge
  const getStatusBadge = useCallback(
    (user: AdminUserInfo) => {
      if (user.active_ban) {
        return {
          text: t('admin.users.status.banned' as TranslationKey),
          bg: colors.errorBg,
          textColor: colors.errorText,
          icon: 'ban-outline' as keyof typeof Ionicons.glyphMap,
        };
      }
      if (!user.is_active) {
        return {
          text: t('admin.users.status.inactive' as TranslationKey),
          bg: colors.warningBg,
          textColor: colors.warningText,
          icon: 'time-outline' as keyof typeof Ionicons.glyphMap,
        };
      }
      return {
        text: t('admin.users.status.active' as TranslationKey),
        bg: colors.successBg,
        textColor: colors.successText,
        icon: 'checkmark-circle-outline' as keyof typeof Ionicons.glyphMap,
      };
    },
    [colors, t]
  );

  // Format date
  const formatDate = useCallback(
    (dateString: string | null): string => {
      if (!dateString) return t('common.never' as TranslationKey);
      const date = new Date(dateString);
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    },
    [t]
  );

  // Render user card
  const renderUserCard = useCallback(
    ({ item }: { item: AdminUserInfo }) => {
      const statusBadge = getStatusBadge(item);
      const displayName = getUserDisplayName(item);

      return (
        <TouchableOpacity
          style={[
            styles.userCard,
            { backgroundColor: colors.cardBackground, borderColor: colors.border },
          ]}
          onPress={() => handleUserPress(item)}
          activeOpacity={0.7}
        >
          <View style={styles.userCardContent}>
            {/* Avatar */}
            <Image
              source={{ uri: item.profile_picture_url || DEFAULT_AVATAR }}
              style={styles.avatar}
            />

            {/* User Info */}
            <View style={styles.userInfo}>
              <Text size="base" weight="semibold" color={colors.text} numberOfLines={1}>
                {displayName}
              </Text>
              <Text size="sm" color={colors.textSecondary} numberOfLines={1}>
                {item.email || t('admin.users.noEmail' as TranslationKey)}
              </Text>
              <View style={styles.userMeta}>
                {item.city && (
                  <View style={styles.metaItem}>
                    <Ionicons name="location-outline" size={12} color={colors.textMuted} />
                    <Text size="xs" color={colors.textMuted} style={styles.metaText}>
                      {item.city}
                    </Text>
                  </View>
                )}
                <View style={styles.metaItem}>
                  <Ionicons name="calendar-outline" size={12} color={colors.textMuted} />
                  <Text size="xs" color={colors.textMuted} style={styles.metaText}>
                    {formatDate(item.created_at)}
                  </Text>
                </View>
              </View>
            </View>

            {/* Status Badge & Arrow */}
            <View style={styles.userActions}>
              <View style={[styles.statusBadge, { backgroundColor: statusBadge.bg }]}>
                <Ionicons name={statusBadge.icon} size={12} color={statusBadge.textColor} />
                <Text
                  size="xs"
                  weight="medium"
                  color={statusBadge.textColor}
                  style={styles.statusText}
                >
                  {statusBadge.text}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.iconMuted} />
            </View>
          </View>

          {/* Quick Stats */}
          <View style={[styles.quickStats, { borderTopColor: colors.border }]}>
            <View style={styles.statItem}>
              <Ionicons name="football-outline" size={14} color={colors.textMuted} />
              <Text size="xs" color={colors.textMuted}>
                {item.sports_count} {t('admin.users.sports' as TranslationKey)}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Ionicons name="game-controller-outline" size={14} color={colors.textMuted} />
              <Text size="xs" color={colors.textMuted}>
                {item.matches_count} {t('admin.users.matches' as TranslationKey)}
              </Text>
            </View>
            {item.last_sign_in_at && (
              <View style={styles.statItem}>
                <Ionicons name="log-in-outline" size={14} color={colors.textMuted} />
                <Text size="xs" color={colors.textMuted}>
                  {formatDate(item.last_sign_in_at)}
                </Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      );
    },
    [colors, t, handleUserPress, formatDate, getStatusBadge, getUserDisplayName]
  );

  // Render empty state
  const renderEmptyState = () => {
    if (loading) return null;

    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="people-outline" size={64} color={colors.textMuted} />
        <Text size="lg" weight="semibold" color={colors.textMuted} style={styles.emptyTitle}>
          {searchQuery
            ? t('admin.users.noSearchResults' as TranslationKey)
            : t('admin.users.noUsers' as TranslationKey)}
        </Text>
        <Text size="sm" color={colors.textMuted} style={styles.emptyDescription}>
          {searchQuery
            ? t('admin.users.tryDifferentSearch' as TranslationKey)
            : t('admin.users.noUsersDescription' as TranslationKey)}
        </Text>
      </View>
    );
  };

  // Render footer (load more indicator)
  const renderFooter = () => {
    if (!hasMore) return null;
    return (
      <View style={styles.footer}>
        <ActivityIndicator size="small" color={colors.accent} />
      </View>
    );
  };

  // Access denied view
  if (!hasAccess) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['bottom']}
      >
        <View style={styles.accessDenied}>
          <Ionicons name="lock-closed-outline" size={64} color={colors.errorText} />
          <Text size="lg" weight="semibold" color={colors.text} style={styles.accessDeniedTitle}>
            {t('admin.errors.accessDenied' as TranslationKey)}
          </Text>
          <Text size="sm" color={colors.textMuted} style={styles.accessDeniedDescription}>
            {t('admin.errors.noPermission' as TranslationKey)}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Error view
  if (error && !users.length) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['bottom']}
      >
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={64} color={colors.errorText} />
          <Text size="lg" weight="semibold" color={colors.text} style={styles.errorTitle}>
            {t('admin.errors.loadFailed' as TranslationKey)}
          </Text>
          <Text size="sm" color={colors.textMuted} style={styles.errorDescription}>
            {error.message}
          </Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: colors.accent }]}
            onPress={handleRefresh}
            activeOpacity={0.8}
          >
            <Ionicons name="refresh" size={18} color={BASE_WHITE} />
            <Text size="sm" weight="semibold" color={BASE_WHITE}>
              {t('common.retry')}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['bottom']}
    >
      {/* Header with Search */}
      <View style={styles.header}>
        {/* Search Input */}
        <View style={[styles.searchContainer, { backgroundColor: colors.inputBackground }]}>
          <Ionicons name="search-outline" size={20} color={colors.iconMuted} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder={t('admin.users.searchPlaceholder' as TranslationKey)}
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={handleSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => handleSearch('')}>
              <Ionicons name="close-circle" size={20} color={colors.iconMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Filter Toggle */}
        <TouchableOpacity
          style={[
            styles.filterButton,
            { backgroundColor: showFilters ? colors.accentLight : colors.inputBackground },
          ]}
          onPress={() => {
            lightHaptic();
            setShowFilters(!showFilters);
          }}
          activeOpacity={0.7}
        >
          <Ionicons
            name="filter-outline"
            size={20}
            color={showFilters ? colors.accent : colors.iconMuted}
          />
        </TouchableOpacity>

        {/* Export Button */}
        <TouchableOpacity
          style={[styles.filterButton, { backgroundColor: colors.inputBackground }]}
          onPress={handleExportPress}
          disabled={exporting || users.length === 0}
          activeOpacity={0.7}
        >
          {exporting ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Ionicons
              name="download-outline"
              size={20}
              color={users.length > 0 ? colors.accent : colors.iconMuted}
            />
          )}
        </TouchableOpacity>
      </View>

      {/* Filter Pills */}
      {showFilters && (
        <View style={[styles.filtersContainer, { borderBottomColor: colors.border }]}>
          {filterOptions.map(option => (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.filterPill,
                {
                  backgroundColor:
                    selectedStatus === option.value ? colors.accentLight : colors.inputBackground,
                  borderColor: selectedStatus === option.value ? colors.accent : 'transparent',
                },
              ]}
              onPress={() => handleFilterChange(option.value)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={option.icon}
                size={14}
                color={selectedStatus === option.value ? colors.accent : colors.textMuted}
              />
              <Text
                size="xs"
                weight={selectedStatus === option.value ? 'semibold' : 'regular'}
                color={selectedStatus === option.value ? colors.accent : colors.textMuted}
                style={styles.filterPillText}
              >
                {t(option.labelKey as TranslationKey)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Results Count */}
      <View style={styles.resultsHeader}>
        <Text size="sm" color={colors.textMuted}>
          {t('admin.users.resultsCount' as TranslationKey, { count: totalCount ?? 0 })}
        </Text>
      </View>

      {/* User List */}
      <FlatList
        data={users}
        keyExtractor={item => item.id}
        renderItem={renderUserCard}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={loading && users.length > 0}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
          />
        }
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={renderEmptyState}
        ListFooterComponent={renderFooter}
      />

      {/* Export Format Menu */}
      <Modal
        visible={showExportMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowExportMenu(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowExportMenu(false)}>
          <View style={[styles.exportMenu, { backgroundColor: colors.cardBackground }]}>
            <Text size="lg" weight="semibold" color={colors.text} style={styles.exportMenuTitle}>
              {t('admin.export.selectFormat' as TranslationKey)}
            </Text>

            <TouchableOpacity
              style={[styles.exportOption, { borderBottomColor: colors.border }]}
              onPress={() => handleExport('csv')}
              activeOpacity={0.7}
            >
              <Ionicons name="document-text-outline" size={24} color={colors.accent} />
              <View style={styles.exportOptionText}>
                <Text size="base" weight="medium" color={colors.text}>
                  CSV
                </Text>
                <Text size="sm" color={colors.textMuted}>
                  {t('admin.export.csvDescription' as TranslationKey)}
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.exportOption}
              onPress={() => handleExport('pdf')}
              activeOpacity={0.7}
            >
              <Ionicons name="document-outline" size={24} color={colors.errorText} />
              <View style={styles.exportOptionText}>
                <Text size="base" weight="medium" color={colors.text}>
                  PDF
                </Text>
                <Text size="sm" color={colors.textMuted}>
                  {t('admin.export.pdfDescription' as TranslationKey)}
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.cancelButton, { backgroundColor: colors.inputBackground }]}
              onPress={() => setShowExportMenu(false)}
              activeOpacity={0.7}
            >
              <Text size="base" weight="medium" color={colors.textMuted}>
                {t('common.cancel' as TranslationKey)}
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
    gap: spacingPixels[2],
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    height: 44,
    gap: spacingPixels[2],
  },
  searchInput: {
    flex: 1,
    fontSize: fontSizePixels.base,
    fontWeight: fontWeightNumeric.normal,
  },
  filterButton: {
    width: 44,
    height: 44,
    borderRadius: radiusPixels.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filtersContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[3],
    gap: spacingPixels[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
    gap: spacingPixels[1],
  },
  filterPillText: {
    marginLeft: spacingPixels[1],
  },
  resultsHeader: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
  },
  listContent: {
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[6],
  },
  userCard: {
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[3],
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  userCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    gap: spacingPixels[3],
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  userInfo: {
    flex: 1,
    gap: spacingPixels[0.5],
  },
  userMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    marginTop: spacingPixels[1],
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  metaText: {
    marginLeft: 2,
  },
  userActions: {
    alignItems: 'flex-end',
    gap: spacingPixels[2],
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
    gap: spacingPixels[1],
  },
  statusText: {
    marginLeft: 2,
  },
  quickStats: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacingPixels[2],
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  footer: {
    paddingVertical: spacingPixels[4],
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacingPixels[6],
    paddingVertical: spacingPixels[12],
  },
  emptyTitle: {
    marginTop: spacingPixels[4],
    textAlign: 'center',
  },
  emptyDescription: {
    marginTop: spacingPixels[2],
    textAlign: 'center',
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacingPixels[6],
  },
  errorTitle: {
    marginTop: spacingPixels[4],
    textAlign: 'center',
  },
  errorDescription: {
    marginTop: spacingPixels[2],
    textAlign: 'center',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    marginTop: spacingPixels[4],
    gap: spacingPixels[2],
  },
  accessDenied: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacingPixels[6],
  },
  accessDeniedTitle: {
    marginTop: spacingPixels[4],
    textAlign: 'center',
  },
  accessDeniedDescription: {
    marginTop: spacingPixels[2],
    textAlign: 'center',
  },
  modalOverlay: {
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
    gap: spacingPixels[0.5],
  },
  cancelButton: {
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    marginTop: spacingPixels[2],
  },
});

export default AdminUsersScreen;
