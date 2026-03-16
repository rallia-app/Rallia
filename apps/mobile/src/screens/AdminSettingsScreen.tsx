/**
 * AdminSettingsScreen
 *
 * Admin settings and preferences screen.
 * Allows admins to manage their notification preferences,
 * alert settings, and view system configuration.
 *
 * Access Requirements:
 * - User must be a super_admin
 */

import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text, useToast } from '@rallia/shared-components';
import { Logger } from '@rallia/shared-services';
import { useTheme, useAdminStatus } from '@rallia/shared-hooks';
import { useTranslation } from '../hooks';
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
import { lightHaptic, warningHaptic } from '@rallia/shared-utils';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const BASE_WHITE = '#ffffff';

// =============================================================================
// TYPES
// =============================================================================

interface AlertPreference {
  type: string;
  enabled: boolean;
  email: boolean;
  push: boolean;
}

// =============================================================================
// COMPONENT
// =============================================================================

const AdminSettingsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const toast = useToast();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { role, loading: adminLoading } = useAdminStatus();

  // Local state
  const [preferences, setPreferences] = useState<AlertPreference[]>([
    { type: 'critical_action', enabled: true, email: true, push: true },
    { type: 'user_report', enabled: true, email: true, push: false },
    { type: 'system_alert', enabled: true, email: false, push: true },
    { type: 'new_admin', enabled: true, email: true, push: true },
    { type: 'security_alert', enabled: true, email: true, push: true },
  ]);
  const [saving, setSaving] = useState(false);
  const [emailDigest, setEmailDigest] = useState<'daily' | 'weekly' | 'never'>('daily');

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
      switchTrack: isDark ? neutral[700] : neutral[300],
      switchTrackActive: isDark ? primary[700] : primary[400],
      switchThumb: BASE_WHITE,
    }),
    [themeColors, isDark]
  );

  // Toggle preference
  const togglePreference = useCallback((type: string, field: 'enabled' | 'email' | 'push') => {
    lightHaptic();
    setPreferences(prev => prev.map(p => (p.type === type ? { ...p, [field]: !p[field] } : p)));
  }, []);

  // Get alert type label
  const getAlertTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      critical_action: t('admin.settings.alertTypes.criticalAction'),
      user_report: t('admin.settings.alertTypes.userReport'),
      system_alert: t('admin.settings.alertTypes.systemAlert'),
      new_admin: t('admin.settings.alertTypes.newAdmin'),
      security_alert: t('admin.settings.alertTypes.securityAlert'),
    };
    return labels[type] || type;
  };

  // Save preferences
  const handleSavePreferences = useCallback(async () => {
    setSaving(true);
    try {
      // In a real implementation, this would call alertService.updateAlertPreference
      // For now, we'll simulate the save
      await new Promise(resolve => setTimeout(resolve, 500));

      toast.success(t('admin.settings.saveSuccess'));
      Logger.logUserAction('admin_settings_saved', { preferences });
    } catch (error) {
      Logger.error('Failed to save admin settings', error as Error);
      toast.error(t('admin.settings.saveError'));
    } finally {
      setSaving(false);
    }
  }, [preferences, toast, t]);

  // Clear all alerts
  const handleClearAllAlerts = useCallback(() => {
    warningHaptic();
    Alert.alert(t('admin.settings.clearAlertsTitle'), t('admin.settings.clearAlertsMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.confirm'),
        style: 'destructive',
        onPress: async () => {
          try {
            // Would call alertService to clear all alerts
            toast.success(t('admin.settings.alertsCleared'));
            Logger.logUserAction('admin_alerts_cleared');
          } catch (error) {
            Logger.error('Failed to clear alerts', error as Error);
            toast.error(t('errors.unknown'));
          }
        },
      },
    ]);
  }, [toast, t]);

  // Loading state
  if (adminLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
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
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={24} color={colors.icon} />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text size="lg" weight="bold" color={colors.text}>
            {t('admin.settings.title')}
          </Text>
          <Text size="xs" color={colors.textMuted}>
            {t('admin.sections.settings.description')}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.saveButton, { backgroundColor: colors.accent }]}
          onPress={handleSavePreferences}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color={BASE_WHITE} />
          ) : (
            <Text size="sm" weight="semibold" color={BASE_WHITE}>
              {t('common.save')}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Notification Preferences Section */}
        <View style={styles.section}>
          <Text
            size="sm"
            weight="semibold"
            color={colors.textSecondary}
            style={styles.sectionTitle}
          >
            {t('admin.settings.notificationPreferences')}
          </Text>

          <View
            style={[
              styles.card,
              { backgroundColor: colors.cardBackground, borderColor: colors.border },
            ]}
          >
            {/* Table Header */}
            <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
              <View style={styles.tableHeaderLabel}>
                <Text size="xs" weight="semibold" color={colors.textMuted}>
                  {t('admin.settings.alertType')}
                </Text>
              </View>
              <View style={styles.tableHeaderToggle}>
                <Text size="xs" weight="semibold" color={colors.textMuted}>
                  {t('admin.settings.enabled')}
                </Text>
              </View>
              <View style={styles.tableHeaderToggle}>
                <Text size="xs" weight="semibold" color={colors.textMuted}>
                  {t('admin.settings.email')}
                </Text>
              </View>
              <View style={styles.tableHeaderToggle}>
                <Text size="xs" weight="semibold" color={colors.textMuted}>
                  {t('admin.settings.push')}
                </Text>
              </View>
            </View>

            {/* Preference Rows */}
            {preferences.map((pref, index) => (
              <View
                key={pref.type}
                style={[
                  styles.tableRow,
                  index < preferences.length - 1 && {
                    borderBottomColor: colors.border,
                    borderBottomWidth: 1,
                  },
                ]}
              >
                <View style={styles.tableRowLabel}>
                  <Text size="sm" color={colors.text}>
                    {getAlertTypeLabel(pref.type)}
                  </Text>
                </View>
                <View style={styles.tableRowToggle}>
                  <Switch
                    value={pref.enabled}
                    onValueChange={() => togglePreference(pref.type, 'enabled')}
                    trackColor={{ false: colors.switchTrack, true: colors.switchTrackActive }}
                    thumbColor={colors.switchThumb}
                  />
                </View>
                <View style={styles.tableRowToggle}>
                  <Switch
                    value={pref.email && pref.enabled}
                    onValueChange={() => togglePreference(pref.type, 'email')}
                    disabled={!pref.enabled}
                    trackColor={{ false: colors.switchTrack, true: colors.switchTrackActive }}
                    thumbColor={colors.switchThumb}
                  />
                </View>
                <View style={styles.tableRowToggle}>
                  <Switch
                    value={pref.push && pref.enabled}
                    onValueChange={() => togglePreference(pref.type, 'push')}
                    disabled={!pref.enabled}
                    trackColor={{ false: colors.switchTrack, true: colors.switchTrackActive }}
                    thumbColor={colors.switchThumb}
                  />
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Email Digest Section */}
        <View style={styles.section}>
          <Text
            size="sm"
            weight="semibold"
            color={colors.textSecondary}
            style={styles.sectionTitle}
          >
            {t('admin.settings.emailDigest')}
          </Text>

          <View
            style={[
              styles.card,
              { backgroundColor: colors.cardBackground, borderColor: colors.border },
            ]}
          >
            <Text size="xs" color={colors.textMuted} style={styles.digestDescription}>
              {t('admin.settings.emailDigestDescription')}
            </Text>
            <View style={styles.digestOptions}>
              {(['daily', 'weekly', 'never'] as const).map(option => (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.digestOption,
                    {
                      backgroundColor: emailDigest === option ? colors.accent : colors.accentLight,
                      borderColor: emailDigest === option ? colors.accent : colors.border,
                    },
                  ]}
                  onPress={() => {
                    lightHaptic();
                    setEmailDigest(option);
                  }}
                >
                  <Text
                    size="sm"
                    weight={emailDigest === option ? 'semibold' : 'medium'}
                    color={emailDigest === option ? BASE_WHITE : colors.text}
                  >
                    {t(`admin.settings.digestOptions.${option}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* Data Management Section */}
        <View style={styles.section}>
          <Text
            size="sm"
            weight="semibold"
            color={colors.textSecondary}
            style={styles.sectionTitle}
          >
            {t('admin.settings.dataManagement')}
          </Text>

          <View
            style={[
              styles.card,
              { backgroundColor: colors.cardBackground, borderColor: colors.border },
            ]}
          >
            {/* Export Audit Log */}
            <TouchableOpacity
              style={[styles.actionRow, { borderBottomColor: colors.border }]}
              onPress={() => {
                lightHaptic();
                navigation.navigate('AdminActivityLog');
              }}
            >
              <View style={styles.actionRowContent}>
                <View style={[styles.actionIcon, { backgroundColor: colors.accentLight }]}>
                  <Ionicons name="download-outline" size={20} color={colors.accent} />
                </View>
                <View>
                  <Text size="sm" weight="medium" color={colors.text}>
                    {t('admin.settings.exportAuditLog')}
                  </Text>
                  <Text size="xs" color={colors.textMuted}>
                    {t('admin.settings.exportAuditLogDescription')}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.iconMuted} />
            </TouchableOpacity>

            {/* Export Users */}
            <TouchableOpacity
              style={[styles.actionRow, { borderBottomColor: colors.border }]}
              onPress={() => {
                lightHaptic();
                navigation.navigate('AdminUsers');
              }}
            >
              <View style={styles.actionRowContent}>
                <View style={[styles.actionIcon, { backgroundColor: colors.accentLight }]}>
                  <Ionicons name="people-outline" size={20} color={colors.accent} />
                </View>
                <View>
                  <Text size="sm" weight="medium" color={colors.text}>
                    {t('admin.settings.exportUsers')}
                  </Text>
                  <Text size="xs" color={colors.textMuted}>
                    {t('admin.settings.exportUsersDescription')}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.iconMuted} />
            </TouchableOpacity>

            {/* Clear Alerts */}
            <TouchableOpacity style={styles.actionRowLast} onPress={handleClearAllAlerts}>
              <View style={styles.actionRowContent}>
                <View style={[styles.actionIcon, { backgroundColor: colors.errorBg }]}>
                  <Ionicons name="trash-outline" size={20} color={colors.errorText} />
                </View>
                <View>
                  <Text size="sm" weight="medium" color={colors.text}>
                    {t('admin.settings.clearAlerts')}
                  </Text>
                  <Text size="xs" color={colors.textMuted}>
                    {t('admin.settings.clearAlertsDescription')}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.iconMuted} />
            </TouchableOpacity>
          </View>
        </View>

        {/* System Info Section (super_admin only) */}
        {role === 'super_admin' && (
          <View style={styles.section}>
            <Text
              size="sm"
              weight="semibold"
              color={colors.textSecondary}
              style={styles.sectionTitle}
            >
              {t('admin.settings.systemInfo')}
            </Text>

            <View
              style={[
                styles.card,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
                <Text size="sm" color={colors.textMuted}>
                  {t('admin.settings.version')}
                </Text>
                <Text size="sm" weight="medium" color={colors.text}>
                  1.0.0
                </Text>
              </View>
              <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
                <Text size="sm" color={colors.textMuted}>
                  {t('admin.settings.environment')}
                </Text>
                <Text size="sm" weight="medium" color={colors.text}>
                  Production
                </Text>
              </View>
              <View style={styles.infoRowLast}>
                <Text size="sm" color={colors.textMuted}>
                  {t('admin.settings.adminRole')}
                </Text>
                <Text size="sm" weight="medium" color={colors.accent}>
                  {t(`admin.roles.${role}`)}
                </Text>
              </View>
            </View>
          </View>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  backButton: {
    padding: spacingPixels[1],
    marginRight: spacingPixels[3],
  },
  headerTitleContainer: {
    flex: 1,
  },
  saveButton: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.md,
    minWidth: 70,
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[4],
  },
  section: {
    marginBottom: spacingPixels[6],
  },
  sectionTitle: {
    marginBottom: spacingPixels[3],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  card: {
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    borderBottomWidth: 1,
  },
  tableHeaderLabel: {
    flex: 1,
  },
  tableHeaderToggle: {
    width: 60,
    alignItems: 'center',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
  },
  tableRowLabel: {
    flex: 1,
  },
  tableRowToggle: {
    width: 60,
    alignItems: 'center',
  },
  digestDescription: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[2],
  },
  digestOptions: {
    flexDirection: 'row',
    padding: spacingPixels[3],
    gap: spacingPixels[2],
  },
  digestOption: {
    flex: 1,
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    borderBottomWidth: 1,
  },
  actionRowLast: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
  },
  actionRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacingPixels[3],
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: radiusPixels.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    borderBottomWidth: 1,
  },
  infoRowLast: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
  },
  bottomSpacer: {
    height: spacingPixels[10],
  },
});

export default AdminSettingsScreen;
