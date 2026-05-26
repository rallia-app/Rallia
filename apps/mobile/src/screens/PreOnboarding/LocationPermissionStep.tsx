/**
 * LocationPermissionStep - Third step of the pre-onboarding wizard
 *
 * Requests device location permission for precise distance calculations.
 * Persuasive UI with visual comparison to show the value of enabling location.
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
  status,
  shadowsNative,
} from '@rallia/design-system';
import { mediumHaptic } from '@rallia/shared-utils';

import { useThemeStyles, useTranslation, usePermissions } from '#/hooks';

interface LocationPermissionStepProps {
  /** Called when user enables location or skips */
  onContinue: (locationEnabled: boolean) => void;
  /** Whether the step is currently active */
  isActive?: boolean;
}

export function LocationPermissionStep({
  onContinue,
  isActive = true,
}: LocationPermissionStepProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { requestLocationPermission } = usePermissions();
  const [isRequesting, setIsRequesting] = useState(false);

  const handleEnableLocation = useCallback(async () => {
    if (isRequesting) return;

    setIsRequesting(true);
    mediumHaptic();

    try {
      const granted = await requestLocationPermission();
      onContinue(granted);
    } catch (error) {
      console.error('Failed to request location:', error);
      onContinue(false);
    } finally {
      setIsRequesting(false);
    }
  }, [isRequesting, requestLocationPermission, onContinue]);

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
              name="navigate-outline"
              size={36}
              color={isDark ? primary[200] : primary[600]}
            />
          </LinearGradient>

          <Text size="xl" weight="bold" color={colors.foreground} style={styles.title}>
            {t('preOnboarding.locationPermission.title')}
          </Text>

          <Text size="sm" color={colors.textMuted} style={styles.subtitle}>
            {t('preOnboarding.locationPermission.subtitle')}
          </Text>
        </Animated.View>

        {/* Visual Comparison Section */}
        <Animated.View
          entering={FadeInDown.delay(150).springify()}
          style={styles.comparisonSection}
        >
          {/* Without GPS */}
          <View style={styles.comparisonItem}>
            <View style={styles.comparisonHeader}>
              <Ionicons
                name="location-outline"
                size={16}
                color={isDark ? neutral[500] : neutral[400]}
              />
              <Text size="xs" weight="medium" color={isDark ? neutral[500] : neutral[400]}>
                {t('preOnboarding.locationPermission.comparison.without')}
              </Text>
            </View>
            <Text size="lg" weight="semibold" color={isDark ? neutral[400] : neutral[500]}>
              {t('preOnboarding.locationPermission.comparison.withoutExample')}
            </Text>
          </View>

          {/* Arrow */}
          <View style={styles.arrowContainer}>
            <Ionicons name="arrow-forward" size={20} color={isDark ? primary[400] : primary[600]} />
          </View>

          {/* With GPS */}
          <View style={styles.comparisonItem}>
            <View style={styles.comparisonHeader}>
              <Ionicons name="navigate" size={16} color={status.success.DEFAULT} />
              <Text size="xs" weight="medium" color={status.success.DEFAULT}>
                {t('preOnboarding.locationPermission.comparison.with')}
              </Text>
            </View>
            <Text size="lg" weight="bold" color={status.success.DEFAULT}>
              {t('preOnboarding.locationPermission.comparison.withExample')}
            </Text>
          </View>
        </Animated.View>

        {/* Benefits Section */}
        <View style={styles.benefitsSection}>
          {[
            {
              icon: 'speedometer' as const,
              title: t('preOnboarding.locationPermission.benefits.preciseDistance.title'),
              description: t(
                'preOnboarding.locationPermission.benefits.preciseDistance.description'
              ),
            },
            {
              icon: 'golf' as const,
              title: t('preOnboarding.locationPermission.benefits.closestCourts.title'),
              description: t('preOnboarding.locationPermission.benefits.closestCourts.description'),
            },
            {
              icon: 'notifications' as const,
              title: t('preOnboarding.locationPermission.benefits.nearbyAlerts.title'),
              description: t('preOnboarding.locationPermission.benefits.nearbyAlerts.description'),
            },
          ].map((benefit, index) => (
            <Animated.View
              key={benefit.icon}
              entering={FadeInDown.delay(250 + index * 80).springify()}
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
          onPress={handleEnableLocation}
          disabled={isRequesting}
          style={styles.enableButton}
        >
          {isRequesting ? t('common.loading') : t('preOnboarding.locationPermission.enable')}
        </Button>

        <View style={styles.privacyContainer}>
          <Ionicons
            name="shield-checkmark"
            size={14}
            color={isDark ? primary[400] : primary[600]}
          />
          <Text size="xs" color={colors.textMuted} style={styles.privacyText}>
            {t('preOnboarding.locationPermission.privacyNote')}
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

  // Comparison section
  comparisonSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacingPixels[8],
    gap: spacingPixels[2],
  },
  comparisonItem: {
    flex: 1,
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  comparisonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  arrowContainer: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Benefits section
  benefitsSection: {
    marginTop: spacingPixels[10],
    gap: spacingPixels[8],
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

export default LocationPermissionStep;
