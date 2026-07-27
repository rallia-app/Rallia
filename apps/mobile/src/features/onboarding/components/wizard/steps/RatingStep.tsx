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
import { ScrollView as SheetScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import DatabaseService, { Logger } from '@rallia/shared-services';
import {
  RATING_SYSTEM_URLS,
  ratingDescriptionKey,
  ratingSkillLevelKey,
  ratingSkillTier,
  selectionHaptic,
  type RatingSystemCode,
} from '@rallia/shared-utils';
import type { TranslationKey } from '@rallia/shared-translations';

import type { OnboardingFormData } from '#/features/onboarding/hooks/useOnboardingWizard';

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
 * Score → translation key. The mappings live in @rallia/shared-utils so web's rating
 * step names and describes each level identically; only the namespace prefix (which
 * differs by translator shape) is applied here.
 */
const skillLabelKey = (system: RatingSystemCode, scoreValue: number): TranslationKey => {
  const leaf = ratingSkillLevelKey(system, scoreValue);
  return leaf
    ? (`onboarding.ratingStep.skillLevels.${leaf}` as TranslationKey)
    : ('' as TranslationKey);
};

const descriptionKey = (system: RatingSystemCode, scoreValue: number): TranslationKey =>
  `onboarding.ratingStep.${ratingDescriptionKey(system, scoreValue)}` as TranslationKey;

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
  const ratingSystem: RatingSystemCode = isTennis ? 'ntrp' : 'dupr';
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
        // Guard the destructure: a null/undefined resolution would throw "Cannot convert undefined value to object" on Hermes
        const response = await DatabaseService.RatingScore.getRatingScoresBySport(
          sport,
          ratingSystem
        );
        const { data, error } = response ?? { data: null, error: null };

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

  const getRatingUrl = () => RATING_SYSTEM_URLS[ratingSystem];

  return (
    <SheetScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
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
                    name={getRatingIcon(ratingSkillTier(rating.score_value))}
                    size={20}
                    color={isSelected ? colors.buttonActive : colors.buttonActive}
                    style={styles.ratingIcon}
                  />
                  <Text
                    size="base"
                    weight="bold"
                    color={isSelected ? colors.buttonActive : colors.text}
                  >
                    {t(skillLabelKey(ratingSystem, rating.score_value))}
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
                  {t(descriptionKey(ratingSystem, rating.score_value))}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </SheetScrollView>
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
