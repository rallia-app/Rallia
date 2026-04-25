/**
 * NotificationPermissionStep - Fourth step of the pre-onboarding wizard
 *
 * Requests push notification permission. Persuasive UI mirroring
 * LocationPermissionStep so the user understands the value before the
 * native system dialog appears.
 */

import React, { useCallback, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button } from '@rallia/shared-components';
import {
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
  shadowsNative,
} from '@rallia/design-system';
import { mediumHaptic } from '@rallia/shared-utils';
import { useThemeStyles, useTranslation, usePermissions } from '../../hooks';
import * as Analytics from '../../services/analytics';
import { SportIcon } from '../../components/SportIcon';

interface NotificationPermissionStepProps {
  /** Called when user enables notifications or dismisses the system dialog */
  onContinue: (notificationsEnabled: boolean) => void;
  /** Sport name to render in the mock notification icon (defaults to tennis). */
  primarySportName?: string;
  /** Whether the step is currently active */
  isActive?: boolean;
}

export function NotificationPermissionStep({
  onContinue,
  primarySportName,
  isActive: _isActive = true,
}: NotificationPermissionStepProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { requestNotificationPermission } = usePermissions();
  const [isRequesting, setIsRequesting] = useState(false);

  const handleEnableNotifications = useCallback(async () => {
    if (isRequesting) return;

    setIsRequesting(true);
    mediumHaptic();

    try {
      const granted = await requestNotificationPermission();
      Analytics.notificationPermissionResult({ granted, source: 'pre_onboarding' });
      onContinue(granted);
    } catch (error) {
      console.error('Failed to request notifications:', error);
      Analytics.notificationPermissionResult({ granted: false, source: 'pre_onboarding' });
      onContinue(false);
    } finally {
      setIsRequesting(false);
    }
  }, [isRequesting, requestNotificationPermission, onContinue]);

  return (
    <View style={styles.container}>
      <View style={styles.inner}>
        {/* Header Section */}
        <Animated.View entering={FadeInDown.delay(50).springify()} style={styles.headerSection}>
          <LinearGradient
            colors={isDark ? [primary[800], primary[900]] : [primary[50], primary[100]]}
            style={styles.iconContainer}
          >
            <Ionicons
              name="notifications-outline"
              size={36}
              color={isDark ? primary[200] : primary[600]}
            />
          </LinearGradient>

          <Text size="xl" weight="bold" color={colors.foreground} style={styles.title}>
            {t('preOnboarding.notificationPermission.title')}
          </Text>

          <Text size="sm" color={colors.textMuted} style={styles.subtitle}>
            {t('preOnboarding.notificationPermission.subtitle')}
          </Text>
        </Animated.View>

        {/* Mock iOS Notification Center stack — three banners tiered with
            inset & vertical offset to mimic Apple's grouped-notification
            look. The front card is the only one that renders content. */}
        <Animated.View entering={FadeInDown.delay(120).springify()} style={styles.previewWrapper}>
          {/* Back card (oldest) */}
          <View
            style={[
              styles.previewBackCard,
              {
                backgroundColor: isDark ? 'rgba(38, 38, 38, 0.55)' : 'rgba(255, 255, 255, 0.55)',
                borderColor: isDark ? 'rgba(82, 82, 82, 0.3)' : 'rgba(229, 229, 229, 0.5)',
              },
            ]}
          />
          {/* Middle card */}
          <View
            style={[
              styles.previewMiddleCard,
              {
                backgroundColor: isDark ? 'rgba(38, 38, 38, 0.78)' : 'rgba(255, 255, 255, 0.78)',
                borderColor: isDark ? 'rgba(82, 82, 82, 0.35)' : 'rgba(229, 229, 229, 0.6)',
              },
            ]}
          />
          {/* Front card (newest, fully rendered) */}
          <View
            style={[
              styles.previewCard,
              {
                backgroundColor: isDark ? 'rgba(38, 38, 38, 0.92)' : 'rgba(255, 255, 255, 0.96)',
                borderColor: isDark ? 'rgba(115, 115, 115, 0.25)' : 'rgba(0, 0, 0, 0.06)',
              },
            ]}
          >
            <View
              style={[
                styles.previewIcon,
                { backgroundColor: isDark ? primary[600] : primary[500] },
              ]}
            >
              <SportIcon sportName={primarySportName ?? 'tennis'} size={22} color="#ffffff" />
            </View>
            <View style={styles.previewContent}>
              <View style={styles.previewTitleRow}>
                <Text
                  size="sm"
                  weight="semibold"
                  color={colors.foreground}
                  numberOfLines={1}
                  style={styles.previewTitle}
                >
                  {t('preOnboarding.notificationPermission.preview.title')}
                </Text>
                <Text size="xs" color={isDark ? neutral[400] : neutral[500]}>
                  {t('preOnboarding.notificationPermission.preview.timestamp')}
                </Text>
              </View>
              <Text
                size="xs"
                color={isDark ? neutral[300] : neutral[700]}
                numberOfLines={2}
                style={styles.previewBody}
              >
                {t('preOnboarding.notificationPermission.preview.body')}
              </Text>
            </View>
          </View>
        </Animated.View>

        {/* Benefits Section */}
        <View style={styles.benefitsSection}>
          {[
            {
              icon: 'megaphone' as const,
              title: t('preOnboarding.notificationPermission.benefits.matchInvites.title'),
              description: t(
                'preOnboarding.notificationPermission.benefits.matchInvites.description'
              ),
            },
            {
              icon: 'flash' as const,
              title: t('preOnboarding.notificationPermission.benefits.matchAlerts.title'),
              description: t(
                'preOnboarding.notificationPermission.benefits.matchAlerts.description'
              ),
            },
            {
              icon: 'checkmark-done' as const,
              title: t('preOnboarding.notificationPermission.benefits.confirmations.title'),
              description: t(
                'preOnboarding.notificationPermission.benefits.confirmations.description'
              ),
            },
          ].map((benefit, index) => (
            <Animated.View
              key={benefit.icon}
              entering={FadeInDown.delay(150 + index * 80).springify()}
              style={styles.benefitRow}
            >
              <View
                style={[
                  styles.benefitIconContainer,
                  {
                    backgroundColor: isDark ? 'rgba(115, 115, 115, 0.18)' : neutral[100],
                  },
                ]}
              >
                <Ionicons
                  name={benefit.icon}
                  size={18}
                  color={isDark ? neutral[400] : neutral[500]}
                />
              </View>
              <View style={styles.benefitContent}>
                <Text size="base" weight="semibold" color={colors.foreground}>
                  {benefit.title}
                </Text>
                <Text size="sm" color={colors.textMuted} style={styles.benefitDescription}>
                  {benefit.description}
                </Text>
              </View>
            </Animated.View>
          ))}
        </View>
      </View>

      {/* Bottom Section (pinned) */}
      <Animated.View entering={FadeInUp.delay(400).springify()} style={styles.bottomSection}>
        <Button
          variant="primary"
          onPress={handleEnableNotifications}
          disabled={isRequesting}
          style={styles.enableButton}
        >
          {isRequesting ? t('common.loading') : t('preOnboarding.notificationPermission.enable')}
        </Button>

        <View style={styles.privacyContainer}>
          <Ionicons
            name="shield-checkmark"
            size={14}
            color={isDark ? primary[400] : primary[600]}
          />
          <Text size="xs" color={colors.textMuted} style={styles.privacyText}>
            {t('preOnboarding.notificationPermission.privacyNote')}
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  inner: {
    flex: 1,
    paddingHorizontal: spacingPixels[5],
  },

  // Header section
  headerSection: {
    paddingTop: spacingPixels[2],
    alignItems: 'center',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[3],
    ...shadowsNative.md,
    shadowColor: primary[500],
    shadowOpacity: 0.25,
  },
  title: {
    textAlign: 'center',
    marginBottom: spacingPixels[1],
  },
  subtitle: {
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: spacingPixels[2],
    paddingTop: spacingPixels[2],
  },

  // Mock iOS-style notification banner stack
  previewWrapper: {
    marginTop: spacingPixels[8],
    marginBottom: spacingPixels[4],
    paddingHorizontal: spacingPixels[1],
  },
  previewBackCard: {
    position: 'absolute',
    left: spacingPixels[5],
    right: spacingPixels[5],
    bottom: -16,
    height: 22,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  previewMiddleCard: {
    position: 'absolute',
    left: spacingPixels[3],
    right: spacingPixels[3],
    bottom: -8,
    height: 22,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  previewCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacingPixels[3],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 6,
  },
  previewIcon: {
    width: 38,
    height: 38,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewContent: {
    flex: 1,
    paddingTop: 1,
  },
  previewTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacingPixels[2],
    marginBottom: 2,
  },
  previewTitle: {
    flex: 1,
  },
  previewBody: {
    lineHeight: 16,
  },

  // Benefits section
  benefitsSection: {
    marginTop: spacingPixels[8],
    gap: spacingPixels[6],
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  benefitIconContainer: {
    width: 32,
    height: 32,
    borderRadius: radiusPixels.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[3],
  },
  benefitContent: {
    flex: 1,
  },
  benefitDescription: {
    marginTop: 2,
    lineHeight: 16,
  },

  // Privacy note
  privacyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacingPixels[5],
    paddingHorizontal: spacingPixels[8],
  },
  privacyText: {
    marginLeft: spacingPixels[2],
    textAlign: 'center',
    lineHeight: 18,
    flexShrink: 1,
  },

  // Bottom section (pinned outside scroll)
  bottomSection: {
    paddingHorizontal: spacingPixels[5],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[4],
    alignItems: 'center',
  },
  enableButton: {
    width: '100%',
  },
});

export default NotificationPermissionStep;
