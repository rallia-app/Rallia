import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Text } from '@rallia/shared-components';
import DatabaseService, { OnboardingService, SportService, Logger } from '@rallia/shared-services';
import type { OnboardingRating } from '@rallia/shared-types';
import ProgressIndicator from '../ProgressIndicator';
import { selectionHaptic, mediumHaptic } from '@rallia/shared-utils';
import { useThemeStyles, useTranslation } from '../../../../hooks';
import { primary, radiusPixels, spacingPixels } from '@rallia/design-system';
import type { TranslationKey } from '@rallia/shared-translations';

interface PickleballRatingOverlayProps {
  visible: boolean;
  onClose: () => void;
  onBack?: () => void;
  onContinue?: (rating: string) => void;
  currentStep?: number;
  totalSteps?: number;
  mode?: 'onboarding' | 'edit'; // Mode: onboarding (create) or edit (update)
  initialRating?: string; // Pre-selected rating ID for edit mode
  onSave?: (ratingId: string) => void; // Save callback for edit mode
}

interface Rating {
  id: string;
  score_value: number;
  display_label: string;
  description: string;
  skill_level: 'beginner' | 'intermediate' | 'advanced' | 'professional' | null;
}

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
 * Maps DUPR score value to a description translation key
 */
const getDuprDescriptionKey = (scoreValue: number): TranslationKey => {
  return `onboarding.ratingStep.duprDescriptions.${scoreValue.toFixed(1).replace('.', '_')}` as TranslationKey;
};

export function PickleballRatingActionSheet({ payload }: SheetProps<'pickleball-rating'>) {
  const mode = payload?.mode || 'onboarding';
  const onBack = payload?.onBack;
  const onContinue = payload?.onContinue;
  const onSave = payload?.onSave;
  const onDismiss = payload?.onDismiss;
  const currentStep = payload?.currentStep || 1;
  const totalSteps = payload?.totalSteps || 8;
  const initialRating = payload?.initialRating;
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const [selectedRating, setSelectedRating] = useState<string | null>(initialRating || null);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Track if save was called to distinguish between saved close and dismissed close
  const didSaveRef = useRef(false);

  const onClose = () => {
    // onBeforeClose will handle calling onDismiss if not saved
    SheetManager.hide('pickleball-rating');
  };

  // Load ratings from database when component mounts
  useEffect(() => {
    const loadRatings = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await DatabaseService.RatingScore.getRatingScoresBySport(
          'pickleball',
          'dupr'
        );

        if (error || !data) {
          Logger.error('Failed to load pickleball ratings', error as Error, {
            sport: 'pickleball',
            system: 'dupr',
          });
          Alert.alert(t('alerts.error'), t('onboarding.ratingOverlay.failedToLoadRatings'));
          return;
        }

        // Transform database data to match UI expectations
        const transformedRatings: Rating[] = data.map(rating => ({
          id: rating.id,
          score_value: rating.score_value,
          display_label: rating.display_label,
          description: rating.description,
          skill_level: rating.skill_level,
        }));

        setRatings(transformedRatings);
      } catch (error) {
        Logger.error('Unexpected error loading pickleball ratings', error as Error);
        Alert.alert(t('alerts.error'), t('onboarding.ratingOverlay.unexpectedError'));
      } finally {
        setIsLoading(false);
      }
    };

    loadRatings();
  }, [t]);

  // Update selected rating when initialRating changes
  useEffect(() => {
    if (initialRating) {
      setSelectedRating(initialRating);
    }
  }, [initialRating]);

  // Helper function to get skill category from DUPR score value
  const getSkillCategory = (scoreValue: number): string => {
    if (scoreValue <= 2.5) return 'beginner';
    if (scoreValue <= 4.0) return 'intermediate';
    if (scoreValue <= 5.5) return 'advanced';
    return 'professional';
  };

  // Helper function to get icon based on skill level
  const getRatingIcon = (skillLevel: string): keyof typeof Ionicons.glyphMap => {
    if (skillLevel === 'beginner') return 'star-outline';
    if (skillLevel === 'intermediate') return 'star-half';
    if (skillLevel === 'advanced') return 'star';
    return 'trophy'; // professional
  };

  const handleContinue = async () => {
    if (!selectedRating || isSaving) return;

    mediumHaptic();

    // Edit mode: use the onSave callback
    if (mode === 'edit' && onSave) {
      didSaveRef.current = true; // Mark as saved before closing
      onSave(selectedRating);
      SheetManager.hide('pickleball-rating');
      return;
    }

    // Onboarding mode: save to database
    if (onContinue) {
      setIsSaving(true);
      try {
        // Get pickleball sport ID
        const { data: pickleballSport, error: sportError } =
          await SportService.getSportByName('pickleball');

        if (sportError || !pickleballSport) {
          Logger.error('Failed to fetch pickleball sport', sportError as Error);
          setIsSaving(false);
          Alert.alert(t('alerts.error'), t('onboarding.ratingOverlay.failedToSaveRating'), [
            { text: t('common.ok') },
          ]);
          return;
        }

        // Find the selected rating data
        const selectedRatingData = ratings.find(r => r.id === selectedRating);

        if (!selectedRatingData) {
          setIsSaving(false);
          Alert.alert(t('alerts.error'), t('onboarding.ratingOverlay.invalidRatingSelected'));
          return;
        }

        // Save rating to database
        const ratingData: OnboardingRating = {
          sport_id: pickleballSport.id,
          sport_name: 'pickleball',
          rating_system_code: 'dupr',
          score_value: selectedRatingData.score_value,
          display_label: selectedRatingData.display_label,
        };

        const { error } = await OnboardingService.saveRatings([ratingData]);

        if (error) {
          Logger.error('Failed to save pickleball rating', error as Error, { ratingData });
          setIsSaving(false);
          Alert.alert(t('alerts.error'), t('onboarding.ratingOverlay.failedToSaveRating'), [
            { text: t('common.ok') },
          ]);
          return;
        }

        Logger.debug('pickleball_rating_saved', { ratingData });
        onContinue?.(selectedRating);
      } catch (error) {
        Logger.error('Unexpected error saving pickleball rating', error as Error);
        setIsSaving(false);
        Alert.alert(t('alerts.error'), t('onboarding.ratingOverlay.unexpectedError'), [
          { text: t('common.ok') },
        ]);
      }
    }
  };

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.card }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
      onBeforeClose={() => {
        // Call onDismiss if sheet is closed without saving (in edit mode with onDismiss callback)
        if (mode === 'edit' && onDismiss && !didSaveRef.current) {
          onDismiss();
        }
      }}
    >
      <View style={styles.modalContent}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerCenter}>
            <Text
              weight="semibold"
              size="lg"
              style={{ color: colors.text }}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {mode === 'edit'
                ? t('onboarding.ratingOverlay.editPickleballTitle')
                : t('onboarding.ratingOverlay.title')}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Scrollable Content */}
        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Progress Indicator - only show in onboarding mode */}
          {mode === 'onboarding' && (
            <ProgressIndicator currentStep={currentStep} totalSteps={totalSteps} />
          )}

          {/* Back Button - Only show in onboarding mode */}
          {mode === 'onboarding' && onBack && (
            <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
          )}

          {/* Sport Badge */}
          <View style={[styles.sportBadge, { backgroundColor: colors.primary }]}>
            <Text style={[styles.sportBadgeText, { color: colors.primaryForeground }]}>
              {t('onboarding.pickleball')}
            </Text>
          </View>

          {/* Subtitle with DUPR link */}
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            {mode === 'edit' ? (
              <Text
                style={[styles.link, { color: colors.primary }]}
                onPress={() =>
                  Linking.openURL('https://www.dupr.com/post/understanding-all-pickleball-ratings')
                }
              >
                {t('onboarding.ratingOverlay.learnMoreDupr')}
              </Text>
            ) : (
              t('onboarding.ratingOverlay.pickleballSubtitle')
            )}
          </Text>

          {/* Rating Options */}
          {isLoading ? (
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
                    <Text
                      style={[
                        styles.ratingLevel,
                        {
                          color: selectedRating === rating.id ? colors.text : colors.text,
                        },
                      ]}
                    >
                      {t(getDuprSkillLabelKey(rating.score_value))}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.ratingDupr,
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
                    {t(getDuprDescriptionKey(rating.score_value))}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>

        {/* Sticky Footer */}
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[
              styles.submitButton,
              { backgroundColor: colors.primary },
              (!selectedRating || isSaving) && { opacity: 0.6 },
            ]}
            onPress={handleContinue}
            disabled={!selectedRating || isSaving}
            activeOpacity={0.8}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Text weight="semibold" style={{ color: colors.primaryForeground }}>
                {mode === 'edit'
                  ? t('onboarding.ratingOverlay.save')
                  : t('onboarding.ratingOverlay.continue')}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </ActionSheet>
  );
}

// Keep old export for backwards compatibility during migration
const PickleballRatingOverlay: React.FC<PickleballRatingOverlayProps> = ({
  visible,
  onClose,
  onBack,
  onContinue,
  currentStep,
  totalSteps,
  mode,
  initialRating,
  onSave,
}) => {
  useEffect(() => {
    if (visible) {
      SheetManager.show('pickleball-rating', {
        payload: {
          mode,
          initialRating,
          onSave,
          onContinue,
          onBack,
          currentStep,
          totalSteps,
        },
      });
    }
  }, [visible, mode, initialRating, onSave, onContinue, onBack, currentStep, totalSteps]);

  useEffect(() => {
    if (!visible) {
      SheetManager.hide('pickleball-rating');
    }
  }, [visible]);

  return null;
};

export default PickleballRatingOverlay;

const styles = StyleSheet.create({
  sheetBackground: {
    flex: 1,
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
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
  closeButton: {
    padding: spacingPixels[1],
    position: 'absolute',
    right: spacingPixels[4],
    zIndex: 1,
  },
  scrollContent: {
    flex: 1,
  },
  content: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[6],
  },
  backButton: {
    alignSelf: 'flex-start',
    padding: spacingPixels[2],
    marginBottom: spacingPixels[2],
  },
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
  ratingCardHighlighted: {
    // backgroundColor applied inline
  },
  ratingCardSelected: {
    // borderColor and backgroundColor applied inline
  },
  ratingLevel: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  ratingLevelHighlighted: {
    // color applied inline
  },
  ratingLevelSelected: {
    // color applied inline
  },
  ratingDupr: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  ratingDuprHighlighted: {
    // color applied inline
  },
  ratingDuprSelected: {
    // color applied inline
  },
  ratingDescription: {
    fontSize: 11,
    lineHeight: 16,
  },
  ratingDescriptionHighlighted: {
    // color applied inline
  },
  ratingDescriptionSelected: {
    // color applied inline
  },
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
  link: {
    textDecorationLine: 'underline',
    fontWeight: '600',
    // color will be set dynamically
  },
});
