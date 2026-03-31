/**
 * PreOnboardingScreen - Multi-step wizard for first-time users
 *
 * Collects essential information before main app access:
 * 1. Sports selection (required)
 * 2. Postal code for location (required)
 * 3. Device location permission (skippable)
 *
 * Data is stored in AsyncStorage and synced to database after sign-up.
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing, Dimensions, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { spacingPixels, primary, secondary, neutral } from '@rallia/design-system';
import { mediumHaptic } from '@rallia/shared-utils';
import { useThemeStyles } from '../../hooks';
import { useOverlay, useSport, useLocationMode } from '../../context';
import { SportStep, type Sport } from './SportStep';
import { PostalCodeStep } from './PostalCodeStep';
import { LocationPermissionStep } from './LocationPermissionStep';
import * as Analytics from '../../services/analytics';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

type WizardStep = 1 | 2 | 3;

export function PreOnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { isDark } = useThemeStyles();
  const { isSplashComplete, onSportSelectionComplete } = useOverlay();
  const { setSelectedSportsOrdered } = useSport();
  const { setLocationMode } = useLocationMode();

  // Wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [selectedSports, setSelectedSports] = useState<Sport[]>([]);

  // Animation values
  const slideAnim = useMemo(() => new Animated.Value(0), []);
  const fadeAnim = useMemo(() => new Animated.Value(0), []);

  // Background decoration animations
  const circle1Scale = useMemo(() => new Animated.Value(0.8), []);
  const circle1Opacity = useMemo(() => new Animated.Value(0), []);
  const circle2Scale = useMemo(() => new Animated.Value(0.8), []);
  const circle2Opacity = useMemo(() => new Animated.Value(0), []);
  const decorOpacity = useMemo(() => new Animated.Value(0), []);

  // Track if we've animated entrance
  const hasAnimated = useRef(false);

  // Entrance animation
  useEffect(() => {
    if (isSplashComplete && !hasAnimated.current) {
      hasAnimated.current = true;

      // Reset animation values
      fadeAnim.setValue(0);
      circle1Opacity.setValue(0);
      circle1Scale.setValue(0.8);
      circle2Opacity.setValue(0);
      circle2Scale.setValue(0.8);
      decorOpacity.setValue(0);

      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 400,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(circle1Opacity, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.spring(circle1Scale, {
          toValue: 1,
          tension: 40,
          friction: 8,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.delay(100),
          Animated.parallel([
            Animated.timing(circle2Opacity, {
              toValue: 1,
              duration: 600,
              useNativeDriver: true,
            }),
            Animated.spring(circle2Scale, {
              toValue: 1,
              tension: 35,
              friction: 8,
              useNativeDriver: true,
            }),
          ]),
        ]),
        Animated.timing(decorOpacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [
    isSplashComplete,
    fadeAnim,
    circle1Opacity,
    circle1Scale,
    circle2Opacity,
    circle2Scale,
    decorOpacity,
  ]);

  // Animate step transitions
  const animateToStep = useCallback(
    (newStep: WizardStep, direction: 'forward' | 'back') => {
      const toValue = direction === 'forward' ? -SCREEN_WIDTH : SCREEN_WIDTH;

      Animated.sequence([
        Animated.timing(slideAnim, {
          toValue: toValue,
          duration: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]).start();

      // Update step after animation starts
      setTimeout(() => setCurrentStep(newStep), 100);
    },
    [slideAnim]
  );

  // Step 1: Sport selection complete
  const handleSportsContinue = useCallback(
    async (orderedSports: Sport[]) => {
      mediumHaptic();
      setSelectedSports(orderedSports);
      await setSelectedSportsOrdered(orderedSports);
      animateToStep(2, 'forward');
    },
    [setSelectedSportsOrdered, animateToStep]
  );

  // Step 2: Postal code complete
  const handlePostalCodeContinue = useCallback(() => {
    mediumHaptic();
    animateToStep(3, 'forward');
  }, [animateToStep]);

  // Step 3: Location permission complete (or skipped)
  const handleLocationContinue = useCallback(
    async (_locationEnabled: boolean) => {
      mediumHaptic();
      Analytics.preOnboardingCompleted({ sport_count: selectedSports.length });
      // Complete the pre-onboarding flow
      onSportSelectionComplete(selectedSports);
      // Set location mode to home so effective location uses the home location
      // that was just collected in step 2
      await setLocationMode('home');
    },
    [selectedSports, onSportSelectionComplete, setLocationMode]
  );

  // Back navigation
  const handleBack = useCallback(() => {
    mediumHaptic();
    if (currentStep === 2) {
      animateToStep(1, 'back');
    } else if (currentStep === 3) {
      animateToStep(2, 'back');
    }
  }, [currentStep, animateToStep]);

  // Background colors for gradient
  const gradientColors = isDark
    ? [neutral[900], neutral[950], neutral[950]]
    : [primary[50], '#ffffff', '#ffffff'];

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + spacingPixels[4], paddingBottom: insets.bottom },
      ]}
    >
      {/* Gradient Background */}
      <LinearGradient
        colors={gradientColors as [string, string, ...string[]]}
        style={StyleSheet.absoluteFillObject}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />

      {/* Decorative Background Circles */}
      <Animated.View
        style={[
          styles.decorCircle1,
          {
            backgroundColor: isDark ? primary[900] : primary[100],
            opacity: circle1Opacity,
            transform: [{ scale: circle1Scale }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.decorCircle2,
          {
            backgroundColor: isDark ? secondary[900] : secondary[100],
            opacity: circle2Opacity,
            transform: [{ scale: circle2Scale }],
          },
        ]}
      />

      {/* Decorative dots pattern */}
      <Animated.View style={[styles.decorPattern, { opacity: decorOpacity }]}>
        {[...Array(6)].map((_, i) => (
          <View
            key={i}
            style={[
              styles.decorDot,
              {
                backgroundColor: isDark ? primary[700] : primary[300],
                left: 30 + (i % 3) * 25,
                top: 20 + Math.floor(i / 3) * 25,
                opacity: 0.3 + i * 0.1,
              },
            ]}
          />
        ))}
      </Animated.View>

      {/* Progress Indicator & Back Button */}
      <Animated.View style={[styles.header, { opacity: fadeAnim }]}>
        {currentStep > 1 ? (
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <Ionicons
              name="chevron-back-outline"
              size={24}
              color={isDark ? neutral[300] : neutral[600]}
            />
          </TouchableOpacity>
        ) : (
          <View style={styles.backButtonPlaceholder} />
        )}

        <View style={styles.progressContainer}>
          {[1, 2, 3].map(step => (
            <View
              key={step}
              style={[
                styles.progressDot,
                {
                  backgroundColor:
                    step <= currentStep ? primary[500] : isDark ? neutral[700] : neutral[200],
                },
                step === currentStep && styles.progressDotActive,
              ]}
            />
          ))}
        </View>

        <View style={styles.backButtonPlaceholder} />
      </Animated.View>

      {/* Step Content */}
      <Animated.View
        style={[
          styles.stepContainer,
          {
            opacity: fadeAnim,
            transform: [{ translateX: slideAnim }],
          },
        ]}
      >
        {currentStep === 1 && (
          <SportStep onContinue={handleSportsContinue} isActive={currentStep === 1} />
        )}
        {currentStep === 2 && (
          <PostalCodeStep onContinue={handlePostalCodeContinue} isActive={currentStep === 2} />
        )}
        {currentStep === 3 && (
          <LocationPermissionStep
            onContinue={handleLocationContinue}
            isActive={currentStep === 3}
          />
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  // Decorative elements
  decorCircle1: {
    position: 'absolute',
    width: SCREEN_WIDTH * 1.2,
    height: SCREEN_WIDTH * 1.2,
    borderRadius: (SCREEN_WIDTH * 1.2) / 2,
    top: -SCREEN_WIDTH * 0.6,
    right: -SCREEN_WIDTH * 0.3,
    opacity: 0.4,
  },
  decorCircle2: {
    position: 'absolute',
    width: SCREEN_WIDTH * 0.8,
    height: SCREEN_WIDTH * 0.8,
    borderRadius: (SCREEN_WIDTH * 0.8) / 2,
    bottom: -SCREEN_WIDTH * 0.2,
    left: -SCREEN_WIDTH * 0.3,
    opacity: 0.3,
  },
  decorPattern: {
    position: 'absolute',
    top: SCREEN_HEIGHT * 0.12,
    right: spacingPixels[4],
    width: 80,
    height: 60,
  },
  decorDot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  // Header with progress
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[2],
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonPlaceholder: {
    width: 40,
    height: 40,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  progressDotActive: {
    width: 24,
    borderRadius: 4,
  },

  // Step container
  stepContainer: {
    flex: 1,
  },
});

export default PreOnboardingScreen;
