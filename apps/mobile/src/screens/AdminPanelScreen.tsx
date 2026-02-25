/**
 * AdminPanelScreen
 *
 * Main dashboard entry point for administrators.
 * Displays admin status, role-based sections, and quick actions.
 *
 * Access Requirements:
 * - User must have a record in the `admin` table
 * - Features vary based on role: super_admin, moderator, support, analyst
 */

import React, { useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text } from '@rallia/shared-components';
import { Logger } from '@rallia/shared-services';
import { useTheme, useAdminStatus, hasMinimumRole, type AdminRole } from '@rallia/shared-hooks';
import { useAdminPush } from '../hooks/useAdminPush';
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

const BASE_WHITE = '#ffffff';

// =============================================================================
// TYPES
// =============================================================================

interface AdminSectionItem {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  titleKey: string;
  descriptionKey: string;
  onPress: () => void;
  minimumRole: AdminRole;
  badge?: number;
  comingSoon?: boolean;
}

// =============================================================================
// COMPONENT
// =============================================================================

const AdminPanelScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { isAdmin, role, loading, error, adminId } = useAdminStatus();

  // Handle notification press - navigate to relevant screen
  const handleNotificationPressed = useCallback(
    (response: { notification: { request: { content: { data?: Record<string, unknown> } } } }) => {
      const data = response.notification.request.content.data;
      if (data?.alertId) {
        navigation.navigate('AdminAlerts');
      } else if (data?.alertType === 'user_report') {
        navigation.navigate('AdminModeration');
      }
    },
    [navigation]
  );

  // Register for admin push notifications
  useAdminPush({
    adminId: adminId || null,
    enabled: isAdmin,
    onNotificationPressed: handleNotificationPressed,
  });

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
    }),
    [themeColors, isDark]
  );

  // Role badge styling
  const getRoleBadgeStyle = (adminRole: AdminRole | null) => {
    switch (adminRole) {
      case 'super_admin':
        return { bg: colors.errorBg, text: colors.errorText };
      case 'moderator':
        return { bg: colors.warningBg, text: colors.warningText };
      case 'support':
        return { bg: colors.accentLight, text: colors.accent };
      case 'analyst':
        return { bg: colors.successBg, text: colors.successText };
      default:
        return { bg: colors.accentLight, text: colors.textMuted };
    }
  };

  // Admin section items - Phase 1 shows structure, features coming in later phases
  const adminSections: AdminSectionItem[] = useMemo(
    () => [
      {
        id: 'users',
        icon: 'people-outline',
        titleKey: 'admin.sections.users.title',
        descriptionKey: 'admin.sections.users.description',
        onPress: () => {
          lightHaptic();
          Logger.logUserAction('admin_users_pressed');
          navigation.navigate('AdminUsers');
        },
        minimumRole: 'support',
        comingSoon: false,
      },
      {
        id: 'analytics',
        icon: 'bar-chart-outline',
        titleKey: 'admin.sections.analytics.title',
        descriptionKey: 'admin.sections.analytics.description',
        onPress: () => {
          lightHaptic();
          Logger.logUserAction('admin_analytics_pressed');
          navigation.navigate('AdminDashboard');
        },
        minimumRole: 'analyst',
        comingSoon: false,
      },
      {
        id: 'moderation',
        icon: 'shield-checkmark-outline',
        titleKey: 'admin.sections.moderation.title',
        descriptionKey: 'admin.sections.moderation.description',
        onPress: () => {
          lightHaptic();
          Logger.logUserAction('admin_moderation_pressed');
          navigation.navigate('AdminModeration');
        },
        minimumRole: 'moderator',
        comingSoon: false,
      },
      {
        id: 'notifications',
        icon: 'notifications-outline',
        titleKey: 'admin.sections.notifications.title',
        descriptionKey: 'admin.sections.notifications.description',
        onPress: () => {
          lightHaptic();
          Logger.logUserAction('admin_notifications_pressed');
          navigation.navigate('AdminAlerts');
        },
        minimumRole: 'moderator',
        comingSoon: false,
      },
      {
        id: 'audit',
        icon: 'document-text-outline',
        titleKey: 'admin.sections.audit.title',
        descriptionKey: 'admin.sections.audit.description',
        onPress: () => {
          lightHaptic();
          Logger.logUserAction('admin_audit_pressed');
          navigation.navigate('AdminActivityLog');
        },
        minimumRole: 'moderator',
        comingSoon: false,
      },
      {
        id: 'settings',
        icon: 'settings-outline',
        titleKey: 'admin.sections.settings.title',
        descriptionKey: 'admin.sections.settings.description',
        onPress: () => {
          lightHaptic();
          Logger.logUserAction('admin_settings_pressed');
          navigation.navigate('AdminSettings');
        },
        minimumRole: 'super_admin',
        comingSoon: false,
      },
    ],
    [navigation]
  );

  // Filter sections based on user's role
  const visibleSections = adminSections.filter(section =>
    hasMinimumRole(role, section.minimumRole)
  );

  // Section card component
  const SectionCard = ({ section }: { section: AdminSectionItem }) => {
    return (
      <TouchableOpacity
        style={[
          styles.sectionCard,
          {
            backgroundColor: colors.cardBackground,
            borderColor: colors.border,
            opacity: section.comingSoon ? 0.7 : 1,
          },
        ]}
        onPress={section.onPress}
        disabled={section.comingSoon}
        activeOpacity={0.7}
      >
        <View style={[styles.sectionIconContainer, { backgroundColor: colors.accentLight }]}>
          <Ionicons name={section.icon} size={24} color={colors.accent} />
        </View>
        <View style={styles.sectionContent}>
          <View style={styles.sectionTitleRow}>
            <Text size="base" weight="semibold" color={colors.text}>
              {t(section.titleKey as TranslationKey)}
            </Text>
            {section.comingSoon && (
              <View style={[styles.comingSoonBadge, { backgroundColor: colors.warningBg }]}>
                <Text size="xs" color={colors.warningText}>
                  {t('admin.comingSoon')}
                </Text>
              </View>
            )}
            {section.badge !== undefined && section.badge > 0 && (
              <View style={[styles.badge, { backgroundColor: colors.errorText }]}>
                <Text size="xs" weight="bold" color={BASE_WHITE}>
                  {section.badge > 99 ? '99+' : section.badge}
                </Text>
              </View>
            )}
          </View>
          <Text size="sm" color={colors.textSecondary} style={styles.sectionDescription}>
            {t(section.descriptionKey as TranslationKey)}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.iconMuted} />
      </TouchableOpacity>
    );
  };

  // Loading state
  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text size="base" color={colors.textSecondary} style={styles.loadingText}>
            {t('common.loading')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Error state
  if (error) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.errorText} />
          <Text size="lg" weight="semibold" color={colors.text} style={styles.errorTitle}>
            {t('admin.errors.loadFailed')}
          </Text>
          <Text size="base" color={colors.textSecondary} style={styles.errorDescription}>
            {error.message}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Not an admin - should not happen if navigation is properly gated
  if (!isAdmin) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
        <View style={styles.errorContainer}>
          <Ionicons name="lock-closed-outline" size={48} color={colors.errorText} />
          <Text size="lg" weight="semibold" color={colors.text} style={styles.errorTitle}>
            {t('admin.errors.accessDenied')}
          </Text>
          <Text size="base" color={colors.textSecondary} style={styles.errorDescription}>
            {t('admin.errors.noPermission')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const roleBadgeStyle = getRoleBadgeStyle(role);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      <ScrollView
        style={styles.scrollContent}
        contentContainerStyle={styles.scrollContentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Admin Status Header */}
        <View style={[styles.statusHeader, { backgroundColor: colors.cardBackground }]}>
          <View style={styles.statusIconContainer}>
            <Ionicons name="shield-checkmark" size={32} color={colors.accent} />
          </View>
          <View style={styles.statusContent}>
            <Text size="lg" weight="bold" color={colors.text}>
              {t('admin.dashboard.title')}
            </Text>
            <View style={styles.roleRow}>
              <Text size="sm" color={colors.textSecondary}>
                {t('admin.dashboard.roleLabel')}:
              </Text>
              <View style={[styles.roleBadge, { backgroundColor: roleBadgeStyle.bg }]}>
                <Text size="sm" weight="semibold" color={roleBadgeStyle.text}>
                  {role ? t(`admin.roles.${role}` as TranslationKey) : ''}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Quick Stats - Phase 3 will populate with real data */}
        <View style={styles.statsGrid}>
          <View style={[styles.statCard, { backgroundColor: colors.cardBackground }]}>
            <Text size="2xl" weight="bold" color={colors.accent}>
              --
            </Text>
            <Text size="sm" color={colors.textSecondary}>
              {t('admin.stats.activeUsers')}
            </Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.cardBackground }]}>
            <Text size="2xl" weight="bold" color={colors.successText}>
              --
            </Text>
            <Text size="sm" color={colors.textSecondary}>
              {t('admin.stats.matchesToday')}
            </Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.cardBackground }]}>
            <Text size="2xl" weight="bold" color={colors.warningText}>
              --
            </Text>
            <Text size="sm" color={colors.textSecondary}>
              {t('admin.stats.pendingReports')}
            </Text>
          </View>
        </View>

        {/* Admin Sections */}
        <View style={styles.sectionsContainer}>
          <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.sectionHeader}>
            {t('admin.dashboard.sections')}
          </Text>
          {visibleSections.map(section => (
            <SectionCard key={section.id} section={section} />
          ))}
        </View>

        {/* Phase 1 Notice */}
        <View style={[styles.phaseNotice, { backgroundColor: colors.accentLight }]}>
          <Ionicons name="information-circle-outline" size={20} color={colors.accent} />
          <Text size="sm" color={colors.accent} style={styles.phaseNoticeText}>
            {t('admin.phase1Notice')}
          </Text>
        </View>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  loadingText: {
    marginTop: spacingPixels[2],
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacingPixels[6],
    gap: spacingPixels[3],
  },
  errorTitle: {
    marginTop: spacingPixels[2],
    textAlign: 'center',
  },
  errorDescription: {
    textAlign: 'center',
    maxWidth: 280,
  },
  scrollContent: {
    flex: 1,
  },
  scrollContentContainer: {
    padding: spacingPixels[4],
    gap: spacingPixels[4],
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[4],
  },
  statusIconContainer: {
    width: 56,
    height: 56,
    borderRadius: radiusPixels.full,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusContent: {
    flex: 1,
    gap: spacingPixels[1],
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  roleBadge: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.md,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: spacingPixels[3],
  },
  statCard: {
    flex: 1,
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  sectionsContainer: {
    gap: spacingPixels[3],
  },
  sectionHeader: {
    marginLeft: spacingPixels[1],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    gap: spacingPixels[3],
  },
  sectionIconContainer: {
    width: 44,
    height: 44,
    borderRadius: radiusPixels.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionContent: {
    flex: 1,
    gap: spacingPixels[1],
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  sectionDescription: {
    lineHeight: 18,
  },
  comingSoonBadge: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: 2,
    borderRadius: radiusPixels.sm,
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: radiusPixels.full,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[1],
  },
  phaseNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[3],
  },
  phaseNoticeText: {
    flex: 1,
    lineHeight: 20,
  },
});

export default AdminPanelScreen;
