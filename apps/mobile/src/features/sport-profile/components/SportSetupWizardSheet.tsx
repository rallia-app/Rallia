import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ActionSheet, { SheetProps } from 'react-native-actions-sheet';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Text } from '@rallia/shared-components';
import DatabaseService, {
  OnboardingService,
  SportService,
  Logger,
  supabase,
} from '@rallia/shared-services';
import { usePlayPreferences } from '@rallia/shared-hooks';
import type { OnboardingRating } from '@rallia/shared-types';
import type { TranslationKey } from '@rallia/shared-translations';
import ProgressIndicator from '../../onboarding/components/ProgressIndicator';
import { FavoriteFacilitiesSelector } from './FavoriteFacilitiesSelector';
import { selectionHaptic, mediumHaptic } from '../../../utils/haptics';
import { useThemeStyles, useTranslation } from '../../../hooks';
import { primary, radiusPixels, spacingPixels } from '@rallia/design-system';
import { withTimeout } from '../../../utils/networkTimeout';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const TOTAL_STEPS = 2;

// =============================================================================
// RATING HELPERS
// =============================================================================

interface Rating {
  id: string;
  score_value: number;
  display_label: string;
  description: string;
  skill_level: 'beginner' | 'intermediate' | 'advanced' | 'professional' | null;
}

const getNtrpSkillLabelKey = (scoreValue: number): TranslationKey => {
  const mapping: Record<number, TranslationKey> = {
    1.5: 'onboarding.ratingStep.skillLevels.beginner1',
    2.0: 'onboarding.ratingStep.skillLevels.beginner2',
    2.5: 'onboarding.ratingStep.skillLevels.beginner3',
    3.0: 'onboarding.ratingStep.skillLevels.intermediate1',
    3.5: 'onboarding.ratingStep.skillLevels.intermediate2',
    4.0: 'onboarding.ratingStep.skillLevels.intermediate3',
    4.5: 'onboarding.ratingStep.skillLevels.advanced1',
    5.0: 'onboarding.ratingStep.skillLevels.advanced2',
    5.5: 'onboarding.ratingStep.skillLevels.advanced3',
    6.0: 'onboarding.ratingStep.skillLevels.professional',
  };
  return mapping[scoreValue] || '';
};

const getDuprSkillLabelKey = (scoreValue: number): TranslationKey => {
  const mapping: Record<number, TranslationKey> = {
    1.0: 'onboarding.ratingStep.skillLevels.beginner1',
    2.0: 'onboarding.ratingStep.skillLevels.beginner2',
    2.5: 'onboarding.ratingStep.skillLevels.beginner3',
    3.0: 'onboarding.ratingStep.skillLevels.intermediate1',
    3.5: 'onboarding.ratingStep.skillLevels.intermediate2',
    4.0: 'onboarding.ratingStep.skillLevels.intermediate3',
    4.5: 'onboarding.ratingStep.skillLevels.advanced1',
    5.0: 'onboarding.ratingStep.skillLevels.advanced2',
    5.5: 'onboarding.ratingStep.skillLevels.advanced3',
    6.0: 'onboarding.ratingStep.skillLevels.professional',
  };
  return mapping[scoreValue] || '';
};

const getNtrpDescriptionKey = (scoreValue: number): TranslationKey => {
  return `onboarding.ratingStep.ntrpDescriptions.${scoreValue.toFixed(1).replace('.', '_')}` as TranslationKey;
};

const getDuprDescriptionKey = (scoreValue: number): TranslationKey => {
  return `onboarding.ratingStep.duprDescriptions.${scoreValue.toFixed(1).replace('.', '_')}` as TranslationKey;
};

const getSkillCategory = (scoreValue: number): string => {
  if (scoreValue <= 2.5) return 'beginner';
  if (scoreValue <= 4.0) return 'intermediate';
  if (scoreValue <= 5.5) return 'advanced';
  return 'professional';
};

const getRatingIcon = (skillLevel: string): keyof typeof Ionicons.glyphMap => {
  if (skillLevel === 'beginner') return 'star-outline';
  if (skillLevel === 'intermediate') return 'star-half';
  if (skillLevel === 'advanced') return 'star';
  return 'trophy';
};

// =============================================================================
// PREFERENCES HELPERS
// =============================================================================

const formatName = (name: string): string => {
  return name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const getPlayStyleLabel = (name: string, t: (key: TranslationKey) => string): string => {
  const key = `profile.preferences.playStyles.${name}` as TranslationKey;
  const translated = t(key);
  return translated === key ? formatName(name) : translated;
};

const getPlayAttributeLabel = (name: string, t: (key: TranslationKey) => string): string => {
  const key = `profile.preferences.playAttributes.${name}` as TranslationKey;
  const translated = t(key);
  return translated === key ? formatName(name) : translated;
};

const getCategoryLabel = (category: string, t: (key: TranslationKey) => string): string => {
  const key = `profile.preferences.playAttributeCategories.${category}` as TranslationKey;
  const translated = t(key);
  return translated === key ? category : translated;
};

// =============================================================================
// COMPONENT
// =============================================================================

export function SportSetupWizardActionSheet({ payload }: SheetProps<'sport-setup-wizard'>) {
  const sportName = payload?.sportName ?? 'tennis';
  const sportId = payload?.sportId ?? '';
  const playerSportId = payload?.playerSportId ?? '';
  const userId = payload?.userId ?? '';
  const latitude = payload?.latitude ?? null;
  const longitude = payload?.longitude ?? null;
  const onComplete = payload?.onComplete;
  const onCancel = payload?.onCancel;

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const sheetRef = useRef<any>(null);
  const didCompleteRef = useRef(false);

  // Step management (1-indexed for display, 0-indexed for animation)
  const [currentStep, setCurrentStep] = useState(1);
  const translateX = useSharedValue(0);

  // Rating step state
  const [selectedRating, setSelectedRating] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [isLoadingRatings, setIsLoadingRatings] = useState(false);
  const [isSavingRating, setIsSavingRating] = useState(false);

  // Preferences step state
  const [matchDuration, setMatchDuration] = useState<string | undefined>();
  const [matchType, setMatchType] = useState<string | undefined>();
  const [playStyle, setPlayStyle] = useState<string | undefined>();
  const [playAttributes, setPlayAttributes] = useState<string[]>([]);
  const [showPlayStyleDropdown, setShowPlayStyleDropdown] = useState(false);
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);

  // Fetch play preferences for the preferences step
  const {
    playStyles: playStyleOptions,
    playAttributesByCategory,
    loading: loadingPlayOptions,
  } = usePlayPreferences(sportId);

  const isTennis = sportName === 'tennis';
  const ratingSystem = isTennis ? 'ntrp' : 'dupr';
  const getSkillLabelKey = isTennis ? getNtrpSkillLabelKey : getDuprSkillLabelKey;
  const getDescriptionKey = isTennis ? getNtrpDescriptionKey : getDuprDescriptionKey;

  const MATCH_DURATIONS: Array<{ value: string; label: string }> = [
    { value: '30', label: t('profile.preferences.durations.30') },
    { value: '60', label: t('profile.preferences.durations.60') },
    { value: '90', label: t('profile.preferences.durations.90') },
    { value: '120', label: t('profile.preferences.durations.120') },
  ];

  const MATCH_TYPES = [
    { value: 'casual', label: t('profile.preferences.matchTypes.casual') },
    { value: 'competitive', label: t('profile.preferences.matchTypes.competitive') },
    { value: 'both', label: t('profile.preferences.matchTypes.both') },
  ];

  const PLAY_STYLES = playStyleOptions.map(style => ({
    value: style.name,
    label: getPlayStyleLabel(style.name, t),
    description: style.description,
  }));

  // Load ratings on mount
  useEffect(() => {
    const loadRatings = async () => {
      setIsLoadingRatings(true);
      try {
        const { data, error } = await DatabaseService.RatingScore.getRatingScoresBySport(
          sportName,
          ratingSystem
        );

        if (error || !data) {
          Logger.error('Failed to load ratings', error as Error, {
            sport: sportName,
            system: ratingSystem,
          });
          Alert.alert(t('alerts.error'), t('onboarding.validation.failedToLoadRatings'));
          return;
        }

        const transformedRatings: Rating[] = data.map(rating => ({
          id: rating.id,
          score_value: rating.score_value,
          display_label: rating.display_label,
          description: rating.description || '',
          skill_level: rating.skill_level,
        }));

        setRatings(transformedRatings);
      } catch (error) {
        Logger.error('Unexpected error loading ratings', error as Error);
        Alert.alert(t('alerts.error'), t('onboarding.validation.unexpectedError'));
      } finally {
        setIsLoadingRatings(false);
      }
    };

    loadRatings();
  }, [sportName, ratingSystem, t]);

  // Animate step transitions
  useEffect(() => {
    translateX.value = withSpring(-(currentStep - 1) * SCREEN_WIDTH, {
      damping: 80,
      stiffness: 600,
    });
  }, [currentStep, translateX]);

  const animatedStepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  // Step names for progress indicator
  const getStepName = (): string => {
    if (currentStep === 1) {
      return isTennis
        ? t('onboarding.stepNames.tennisRating')
        : t('onboarding.stepNames.pickleballRating');
    }
    return t('onboarding.stepNames.preferences');
  };

  // Save rating and advance to preferences step
  const handleNext = useCallback(async () => {
    if (!selectedRating || isSavingRating) return;
    mediumHaptic();
    setIsSavingRating(true);

    try {
      const { data: sportData, error: sportError } = await SportService.getSportByName(sportName);

      if (sportError || !sportData) {
        Logger.error('Failed to fetch sport', sportError as Error);
        Alert.alert(t('alerts.error'), t('onboarding.validation.failedToSaveRating'), [
          { text: t('common.ok') },
        ]);
        setIsSavingRating(false);
        return;
      }

      const selectedRatingData = ratings.find(r => r.id === selectedRating);
      if (!selectedRatingData) {
        Alert.alert(t('alerts.error'), t('onboarding.validation.invalidRating'));
        setIsSavingRating(false);
        return;
      }

      const ratingData: OnboardingRating = {
        sport_id: sportData.id,
        sport_name: sportName,
        rating_system_code: ratingSystem,
        score_value: selectedRatingData.score_value,
        display_label: selectedRatingData.display_label,
      };

      const { error } = await OnboardingService.saveRatings([ratingData]);
      if (error) {
        Logger.error('Failed to save rating', error as Error, { ratingData });
        Alert.alert(t('alerts.error'), t('onboarding.validation.failedToSaveRating'), [
          { text: t('common.ok') },
        ]);
        setIsSavingRating(false);
        return;
      }

      Logger.debug('wizard_rating_saved', { ratingData });
      setCurrentStep(2);
    } catch (error) {
      Logger.error('Unexpected error saving rating', error as Error);
      Alert.alert(t('alerts.error'), t('onboarding.validation.unexpectedError'), [
        { text: t('common.ok') },
      ]);
    } finally {
      setIsSavingRating(false);
    }
  }, [selectedRating, isSavingRating, sportName, ratingSystem, ratings, t]);

  // Save preferences and complete wizard
  const handleComplete = useCallback(async () => {
    if (isSavingPreferences) return;
    mediumHaptic();
    setIsSavingPreferences(true);

    try {
      // Update basic preferences in player_sport table
      const updateResult = await withTimeout(
        (async () =>
          supabase
            .from('player_sport')
            .update({
              preferred_match_duration: matchDuration,
              preferred_match_type: matchType,
            })
            .eq('id', playerSportId))(),
        10000,
        'Failed to save preferences - connection timeout'
      );

      if (updateResult.error) throw updateResult.error;

      // Save play style to junction table
      if (playStyle) {
        await supabase
          .from('player_sport_play_style')
          .delete()
          .eq('player_sport_id', playerSportId);

        const { data: playStyleData } = await supabase
          .from('play_style')
          .select('id')
          .eq('sport_id', sportId)
          .eq('name', playStyle)
          .single();

        if (playStyleData) {
          await supabase.from('player_sport_play_style').insert({
            player_sport_id: playerSportId,
            play_style_id: playStyleData.id,
          });
        }
      }

      // Save play attributes to junction table
      await supabase
        .from('player_sport_play_attribute')
        .delete()
        .eq('player_sport_id', playerSportId);

      if (playAttributes.length > 0) {
        const { data: playAttributeData } = await supabase
          .from('play_attribute')
          .select('id, name')
          .eq('sport_id', sportId)
          .in('name', playAttributes);

        if (playAttributeData && playAttributeData.length > 0) {
          const attributeInserts = playAttributeData.map(attr => ({
            player_sport_id: playerSportId,
            play_attribute_id: attr.id,
          }));
          await supabase.from('player_sport_play_attribute').insert(attributeInserts);
        }
      }

      didCompleteRef.current = true;
      onComplete?.();
    } catch (error) {
      Logger.error('Failed to save preferences', error as Error, { playerSportId });
      Alert.alert(t('alerts.error'), t('alerts.sportSetupIncomplete'), [{ text: t('common.ok') }]);
    } finally {
      setIsSavingPreferences(false);
    }
  }, [
    isSavingPreferences,
    matchDuration,
    matchType,
    playStyle,
    playAttributes,
    playerSportId,
    sportId,
    onComplete,
    t,
  ]);

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleClose = () => {
    Alert.alert(t('sportSetup.cancelTitle'), t('sportSetup.cancelMessage'), [
      { text: t('common.no'), style: 'cancel' },
      {
        text: t('common.yes'),
        style: 'destructive',
        onPress: () => {
          onCancel?.();
        },
      },
    ]);
  };

  const canAdvance = currentStep === 1 ? !!selectedRating : false;
  const canComplete = !!matchDuration && !!matchType && !!playStyle && playAttributes.length > 0;

  // ==========================================================================
  // RENDER: Rating Step
  // ==========================================================================
  const renderRatingStep = () => (
    <ScrollView
      style={styles.scrollContent}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Sport Badge */}
      <View style={[styles.sportBadge, { backgroundColor: colors.primary }]}>
        <Text style={[styles.sportBadgeText, { color: colors.primaryForeground }]}>
          {isTennis ? t('onboarding.tennis') : t('onboarding.pickleball')}
        </Text>
      </View>

      {/* Subtitle */}
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>
        {isTennis
          ? t('onboarding.ratingOverlay.tennisSubtitle')
          : t('onboarding.ratingOverlay.pickleballSubtitle')}
      </Text>

      {/* Rating Grid */}
      {isLoadingRatings ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textMuted }]}>
            {t('onboarding.ratingOverlay.loading')}
          </Text>
        </View>
      ) : (
        <View style={styles.ratingGrid}>
          {ratings.map(rating => (
            <TouchableOpacity
              key={rating.id}
              style={[
                styles.ratingCard,
                { backgroundColor: colors.inputBackground },
                selectedRating === rating.id && [
                  styles.ratingCardSelected,
                  {
                    borderColor: colors.primary,
                    backgroundColor: isDark ? colors.inputBackground : primary[50],
                  },
                ],
              ]}
              onPress={() => {
                selectionHaptic();
                setSelectedRating(rating.id);
              }}
              activeOpacity={0.8}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                <Ionicons
                  name={getRatingIcon(getSkillCategory(rating.score_value))}
                  size={20}
                  color={colors.primary}
                  style={{ marginRight: 8 }}
                />
                <Text style={[styles.ratingLevel, { color: colors.text }]}>
                  {t(getSkillLabelKey(rating.score_value))}
                </Text>
              </View>
              <Text
                style={[
                  styles.ratingLabel,
                  {
                    color: selectedRating === rating.id ? colors.text : colors.textMuted,
                  },
                ]}
              >
                {rating.display_label}
              </Text>
              <Text
                style={[
                  styles.ratingDescription,
                  {
                    color: selectedRating === rating.id ? colors.text : colors.textMuted,
                  },
                ]}
              >
                {t(getDescriptionKey(rating.score_value))}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </ScrollView>
  );

  // ==========================================================================
  // RENDER: Preferences Step
  // ==========================================================================
  const renderPreferencesStep = () => (
    <ScrollView
      style={styles.scrollContent}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Match Duration */}
      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.text }]}>
          {t('profile.preferences.matchDuration')}
        </Text>
        <View style={styles.chipsContainer}>
          {MATCH_DURATIONS.map(duration => (
            <TouchableOpacity
              key={duration.value}
              style={[
                styles.chip,
                { backgroundColor: colors.inputBackground },
                matchDuration === duration.value && [
                  styles.chipSelected,
                  { backgroundColor: colors.primary },
                ],
              ]}
              onPress={() => {
                selectionHaptic();
                setMatchDuration(duration.value);
              }}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: colors.textMuted },
                  ...(matchDuration === duration.value
                    ? [styles.chipTextSelected, { color: colors.primaryForeground }]
                    : []),
                ]}
              >
                {duration.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Match Type */}
      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.text }]}>
          {t('profile.preferences.matchType')}
        </Text>
        <View style={styles.chipsContainer}>
          {MATCH_TYPES.map(type => (
            <TouchableOpacity
              key={type.value}
              style={[
                styles.chip,
                { backgroundColor: colors.inputBackground },
                matchType === type.value && [
                  styles.chipSelected,
                  { backgroundColor: colors.primary },
                ],
              ]}
              onPress={() => {
                selectionHaptic();
                setMatchType(type.value);
              }}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: colors.textMuted },
                  ...(matchType === type.value
                    ? [styles.chipTextSelected, { color: colors.primaryForeground }]
                    : []),
                ]}
              >
                {type.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Favorite Facilities */}
      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.text }]}>
          {t('profile.preferences.favoriteFacilities')}
        </Text>
        <Text style={[styles.sublabel, { color: colors.textMuted }]}>
          {t('profile.preferences.selectUpTo3')}
        </Text>
        {userId && sportId ? (
          <FavoriteFacilitiesSelector
            playerId={userId}
            sportId={sportId}
            latitude={latitude}
            longitude={longitude}
            colors={{
              text: colors.text,
              textMuted: colors.textMuted,
              inputBackground: colors.inputBackground,
              border: colors.border,
              primary: colors.primary,
              primaryForeground: colors.primaryForeground,
              card: colors.card,
            }}
            t={(key: string) => t(key as Parameters<typeof t>[0])}
          />
        ) : (
          <Text style={{ color: colors.textMuted, fontStyle: 'italic' }}>
            {t('common.loading')}
          </Text>
        )}
      </View>

      {/* Play Style */}
      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.text }]}>
          {t('profile.preferences.playStyle')}
        </Text>
        <TouchableOpacity
          style={[
            styles.inputContainer,
            { backgroundColor: colors.inputBackground, borderColor: colors.border },
          ]}
          onPress={() => {
            selectionHaptic();
            setShowPlayStyleDropdown(!showPlayStyleDropdown);
          }}
        >
          <Text
            style={[
              styles.input,
              styles.dropdownText,
              { color: playStyle ? colors.text : colors.textMuted },
            ]}
          >
            {playStyle
              ? PLAY_STYLES.find(s => s.value === playStyle)?.label
              : t('profile.preferences.selectPlayStyle')}
          </Text>
          <Ionicons
            name={showPlayStyleDropdown ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={colors.textMuted}
            style={styles.inputIcon}
          />
        </TouchableOpacity>

        {showPlayStyleDropdown && (
          <View
            style={[
              styles.dropdown,
              { backgroundColor: colors.inputBackground, borderColor: colors.border },
            ]}
          >
            {PLAY_STYLES.map(style => (
              <TouchableOpacity
                key={style.value}
                style={[
                  styles.dropdownItem,
                  { borderBottomColor: colors.border },
                  playStyle === style.value && [
                    styles.dropdownItemSelected,
                    { backgroundColor: colors.card },
                  ],
                ]}
                onPress={() => {
                  selectionHaptic();
                  setPlayStyle(style.value);
                  setShowPlayStyleDropdown(false);
                }}
              >
                <Text
                  style={[
                    styles.dropdownItemText,
                    { color: colors.text },
                    ...(playStyle === style.value
                      ? [
                          styles.dropdownItemTextSelected,
                          { color: colors.primary, fontWeight: '600' as const },
                        ]
                      : []),
                  ]}
                >
                  {style.label}
                </Text>
                {playStyle === style.value && (
                  <Ionicons name="checkmark-outline" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* Play Attributes - grouped by category */}
      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.text }]}>
          {t('profile.fields.playAttributes')}
        </Text>
        <Text style={[styles.sublabel, { color: colors.textMuted }]}>
          {t('profile.preferences.selectAllThatApply')}
        </Text>
        {loadingPlayOptions ? (
          <Text style={{ color: colors.textMuted, marginBottom: 12 }}>{t('common.loading')}</Text>
        ) : Object.keys(playAttributesByCategory).length > 0 ? (
          Object.entries(playAttributesByCategory).map(([category, attributes]) => (
            <View key={category} style={styles.categorySection}>
              <Text style={[styles.categoryLabel, { color: colors.textMuted }]}>
                {getCategoryLabel(category, t)}
              </Text>
              <View style={styles.chipsContainer}>
                {attributes.map(attribute => (
                  <TouchableOpacity
                    key={attribute.name}
                    style={[
                      styles.attributeChip,
                      { backgroundColor: colors.inputBackground },
                      playAttributes.includes(attribute.name) && [
                        styles.attributeChipSelected,
                        { backgroundColor: colors.primary },
                      ],
                    ]}
                    onPress={() => {
                      selectionHaptic();
                      setPlayAttributes(prev =>
                        prev.includes(attribute.name)
                          ? prev.filter(a => a !== attribute.name)
                          : [...prev, attribute.name]
                      );
                    }}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: colors.textMuted },
                        ...(playAttributes.includes(attribute.name)
                          ? [styles.chipTextSelected, { color: colors.primaryForeground }]
                          : []),
                      ]}
                    >
                      {getPlayAttributeLabel(attribute.name, t)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))
        ) : (
          <Text style={{ color: colors.textMuted, fontStyle: 'italic' }}>
            No attributes available
          </Text>
        )}
      </View>
    </ScrollView>
  );

  // ==========================================================================
  // MAIN RENDER
  // ==========================================================================
  return (
    <ActionSheet
      ref={sheetRef}
      gestureEnabled={false}
      closable={false}
      closeOnTouchBackdrop={false}
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.card }]}
      onBeforeClose={() => {
        if (!didCompleteRef.current) {
          onCancel?.();
        }
      }}
    >
      <View style={styles.modalContent}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          {currentStep > 1 && (
            <TouchableOpacity onPress={handleBack} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
          )}
          <View style={styles.headerCenter}>
            <Text
              weight="semibold"
              size="lg"
              style={{ color: colors.text }}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {t('sportSetup.wizardTitle')}
            </Text>
          </View>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Progress Indicator */}
        <ProgressIndicator
          currentStep={currentStep}
          totalSteps={TOTAL_STEPS}
          stepName={getStepName()}
        />

        {/* Sliding Step Container */}
        <View style={styles.stepsViewport}>
          <Animated.View
            style={[
              styles.stepsContainer,
              { width: SCREEN_WIDTH * TOTAL_STEPS },
              animatedStepStyle,
            ]}
          >
            <View style={[styles.stepWrapper, { width: SCREEN_WIDTH }]}>{renderRatingStep()}</View>
            <View style={[styles.stepWrapper, { width: SCREEN_WIDTH }]}>
              {renderPreferencesStep()}
            </View>
          </Animated.View>
        </View>

        {/* Footer */}
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          {currentStep === 1 ? (
            <TouchableOpacity
              style={[
                styles.submitButton,
                { backgroundColor: colors.primary },
                (!canAdvance || isSavingRating) && { opacity: 0.6 },
              ]}
              onPress={handleNext}
              disabled={!canAdvance || isSavingRating}
              activeOpacity={0.8}
            >
              {isSavingRating ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Text weight="semibold" style={{ color: colors.primaryForeground }}>
                  {t('common.next')}
                </Text>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[
                styles.submitButton,
                { backgroundColor: colors.primary },
                (!canComplete || isSavingPreferences) && { opacity: 0.6 },
              ]}
              onPress={handleComplete}
              disabled={!canComplete || isSavingPreferences}
              activeOpacity={0.8}
            >
              {isSavingPreferences ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Text weight="semibold" style={{ color: colors.primaryForeground }}>
                  {t('onboarding.complete')}
                </Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
    </ActionSheet>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  sheetBackground: {
    flex: 1,
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  modalContent: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[4],
    borderBottomWidth: 1,
    position: 'relative',
    minHeight: 56,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacingPixels[12],
  },
  backButton: {
    padding: spacingPixels[1],
    position: 'absolute',
    left: spacingPixels[4],
    zIndex: 1,
  },
  closeButton: {
    padding: spacingPixels[1],
    position: 'absolute',
    right: spacingPixels[4],
    zIndex: 1,
  },
  stepsViewport: {
    flex: 1,
    overflow: 'hidden',
  },
  stepsContainer: {
    flexDirection: 'row',
    flex: 1,
  },
  stepWrapper: {
    flex: 1,
    height: '100%',
  },
  scrollContent: {
    flex: 1,
  },
  content: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[6],
  },
  // Rating step styles
  sportBadge: {
    paddingHorizontal: 20,
    paddingVertical: 6,
    borderRadius: 16,
    alignSelf: 'center',
    marginBottom: 20,
  },
  sportBadgeText: {
    fontSize: 14,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 14,
    marginBottom: 15,
  },
  ratingGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
  },
  ratingCard: {
    width: '48%',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  ratingCardSelected: {
    // borderColor and backgroundColor applied inline
  },
  ratingLevel: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  ratingLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  ratingDescription: {
    fontSize: 11,
    lineHeight: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  // Preferences step styles
  section: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  sublabel: {
    fontSize: 14,
    marginBottom: 12,
    marginTop: -8,
  },
  categorySection: {
    marginBottom: 16,
  },
  categoryLabel: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 8,
  },
  chip: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  chipSelected: {
    // backgroundColor applied inline
  },
  attributeChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 0,
    marginBottom: 8,
    marginRight: 8,
  },
  attributeChipSelected: {
    // backgroundColor applied inline
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
  },
  chipTextSelected: {
    // color applied inline
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
  },
  dropdownText: {
    paddingVertical: 14,
  },
  inputIcon: {
    marginLeft: 8,
  },
  dropdown: {
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  dropdownItemSelected: {
    // backgroundColor applied inline
  },
  dropdownItemText: {
    fontSize: 16,
  },
  dropdownItemTextSelected: {
    // fontWeight and color applied inline
  },
  // Footer
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: radiusPixels.lg,
  },
});
