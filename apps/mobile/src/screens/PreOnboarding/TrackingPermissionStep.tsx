/**
 * TrackingPermissionStep — Fifth step of the iOS pre-onboarding wizard.
 *
 * Persuasive pre-prompt screen that runs before Apple's system ATT
 * (App Tracking Transparency) dialog. The system prompt is one-shot per
 * install — if a user dismisses or denies it, you cannot re-prompt without
 * them going into iOS Settings manually. Industry benchmark: a custom
 * pre-prompt lifts ATT opt-in from ~25% (cold system prompt) to 40–50%
 * by self-selecting receptive users before the irreversible system call.
 *
 * Behavior:
 *   - "Allow tracking" → triggers Apple's system ATT prompt, then
 *     flips Meta SDK advertiser tracking ON for granted, OFF for denied.
 *   - "Not now" → skips without firing the system prompt, preserving
 *     the one-shot for a future opportunity (e.g. a Settings deep link
 *     in profile, added later).
 *
 * Android is handled at app launch in `initMeta()` — this step is only
 * rendered on iOS by PreOnboardingScreen.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { getTrackingPermissionsAsync } from 'expo-tracking-transparency';
import { Text, Button } from '@rallia/shared-components';
import {
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
  shadowsNative,
} from '@rallia/design-system';
import { mediumHaptic } from '@rallia/shared-utils';

import { useThemeStyles, useTranslation } from '#/hooks';
import * as Analytics from '#/services/analytics';
import { requestATTAndConfigureMeta } from '#/lib/meta';

interface TrackingPermissionStepProps {
  /** Called after the user resolves the ATT prompt (granted/denied) or skips. */
  onContinue: (trackingGranted: boolean) => void;
  /** Whether the step is currently active. */
  isActive?: boolean;
}

export function TrackingPermissionStep({
  onContinue,
  isActive: _isActive = true,
}: TrackingPermissionStepProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const [isRequesting, setIsRequesting] = useState(false);

  // Apple's ATT prompt is one-shot per install. If the user already answered
  // (granted/denied) on a previous run — common after a reinstall scenario
  // or if iOS Settings has been used to reset Rallia's ATT decision — the
  // system dialog will silently no-op when we call it. Showing the pre-prompt
  // in that case is confusing UX (the "Allow Tracking" button does nothing
  // visible). So we auto-onContinue when status is already determined, and
  // only render the pre-prompt UI when status is 'undetermined'.
  const hasAutoContinuedRef = useRef(false);
  useEffect(() => {
    if (hasAutoContinuedRef.current) return;
    let cancelled = false;
    getTrackingPermissionsAsync()
      .then(({ status }) => {
        if (cancelled || hasAutoContinuedRef.current) return;
        if (status === 'undetermined') return; // show pre-prompt as usual
        hasAutoContinuedRef.current = true;
        Analytics.trackingPermissionResult({
          granted: status === 'granted',
          skipped: true, // didn't show our pre-prompt; system already answered
          source: 'pre_onboarding',
        });
        onContinue(status === 'granted');
      })
      .catch(() => {
        // Non-iOS or API unavailable — fall through to render the pre-prompt;
        // the button handler is defensive enough to handle either case.
      });
    return () => {
      cancelled = true;
    };
  }, [onContinue]);

  const handleAllowTracking = useCallback(async () => {
    if (isRequesting) return;
    setIsRequesting(true);
    mediumHaptic();
    try {
      const result = await requestATTAndConfigureMeta();
      const granted = result === 'granted';
      Analytics.trackingPermissionResult({
        granted,
        skipped: false,
        source: 'pre_onboarding',
      });
      onContinue(granted);
    } catch (error) {
      console.error('Failed to request ATT:', error);
      Analytics.trackingPermissionResult({
        granted: false,
        skipped: false,
        source: 'pre_onboarding',
      });
      onContinue(false);
    } finally {
      setIsRequesting(false);
    }
  }, [isRequesting, onContinue]);

  const handleSkip = useCallback(() => {
    if (isRequesting) return;
    mediumHaptic();
    // Deliberately do NOT call the ATT API — we want to preserve the
    // one-shot system prompt for a later, better moment.
    Analytics.trackingPermissionResult({
      granted: false,
      skipped: true,
      source: 'pre_onboarding',
    });
    onContinue(false);
  }, [isRequesting, onContinue]);

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
              name="shield-checkmark-outline"
              size={36}
              color={isDark ? primary[200] : primary[600]}
            />
          </LinearGradient>

          <Text size="xl" weight="bold" color={colors.foreground} style={styles.title}>
            {t('preOnboarding.trackingPermission.title')}
          </Text>

          <Text size="sm" color={colors.textMuted} style={styles.subtitle}>
            {t('preOnboarding.trackingPermission.subtitle')}
          </Text>
        </Animated.View>

        {/* Benefits Section */}
        <View style={styles.benefitsSection}>
          {[
            {
              icon: 'sparkles' as const,
              title: t('preOnboarding.trackingPermission.benefits.betterMatches.title'),
              description: t('preOnboarding.trackingPermission.benefits.betterMatches.description'),
            },
            {
              icon: 'trending-up' as const,
              title: t('preOnboarding.trackingPermission.benefits.improveApp.title'),
              description: t('preOnboarding.trackingPermission.benefits.improveApp.description'),
            },
            {
              icon: 'lock-closed' as const,
              title: t('preOnboarding.trackingPermission.benefits.privacy.title'),
              description: t('preOnboarding.trackingPermission.benefits.privacy.description'),
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
          onPress={handleAllowTracking}
          disabled={isRequesting}
          style={styles.enableButton}
        >
          {isRequesting ? t('common.loading') : t('preOnboarding.trackingPermission.enable')}
        </Button>

        <Button
          variant="ghost"
          onPress={handleSkip}
          disabled={isRequesting}
          style={styles.skipButton}
        >
          {t('preOnboarding.trackingPermission.skip')}
        </Button>

        <View style={styles.privacyContainer}>
          <Ionicons
            name="shield-checkmark"
            size={14}
            color={isDark ? primary[400] : primary[600]}
          />
          <Text size="xs" color={colors.textMuted} style={styles.privacyText}>
            {t('preOnboarding.trackingPermission.privacyNote')}
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
    marginTop: spacingPixels[4],
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
  skipButton: {
    width: '100%',
    marginTop: spacingPixels[2],
  },
});

export default TrackingPermissionStep;
