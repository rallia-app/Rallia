/**
 * SuccessStep Component
 *
 * Final success screen of onboarding - animated celebration.
 * Shows after completing all onboarding steps.
 * Automatically selects the initial sport:
 * - If the current sport is still selected, keep it
 * - Otherwise, switch to the first sport from the selection
 */

import React, { useEffect, useRef } from 'react';
import { StyleSheet, TouchableOpacity, ScrollView, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withDelay,
} from 'react-native-reanimated';
import LottieView from 'lottie-react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';

const BASE_WHITE = '#ffffff';
import type { TranslationKey } from '@rallia/shared-translations';

interface ThemeColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  buttonActive: string;
  buttonInactive: string;
  buttonTextActive: string;
  success: string;
}

export interface Sport {
  id: string;
  name: string;
  display_name: string;
  icon_url?: string | null;
}

interface SuccessStepProps {
  onComplete: () => void;
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
  isDark: boolean;
  selectedSports: Sport[];
  currentSport: Sport | null;
  onSelectInitialSport: (sport: Sport) => void | Promise<void>;
}

export const SuccessStep: React.FC<SuccessStepProps> = ({
  onComplete,
  colors,
  t,
  selectedSports,
  currentSport,
  onSelectInitialSport,
}) => {
  // Track if we've already auto-selected to prevent repeated calls
  const hasAutoSelected = useRef(false);

  // Auto-select initial sport based on current selection
  useEffect(() => {
    if (hasAutoSelected.current || selectedSports.length === 0) return;

    // Check if current sport is still in the selected sports
    const currentStillSelected = currentSport && selectedSports.some(s => s.id === currentSport.id);

    if (currentStillSelected) {
      // Keep the current sport
      onSelectInitialSport(currentSport);
    } else {
      // Switch to the first sport from the selection
      onSelectInitialSport(selectedSports[0]);
    }

    hasAutoSelected.current = true;
  }, [selectedSports, currentSport, onSelectInitialSport]);

  // Animation values
  const iconScale = useSharedValue(0);
  const iconOpacity = useSharedValue(0);
  const textOpacity = useSharedValue(0);
  const buttonOpacity = useSharedValue(0);
  const buttonTranslateY = useSharedValue(20);

  // Trigger animations on mount
  useEffect(() => {
    // Icon animation - pop in with bounce
    iconScale.value = withDelay(200, withSpring(1, { damping: 40, stiffness: 300 }));
    iconOpacity.value = withDelay(200, withTiming(1, { duration: 300 }));

    // Text animation - fade in
    textOpacity.value = withDelay(500, withTiming(1, { duration: 400 }));

    // Button animation - slide up and fade in
    buttonOpacity.value = withDelay(800, withTiming(1, { duration: 400 }));
    buttonTranslateY.value = withDelay(800, withSpring(0, { damping: 40, stiffness: 300 }));
  }, [iconScale, iconOpacity, textOpacity, buttonOpacity, buttonTranslateY]);

  const iconAnimatedStyle = useAnimatedStyle(() => ({
    opacity: iconOpacity.value,
    transform: [{ scale: iconScale.value }],
  }));

  const textAnimatedStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
  }));

  const buttonAnimatedStyle = useAnimatedStyle(() => ({
    opacity: buttonOpacity.value,
    transform: [{ translateY: buttonTranslateY.value }],
  }));

  return (
    <View style={styles.wrapper}>
      {/* Confetti Animation Overlay */}
      <View style={styles.confetti} pointerEvents="none">
        <LottieView
          source={require('../../../../../../assets/animations/confetti.json')}
          autoPlay
          loop={false}
          speed={0.8}
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
        />
      </View>

      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        {/* Success Icon */}
        <Animated.View
          style={[
            styles.iconContainer,
            { backgroundColor: colors.buttonActive },
            iconAnimatedStyle,
          ]}
        >
          <Ionicons name="checkmark-outline" size={48} color={BASE_WHITE} />
        </Animated.View>

        {/* Success Text */}
        <Animated.View style={textAnimatedStyle}>
          <Text size="xl" weight="bold" color={colors.text} style={styles.title}>
            {t('onboarding.success.title')}
          </Text>
          <Text size="base" color={colors.textMuted} style={styles.subtitle}>
            {t('onboarding.success.subtitle')}
          </Text>
        </Animated.View>

        {/* Continue Button */}
        <Animated.View style={[styles.buttonContainer, buttonAnimatedStyle]}>
          <TouchableOpacity
            style={[styles.continueButton, { backgroundColor: colors.buttonActive }]}
            onPress={onComplete}
            activeOpacity={0.8}
          >
            <Text size="base" weight="semibold" color={colors.buttonTextActive}>
              {t('onboarding.success.getStarted')}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  confetti: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  scrollContainer: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[6],
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[4],
  },
  title: {
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[6],
  },
  buttonContainer: {
    width: '100%',
  },
  continueButton: {
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    alignItems: 'center',
  },
});

export default SuccessStep;
