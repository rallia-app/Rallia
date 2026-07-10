/**
 * PreferencesStep Component
 *
 * Preferences step of onboarding - playing hand, travel distance, match duration, match type.
 * Migrated from PlayerPreferencesOverlay with theme-aware colors.
 *
 * When user has multiple sports, shows "Same for all sports" checkbox for match type.
 * Unchecking reveals individual preference rows for each sport.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ScrollView as SheetScrollView } from 'react-native-actions-sheet';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { selectionHaptic } from '@rallia/shared-utils';
import type { TranslationKey } from '@rallia/shared-translations';

import type { OnboardingFormData } from '#/features/onboarding/hooks/useOnboardingWizard';

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
}

interface PreferencesStepProps {
  formData: OnboardingFormData;
  onUpdateFormData: (updates: Partial<OnboardingFormData>) => void;
  hasTennis: boolean;
  hasPickleball: boolean;
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
  isDark: boolean;
}

export const PreferencesStep: React.FC<PreferencesStepProps> = ({
  formData,
  onUpdateFormData,
  hasTennis,
  hasPickleball,
  colors,
  t,
  isDark: _isDark,
}) => {
  const hasBothSports = hasTennis && hasPickleball;

  // State for "Same for all sports" checkboxes (only relevant when user has both sports)
  const [sameMatchTypeForAll, setSameMatchTypeForAll] = useState(true);
  const [sameMatchDurationForAll, setSameMatchDurationForAll] = useState(true);

  // Custom slider built with RNGH + Reanimated to work inside the actions-sheet on Android.
  // translateX represents the thumb center within the track (range 0..trackWidth). The
  // wrapping View applies horizontal padding equal to THUMB_SIZE/2 so the thumb's
  // half-width never overflows the parent at min/max.
  const MIN = 3;
  const MAX = 50;
  const THUMB_SIZE = 24;
  const trackWidth = useSharedValue(0);
  const translateX = useSharedValue(0);
  const startX = useSharedValue(0);

  // Clamp any saved value below the new minimum (e.g. legacy 1 km settings)
  const clampedInitial = Math.min(Math.max(formData.maxTravelDistance, MIN), MAX);
  const [sliderValue, setSliderValue] = useState(clampedInitial);

  // If the persisted value was outside the allowed range, push the clamped value
  // back into form data so the next save writes the corrected value.
  useEffect(() => {
    if (formData.maxTravelDistance !== clampedInitial) {
      onUpdateFormData({ maxTravelDistance: clampedInitial });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onTrackLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const w = e.nativeEvent.layout.width;
      trackWidth.value = w;
      translateX.value = ((clampedInitial - MIN) / (MAX - MIN)) * w;
    },
    [clampedInitial, trackWidth, translateX]
  );

  const updateSliderValue = useCallback((val: number) => {
    setSliderValue(val);
  }, []);

  const commitSliderValue = useCallback(
    (val: number) => {
      onUpdateFormData({ maxTravelDistance: val });
    },
    [onUpdateFormData]
  );

  const sliderGesture = Gesture.Pan()
    .activeOffsetX([-5, 5])
    .failOffsetY([-10, 10])
    .onStart(() => {
      startX.value = translateX.value;
    })
    .onUpdate(e => {
      const newX = Math.min(Math.max(startX.value + e.translationX, 0), trackWidth.value);
      translateX.value = newX;
      const val = trackWidth.value
        ? Math.round(MIN + (newX / trackWidth.value) * (MAX - MIN))
        : MIN;
      runOnJS(updateSliderValue)(val);
    })
    .onEnd(() => {
      const val = trackWidth.value
        ? Math.round(MIN + (translateX.value / trackWidth.value) * (MAX - MIN))
        : MIN;
      runOnJS(commitSliderValue)(val);
    });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value - THUMB_SIZE / 2 }],
  }));

  const filledTrackStyle = useAnimatedStyle(() => ({
    width: translateX.value,
  }));

  // When "Same for all sports" is toggled ON, sync both sports to the tennis value
  const handleSameMatchTypeToggle = () => {
    selectionHaptic();
    const newValue = !sameMatchTypeForAll;
    setSameMatchTypeForAll(newValue);

    if (newValue) {
      // Sync pickleball to tennis value (or use a unified value)
      onUpdateFormData({ pickleballMatchType: formData.tennisMatchType });
    }
  };

  const handleSameMatchDurationToggle = () => {
    selectionHaptic();
    const newValue = !sameMatchDurationForAll;
    setSameMatchDurationForAll(newValue);

    if (newValue) {
      // Sync pickleball to tennis value
      onUpdateFormData({ pickleballMatchDuration: formData.tennisMatchDuration });
    }
  };

  // Handle unified match type change (when "Same for all sports" is checked)
  const handleUnifiedMatchTypeChange = (value: 'casual' | 'competitive' | 'both') => {
    onUpdateFormData({
      tennisMatchType: value,
      pickleballMatchType: value,
    });
  };

  // Handle unified match duration change (when "Same for all sports" is checked)
  const handleUnifiedMatchDurationChange = (value: '30' | '60' | '90' | '120') => {
    onUpdateFormData({
      tennisMatchDuration: value,
      pickleballMatchDuration: value,
      matchDuration: value, // Keep legacy field in sync
    });
  };

  const renderOptionButton = (
    label: string,
    value: string,
    currentValue: string,
    onPress: () => void
  ) => {
    const isSelected = value === currentValue;
    return (
      <TouchableOpacity
        style={[
          styles.optionButton,
          {
            backgroundColor: isSelected ? colors.buttonActive : colors.buttonInactive,
            borderColor: isSelected ? colors.buttonActive : 'transparent',
          },
        ]}
        onPress={() => {
          selectionHaptic();
          onPress();
        }}
        activeOpacity={0.8}
      >
        <Text
          size="sm"
          weight="semibold"
          color={isSelected ? colors.buttonTextActive : colors.textSecondary}
        >
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <SheetScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      {/* Title */}
      <Text size="xl" weight="bold" color={colors.text} style={styles.title}>
        {t('onboarding.preferencesStep.title')}
      </Text>

      {/* Playing Hand */}
      <Text size="sm" weight="semibold" color={colors.text} style={styles.sectionLabel}>
        {t('onboarding.preferencesStep.playingHand')}
      </Text>
      <View style={styles.buttonGroup}>
        {renderOptionButton(
          t('onboarding.preferencesStep.left'),
          'left',
          formData.playingHand,
          () => onUpdateFormData({ playingHand: 'left' })
        )}
        {renderOptionButton(
          t('onboarding.preferencesStep.right'),
          'right',
          formData.playingHand,
          () => onUpdateFormData({ playingHand: 'right' })
        )}
        {renderOptionButton(
          t('onboarding.preferencesStep.both'),
          'both',
          formData.playingHand,
          () => onUpdateFormData({ playingHand: 'both' })
        )}
      </View>

      {/* Maximum Travel Distance */}
      <Text size="sm" weight="semibold" color={colors.text} style={styles.sectionLabel}>
        {t('onboarding.preferencesStep.travelDistance')}
      </Text>
      <View style={styles.sliderContainer}>
        <Text size="lg" weight="bold" color={colors.text} style={styles.sliderValue}>
          {sliderValue} km
        </Text>
        <View style={styles.sliderTrackPadding}>
          <GestureDetector gesture={sliderGesture}>
            <Animated.View style={styles.sliderTrackOuter} onLayout={onTrackLayout}>
              <View style={[styles.sliderTrack, { backgroundColor: colors.buttonInactive }]}>
                <Animated.View
                  style={[
                    styles.sliderTrackFilled,
                    { backgroundColor: colors.buttonActive },
                    filledTrackStyle,
                  ]}
                />
              </View>
              <Animated.View
                style={[styles.sliderThumb, { backgroundColor: colors.buttonActive }, thumbStyle]}
              />
            </Animated.View>
          </GestureDetector>
        </View>
      </View>

      {/* Preferred Match Duration Section */}
      {(hasTennis || hasPickleball) && (
        <>
          {/* Section Header */}
          <View style={styles.sectionHeaderRow}>
            <Text size="sm" weight="semibold" color={colors.text}>
              {t('onboarding.preferencesStep.matchDuration')}
            </Text>
          </View>

          {/* Unified Match Duration (when same for all or only one sport) */}
          {(sameMatchDurationForAll || !hasBothSports) && (
            <View style={styles.buttonGroup}>
              {renderOptionButton(
                '1h',
                '60',
                hasTennis ? formData.tennisMatchDuration : formData.pickleballMatchDuration,
                () =>
                  hasBothSports
                    ? handleUnifiedMatchDurationChange('60')
                    : onUpdateFormData({
                        [hasTennis ? 'tennisMatchDuration' : 'pickleballMatchDuration']: '60',
                        matchDuration: '60', // Keep legacy field in sync
                      })
              )}
              {renderOptionButton(
                '1.5h',
                '90',
                hasTennis ? formData.tennisMatchDuration : formData.pickleballMatchDuration,
                () =>
                  hasBothSports
                    ? handleUnifiedMatchDurationChange('90')
                    : onUpdateFormData({
                        [hasTennis ? 'tennisMatchDuration' : 'pickleballMatchDuration']: '90',
                        matchDuration: '90', // Keep legacy field in sync
                      })
              )}
              {renderOptionButton(
                '2h',
                '120',
                hasTennis ? formData.tennisMatchDuration : formData.pickleballMatchDuration,
                () =>
                  hasBothSports
                    ? handleUnifiedMatchDurationChange('120')
                    : onUpdateFormData({
                        [hasTennis ? 'tennisMatchDuration' : 'pickleballMatchDuration']: '120',
                        matchDuration: '120', // Keep legacy field in sync
                      })
              )}
            </View>
          )}

          {/* Individual Sport Match Durations (when not same for all) */}
          {!sameMatchDurationForAll && hasBothSports && (
            <>
              {/* Tennis Match Duration */}
              <Text size="sm" weight="semibold" color={colors.text} style={styles.sportSubLabel}>
                Tennis
              </Text>
              <View style={styles.buttonGroup}>
                {renderOptionButton('1h', '60', formData.tennisMatchDuration, () =>
                  onUpdateFormData({ tennisMatchDuration: '60' })
                )}
                {renderOptionButton('1.5h', '90', formData.tennisMatchDuration, () =>
                  onUpdateFormData({ tennisMatchDuration: '90' })
                )}
                {renderOptionButton('2h', '120', formData.tennisMatchDuration, () =>
                  onUpdateFormData({ tennisMatchDuration: '120' })
                )}
              </View>

              {/* Pickleball Match Duration */}
              <Text size="sm" weight="semibold" color={colors.text} style={styles.sportSubLabel}>
                Pickleball
              </Text>
              <View style={styles.buttonGroup}>
                {renderOptionButton('1h', '60', formData.pickleballMatchDuration, () =>
                  onUpdateFormData({ pickleballMatchDuration: '60' })
                )}
                {renderOptionButton('1.5h', '90', formData.pickleballMatchDuration, () =>
                  onUpdateFormData({ pickleballMatchDuration: '90' })
                )}
                {renderOptionButton('2h', '120', formData.pickleballMatchDuration, () =>
                  onUpdateFormData({ pickleballMatchDuration: '120' })
                )}
              </View>
            </>
          )}

          <View style={styles.checkboxRow}>
            {hasBothSports && (
              <TouchableOpacity
                style={styles.checkboxRow}
                onPress={handleSameMatchDurationToggle}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.checkbox,
                    {
                      backgroundColor: sameMatchDurationForAll
                        ? colors.buttonActive
                        : 'transparent',
                      borderColor: sameMatchDurationForAll ? colors.buttonActive : colors.textMuted,
                    },
                  ]}
                >
                  {sameMatchDurationForAll && (
                    <Ionicons name="checkmark-outline" size={14} color={colors.buttonTextActive} />
                  )}
                </View>
                <Text size="xs" color={colors.textSecondary}>
                  {t('onboarding.preferencesStep.sameForAll')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      )}

      {/* Match Type Section */}
      {(hasTennis || hasPickleball) && (
        <>
          {/* Section Header with "Same for all sports" checkbox when both sports selected */}
          <View style={styles.sectionHeaderRow}>
            <Text size="sm" weight="semibold" color={colors.text}>
              {t('onboarding.preferencesStep.matchType')}
            </Text>
          </View>

          {/* Unified Match Type (when same for all or only one sport) */}
          {(sameMatchTypeForAll || !hasBothSports) && (
            <View style={styles.buttonGroup}>
              {renderOptionButton(
                t('onboarding.preferencesStep.casual'),
                'casual',
                hasTennis ? formData.tennisMatchType : formData.pickleballMatchType,
                () =>
                  hasBothSports
                    ? handleUnifiedMatchTypeChange('casual')
                    : onUpdateFormData({
                        [hasTennis ? 'tennisMatchType' : 'pickleballMatchType']: 'casual',
                      })
              )}
              {renderOptionButton(
                t('onboarding.preferencesStep.competitive'),
                'competitive',
                hasTennis ? formData.tennisMatchType : formData.pickleballMatchType,
                () =>
                  hasBothSports
                    ? handleUnifiedMatchTypeChange('competitive')
                    : onUpdateFormData({
                        [hasTennis ? 'tennisMatchType' : 'pickleballMatchType']: 'competitive',
                      })
              )}
              {renderOptionButton(
                t('onboarding.preferencesStep.both'),
                'both',
                hasTennis ? formData.tennisMatchType : formData.pickleballMatchType,
                () =>
                  hasBothSports
                    ? handleUnifiedMatchTypeChange('both')
                    : onUpdateFormData({
                        [hasTennis ? 'tennisMatchType' : 'pickleballMatchType']: 'both',
                      })
              )}
            </View>
          )}

          {/* Individual Sport Match Types (when not same for all) */}
          {!sameMatchTypeForAll && hasBothSports && (
            <>
              {/* Tennis Match Type */}
              <Text size="sm" weight="semibold" color={colors.text} style={styles.sportSubLabel}>
                Tennis
              </Text>
              <View style={styles.buttonGroup}>
                {renderOptionButton(
                  t('onboarding.preferencesStep.casual'),
                  'casual',
                  formData.tennisMatchType,
                  () => onUpdateFormData({ tennisMatchType: 'casual' })
                )}
                {renderOptionButton(
                  t('onboarding.preferencesStep.competitive'),
                  'competitive',
                  formData.tennisMatchType,
                  () => onUpdateFormData({ tennisMatchType: 'competitive' })
                )}
                {renderOptionButton(
                  t('onboarding.preferencesStep.both'),
                  'both',
                  formData.tennisMatchType,
                  () => onUpdateFormData({ tennisMatchType: 'both' })
                )}
              </View>

              {/* Pickleball Match Type */}
              <Text size="sm" weight="semibold" color={colors.text} style={styles.sportSubLabel}>
                Pickleball
              </Text>
              <View style={styles.buttonGroup}>
                {renderOptionButton(
                  t('onboarding.preferencesStep.casual'),
                  'casual',
                  formData.pickleballMatchType,
                  () => onUpdateFormData({ pickleballMatchType: 'casual' })
                )}
                {renderOptionButton(
                  t('onboarding.preferencesStep.competitive'),
                  'competitive',
                  formData.pickleballMatchType,
                  () => onUpdateFormData({ pickleballMatchType: 'competitive' })
                )}
                {renderOptionButton(
                  t('onboarding.preferencesStep.both'),
                  'both',
                  formData.pickleballMatchType,
                  () => onUpdateFormData({ pickleballMatchType: 'both' })
                )}
              </View>
            </>
          )}

          <View style={styles.checkboxRow}>
            {hasBothSports && (
              <TouchableOpacity
                style={styles.checkboxRow}
                onPress={handleSameMatchTypeToggle}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.checkbox,
                    {
                      backgroundColor: sameMatchTypeForAll ? colors.buttonActive : 'transparent',
                      borderColor: sameMatchTypeForAll ? colors.buttonActive : colors.textMuted,
                    },
                  ]}
                >
                  {sameMatchTypeForAll && (
                    <Ionicons name="checkmark-outline" size={14} color={colors.buttonTextActive} />
                  )}
                </View>
                <Text size="xs" color={colors.textSecondary}>
                  {t('onboarding.preferencesStep.sameForAll')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      )}
    </SheetScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[8],
    flexGrow: 1,
  },
  title: {
    textAlign: 'center',
    marginBottom: spacingPixels[6],
    lineHeight: 28,
  },
  sectionLabel: {
    marginBottom: spacingPixels[3],
    marginTop: spacingPixels[4],
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacingPixels[3],
    marginTop: spacingPixels[4],
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginTop: spacingPixels[1],
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sportSubLabel: {
    marginTop: spacingPixels[3],
    marginBottom: spacingPixels[2],
  },
  buttonGroup: {
    flexDirection: 'row',
    gap: spacingPixels[2],
  },
  optionButton: {
    flex: 1,
    borderRadius: radiusPixels.lg,
    paddingVertical: spacingPixels[3],
    alignItems: 'center',
    borderWidth: 2,
  },
  sliderContainer: {
    marginBottom: spacingPixels[2],
  },
  sliderValue: {
    marginBottom: spacingPixels[2],
  },
  sliderTrackPadding: {
    paddingHorizontal: 12, // THUMB_SIZE / 2 — keeps the thumb inside the parent at min/max
  },
  sliderTrackOuter: {
    height: 40,
    justifyContent: 'center',
  },
  sliderTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  sliderTrackFilled: {
    height: '100%',
    borderRadius: 2,
  },
  sliderThumb: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    top: 8,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
});

export default PreferencesStep;
