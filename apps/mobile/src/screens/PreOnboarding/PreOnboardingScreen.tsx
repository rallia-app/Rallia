/**
 * PreOnboardingScreen - Multi-step wizard for first-time users
 *
 * Collects essential information before main app access:
 * 1. Sports selection (required)
 * 2. Postal code for location (required)
 * 3. Device location permission (skippable)
 * 4. Push notification permission (skippable)
 * 5. iOS only — App Tracking Transparency (ATT) permission (skippable)
 * 6. Discovery / acquisition channel (skippable) — step 5 on Android,
 *    step 6 on iOS
 *
 * On Android the ATT step is omitted entirely (Android doesn't have ATT)
 * so the wizard is 5 steps. Meta SDK tracking is enabled at app launch
 * via `initMeta()` for Android.
 *
 * Data is stored in AsyncStorage and synced to database after sign-up.
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Platform,
  View,
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { spacingPixels, primary, secondary, neutral } from '@rallia/design-system';
import { mediumHaptic } from '@rallia/shared-utils';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PostalCodeLocation } from '@rallia/shared-hooks';
import { SportService, Logger, makeFallbackSportId } from '@rallia/shared-services';
import type { Sport as DatabaseSport } from '@rallia/shared-types';

import { useThemeStyles } from '#/hooks';
import { useOverlay, useSport, useLocationMode } from '#/context';
import * as Analytics from '#/services/analytics';
import { ACQUISITION_CHANNEL_KEY } from '#/navigation/deepLinkStore';

import { SportStep, type Sport } from './SportStep';
import { PostalCodeStep } from './PostalCodeStep';
import { LocationPermissionStep } from './LocationPermissionStep';
import { NotificationPermissionStep } from './NotificationPermissionStep';
import { TrackingPermissionStep } from './TrackingPermissionStep';
import { DiscoveryStep } from './DiscoveryStep';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// iOS gets an extra step (ATT prompt) between NotificationPermission and
// Discovery. Android skips it entirely — Meta SDK tracking is enabled at
// launch since Android has no ATT equivalent.
const IS_IOS = Platform.OS === 'ios';
const TOTAL_STEPS = IS_IOS ? 6 : 5;
const ATT_STEP = 5 as const; // iOS only; slot between NotifPerm and Discovery
const DISCOVERY_STEP: 5 | 6 = IS_IOS ? 6 : 5;

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

export function PreOnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { isDark } = useThemeStyles();
  const { isSplashComplete, onSportSelectionComplete } = useOverlay();
  const { setSelectedSportsOrdered } = useSport();
  const { setLocationMode } = useLocationMode();

  // Wizard state — all persistent fields live here so each step can unmount
  // during navigation without losing user input.
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [selectedSports, setSelectedSports] = useState<Sport[]>([]);
  const [postalCode, setPostalCode] = useState('');
  const [geocodeResult, setGeocodeResult] = useState<PostalCodeLocation | null>(null);
  const [discoveryMode, setDiscoveryMode] = useState<'chips' | 'friendCode'>('chips');
  const [referralCode, setReferralCode] = useState('');

  // Sports catalog — render the local fallback immediately so step 1 has no
  // spinner, then reconcile fallback IDs with real DB IDs in the background.
  const FALLBACK_SPORTS = useMemo<Sport[]>(
    () => [
      { id: makeFallbackSportId('tennis'), name: 'tennis', display_name: 'Tennis' },
      { id: makeFallbackSportId('pickleball'), name: 'pickleball', display_name: 'Pickleball' },
    ],
    []
  );
  const [sports, setSports] = useState<Sport[]>(FALLBACK_SPORTS);
  // Pending catalog fetch — awaited by handleSportsContinue so we hand off
  // real sport IDs even if the user taps Continue before the fetch resolves.
  const sportsFetchRef = useRef<Promise<Sport[] | null> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchPromise = (async (): Promise<Sport[] | null> => {
      try {
        const { data, error } = await SportService.getAllSports();
        if (error || !data) {
          if (error) Logger.error('Failed to fetch sports for pre-onboarding', error as Error);
          return null;
        }
        return data
          .filter((s: DatabaseSport) => s.is_active)
          .map((s: DatabaseSport) => ({
            id: s.id,
            name: s.name,
            display_name: s.display_name,
            icon_url: s.icon_url,
          }));
      } catch (err) {
        Logger.error('Unexpected error fetching sports', err as Error);
        return null;
      }
    })();
    sportsFetchRef.current = fetchPromise;
    fetchPromise.then(real => {
      if (cancelled || !real) return;
      // Preserve fallback order so keyed Animated.Views don't reorder
      // mid-entering-animation (which leaves stuck translateY transforms
      // and causes cards to overlap).
      const byName = new Map(real.map(s => [s.name, s] as const));
      const ordered = [
        ...FALLBACK_SPORTS.map(f => byName.get(f.name) ?? f),
        ...real.filter(r => !FALLBACK_SPORTS.some(f => f.name === r.name)),
      ];
      setSports(ordered);
      // Swap fallback IDs for real IDs on anything the user already picked.
      setSelectedSports(prev => prev.map(picked => byName.get(picked.name) ?? picked));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Animation values
  // slideAnim is the horizontal pager offset: 0 for step 1, -SCREEN_WIDTH
  // for step 2, etc. All four steps live side-by-side in a row that's
  // SCREEN_WIDTH × 4 wide, so a single translateX animation moves between
  // them — no display toggling, no mid-animation state updates, no flash.
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

  // Animate step transitions — single translateX animation on the pager row.
  const animateToStep = useCallback(
    (newStep: WizardStep, _direction: 'forward' | 'back') => {
      setCurrentStep(newStep);
      Animated.timing(slideAnim, {
        toValue: -(newStep - 1) * SCREEN_WIDTH,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    },
    [slideAnim]
  );

  // Step 1: Sport selection complete
  const handleSportsContinue = useCallback(
    async (orderedSports: Sport[]) => {
      mediumHaptic();
      // If the catalog fetch is still in-flight, wait for it so we persist
      // real DB IDs instead of the fallback placeholders.
      const real = await (sportsFetchRef.current ?? Promise.resolve(null));
      const resolved = real
        ? orderedSports.map(picked => real.find(r => r.name === picked.name) ?? picked)
        : orderedSports;
      await setSelectedSportsOrdered(resolved);
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
    (_locationEnabled: boolean) => {
      mediumHaptic();
      animateToStep(4, 'forward');
    },
    [animateToStep]
  );

  // Step 4: Notification permission complete (or skipped). Next slot is
  // either TrackingPerm (iOS, step 5) or Discovery (Android, step 5).
  const handleNotificationContinue = useCallback(
    (_notificationsEnabled: boolean) => {
      mediumHaptic();
      animateToStep(5, 'forward');
    },
    [animateToStep]
  );

  // Step 5 (iOS only): Tracking permission resolved or skipped.
  const handleTrackingContinue = useCallback(
    (_trackingGranted: boolean) => {
      mediumHaptic();
      animateToStep(6, 'forward');
    },
    [animateToStep]
  );

  // Discovery channel selected (or skipped). Final step: 6 on iOS, 5 on Android.
  const handleDiscoveryContinue = useCallback(
    async (channel: string | null) => {
      if (channel) {
        await AsyncStorage.setItem(ACQUISITION_CHANNEL_KEY, channel);
        Analytics.acquisitionChannelSelected({ channel });
      }
      Analytics.preOnboardingCompleted({ sport_count: selectedSports.length });
      onSportSelectionComplete(selectedSports);
      await setLocationMode('home');
    },
    [selectedSports, onSportSelectionComplete, setLocationMode]
  );

  // Back navigation — universal (always go to currentStep - 1). Works on both
  // platforms because Android simply never reaches step 6.
  const handleBack = useCallback(() => {
    mediumHaptic();
    if (currentStep > 1) {
      animateToStep((currentStep - 1) as WizardStep, 'back');
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
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map(step => (
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

      {/* Step Content — horizontal pager. All steps render side-by-side and
          we slide the row via translateX. No display toggling, no
          mid-animation state changes, so no Android flash. The TrackingPerm
          slot is iOS-only; on Android the row has 5 slots instead of 6. */}
      <Animated.View style={[styles.stepViewport, { opacity: fadeAnim }]}>
        <Animated.View
          style={[
            styles.stepRow,
            { width: SCREEN_WIDTH * TOTAL_STEPS, transform: [{ translateX: slideAnim }] },
          ]}
        >
          <View style={styles.stepSlot}>
            <SportStep
              sports={sports}
              value={selectedSports}
              onChange={setSelectedSports}
              onContinue={handleSportsContinue}
              isActive={currentStep === 1}
            />
          </View>
          <View style={styles.stepSlot}>
            <PostalCodeStep
              postalCode={postalCode}
              onPostalCodeChange={setPostalCode}
              verifiedResult={geocodeResult}
              onVerifiedResultChange={setGeocodeResult}
              onContinue={handlePostalCodeContinue}
              isActive={currentStep === 2}
            />
          </View>
          <View style={styles.stepSlot}>
            <LocationPermissionStep
              onContinue={handleLocationContinue}
              isActive={currentStep === 3}
            />
          </View>
          <View style={styles.stepSlot}>
            <NotificationPermissionStep
              onContinue={handleNotificationContinue}
              primarySportName={selectedSports[0]?.name}
              isActive={currentStep === 4}
            />
          </View>
          {IS_IOS && (
            <View style={styles.stepSlot}>
              <TrackingPermissionStep
                onContinue={handleTrackingContinue}
                isActive={currentStep === ATT_STEP}
              />
            </View>
          )}
          <View style={styles.stepSlot}>
            <DiscoveryStep
              mode={discoveryMode}
              onModeChange={setDiscoveryMode}
              code={referralCode}
              onCodeChange={setReferralCode}
              onContinue={handleDiscoveryContinue}
              isActive={currentStep === DISCOVERY_STEP}
            />
          </View>
        </Animated.View>
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

  // Step container — horizontal pager.
  stepViewport: {
    flex: 1,
    overflow: 'hidden',
  },
  stepRow: {
    flex: 1,
    flexDirection: 'row',
    // width set inline based on platform (SCREEN_WIDTH * TOTAL_STEPS).
  },
  stepSlot: {
    width: SCREEN_WIDTH,
    height: '100%',
  },
});

export default PreOnboardingScreen;
