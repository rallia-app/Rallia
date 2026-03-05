/**
 * RatingStep Component
 *
 * Generic rating step for Tennis (NTRP) and Pickleball (DUPR).
 * Migrated from TennisRatingOverlay/PickleballRatingOverlay with theme-aware colors.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Alert,
} from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import DatabaseService, { Logger } from '@rallia/shared-services';
import { selectionHaptic } from '@rallia/shared-utils';
import type { TranslationKey } from '@rallia/shared-translations';
import type { OnboardingFormData } from '../../../hooks/useOnboardingWizard';
import TennisIcon from '../../../../../../assets/icons/tennis.svg';
import PickleballIcon from '../../../../../../assets/icons/pickleball.svg';

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
  inputBackground: string;
}

interface Rating {
  id: string;
  score_value: number;
  display_label: string;
  description: string;
  skill_level: 'beginner' | 'intermediate' | 'advanced' | 'professional' | null;
}

/**
 * Maps NTRP score value to a translation key
 */
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

/**
 * Maps DUPR score value to a translation key
 */
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

/**
 * Maps NTRP score value to a description translation key
 */
const getNtrpDescriptionKey = (scoreValue: number): TranslationKey => {
  return `onboarding.ratingStep.ntrpDescriptions.${scoreValue.toFixed(1).replace('.', '_')}` as TranslationKey;
};

/**
 * Maps DUPR score value to a description translation key
 */
const getDuprDescriptionKey = (scoreValue: number): TranslationKey => {
  return `onboarding.ratingStep.duprDescriptions.${scoreValue.toFixed(1).replace('.', '_')}` as TranslationKey;
};

/**
 * Get skill category from score value for icon selection
 */
const getSkillCategory = (scoreValue: number): string => {
  if (scoreValue <= 2.5) return 'beginner';
  if (scoreValue <= 4.0) return 'intermediate';
  if (scoreValue <= 5.5) return 'advanced';
  return 'professional';
};

interface RatingStepProps {
  sport: 'tennis' | 'pickleball';
  formData: OnboardingFormData;
  onUpdateFormData: (updates: Partial<OnboardingFormData>) => void;
  onContinue: () => void;
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
  isDark: boolean;
}

export const RatingStep: React.FC<RatingStepProps> = ({
  sport,
  formData,
  onUpdateFormData,
  onContinue: _onContinue,
  colors,
  t,
}) => {
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const isTennis = sport === 'tennis';
  const ratingSystem = isTennis ? 'ntrp' : 'dupr';
  const titleKey = isTennis
    ? 'onboarding.ratingStep.tennisTitle'
    : 'onboarding.ratingStep.pickleballTitle';
  const badgeText = isTennis
    ? t('onboarding.ratingStep.ntrpBadge')
    : t('onboarding.ratingStep.duprBadge');
  const selectedRatingId = isTennis ? formData.tennisRatingId : formData.pickleballRatingId;
  const ratingFieldKey = isTennis ? 'tennisRatingId' : 'pickleballRatingId';

  // Load ratings from database
  useEffect(() => {
    const loadRatings = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await DatabaseService.RatingScore.getRatingScoresBySport(
          sport,
          ratingSystem
        );

        if (error || !data) {
          Logger.error(`Failed to load ${sport} ratings`, error as Error, {
            sport,
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
        Logger.error(`Unexpected error loading ${sport} ratings`, error as Error);
        Alert.alert(t('alerts.error'), t('onboarding.validation.unexpectedError'));
      } finally {
        setIsLoading(false);
      }
    };

    loadRatings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sport, ratingSystem]);

  const handleRatingSelect = (ratingId: string) => {
    selectionHaptic();
    onUpdateFormData({ [ratingFieldKey]: ratingId });
  };

  const getRatingIcon = (skillLevel: string): keyof typeof Ionicons.glyphMap => {
    if (skillLevel === 'beginner') return 'star-outline';
    if (skillLevel === 'intermediate') return 'star-half';
    if (skillLevel === 'advanced') return 'star';
    return 'trophy';
  };

  const getRatingUrl = () => {
    return isTennis
      ? 'https://www.usta.com/content/dam/usta/pdfs/10013_experience_player_ntrp_characteristics1%20(2).pdf'
      : 'https://www.dupr.com/post/understanding-all-pickleball-ratings';
  };

  return (
    <BottomSheetScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      {/* Sport Icon */}
      <View style={styles.sportIconContainer}>
        {isTennis ? (
          <TennisIcon width={48} height={48} fill={colors.text} />
        ) : (
          <PickleballIcon width={48} height={48} fill={colors.text} />
        )}
      </View>

      {/* Title */}
      <Text size="xl" weight="bold" color={colors.text} style={styles.title}>
        {t(titleKey)}
      </Text>

      {/* Rating System Badge */}
      <View style={[styles.sportBadge, { backgroundColor: colors.buttonActive }]}>
        <Text size="sm" weight="semibold" color={colors.buttonTextActive}>
          {badgeText}
        </Text>
        {isTennis ? (
          <TennisIcon
            width={16}
            height={16}
            fill={colors.buttonTextActive}
            style={styles.badgeIcon}
          />
        ) : (
          <PickleballIcon
            width={16}
            height={16}
            fill={colors.buttonTextActive}
            style={styles.badgeIcon}
          />
        )}
      </View>

      {/* Learn More Link */}
      <TouchableOpacity
        style={styles.learnMore}
        onPress={() => Linking.openURL(getRatingUrl())}
        activeOpacity={0.7}
      >
        <Text size="sm" color={colors.buttonActive}>
          {t(
            isTennis
              ? 'onboarding.ratingOverlay.learnMoreNtrp'
              : 'onboarding.ratingOverlay.learnMoreDupr'
          )}
        </Text>
        <Ionicons
          name="open-outline"
          size={14}
          color={colors.buttonActive}
          style={styles.externalLinkIcon}
        />
      </TouchableOpacity>

      {/* Rating Options */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.buttonActive} />
          <Text size="sm" color={colors.textMuted} style={styles.loadingText}>
            {t('common.loading')}
          </Text>
        </View>
      ) : (
        <View style={styles.ratingGrid}>
          {ratings.map(rating => {
            const isSelected = selectedRatingId === rating.id;

            return (
              <TouchableOpacity
                key={rating.id}
                style={[
                  styles.ratingCard,
                  {
                    backgroundColor: isSelected
                      ? `${colors.buttonActive}20`
                      : colors.inputBackground,
                    borderColor: isSelected ? colors.buttonActive : colors.border,
                  },
                ]}
                onPress={() => handleRatingSelect(rating.id)}
                activeOpacity={0.8}
              >
                <View style={styles.ratingHeader}>
                  <Ionicons
                    name={getRatingIcon(getSkillCategory(rating.score_value))}
                    size={20}
                    color={isSelected ? colors.buttonActive : colors.buttonActive}
                    style={styles.ratingIcon}
                  />
                  <Text
                    size="base"
                    weight="bold"
                    color={isSelected ? colors.buttonActive : colors.text}
                  >
                    {t(
                      isTennis
                        ? getNtrpSkillLabelKey(rating.score_value)
                        : getDuprSkillLabelKey(rating.score_value)
                    )}
                  </Text>
                </View>
                <Text
                  size="sm"
                  weight="semibold"
                  color={isSelected ? colors.buttonActive : colors.textSecondary}
                  style={styles.ratingLabel}
                >
                  {rating.display_label}
                </Text>
                <Text
                  size="xs"
                  color={isSelected ? colors.text : colors.textSecondary}
                  style={styles.ratingDescription}
                >
                  {t(
                    isTennis
                      ? getNtrpDescriptionKey(rating.score_value)
                      : getDuprDescriptionKey(rating.score_value)
                  )}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </BottomSheetScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[8],
    flexGrow: 1,
  },
  sportIconContainer: {
    alignItems: 'center',
    marginBottom: spacingPixels[2],
  },
  title: {
    textAlign: 'center',
    marginBottom: spacingPixels[3],
  },
  sportBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
    alignSelf: 'center',
    marginBottom: spacingPixels[4],
  },
  badgeIcon: {
    marginLeft: spacingPixels[1.5],
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[4],
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacingPixels[10],
  },
  loadingText: {
    marginTop: spacingPixels[3],
  },
  ratingGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: spacingPixels[2],
  },
  ratingCard: {
    width: '48%',
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[3],
    marginBottom: spacingPixels[2],
    borderWidth: 2,
  },
  ratingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[1],
  },
  ratingIcon: {
    marginRight: spacingPixels[2],
  },
  ratingLabel: {
    marginBottom: spacingPixels[1.5],
  },
  ratingDescription: {
    lineHeight: 16,
  },
  learnMore: {
    flexDirection: 'row',
    marginBottom: spacingPixels[4],
    alignItems: 'center',
    justifyContent: 'center',
  },
  externalLinkIcon: {
    marginLeft: spacingPixels[1],
  },
});

export default RatingStep;
