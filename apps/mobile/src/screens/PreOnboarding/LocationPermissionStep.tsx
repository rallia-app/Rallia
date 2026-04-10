/**
 * LocationPermissionStep - Third step of the pre-onboarding wizard
 *
 * Requests device location permission for precise distance calculations.
 * Persuasive UI with visual comparison to show the value of enabling location.
 */

import React, { useCallback, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, neutral, status } from '@rallia/design-system';
import { mediumHaptic } from '@rallia/shared-utils';
import { useThemeStyles, useTranslation, usePermissions } from '../../hooks';

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

  if (!isActive) return null;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.inner}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header Section */}
        <Animated.View entering={FadeInDown.delay(50).springify()} style={styles.headerSection}>
          <View
            style={[
              styles.iconContainer,
              { backgroundColor: isDark ? 'rgba(59, 130, 246, 0.15)' : 'rgba(59, 130, 246, 0.1)' },
            ]}
          >
            <Ionicons
              name="navigate-outline"
              size={36}
              color={isDark ? primary[400] : primary[600]}
            />
          </View>

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
          <View
            style={[
              styles.comparisonCard,
              styles.comparisonCardDisabled,
              {
                backgroundColor: isDark ? neutral[800] : neutral[100],
                borderColor: isDark ? neutral[700] : neutral[200],
              },
            ]}
          >
            <View style={styles.comparisonHeader}>
              <Ionicons
                name="location-outline"
                size={18}
                color={isDark ? neutral[500] : neutral[400]}
              />
              <Text size="xs" weight="medium" color={isDark ? neutral[500] : neutral[400]}>
                {t('preOnboarding.locationPermission.comparison.without')}
              </Text>
            </View>
            <View style={styles.comparisonContent}>
              <Text size="lg" weight="semibold" color={isDark ? neutral[400] : neutral[500]}>
                {t('preOnboarding.locationPermission.comparison.withoutExample')}
              </Text>
            </View>
          </View>

          {/* Arrow */}
          <View style={styles.arrowContainer}>
            <Ionicons name="arrow-forward" size={20} color={isDark ? primary[400] : primary[600]} />
          </View>

          {/* With GPS */}
          <View
            style={[
              styles.comparisonCard,
              {
                backgroundColor: isDark ? 'rgba(34, 197, 94, 0.1)' : 'rgba(34, 197, 94, 0.08)',
                borderColor: isDark ? status.success.DEFAULT : status.success.light,
              },
            ]}
          >
            <View style={styles.comparisonHeader}>
              <Ionicons name="navigate" size={18} color={status.success.DEFAULT} />
              <Text size="xs" weight="medium" color={status.success.DEFAULT}>
                {t('preOnboarding.locationPermission.comparison.with')}
              </Text>
            </View>
            <View style={styles.comparisonContent}>
              <Text size="lg" weight="bold" color={status.success.DEFAULT}>
                {t('preOnboarding.locationPermission.comparison.withExample')}
              </Text>
            </View>
          </View>
        </Animated.View>

        {/* Benefits Section */}
        <View style={styles.benefitsSection}>
          {[
            {
              icon: 'speedometer' as const,
              title: t('preOnboarding.locationPermission.benefits.item1'),
              highlight: true,
            },
            {
              icon: 'golf' as const,
              title: t('preOnboarding.locationPermission.benefits.item2'),
              highlight: false,
            },
            {
              icon: 'notifications' as const,
              title: t('preOnboarding.locationPermission.benefits.item3'),
              highlight: false,
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
                    backgroundColor: benefit.highlight
                      ? isDark
                        ? 'rgba(34, 197, 94, 0.15)'
                        : 'rgba(34, 197, 94, 0.1)'
                      : isDark
                        ? neutral[800]
                        : neutral[100],
                  },
                ]}
              >
                <Ionicons
                  name={benefit.icon}
                  size={18}
                  color={
                    benefit.highlight
                      ? status.success.DEFAULT
                      : isDark
                        ? neutral[400]
                        : neutral[500]
                  }
                />
              </View>
              <Text
                size="sm"
                color={isDark ? neutral[300] : neutral[600]}
                style={styles.benefitText}
              >
                {benefit.title}
              </Text>
            </Animated.View>
          ))}
        </View>

        {/* Privacy Note */}
        <Animated.View
          entering={FadeInUp.delay(500).springify()}
          style={[
            styles.privacyContainer,
            {
              backgroundColor: isDark ? neutral[800] : neutral[50],
              borderColor: isDark ? neutral[700] : neutral[100],
            },
          ]}
        >
          <Ionicons
            name="shield-checkmark"
            size={16}
            color={isDark ? primary[400] : primary[600]}
          />
          <Text size="xs" color={colors.textMuted} style={styles.privacyText}>
            {t('preOnboarding.locationPermission.privacyNote')}
          </Text>
        </Animated.View>

        {/* Bottom Section */}
        <Animated.View entering={FadeInUp.delay(400).springify()} style={styles.bottomSection}>
          <Button
            variant="primary"
            onPress={handleEnableLocation}
            disabled={isRequesting}
            style={styles.enableButton}
          >
            {isRequesting ? t('common.loading') : t('preOnboarding.locationPermission.enable')}
          </Button>

          <Text size="xs" color={colors.textMuted} style={styles.settingsHint}>
            {t('preOnboarding.locationPermission.settingsHint')}
          </Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  inner: {
    flexGrow: 1,
    paddingHorizontal: spacingPixels[5],
    justifyContent: 'space-between',
    paddingBottom: spacingPixels[4],
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
    marginTop: spacingPixels[4],
    gap: spacingPixels[2],
  },
  comparisonCard: {
    flex: 1,
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1.5,
  },
  comparisonCardDisabled: {
    opacity: 0.85,
  },
  comparisonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    marginBottom: spacingPixels[1],
  },
  comparisonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  comparisonIcon: {
    marginLeft: spacingPixels[1],
  },
  arrowContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Benefits section
  benefitsSection: {
    marginTop: spacingPixels[4],
    gap: spacingPixels[2],
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
  benefitText: {
    flex: 1,
    lineHeight: 20,
  },

  // Privacy note
  privacyContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginTop: spacingPixels[4],
  },
  privacyText: {
    marginLeft: spacingPixels[2],
    flex: 1,
    lineHeight: 18,
  },

  // Bottom section
  bottomSection: {
    paddingTop: spacingPixels[4],
    alignItems: 'center',
  },
  enableButton: {
    width: '100%',
  },
  settingsHint: {
    marginTop: spacingPixels[4],
    textAlign: 'center',
  },
});

export default LocationPermissionStep;
