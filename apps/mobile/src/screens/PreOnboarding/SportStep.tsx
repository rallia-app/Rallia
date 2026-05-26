/**
 * SportStep - First step of the pre-onboarding wizard
 *
 * Allows users to select which sports they play.
 * Tracks selection order so the first-selected sport becomes the default view.
 */

import React, { useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Image } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, shadowsNative } from '@rallia/design-system';
import { selectionHaptic } from '@rallia/shared-utils';

import { useThemeStyles, useTranslation } from '#/hooks';
import { SportIcon } from '#/components/SportIcon';

import TennisIcon from '../../../assets/icons/tennis.svg';
import PickleballIcon from '../../../assets/icons/pickleball.svg';

const BASE_WHITE = '#ffffff';

// Simplified Sport type for this component
export interface Sport {
  id: string;
  name: string;
  display_name: string;
  icon_url?: string | null;
}

interface SportStepProps {
  /** Sports catalog, owned by parent so it is fetched once. */
  sports: Sport[];
  /** Currently selected sports, in tap order. Owned by the parent so the
   * selection survives when the step unmounts on back/forward navigation. */
  value: Sport[];
  /** Update the selection on the parent. */
  onChange: (next: Sport[]) => void;
  /** Called when user taps Continue with their selected sports */
  onContinue: (orderedSports: Sport[]) => void;
  /** Whether the step is currently active */
  isActive?: boolean;
}

export function SportStep({
  sports,
  value,
  onChange,
  onContinue,
  isActive = true,
}: SportStepProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();

  const orderedSelection = value;

  const toggleSport = useCallback(
    (sport: Sport) => {
      selectionHaptic();
      const existingIndex = value.findIndex(s => s.id === sport.id);
      if (existingIndex >= 0) {
        onChange(value.filter(s => s.id !== sport.id));
      } else {
        onChange([...value, sport]);
      }
    },
    [value, onChange]
  );

  const handleContinue = useCallback(() => {
    if (orderedSelection.length === 0) return;
    onContinue(orderedSelection);
  }, [orderedSelection, onContinue]);

  const getSportImage = (sportName: string) => {
    const lowerName = sportName.toLowerCase();
    if (lowerName.includes('tennis')) {
      return require('../../../assets/images/tennis.webp');
    } else if (lowerName.includes('pickleball')) {
      return require('../../../assets/images/pickleball.webp');
    }
    return require('../../../assets/images/tennis.webp');
  };

  const getSelectionOrder = (sportId: string): number | null => {
    const index = orderedSelection.findIndex(s => s.id === sportId);
    return index >= 0 ? index + 1 : null;
  };

  return (
    <View style={styles.container}>
      <View style={styles.inner}>
        {/* Header Section */}
        <Animated.View entering={FadeInDown.delay(50).springify()} style={styles.headerSection}>
          <LinearGradient
            colors={isDark ? [primary[800], primary[900]] : [primary[50], primary[100]]}
            style={styles.iconContainer}
          >
            <SportIcon sportName="tennis" size={36} color={isDark ? primary[200] : primary[600]} />
          </LinearGradient>

          <Text size="xl" weight="bold" color={colors.foreground} style={styles.title}>
            {t('sportSelectionOverlay.title')}
          </Text>

          <Text size="sm" color={colors.textMuted} style={styles.subtitle}>
            {t('sportSelectionOverlay.subtitle')}
          </Text>
        </Animated.View>

        {/* Sport Cards */}
        <View style={styles.cardsContainer}>
          {sports.map((sport, index) => {
            const selectionOrder = getSelectionOrder(sport.id);
            const isSelected = selectionOrder !== null;

            return (
              <Animated.View
                key={sport.name}
                entering={FadeInDown.delay(150 + index * 100).springify()}
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
                      <View style={styles.sportNameWithIcon}>
                        {sport.name.toLowerCase() === 'pickleball' ? (
                          <PickleballIcon
                            width={24}
                            height={24}
                            fill={BASE_WHITE}
                            style={styles.sportNameIcon}
                          />
                        ) : (
                          <TennisIcon
                            width={24}
                            height={24}
                            fill={BASE_WHITE}
                            style={styles.sportNameIcon}
                          />
                        )}
                        <Text size="xl" weight="bold" color={BASE_WHITE}>
                          {sport.display_name}
                        </Text>
                      </View>

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
          })}
        </View>
      </View>

      {/* Bottom Section (pinned) */}
      <Animated.View entering={FadeInUp.delay(400).springify()} style={styles.bottomSection}>
        <Button
          variant="primary"
          onPress={handleContinue}
          disabled={orderedSelection.length === 0}
          style={styles.continueButton}
        >
          {t('sportSelectionOverlay.getStarted')}
        </Button>

        <View
          style={styles.hintContainer}
          accessible={orderedSelection.length !== 1}
          importantForAccessibility={orderedSelection.length === 1 ? 'no-hide-descendants' : 'yes'}
          pointerEvents="none"
        >
          <Ionicons
            name="information-circle-outline"
            size={14}
            color={isDark ? primary[400] : primary[600]}
            style={{ opacity: orderedSelection.length === 1 ? 0 : 1 }}
          />
          <Text
            size="xs"
            color={colors.textMuted}
            style={[styles.hintText, { opacity: orderedSelection.length === 1 ? 0 : 1 }]}
          >
            {orderedSelection.length > 1
              ? t('sportSelectionOverlay.selectionHint', {
                  sport: orderedSelection[0].display_name.toLowerCase(),
                })
              : t('sportSelectionOverlay.selectAtLeastOne')}
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
  },

  // Cards section
  cardsContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    gap: spacingPixels[3],
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
    height: 180,
    borderRadius: radiusPixels.xl,
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
  sportNameWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sportNameIcon: {
    marginRight: spacingPixels[2],
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

  // Bottom section (pinned outside scroll)
  bottomSection: {
    paddingHorizontal: spacingPixels[5],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[4],
    alignItems: 'center',
  },
  hintContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacingPixels[5],
    paddingHorizontal: spacingPixels[2],
  },
  hintText: {
    marginLeft: spacingPixels[2],
    lineHeight: 18,
    textAlign: 'center',
  },
  continueButton: {
    width: '100%',
  },
});

export default SportStep;
