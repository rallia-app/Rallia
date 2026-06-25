import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import * as Application from 'expo-application';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import { Logger, supabase } from '@rallia/shared-services';
import { useTheme, useAdminStatus, useProfile } from '@rallia/shared-hooks';
import type { Locale } from '@rallia/shared-translations';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  secondary,
  neutral,
  status,
} from '@rallia/design-system';

import { useAppNavigation } from '#/navigation/hooks';
import { useLocale, useFeedbackReportSheet, useSubscription } from '#/context';
import { useTour } from '#/context/TourContext';
import { useAuth, useTranslation } from '#/hooks';

const BASE_WHITE = '#ffffff';
import { lightHaptic, warningHaptic } from '@rallia/shared-utils';

// Get app environment (EXPO_PUBLIC_ vars are inlined at build time by Metro)
const appEnv = process.env.EXPO_PUBLIC_APP_ENV || 'development';

function SettingsItem({
  icon,
  title,
  onPress,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  onPress: () => void;
  colors: { background: string; border: string; icon: string; text: string; iconMuted: string };
}) {
  return (
    <TouchableOpacity
      style={[
        styles.settingsItem,
        { backgroundColor: colors.background, borderBottomColor: colors.border },
      ]}
      onPress={() => {
        lightHaptic();
        onPress();
      }}
      activeOpacity={0.7}
    >
      <View style={styles.settingsItemLeft}>
        <Ionicons name={icon} size={20} color={colors.icon} />
        <Text size="base" color={colors.text}>
          {title}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.iconMuted} />
    </TouchableOpacity>
  );
}

const SettingsScreen: React.FC = () => {
  const navigation = useAppNavigation();
  const toast = useToast();
  const {
    locale,
    setLocale,
    isManuallySet,
    isReady: isLocaleReady,
    resetToDeviceLocale,
    localeConfigs,
    availableLocales,
  } = useLocale();
  const { t } = useTranslation();

  const { openFeedbackReport } = useFeedbackReportSheet();
  const { restartWelcomeTour } = useTour();
  const { isAuthenticated, loading: authLoading, signOut } = useAuth();
  const { subscriptionStatus, presentPaywall } = useSubscription();
  const { profile, loading: profileLoading } = useProfile();
  const { isAdmin } = useAdminStatus();

  // User is fully onboarded only if authenticated AND onboarding is complete
  const isOnboarded = isAuthenticated && profile?.onboarding_completed;

  const [pendingLocale, setPendingLocale] = useState<Locale | null>(null);
  const [isResettingLocale, setIsResettingLocale] = useState(false);
  const isChangingLocale = pendingLocale !== null || isResettingLocale;
  const { theme, themePreference, setThemePreference } = useTheme();
  const [pendingTheme, setPendingTheme] = useState<typeof themePreference | null>(null);
  const isDark = theme === 'dark';

  // Theme-aware colors from design system
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
      buttonInactive: themeColors.muted,
      buttonActive: isDark ? primary[500] : primary[600],
      buttonTextInactive: themeColors.mutedForeground,
      buttonTextActive: BASE_WHITE,
      deleteButtonBg: isDark ? `${status.error.DEFAULT}20` : `${status.error.light}15`,
      deleteButtonText: status.error.DEFAULT,
    }),
    [themeColors, isDark]
  );

  const handleLanguageChange = async (newLocale: Locale) => {
    if (newLocale === locale || isChangingLocale) return;

    lightHaptic();
    setPendingLocale(newLocale);
    try {
      await setLocale(newLocale);
      Logger.logUserAction('language_changed', { locale: newLocale });
    } catch (error) {
      Logger.error('Failed to change language', error as Error);
      toast.error(t('errors.unknown'));
    } finally {
      setPendingLocale(null);
    }
  };

  const handleResetToSystemLocale = async () => {
    if (!isManuallySet || isChangingLocale) return;

    setIsResettingLocale(true);
    try {
      await resetToDeviceLocale();
      Logger.logUserAction('language_reset_to_system');
    } catch (error) {
      Logger.error('Failed to reset language', error as Error);
    } finally {
      setIsResettingLocale(false);
    }
  };

  const handleThemeChange = (themePref: typeof themePreference) => {
    if (themePref === themePreference || pendingTheme !== null) return;
    lightHaptic();
    setPendingTheme(themePref);
    // Defer the actual theme switch by two frames. setThemePreference cascades
    // a re-render across every component that subscribes to useTheme, which
    // would otherwise be batched with this event and delay the paint of the
    // optimistic active state until the heavy work finishes.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setThemePreference(themePref);
        // Clear pending after the theme has propagated; the active state
        // remains visible the whole time because we compare against
        // (pendingTheme ?? themePreference).
        requestAnimationFrame(() => setPendingTheme(null));
      });
    });
  };

  const handleNotificationPreferences = () => {
    lightHaptic();
    navigation.navigate('NotificationPreferences');
    Logger.logUserAction('notification_preferences_pressed');
  };

  const handlePermissions = () => {
    lightHaptic();
    navigation.navigate('Permissions');
    Logger.logUserAction('permissions_pressed');
  };

  const handleFeedback = () => {
    lightHaptic();
    openFeedbackReport('settings');
    Logger.logUserAction('feedback_pressed');
  };

  const handleRestartTour = async () => {
    lightHaptic();
    try {
      await restartWelcomeTour();
      toast.success(t('tour.settings.tourReset'));
      Logger.logUserAction('tour_restart_from_settings');
    } catch (error) {
      Logger.error('Failed to restart app tour from settings', error as Error);
      toast.error(t('errors.unknown'));
    }
  };

  const handleAdminPanel = () => {
    lightHaptic();
    navigation.navigate('AdminPanel');
    Logger.logUserAction('admin_panel_pressed');
  };

  const [isDeleting, setIsDeleting] = useState(false);
  const [showAppInfo, setShowAppInfo] = useState(false);

  const handleDeleteAccount = () => {
    warningHaptic();
    Alert.alert(
      t('settings.deleteAccountConfirmTitle'),
      t('settings.deleteAccountConfirmMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.deleteAccountConfirmButton'),
          style: 'destructive',
          onPress: () => {
            // Second confirmation
            Alert.alert(
              t('settings.deleteAccountFinalTitle'),
              t('settings.deleteAccountFinalMessage'),
              [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('settings.deleteAccountConfirmButton'),
                  style: 'destructive',
                  onPress: async () => {
                    setIsDeleting(true);
                    try {
                      const { data, error } = await supabase.functions.invoke('delete-account');
                      if (error || !data?.success) {
                        throw new Error(error?.message || data?.error || 'Deletion failed');
                      }
                      await signOut();
                      navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
                      toast.success(t('settings.deleteAccountSuccess'));
                    } catch (error) {
                      Logger.error('Failed to delete account', error as Error);
                      toast.error(t('errors.unknown'));
                    } finally {
                      setIsDeleting(false);
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  // Show loading indicator until i18n is ready
  if (!isLocaleReady || authLoading || profileLoading) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['bottom']}
      >
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.buttonActive} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['bottom']}
    >
      <ScrollView
        style={[styles.scrollContent, { backgroundColor: colors.background }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Prominent Feedback CTA — styled like Home quick-nav buttons */}
        {isOnboarded && (
          <View style={[styles.feedbackCardWrapper, { backgroundColor: colors.background }]}>
            <TouchableOpacity
              onPress={handleFeedback}
              activeOpacity={0.85}
              style={styles.feedbackCard}
              accessibilityRole="button"
              accessibilityLabel={t('settings.feedback')}
            >
              <LinearGradient
                colors={[secondary[400], secondary[500], secondary[500]]}
                locations={[0, 0.55, 1]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.feedbackGradient}
              >
                <View style={styles.feedbackTopHighlight} />
                <View style={styles.feedbackIconCircle}>
                  <Ionicons name="chatbox-ellipses" size={22} color={BASE_WHITE} />
                </View>
                <View style={styles.feedbackTextWrapper}>
                  <Text size="base" weight="semibold" color={BASE_WHITE}>
                    {t('settings.feedback')}
                  </Text>
                  <Text size="xs" color={`${BASE_WHITE}D9`} style={styles.feedbackSubtitleText}>
                    {t('feedback.description')}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={`${BASE_WHITE}CC`} />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {/* Settings Items - Permissions always visible; Notifications and Restart Tour when onboarded */}
        <View style={[styles.settingsGroup, { backgroundColor: colors.background }]}>
          {isOnboarded && (
            <SettingsItem
              colors={colors}
              icon="notifications-outline"
              title={t('settings.notifications')}
              onPress={handleNotificationPreferences}
            />
          )}
          <SettingsItem
            colors={colors}
            icon="shield-checkmark-outline"
            title={t('settings.permissions')}
            onPress={handlePermissions}
          />
          {isOnboarded && (
            <SettingsItem
              colors={colors}
              icon="map-outline"
              title={t('tour.settings.restartTour')}
              onPress={handleRestartTour}
            />
          )}
          <SettingsItem
            colors={colors}
            icon="document-text-outline"
            title={t('settings.termsOfService')}
            onPress={() => Linking.openURL('https://rallia.ca/terms')}
          />
          <SettingsItem
            colors={colors}
            icon="lock-closed-outline"
            title={t('settings.privacyPolicy')}
            onPress={() => Linking.openURL('https://rallia.ca/privacy')}
          />
          <SettingsItem
            colors={colors}
            icon="mail-outline"
            title={t('settings.contactSupport')}
            onPress={() => Linking.openURL('mailto:contact@rallia.ca')}
          />
        </View>

        {/* Admin Panel - Only visible to admin users */}
        {isAuthenticated && isAdmin && (
          <View style={[styles.settingsGroup, { backgroundColor: colors.background }]}>
            <SettingsItem
              colors={colors}
              icon="construct-outline"
              title={t('admin.panelButton')}
              onPress={handleAdminPanel}
            />
          </View>
        )}

        {/* Rallia Plus — gated to admins for now */}
        {isOnboarded && isAdmin && (
          <View style={[styles.settingsGroup, { backgroundColor: colors.background }]}>
            <SettingsItem
              colors={colors}
              icon={
                subscriptionStatus === 'active' || subscriptionStatus === 'cancelling'
                  ? 'star'
                  : 'star-outline'
              }
              title={
                subscriptionStatus === 'active' || subscriptionStatus === 'cancelling'
                  ? `Rallia Plus — ${t('subscription.status_active')}`
                  : 'Rallia Plus'
              }
              onPress={() => navigation.navigate('SubscriptionManagement')}
            />
          </View>
        )}

        {/* Preferred Language */}
        <View style={[styles.preferenceSection, { backgroundColor: colors.background }]}>
          <View style={styles.preferenceTitleRow}>
            <Text size="sm" color={colors.textSecondary}>
              {t('settings.language')}
            </Text>
            {isManuallySet && (
              <TouchableOpacity
                onPress={() => {
                  lightHaptic();
                  handleResetToSystemLocale();
                }}
                disabled={isChangingLocale}
              >
                <Text size="xs" weight="medium" color={primary[500]}>
                  {t('settings.languageAuto')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          <Text size="xs" color={colors.textMuted} style={styles.preferenceDescription}>
            {t('settings.languageDescription')}
          </Text>
          <View style={styles.preferenceOptions}>
            {availableLocales.map(loc => {
              const config = localeConfigs[loc];
              const effectiveLocale = pendingLocale ?? locale;
              const isActive = effectiveLocale === loc;
              const isPending = pendingLocale === loc;
              return (
                <TouchableOpacity
                  key={loc}
                  style={[
                    styles.preferenceButton,
                    {
                      backgroundColor: isActive ? colors.buttonActive : colors.buttonInactive,
                    },
                  ]}
                  onPress={() => handleLanguageChange(loc)}
                  disabled={isChangingLocale}
                  activeOpacity={0.7}
                >
                  <View style={styles.preferenceButtonContent}>
                    <Text
                      size="sm"
                      weight="medium"
                      color={isActive ? colors.buttonTextActive : colors.buttonTextInactive}
                    >
                      {config.nativeName}
                    </Text>
                    {isPending && (
                      <ActivityIndicator size="small" color={colors.buttonTextActive} />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
          {!isManuallySet && (
            <Text size="xs" color={colors.textMuted} style={styles.autoDetectedText}>
              {t('settings.languageAuto')}
            </Text>
          )}
        </View>

        {/* Appearance */}
        <View style={[styles.preferenceSection, { backgroundColor: colors.background }]}>
          <Text size="sm" color={colors.textSecondary} style={styles.preferenceSectionTitle}>
            {t('settings.theme')}
          </Text>
          <View style={styles.preferenceOptions}>
            {(['light', 'dark', 'system'] as const).map(themePref => {
              const effectiveTheme = pendingTheme ?? themePreference;
              const isActive = effectiveTheme === themePref;
              const isPending = pendingTheme === themePref;
              const labelKey =
                themePref === 'light'
                  ? 'settings.lightMode'
                  : themePref === 'dark'
                    ? 'settings.darkMode'
                    : 'settings.systemTheme';
              return (
                <TouchableOpacity
                  key={themePref}
                  style={[
                    styles.preferenceButton,
                    {
                      backgroundColor: isActive ? colors.buttonActive : colors.buttonInactive,
                    },
                  ]}
                  onPress={() => handleThemeChange(themePref)}
                  disabled={pendingTheme !== null}
                  activeOpacity={0.7}
                >
                  <View style={styles.preferenceButtonContent}>
                    <Text
                      size="sm"
                      weight="medium"
                      color={isActive ? colors.buttonTextActive : colors.buttonTextInactive}
                    >
                      {t(labelKey)}
                    </Text>
                    {isPending && (
                      <ActivityIndicator size="small" color={colors.buttonTextActive} />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Sign Out & Delete Account */}
        {isAuthenticated && (
          <View style={[styles.actionButtons, { backgroundColor: colors.background }]}>
            <TouchableOpacity
              style={[styles.signOutButton, { backgroundColor: colors.buttonInactive }]}
              onPress={async () => {
                warningHaptic();
                await signOut();
                // Reset to Main - Home screen shows sign-in prompt when not authenticated
                navigation.reset({
                  index: 0,
                  routes: [{ name: 'Main' }],
                });
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="log-out-outline" size={18} color={colors.icon} />
              <Text size="base" weight="medium" color={colors.text}>
                {t('settings.logout')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.deleteAccountButton, { backgroundColor: colors.deleteButtonBg }]}
              onPress={handleDeleteAccount}
              activeOpacity={0.7}
            >
              <Ionicons name="trash-outline" size={18} color={colors.deleteButtonText} />
              <Text size="base" weight="medium" color={colors.deleteButtonText}>
                {t('settings.deleteAccount')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* App Info */}
        <View style={[styles.preferenceSection, { backgroundColor: colors.background }]}>
          <TouchableOpacity
            style={styles.appInfoToggle}
            onPress={() => setShowAppInfo(!showAppInfo)}
            activeOpacity={0.7}
          >
            <Text size="sm" color={colors.textSecondary} style={styles.preferenceSectionTitle}>
              {t('settings.appInfo')}
            </Text>
            <Ionicons
              name={showAppInfo ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
          {showAppInfo && (
            <View style={styles.appInfoGrid}>
              <View style={styles.appInfoRow}>
                <Text size="xs" color={colors.textMuted}>
                  {t('settings.version')}
                </Text>
                <Text size="xs" color={colors.text}>
                  {Constants.expoConfig?.version ?? '—'}
                  {Application.nativeBuildVersion ? ` (${Application.nativeBuildVersion})` : ''}
                </Text>
              </View>
              <View style={styles.appInfoRow}>
                <Text size="xs" color={colors.textMuted}>
                  {t('settings.environment')}
                </Text>
                <Text size="xs" color={colors.text}>
                  {appEnv}
                </Text>
              </View>
              <View style={styles.appInfoRow}>
                <Text size="xs" color={colors.textMuted}>
                  {t('settings.channel')}
                </Text>
                <Text size="xs" color={colors.text}>
                  {Updates.channel ?? '—'}
                </Text>
              </View>
              <View style={styles.appInfoRow}>
                <Text size="xs" color={colors.textMuted}>
                  {t('settings.update')}
                </Text>
                <Text size="xs" color={colors.text}>
                  {Updates.isEmbeddedLaunch
                    ? t('settings.embeddedBundle')
                    : (Updates.updateId?.slice(0, 8) ?? '—')}
                </Text>
              </View>
            </View>
          )}
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    flex: 1,
    paddingVertical: spacingPixels[5],
  },
  settingsGroup: {
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[5],
  },
  feedbackCardWrapper: {
    paddingHorizontal: spacingPixels[5],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[1],
  },
  feedbackCard: {
    borderRadius: radiusPixels['2xl'],
  },
  feedbackGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    paddingVertical: spacingPixels[4],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels['2xl'],
    overflow: 'hidden',
  },
  feedbackTopHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  feedbackIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  feedbackTextWrapper: {
    flex: 1,
  },
  feedbackSubtitleText: {
    marginTop: spacingPixels[0.5],
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[4],
    borderBottomWidth: 1,
  },
  settingsItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  preferenceSection: {
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[5],
  },
  preferenceTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacingPixels[1],
  },
  preferenceSectionTitle: {
    marginBottom: spacingPixels[1],
  },
  preferenceDescription: {
    marginBottom: spacingPixels[3],
  },
  preferenceOptions: {
    flexDirection: 'row',
    gap: spacingPixels[3],
  },
  preferenceButton: {
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[2.5],
    borderRadius: radiusPixels.full,
    minWidth: spacingPixels[20],
    alignItems: 'center',
  },
  preferenceButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  autoDetectedText: {
    marginTop: spacingPixels[2],
    fontStyle: 'italic',
  },
  actionButtons: {
    paddingHorizontal: spacingPixels[5],
    paddingTop: spacingPixels[6],
    gap: spacingPixels[3],
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[3.5],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
  deleteAccountButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[3.5],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
  debugButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
  appInfoToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  appInfoGrid: {
    gap: spacingPixels[2],
  },
  appInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bottomSpacer: {
    height: spacingPixels[10],
  },
});

export default SettingsScreen;
