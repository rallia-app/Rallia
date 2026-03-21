import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import { Logger, tourService, supabase } from '@rallia/shared-services';
import { useTheme, useAdminStatus } from '@rallia/shared-hooks';
import { useAppNavigation } from '../navigation/hooks';
import { useLocale, useFeedbackReportSheet } from '../context';
import { useAuth, useTranslation } from '../hooks';
import type { Locale } from '@rallia/shared-translations';
import { useProfile } from '@rallia/shared-hooks';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
  status,
} from '@rallia/design-system';

const BASE_WHITE = '#ffffff';
import { lightHaptic, warningHaptic, getProfilePictureUrl } from '@rallia/shared-utils';

// Get app environment from config (defaults to 'development' for local dev)
const appEnv = Constants.expoConfig?.extra?.appEnv || 'development';

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
  const { isAuthenticated, loading: authLoading, signOut } = useAuth();
  const { profile, loading: profileLoading } = useProfile();
  const { isAdmin } = useAdminStatus();

  // User is fully onboarded only if authenticated AND onboarding is complete
  const isOnboarded = isAuthenticated && profile?.onboarding_completed;

  const [isChangingLocale, setIsChangingLocale] = useState(false);
  const { theme, themePreference, setThemePreference } = useTheme();
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
    setIsChangingLocale(true);
    try {
      await setLocale(newLocale);
      Logger.logUserAction('language_changed', { locale: newLocale });
    } catch (error) {
      Logger.error('Failed to change language', error as Error);
      toast.error(t('errors.unknown'));
    } finally {
      setIsChangingLocale(false);
    }
  };

  const handleResetToSystemLocale = async () => {
    if (!isManuallySet || isChangingLocale) return;

    setIsChangingLocale(true);
    try {
      await resetToDeviceLocale();
      Logger.logUserAction('language_reset_to_system');
    } catch (error) {
      Logger.error('Failed to reset language', error as Error);
    } finally {
      setIsChangingLocale(false);
    }
  };

  const handleEditProfile = () => {
    navigation.navigate('UserProfile', {});
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

  const handleAdminPanel = () => {
    lightHaptic();
    navigation.navigate('AdminPanel');
    Logger.logUserAction('admin_panel_pressed');
  };

  const handleResetTour = () => {
    lightHaptic();
    Alert.alert(t('tour.settings.restartTour'), t('tour.settings.restartTourDescription'), [
      {
        text: t('common.cancel'),
        style: 'cancel',
      },
      {
        text: t('common.confirm'),
        onPress: async () => {
          try {
            await tourService.resetAllTours();
            toast.success(t('tour.settings.tourReset'));
            Logger.logUserAction('tour_reset');
          } catch (error) {
            Logger.error('Failed to reset tour', error as Error);
            toast.error(t('errors.unknown'));
          }
        },
      },
    ]);
  };

  const SettingsItem = ({
    icon,
    title,
    onPress,
  }: {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    onPress: () => void;
  }) => (
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
        {/* Edit Profile - Only show when fully onboarded */}
        {isOnboarded && (
          <View style={[styles.profileGroup, { backgroundColor: colors.background }]}>
            <View style={[styles.profileSection, { backgroundColor: colors.background }]}>
              {profile?.profile_picture_url ? (
                <Image
                  source={{ uri: getProfilePictureUrl(profile.profile_picture_url) || '' }}
                  style={styles.profileImage}
                />
              ) : (
                <View style={styles.profileImagePlaceholder}>
                  <Ionicons name="person-outline" size={32} color={colors.iconMuted} />
                </View>
              )}
              <View style={styles.profileInfo}>
                <Text size="lg" weight="semibold" color={colors.text}>
                  {profile?.display_name ||
                    `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() ||
                    ''}
                </Text>
                <Text size="sm" color={colors.textSecondary} style={styles.profileEmail}>
                  {profile?.email || ''}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={[
                styles.editProfileButton,
                { backgroundColor: colors.background, borderBottomColor: colors.border },
              ]}
              onPress={() => {
                lightHaptic();
                handleEditProfile();
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="create-outline" size={18} color={colors.icon} />
              <Text size="base" color={colors.text}>
                {t('profile.editProfile')}
              </Text>
              <Ionicons
                name="chevron-forward"
                size={20}
                color={colors.iconMuted}
                style={{ marginLeft: 'auto' }}
              />
            </TouchableOpacity>
          </View>
        )}

        {/* Settings Items - Permissions always visible; Notifications and Restart Tour when onboarded */}
        <View style={[styles.settingsGroup, { backgroundColor: colors.background }]}>
          {isOnboarded && (
            <SettingsItem
              icon="notifications-outline"
              title={t('settings.notifications')}
              onPress={handleNotificationPreferences}
            />
          )}
          <SettingsItem
            icon="shield-checkmark-outline"
            title={t('settings.permissions')}
            onPress={handlePermissions}
          />
          {isOnboarded && (
            <>
              <SettingsItem
                icon="refresh-outline"
                title={t('tour.settings.restartTour')}
                onPress={handleResetTour}
              />
              <SettingsItem
                icon="chatbox-ellipses-outline"
                title={t('settings.feedback')}
                onPress={handleFeedback}
              />
            </>
          )}
          <SettingsItem
            icon="document-text-outline"
            title={t('settings.termsOfService')}
            onPress={() => Linking.openURL('https://rallia.ca/terms')}
          />
          <SettingsItem
            icon="lock-closed-outline"
            title={t('settings.privacyPolicy')}
            onPress={() => Linking.openURL('https://rallia.ca/privacy')}
          />
        </View>

        {/* Admin Panel - Only visible to admin users */}
        {isAuthenticated && isAdmin && (
          <View style={[styles.settingsGroup, { backgroundColor: colors.background }]}>
            <SettingsItem
              icon="construct-outline"
              title={t('admin.panelButton')}
              onPress={handleAdminPanel}
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
              const isActive = locale === loc;
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
                  {isChangingLocale && !isActive ? (
                    <ActivityIndicator size="small" color={colors.buttonActive} />
                  ) : (
                    <Text
                      size="sm"
                      weight="medium"
                      color={isActive ? colors.buttonTextActive : colors.buttonTextInactive}
                    >
                      {config.nativeName}
                    </Text>
                  )}
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
              const isActive = themePreference === themePref;
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
                  onPress={() => {
                    lightHaptic();
                    setThemePreference(themePref);
                  }}
                  activeOpacity={0.7}
                >
                  <Text
                    size="sm"
                    weight="medium"
                    color={isActive ? colors.buttonTextActive : colors.buttonTextInactive}
                  >
                    {t(labelKey)}
                  </Text>
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

            {/* <TouchableOpacity
              style={[styles.deleteAccountButton, { backgroundColor: colors.deleteButtonBg }]}
              onPress={handleDeleteAccount}
              activeOpacity={0.7}
            >
              <Ionicons name="trash-outline" size={18} color={colors.deleteButtonText} />
              <Text size="base" weight="medium" color={colors.deleteButtonText}>
                {t('settings.deleteAccount')}
              </Text>
            </TouchableOpacity> */}
          </View>
        )}

        {/* App Info */}
        <View style={[styles.preferenceSection, { backgroundColor: colors.background }]}>
          <Text size="sm" color={colors.textSecondary} style={styles.preferenceSectionTitle}>
            {t('settings.appInfo')}
          </Text>
          <View style={styles.appInfoGrid}>
            <View style={styles.appInfoRow}>
              <Text size="xs" color={colors.textMuted}>
                {t('settings.version')}
              </Text>
              <Text size="xs" color={colors.text}>
                {Constants.expoConfig?.version ?? '—'}
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
  profileSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[2],
  },
  profileImage: {
    width: spacingPixels[14],
    height: spacingPixels[14],
    borderRadius: radiusPixels.full,
  },
  profileImagePlaceholder: {
    width: spacingPixels[14],
    height: spacingPixels[14],
    borderRadius: radiusPixels.full,
    backgroundColor: neutral[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInfo: {
    marginLeft: spacingPixels[4],
    flex: 1,
  },
  profileEmail: {
    marginTop: spacingPixels[1],
  },
  editProfileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[4],
    borderBottomWidth: 1,
    gap: spacingPixels[2],
  },
  settingsGroup: {
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[5],
  },
  profileGroup: {
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[5],
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
