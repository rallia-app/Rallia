import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { useSharedValue, withTiming, useAnimatedStyle } from 'react-native-reanimated';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { useThemeStyles, useTranslation } from '../../../hooks';

interface ProgressIndicatorProps {
  currentStep: number;
  totalSteps: number;
  stepName?: string;
}

/**
 * Progress indicator for onboarding and sport setup flows.
 * Shows step counter, optional step name, and animated progress bar.
 * Matches the OnboardingWizard ProgressBar styling.
 * Note: Returns null if currentStep is 0 (permission overlays).
 */
const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({
  currentStep,
  totalSteps,
  stepName,
}) => {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const progress = useSharedValue((currentStep / totalSteps) * 100);

  useEffect(() => {
    progress.value = withTiming((currentStep / totalSteps) * 100, { duration: 300 });
  }, [currentStep, totalSteps, progress]);

  const animatedProgressStyle = useAnimatedStyle(() => ({
    width: `${progress.value}%`,
  }));

  // Don't show progress indicator for permission overlays (currentStep = 0)
  if (currentStep === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text size="sm" weight="semibold" color={colors.textMuted}>
          {t('onboarding.step')
            .replace('{current}', String(currentStep))
            .replace('{total}', String(totalSteps))}
        </Text>
        {stepName && (
          <Text size="sm" weight="bold" color={colors.progressActive}>
            {stepName}
          </Text>
        )}
      </View>
      <View style={[styles.progressBarBg, { backgroundColor: colors.progressInactive }]}>
        <Animated.View
          style={[
            styles.progressBarFill,
            { backgroundColor: colors.progressActive },
            animatedProgressStyle,
          ]}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacingPixels[2],
  },
  progressBarBg: {
    height: 4,
    borderRadius: radiusPixels.full,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: radiusPixels.full,
  },
});

export default ProgressIndicator;
