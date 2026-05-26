/**
 * SportSelectionScreen - First-time sport selection screen
 *
 * Shows after the splash animation for first-time users to select their
 * preferred sports. Tracks selection order so the first-selected sport
 * becomes the default view in the app.
 *
 * This is a proper navigation screen (not an overlay) that blocks access
 * to the main app until sport selection is complete.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Image,
  Animated,
  Easing,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Text, Spinner, Button } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, secondary, neutral } from '@rallia/design-system';
import { SportService, Logger } from '@rallia/shared-services';
import { selectionHaptic, mediumHaptic } from '@rallia/shared-utils';
import type { Sport as DatabaseSport } from '@rallia/shared-types';

import { useThemeStyles, useTranslation } from '#/hooks';
import { useOverlay, useSport } from '#/context';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BASE_WHITE = '#ffffff';

// Simplified Sport type for this component
interface Sport {
  id: string;
  name: string;
  display_name: string;
  icon_url?: string | null;
}

export function SportSelectionScreen() {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { isSplashComplete, onSportSelectionComplete } = useOverlay();
  const { setSelectedSportsOrdered } = useSport();

  // State
  const [sports, setSports] = useState<Sport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [orderedSelection, setOrderedSelection] = useState<Sport[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Background decoration animations
  const circle1Scale = useMemo(() => new Animated.Value(0.8), []);
  const circle1Opacity = useMemo(() => new Animated.Value(0), []);
  const circle2Scale = useMemo(() => new Animated.Value(0.8), []);
  const circle2Opacity = useMemo(() => new Animated.Value(0), []);
  const decorOpacity = useMemo(() => new Animated.Value(0), []);

  // Content animations
  const welcomeOpacity = useMemo(() => new Animated.Value(0), []);
  const welcomeTranslateY = useMemo(() => new Animated.Value(30), []);
  const titleOpacity = useMemo(() => new Animated.Value(0), []);
  const titleTranslateY = useMemo(() => new Animated.Value(20), []);
  const subtitleOpacity = useMemo(() => new Animated.Value(0), []);

  // Card animations
  const card1Opacity = useMemo(() => new Animated.Value(0), []);
  const card1TranslateY = useMemo(() => new Animated.Value(40), []);
  const card1Scale = useMemo(() => new Animated.Value(0.95), []);
  const card2Opacity = useMemo(() => new Animated.Value(0), []);
  const card2TranslateY = useMemo(() => new Animated.Value(40), []);
  const card2Scale = useMemo(() => new Animated.Value(0.95), []);

  // Button animation
  const buttonOpacity = useMemo(() => new Animated.Value(0), []);
  const buttonTranslateY = useMemo(() => new Animated.Value(20), []);

  // Fetch sports on mount
  useEffect(() => {
    const fetchSports = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await SportService.getAllSports();

        if (error) {
          Logger.error('Failed to fetch sports for selection screen', error as Error);
          // Fallback sports
          setSports([
            { id: 'tennis-fallback', name: 'tennis', display_name: 'Tennis' },
            { id: 'pickleball-fallback', name: 'pickleball', display_name: 'Pickleball' },
          ]);
        } else if (data) {
          const activeSports: Sport[] = data
            .filter((sport: DatabaseSport) => sport.is_active)
            .map((sport: DatabaseSport) => ({
              id: sport.id,
              name: sport.name,
              display_name: sport.display_name,
              icon_url: sport.icon_url,
            }));
          setSports(activeSports);
        }
      } catch (error) {
        Logger.error('Unexpected error fetching sports', error as Error);
        setSports([
          { id: 'tennis-fallback', name: 'tennis', display_name: 'Tennis' },
          { id: 'pickleball-fallback', name: 'pickleball', display_name: 'Pickleball' },
        ]);
      }
      setIsLoading(false);
    };

    fetchSports();
  }, []);

  // Track if we've already run the entrance animation
  const hasAnimated = useRef(false);

  // Entrance animation - starts when splash fades and sports are loaded
  useEffect(() => {
    if (isSplashComplete && !isLoading && sports.length > 0 && !hasAnimated.current) {
      hasAnimated.current = true;

      // Reset all animation values
      circle1Opacity.setValue(0);
      circle1Scale.setValue(0.8);
      circle2Opacity.setValue(0);
      circle2Scale.setValue(0.8);
      decorOpacity.setValue(0);
      welcomeOpacity.setValue(0);
      welcomeTranslateY.setValue(30);
      titleOpacity.setValue(0);
      titleTranslateY.setValue(20);
      subtitleOpacity.setValue(0);
      card1Opacity.setValue(0);
      card1TranslateY.setValue(40);
      card1Scale.setValue(0.95);
      card2Opacity.setValue(0);
      card2TranslateY.setValue(40);
      card2Scale.setValue(0.95);
      buttonOpacity.setValue(0);
      buttonTranslateY.setValue(20);

      // Orchestrated entrance animation
      Animated.parallel([
        // Background decorations fade in first
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

        // Welcome text - slight delay for impact
        Animated.sequence([
          Animated.delay(200),
          Animated.parallel([
            Animated.timing(welcomeOpacity, {
              toValue: 1,
              duration: 400,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.spring(welcomeTranslateY, {
              toValue: 0,
              tension: 60,
              friction: 10,
              useNativeDriver: true,
            }),
          ]),
        ]),

        // Title follows welcome
        Animated.sequence([
          Animated.delay(350),
          Animated.parallel([
            Animated.timing(titleOpacity, {
              toValue: 1,
              duration: 350,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.spring(titleTranslateY, {
              toValue: 0,
              tension: 70,
              friction: 10,
              useNativeDriver: true,
            }),
          ]),
        ]),

        // Subtitle
        Animated.sequence([
          Animated.delay(450),
          Animated.timing(subtitleOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]),

        // Cards with spring bounce
        Animated.sequence([
          Animated.delay(550),
          Animated.parallel([
            Animated.timing(card1Opacity, {
              toValue: 1,
              duration: 350,
              useNativeDriver: true,
            }),
            Animated.spring(card1TranslateY, {
              toValue: 0,
              tension: 65,
              friction: 9,
              useNativeDriver: true,
            }),
            Animated.spring(card1Scale, {
              toValue: 1,
              tension: 80,
              friction: 8,
              useNativeDriver: true,
            }),
          ]),
        ]),
        Animated.sequence([
          Animated.delay(680),
          Animated.parallel([
            Animated.timing(card2Opacity, {
              toValue: 1,
              duration: 350,
              useNativeDriver: true,
            }),
            Animated.spring(card2TranslateY, {
              toValue: 0,
              tension: 65,
              friction: 9,
              useNativeDriver: true,
            }),
            Animated.spring(card2Scale, {
              toValue: 1,
              tension: 80,
              friction: 8,
              useNativeDriver: true,
            }),
          ]),
        ]),

        // Button last
        Animated.sequence([
          Animated.delay(850),
          Animated.parallel([
            Animated.timing(buttonOpacity, {
              toValue: 1,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.spring(buttonTranslateY, {
              toValue: 0,
              tension: 80,
              friction: 10,
              useNativeDriver: true,
            }),
          ]),
        ]),
      ]).start();
    }
  }, [
    isSplashComplete,
    isLoading,
    sports.length,
    circle1Opacity,
    circle1Scale,
    circle2Opacity,
    circle2Scale,
    decorOpacity,
    welcomeOpacity,
    welcomeTranslateY,
    titleOpacity,
    titleTranslateY,
    subtitleOpacity,
    card1Opacity,
    card1TranslateY,
    card1Scale,
    card2Opacity,
    card2TranslateY,
    card2Scale,
    buttonOpacity,
    buttonTranslateY,
  ]);

  const toggleSport = useCallback((sport: Sport) => {
    selectionHaptic();

    setOrderedSelection(prev => {
      const existingIndex = prev.findIndex(s => s.id === sport.id);
      if (existingIndex >= 0) {
        // Remove from selection
        return prev.filter(s => s.id !== sport.id);
      } else {
        // Add to selection (order matters)
        return [...prev, sport];
      }
    });
  }, []);

  const handleContinue = useCallback(async () => {
    if (orderedSelection.length === 0 || isSubmitting) return;

    setIsSubmitting(true);
    mediumHaptic();

    // Update SportContext with the ordered selection
    await setSelectedSportsOrdered(orderedSelection);
    // Notify OverlayContext that selection is complete
    onSportSelectionComplete(orderedSelection);
  }, [orderedSelection, isSubmitting, setSelectedSportsOrdered, onSportSelectionComplete]);

  const getSportImage = (sportName: string) => {
    const lowerName = sportName.toLowerCase();
    if (lowerName.includes('tennis')) {
      return require('../../assets/images/tennis.webp');
    } else if (lowerName.includes('pickleball')) {
      return require('../../assets/images/pickleball.webp');
    }
    return require('../../assets/images/tennis.webp');
  };

  const getSelectionOrder = (sportId: string): number | null => {
    const index = orderedSelection.findIndex(s => s.id === sportId);
    return index >= 0 ? index + 1 : null;
  };

  // Memoize card animations array
  const cardAnimations = useMemo(
    () => [
      { opacity: card1Opacity, translateY: card1TranslateY, scale: card1Scale },
      { opacity: card2Opacity, translateY: card2TranslateY, scale: card2Scale },
    ],
    [card1Opacity, card1TranslateY, card1Scale, card2Opacity, card2TranslateY, card2Scale]
  );

  // Background colors for gradient
  const gradientColors = isDark
    ? [neutral[900], neutral[950], neutral[950]]
    : [primary[50], BASE_WHITE, BASE_WHITE];

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

      {/* Content */}
      <View style={styles.content}>
        {/* Welcome Header */}
        <View style={styles.headerSection}>
          <Animated.View
            style={[
              styles.welcomeContainer,
              {
                opacity: welcomeOpacity,
                transform: [{ translateY: welcomeTranslateY }],
              },
            ]}
          >
            <View
              style={[
                styles.welcomeBadge,
                { backgroundColor: isDark ? primary[800] : primary[100] },
              ]}
            >
              <Text size="sm" weight="semibold" color={isDark ? primary[300] : primary[700]}>
                {t('sportSelectionOverlay.welcomeBadge')}
              </Text>
            </View>
          </Animated.View>

          <Animated.View
            style={[
              styles.titleContainer,
              {
                opacity: titleOpacity,
                transform: [{ translateY: titleTranslateY }],
              },
            ]}
          >
            <Text
              size="3xl"
              weight="bold"
              color={colors.foreground}
              lineHeight="relaxed"
              style={styles.title}
            >
              {t('sportSelectionOverlay.title')}
            </Text>
          </Animated.View>

          <Animated.View style={[styles.subtitleContainer, { opacity: subtitleOpacity }]}>
            <Text size="base" color={colors.textMuted} style={styles.subtitle}>
              {t('sportSelectionOverlay.subtitle')}
            </Text>
          </Animated.View>
        </View>

        {/* Sport Cards */}
        <View style={styles.cardsContainer}>
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <Spinner size="lg" />
              <Text size="sm" color={colors.textMuted} style={styles.loadingText}>
                {t('sportSelectionOverlay.loading')}
              </Text>
            </View>
          ) : (
            sports.map((sport, index) => {
              const selectionOrder = getSelectionOrder(sport.id);
              const isSelected = selectionOrder !== null;
              const cardAnim = cardAnimations[index] || cardAnimations[0];

              return (
                <Animated.View
                  key={sport.id}
                  style={[
                    {
                      opacity: cardAnim.opacity,
                      transform: [{ translateY: cardAnim.translateY }, { scale: cardAnim.scale }],
                    },
                  ]}
                >
                  <TouchableOpacity
                    style={[
                      styles.sportCard,
                      isSelected ? styles.sportCardSelected : styles.sportCardUnselected,
                    ]}
                    onPress={() => toggleSport(sport)}
                    activeOpacity={0.85}
                  >
                    {/* Sport Image */}
                    <View style={styles.sportImageContainer}>
                      <Image
                        source={getSportImage(sport.name)}
                        style={styles.sportImage}
                        resizeMode="cover"
                      />
                      {/* Gradient overlay for better text readability */}
                      <LinearGradient
                        colors={['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.7)']}
                        style={styles.sportImageGradient}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                      />
                    </View>

                    {/* Sport Info */}
                    <View style={styles.sportInfoContainer}>
                      <View style={styles.sportNameRow}>
                        <Text size="xl" weight="bold" color={BASE_WHITE}>
                          {sport.display_name}
                        </Text>

                        {/* Selection indicator */}
                        {isSelected ? (
                          <View style={styles.selectionBadge}>
                            {orderedSelection.length > 1 ? (
                              <Text size="sm" weight="bold" color={BASE_WHITE}>
                                {selectionOrder}
                              </Text>
                            ) : (
                              <Ionicons name="checkmark-outline" size={18} color={BASE_WHITE} />
                            )}
                          </View>
                        ) : (
                          <View style={styles.addButton}>
                            <Ionicons name="add-outline" size={22} color={BASE_WHITE} />
                          </View>
                        )}
                      </View>

                      {/* Tap to select hint */}
                      <Text size="xs" color="rgba(255,255,255,0.7)" style={styles.tapHint}>
                        {isSelected
                          ? t('sportSelectionOverlay.tapToRemove')
                          : t('sportSelectionOverlay.tapToSelect')}
                      </Text>
                    </View>
                  </TouchableOpacity>
                </Animated.View>
              );
            })
          )}
        </View>

        {/* Bottom Section */}
        <Animated.View
          style={[
            styles.bottomSection,
            {
              opacity: buttonOpacity,
              transform: [{ translateY: buttonTranslateY }],
            },
          ]}
        >
          {orderedSelection.length > 1 && (
            <View
              style={[styles.hintBanner, { backgroundColor: isDark ? neutral[800] : primary[50] }]}
            >
              <Ionicons
                name="information-circle-outline"
                size={18}
                color={isDark ? primary[400] : primary[600]}
              />
              <Text size="sm" color={isDark ? primary[300] : primary[700]} style={styles.hintText}>
                {t('sportSelectionOverlay.selectionHint', {
                  sport: orderedSelection[0].display_name.toLowerCase(),
                })}
              </Text>
            </View>
          )}

          <Button
            variant="primary"
            onPress={handleContinue}
            disabled={orderedSelection.length === 0 || isSubmitting}
            style={styles.continueButton}
          >
            {orderedSelection.length === 0
              ? t('sportSelectionOverlay.selectAtLeastOne')
              : t('sportSelectionOverlay.getStarted')}
          </Button>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacingPixels[5],
    justifyContent: 'space-between',
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

  // Header section
  headerSection: {
    paddingTop: spacingPixels[2],
    alignItems: 'center',
  },
  welcomeContainer: {
    marginBottom: spacingPixels[2],
  },
  welcomeBadge: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.full,
  },
  titleContainer: {
    marginBottom: spacingPixels[2],
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[1],
    overflow: 'visible',
  },
  title: {
    textAlign: 'center',
    letterSpacing: -0.5,
    includeFontPadding: false, // Prevents Android font padding from clipping text
    lineHeight: 48, // Explicit line height for 3xl (30px) bold text to prevent clipping on iOS
  },
  subtitleContainer: {
    paddingHorizontal: spacingPixels[6],
  },
  subtitle: {
    textAlign: 'center',
    lineHeight: 22,
  },

  // Cards section
  cardsContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: spacingPixels[3],
  },

  // Sport card
  sportCard: {
    height: 200,
    borderRadius: radiusPixels.xl,
    marginBottom: spacingPixels[4],
    overflow: 'hidden',
    position: 'relative',
    shadowOffset: { width: 0, height: 4 },
  },
  sportCardSelected: {
    borderWidth: 3,
    borderColor: primary[500],
    shadowColor: primary[500],
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  sportCardUnselected: {
    borderWidth: 0,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 4,
  },
  sportImageContainer: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  sportImage: {
    width: '100%',
    height: '100%',
  },
  sportImageGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sportInfoContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacingPixels[4],
  },
  sportNameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tapHint: {
    marginTop: spacingPixels[1],
  },
  selectionBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: primary[500],
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: primary[600],
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  addButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },

  // Bottom section
  bottomSection: {
    paddingBottom: spacingPixels[4],
  },
  hintBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[3],
  },
  hintText: {
    marginLeft: spacingPixels[2],
    flex: 1,
  },
  continueButton: {
    width: '100%',
  },
});

export default SportSelectionScreen;
