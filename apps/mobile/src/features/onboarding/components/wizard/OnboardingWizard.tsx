/**
 * OnboardingWizard Component
 *
 * Onboarding wizard (dynamic based on the sport selected during pre-onboarding)
 * with horizontal slide animations, progress indicator, and theme/i18n support.
 *
 * Steps:
 * 1. Personal Info (also silently persists pre-onboarding home location)
 * 2. Tennis Rating (if tennis selected)
 * 3. Pickleball Rating (if pickleball selected)
 * 4. Preferences
 * 5. Favorite Sites
 * 6. Availabilities
 * 7. Success (final)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Alert,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic, mediumHaptic, successHaptic, warningHaptic } from '@rallia/shared-utils';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  OnboardingService,
  SportService,
  Logger,
  DatabaseService,
  supabase,
  attributeReferral,
  joinGroupByInviteCode,
  requestToJoinCommunityByInviteCode,
  syncHomeLocation as syncHomeLocationToPlayer,
} from '@rallia/shared-services';
import { useProfile, usePlayer, useTopSuggestions } from '@rallia/shared-hooks';
import {
  PENDING_REFERRAL_KEY,
  ACQUISITION_CHANNEL_KEY,
  type PendingReferral,
  type DiscoveryChannelId,
} from '../../../../navigation/deepLinkStore';
import { replaceImage } from '../../../../services/imageUpload';
import * as Analytics from '../../../../services/analytics';
import { posthogClient } from '../../../../providers/PostHogProvider';
import { useImagePicker, useTranslation as useLocale } from '../../../../hooks';
import { useSport, useUserHomeLocation } from '../../../../context';
import type { TranslationKey } from '@rallia/shared-translations';
import type {
  OnboardingPlayerPreferences,
  OnboardingAvailability,
  DayEnum,
  GenderEnum,
} from '@rallia/shared-types';

import {
  useOnboardingWizard,
  computeFavoriteSportCounts,
  type OnboardingStepId,
} from '../../hooks/useOnboardingWizard';
import {
  PersonalInfoStep,
  RatingStep,
  PreferencesStep,
  FavoriteSitesStep,
  AvailabilitiesStep,
  SuccessStep,
  SuggestionsStep,
} from './steps';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// =============================================================================
// TYPES
// =============================================================================

export interface OnboardingWizardColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  buttonActive: string;
  buttonInactive: string;
  buttonTextActive: string;
  progressActive: string;
  progressInactive: string;
  inputBackground: string;
  inputBorder: string;
  inputBorderFocused: string;
  error: string;
  success: string;
  divider: string;
}

interface OnboardingWizardProps {
  /** Callback when onboarding is complete */
  onComplete: () => void;
  /** Callback to close the entire sheet */
  onClose: () => void;
  /** Callback to go back to the actions landing */
  onBackToLanding: () => void;
  /** Theme colors */
  colors: OnboardingWizardColors;
  /** Translation function */
  t: (key: TranslationKey) => string;
  /** Whether dark mode is enabled */
  isDark: boolean;
}

// =============================================================================
// PROGRESS BAR COMPONENT
// =============================================================================

interface ProgressBarProps {
  currentStep: number;
  totalSteps: number;
  stepName: string;
  colors: OnboardingWizardColors;
  t: (key: TranslationKey) => string;
}

const ProgressBar: React.FC<ProgressBarProps> = ({
  currentStep,
  totalSteps,
  stepName,
  colors,
  t,
}) => {
  const progress = useSharedValue((currentStep / totalSteps) * 100);

  useEffect(() => {
    progress.value = withTiming((currentStep / totalSteps) * 100, { duration: 300 });
  }, [currentStep, totalSteps, progress]);

  const animatedProgressStyle = useAnimatedStyle(() => ({
    width: `${progress.value}%`,
  }));

  return (
    <View style={styles.progressContainer}>
      <View style={styles.progressHeader}>
        <Text size="sm" weight="semibold" color={colors.textMuted}>
          {t('onboarding.step')
            .replace('{current}', String(currentStep))
            .replace('{total}', String(totalSteps))}
        </Text>
        <Text size="sm" weight="bold" color={colors.progressActive}>
          {stepName}
        </Text>
      </View>
      <View style={[styles.progressBarBg, { backgroundColor: colors.progressInactive }]}>
        <Animated.View
          style={[
            styles.progressBarFill,
            { backgroundColor: colors.progressActive },
            animatedProgressStyle,
          ]}
        />
      </View>
    </View>
  );
};

// =============================================================================
// WIZARD HEADER COMPONENT
// =============================================================================

interface WizardHeaderProps {
  currentStep: number;
  onBack: () => void;
  onBackToLanding: () => void;
  onClose: () => void;
  colors: OnboardingWizardColors;
  t: (key: TranslationKey) => string;
}

const WizardHeader: React.FC<WizardHeaderProps> = ({
  currentStep,
  onBack,
  onBackToLanding: _onBackToLanding,
  onClose,
  colors,
  t,
}) => {
  return (
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      {/* Back button (visible on all steps) */}
      <View style={styles.headerLeft}>
        {currentStep !== 1 && (
          <TouchableOpacity
            onPress={() => {
              Keyboard.dismiss();
              lightHaptic();
              onBack();
            }}
            style={styles.headerButton}
            accessibilityLabel={t('common.back')}
            accessibilityRole="button"
          >
            <Ionicons name="chevron-back-outline" size={24} color={colors.buttonActive} />
          </TouchableOpacity>
        )}
      </View>

      {/* Empty center space - no title badge like match creation wizard */}
      <View style={styles.headerCenter} />

      {/* Close button */}
      <View style={styles.headerRight}>
        <TouchableOpacity
          onPress={() => {
            Keyboard.dismiss();
            lightHaptic();
            onClose();
          }}
          style={styles.headerButton}
          accessibilityLabel={t('common.close')}
          accessibilityRole="button"
        >
          <Ionicons name="close-outline" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

// =============================================================================
// STEP NAME MAPPING
// =============================================================================

const getStepName = (stepId: OnboardingStepId, t: (key: TranslationKey) => string): string => {
  const keys: Record<OnboardingStepId, TranslationKey> = {
    personal: 'onboarding.stepNames.personal',
    'tennis-rating': 'onboarding.stepNames.tennisRating',
    'pickleball-rating': 'onboarding.stepNames.pickleballRating',
    preferences: 'onboarding.stepNames.preferences',
    'favorite-sites': 'onboarding.stepNames.favoriteSites',
    availabilities: 'onboarding.stepNames.availability',
    success: 'onboarding.complete',
    suggestions: 'onboarding.suggestions.title' as TranslationKey,
  };
  return t(keys[stepId]) || '';
};

const DISCOVERY_CHIP_TO_SOURCE: Record<DiscoveryChannelId, Analytics.AcquisitionSource> = {
  friend: 'discovery_friend',
  social: 'discovery_social',
  app_store: 'discovery_app_store',
  event: 'discovery_event',
  search: 'discovery_search',
  other: 'discovery_other',
};

function resolveAcquisitionSource(
  pending: PendingReferral | null,
  channel: string | null
): Analytics.AcquisitionSource {
  if (pending?.code) {
    return pending.enteredManually ? 'referral_code' : 'referral_link';
  }
  if (channel && channel in DISCOVERY_CHIP_TO_SOURCE) {
    return DISCOVERY_CHIP_TO_SOURCE[channel as DiscoveryChannelId];
  }
  return 'unknown';
}

// =============================================================================
// MAIN WIZARD COMPONENT
// =============================================================================

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
  onComplete,
  onClose,
  onBackToLanding,
  colors,
  t,
  isDark,
}) => {
  const { locale } = useLocale();
  const {
    currentStep,
    currentStepId,
    totalSteps,
    isLoadingData,
    formData,
    updateFormData,
    goToNextStep,
    goToPrevStep,
    isLastStep,
    resetWizard,
    hasTennis,
    hasPickleball,
    steps,
  } = useOnboardingWizard();

  const [isSaving, setIsSaving] = useState(false);
  // Track the last uploaded profile picture URL to clean up old uploads
  const [lastUploadedProfileUrl, setLastUploadedProfileUrl] = useState<string | null>(null);

  // Profile hook to refetch profile when onboarding completes
  const { refetch: refetchProfile } = useProfile();

  // Player hook to refetch player when onboarding completes
  // This is critical: the player record is created during onboarding (savePersonalInfo),
  // but PlayerContext was initialized with null before the record existed.
  // Without this refetch, the player stays null until sign out/sign in.
  const { refetch: refetchPlayer } = usePlayer();

  // Home location captured during pre-onboarding; synced to the player row
  // after personal info is saved, so we no longer need a Location step.
  const { homeLocation } = useUserHomeLocation();

  // Sport context to refetch player sports when onboarding completes
  const { refetch: refetchSports, setSelectedSport, selectedSport } = useSport();

  // State to store selected sports for SuccessStep
  const [selectedSportsForSuccess, setSelectedSportsForSuccess] = useState<
    Array<{ id: string; name: string; display_name: string; icon_url?: string | null }>
  >([]);

  // Player ID for referral sharing on success step
  const [successPlayerId, setSuccessPlayerId] = useState<string | null>(null);

  // Match suggestions for post-success step — pedagogical preview, suggestions
  // only (no real matches mixed in). Top-5 by score, opponent-deduped.
  const suggestionSport = selectedSport ?? selectedSportsForSuccess[0];
  const {
    suggestions: matchSuggestions,
    isLoading: suggestionsLoading,
    refetch: refetchSuggestions,
  } = useTopSuggestions({
    playerId: successPlayerId,
    sportId: suggestionSport?.id,
    sportName: suggestionSport?.name,
    maxItems: 5,
    enabled: currentStepId === 'success' || currentStepId === 'suggestions',
  });

  // Image picker hook
  const { image: profileImage, pickImage } = useImagePicker();

  // Analytics: track onboarding start time for duration calculation
  const onboardingStartTimeRef = useRef(Date.now());
  useEffect(() => {
    if (!isLoadingData) {
      Analytics.onboardingStarted({ auth_provider: 'unknown' });
    }
  }, [isLoadingData]);

  // Sync picked image to form data
  useEffect(() => {
    if (profileImage) {
      updateFormData({ profileImage });
    }
  }, [profileImage, updateFormData]);

  // Initialize lastUploadedProfileUrl from saved data
  useEffect(() => {
    if (formData.savedProfilePictureUrl && !lastUploadedProfileUrl) {
      setLastUploadedProfileUrl(formData.savedProfilePictureUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.savedProfilePictureUrl]);

  // Fetch selected sports when reaching success step
  useEffect(() => {
    const fetchSelectedSports = async () => {
      if (currentStepId === 'success' && formData.selectedSportIds.length > 0) {
        try {
          // Fetch player ID for referral sharing
          const userId = await DatabaseService.Auth.getCurrentUserId();
          if (userId) setSuccessPlayerId(userId);

          const { data: allSports, error } = await DatabaseService.Sport.getAllSports();
          if (error) {
            Logger.error('Failed to fetch sports for success step', error as Error);
            return;
          }

          if (allSports) {
            // Filter to only selected sports and map to SuccessStep format
            const sports = allSports
              .filter(sport => formData.selectedSportIds.includes(sport.id))
              .map(sport => ({
                id: sport.id,
                name: sport.name,
                display_name: sport.display_name,
                icon_url: sport.icon_url,
              }));
            setSelectedSportsForSuccess(sports);
          }
        } catch (error) {
          Logger.error('Unexpected error fetching sports for success step', error as Error);
        }
      }
    };

    fetchSelectedSports();
  }, [currentStepId, formData.selectedSportIds]);

  // Advance from success step to suggestions step
  const handleAdvanceToSuggestions = useCallback(() => {
    goToNextStep();
  }, [goToNextStep]);

  // Refresh suggestions — delegates to the hook's refetch
  const handleRefreshSuggestions = useCallback(async () => {
    await refetchSuggestions();
  }, [refetchSuggestions]);

  // Wrapper to handle async setSelectedSport
  const handleSelectInitialSport = useCallback(
    async (sport: { id: string; name: string; display_name: string; icon_url?: string | null }) => {
      await setSelectedSport(sport);
    },
    [setSelectedSport]
  );

  // Calculate total availability selections for validation
  const totalAvailabilitySelections = useMemo(() => {
    return Object.values(formData.availabilities).reduce(
      (count, day) => count + Object.values(day).filter(Boolean).length,
      0
    );
  }, [formData.availabilities]);

  // Check if button should be disabled based on current step's mandatory fields.
  // Mirrors the required-field checks performed inside validateAndSaveStep so the
  // user gets a visible affordance instead of only an alert on tap.
  const isButtonDisabled = useMemo(() => {
    if (isSaving) return true;

    switch (currentStepId) {
      case 'personal': {
        if (
          !formData.firstName.trim() ||
          !formData.lastName.trim() ||
          !formData.dateOfBirth ||
          !formData.gender
        ) {
          return true;
        }
        const minimumDateOfBirth = new Date();
        minimumDateOfBirth.setFullYear(minimumDateOfBirth.getFullYear() - 13);
        minimumDateOfBirth.setMonth(minimumDateOfBirth.getMonth() - 1);
        if (formData.dateOfBirth > minimumDateOfBirth) return true;
        return false;
      }
      case 'tennis-rating':
        return !formData.tennisRatingId;
      case 'pickleball-rating':
        return !formData.pickleballRatingId;
      case 'favorite-sites': {
        const bothSports = hasTennis && hasPickleball;
        if (bothSports) {
          const counts = computeFavoriteSportCounts(formData);
          return counts.tennisCount < 2 || counts.pickleballCount < 2;
        }
        return formData.favoriteFacilities.length < 2;
      }
      case 'availabilities':
        return totalAvailabilitySelections < 3;
      default:
        return false;
    }
  }, [isSaving, currentStepId, totalAvailabilitySelections, formData, hasTennis, hasPickleball]);

  // Animation values
  const translateX = useSharedValue(0);

  // Get current step index for animations
  const currentStepIndex = steps.indexOf(currentStepId);

  // Animate step changes
  useEffect(() => {
    translateX.value = withSpring(-currentStepIndex * SCREEN_WIDTH, {
      damping: 80,
      stiffness: 600,
      overshootClamping: false,
    });
  }, [currentStepIndex, translateX]);

  // Validate and save current step data
  const validateAndSaveStep = useCallback(async (): Promise<boolean> => {
    switch (currentStepId) {
      case 'personal': {
        // Validate personal info
        if (
          !formData.firstName.trim() ||
          !formData.lastName.trim() ||
          !formData.dateOfBirth ||
          !formData.gender
        ) {
          Alert.alert(t('alerts.error'), t('onboarding.validation.fillRequiredFields'));
          warningHaptic();
          return false;
        }

        // Check minimum age (13 years and 1 month)
        const minimumDateOfBirth = new Date();
        minimumDateOfBirth.setFullYear(minimumDateOfBirth.getFullYear() - 13);
        minimumDateOfBirth.setMonth(minimumDateOfBirth.getMonth() - 1);
        if (formData.dateOfBirth > minimumDateOfBirth) {
          Alert.alert(t('alerts.error'), t('onboarding.validation.minimumAge'));
          warningHaptic();
          return false;
        }

        setIsSaving(true);
        try {
          const formattedDate = formData.dateOfBirth.toISOString().split('T')[0];

          // Upload profile picture if present and different from saved URL
          // This avoids re-uploading an already-saved picture and cleans up old uploads
          let uploadedImageUrl: string | undefined;
          const hasNewImage =
            formData.profileImage && formData.profileImage !== formData.savedProfilePictureUrl;

          if (hasNewImage) {
            // Use replaceImage to upload new and delete old (if any)
            const { url, error: uploadError } = await replaceImage(
              formData.profileImage!,
              lastUploadedProfileUrl, // Delete the previous upload if exists
              'profile-pictures'
            );
            if (uploadError) {
              Logger.error('Failed to upload profile picture', uploadError as Error);
            } else if (url) {
              uploadedImageUrl = url;
              setLastUploadedProfileUrl(url); // Track for future replacements
            }
          } else if (formData.savedProfilePictureUrl) {
            // Keep existing saved URL
            uploadedImageUrl = formData.savedProfilePictureUrl;
          }

          const { error } = await OnboardingService.savePersonalInfo({
            first_name: formData.firstName,
            last_name: formData.lastName,
            birth_date: formattedDate,
            gender: formData.gender as GenderEnum,
            profile_picture_url: uploadedImageUrl,
          });

          if (error) {
            Logger.error('Failed to save personal info', error as Error);
            Alert.alert(t('alerts.error'), t('onboarding.validation.failedToSaveInfo'));
            setIsSaving(false);
            return false;
          }

          // Silently persist the home location captured in pre-onboarding to the
          // player row so downstream features (suggestions, favorites distance)
          // have lat/long even though we no longer show a Location step.
          if (homeLocation) {
            const userId = await DatabaseService.Auth.getCurrentUserId();
            if (userId) {
              const syncResult = await syncHomeLocationToPlayer(userId, {
                postalCode: homeLocation.postalCode,
                country: homeLocation.country,
                latitude: homeLocation.latitude,
                longitude: homeLocation.longitude,
              });
              if (!syncResult.success) {
                Logger.warn('Failed to sync pre-onboarding home location to player', {
                  error: syncResult.error,
                });
              }
            }
          }

          setIsSaving(false);
          return true;
        } catch (error) {
          Logger.error('Unexpected error saving personal info', error as Error);
          Alert.alert(t('alerts.error'), t('onboarding.validation.unexpectedError'));
          setIsSaving(false);
          return false;
        }
      }

      case 'tennis-rating':
        if (!formData.tennisRatingId) {
          Alert.alert(t('alerts.error'), t('onboarding.validation.selectTennisRating'));
          warningHaptic();
          return false;
        }

        setIsSaving(true);
        try {
          // Get current user ID for the rating
          const tennisUserId = await DatabaseService.Auth.getCurrentUserId();
          if (!tennisUserId) {
            Alert.alert(t('alerts.error'), t('onboarding.validation.userNotAuthenticated'));
            setIsSaving(false);
            return false;
          }

          const { error: tennisRatingError } = await DatabaseService.Rating.addPlayerRating({
            player_id: tennisUserId,
            rating_score_id: formData.tennisRatingId,
            source: 'self_reported',
            is_certified: false,
          });

          if (tennisRatingError) {
            Logger.error('Failed to save tennis rating', tennisRatingError as Error);
            Alert.alert(t('alerts.error'), t('onboarding.validation.failedToSaveRating'));
            setIsSaving(false);
            return false;
          }

          setIsSaving(false);
          return true;
        } catch (error) {
          Logger.error('Unexpected error saving tennis rating', error as Error);
          Alert.alert(t('alerts.error'), t('onboarding.validation.unexpectedError'));
          setIsSaving(false);
          return false;
        }

      case 'pickleball-rating':
        if (!formData.pickleballRatingId) {
          Alert.alert(t('alerts.error'), t('onboarding.validation.selectPickleballRating'));
          warningHaptic();
          return false;
        }

        setIsSaving(true);
        try {
          // Get current user ID for the rating
          const pickleballUserId = await DatabaseService.Auth.getCurrentUserId();
          if (!pickleballUserId) {
            Alert.alert(t('alerts.error'), t('onboarding.validation.userNotAuthenticated'));
            setIsSaving(false);
            return false;
          }

          const { error: pickleballRatingError } = await DatabaseService.Rating.addPlayerRating({
            player_id: pickleballUserId,
            rating_score_id: formData.pickleballRatingId,
            source: 'self_reported',
            is_certified: false,
          });

          if (pickleballRatingError) {
            Logger.error('Failed to save pickleball rating', pickleballRatingError as Error);
            Alert.alert(t('alerts.error'), t('onboarding.validation.failedToSaveRating'));
            setIsSaving(false);
            return false;
          }

          setIsSaving(false);
          return true;
        } catch (error) {
          Logger.error('Unexpected error saving pickleball rating', error as Error);
          Alert.alert(t('alerts.error'), t('onboarding.validation.unexpectedError'));
          setIsSaving(false);
          return false;
        }

      case 'preferences':
        setIsSaving(true);
        try {
          const sportsData: OnboardingPlayerPreferences['sports'] = [];

          if (hasTennis) {
            const { data: tennisSport } = await SportService.getSportByName('tennis');
            if (tennisSport) {
              sportsData.push({
                sport_id: tennisSport.id,
                sport_name: 'tennis',
                preferred_match_duration: (formData.tennisMatchDuration || '90') as
                  | '30'
                  | '60'
                  | '90'
                  | '120',
                preferred_match_type: formData.tennisMatchType,
                is_primary: true,
              });
            }
          }

          if (hasPickleball) {
            const { data: pickleballSport } = await SportService.getSportByName('pickleball');
            if (pickleballSport) {
              sportsData.push({
                sport_id: pickleballSport.id,
                sport_name: 'pickleball',
                preferred_match_duration: (formData.pickleballMatchDuration || '90') as
                  | '30'
                  | '60'
                  | '90'
                  | '120',
                preferred_match_type: formData.pickleballMatchType,
                is_primary: !hasTennis,
              });
            }
          }

          const { error } = await OnboardingService.savePreferences({
            playing_hand: formData.playingHand,
            max_travel_distance: formData.maxTravelDistance,
            sports: sportsData,
          });

          if (error) {
            Logger.error('Failed to save preferences', error as Error);
            Alert.alert(t('alerts.error'), t('onboarding.validation.failedToSavePreferences'));
            setIsSaving(false);
            return false;
          }

          setIsSaving(false);
          return true;
        } catch (error) {
          Logger.error('Unexpected error saving preferences', error as Error);
          Alert.alert(t('alerts.error'), t('onboarding.validation.unexpectedError'));
          setIsSaving(false);
          return false;
        }

      case 'favorite-sites': {
        // Validate per-sport minimums
        const bothSportsSelected = hasTennis && hasPickleball;
        if (bothSportsSelected) {
          const counts = computeFavoriteSportCounts(formData);
          if (counts.tennisCount < 2 || counts.pickleballCount < 2) {
            Alert.alert(t('alerts.error'), t('onboarding.favoriteSitesStep.selectMinimumPerSport'));
            warningHaptic();
            return false;
          }
        } else if (formData.favoriteFacilities.length < 2) {
          Alert.alert(t('alerts.error'), t('onboarding.favoriteSitesStep.selectMinimum'));
          warningHaptic();
          return false;
        }

        // Save the selected favorites to the database
        setIsSaving(true);
        try {
          const userId = await DatabaseService.Auth.getCurrentUserId();
          if (!userId) {
            Alert.alert(t('alerts.error'), t('onboarding.validation.userNotAuthenticated'));
            setIsSaving(false);
            return false;
          }

          // Delete existing favorites first
          const { error: deleteError } = await supabase
            .from('player_favorite_facility')
            .delete()
            .eq('player_id', userId);

          if (deleteError) {
            Logger.warn('Failed to delete existing favorites', { error: deleteError });
          }

          // Insert new favorites with display order, one row per (facility, sport) pair.
          // Each facility may support multiple sports; create a favorite for each sport the player plays.
          const playerSportIds = new Set(formData.selectedSportIds);
          const perSportCounters: Record<string, number> = {};
          const favoritesToInsert = formData.favoriteFacilities.flatMap(facility => {
            const facilitySportIds = (facility.sport_ids ?? []).filter(sid =>
              playerSportIds.has(sid)
            );
            return facilitySportIds.map(sid => {
              perSportCounters[sid] = (perSportCounters[sid] ?? 0) + 1;
              return {
                player_id: userId,
                facility_id: facility.id,
                sport_id: sid,
                display_order: perSportCounters[sid],
              };
            });
          });

          const { error: insertError } = await supabase
            .from('player_favorite_facility')
            .insert(favoritesToInsert);

          if (insertError) {
            Logger.error('Failed to save favorite facilities', insertError as Error);
            Alert.alert(t('alerts.error'), t('onboarding.favoriteSitesStep.failedToSave'));
            setIsSaving(false);
            return false;
          }

          setIsSaving(false);
          return true;
        } catch (error) {
          Logger.error('Unexpected error saving favorite facilities', error as Error);
          Alert.alert(t('alerts.error'), t('onboarding.validation.unexpectedError'));
          setIsSaving(false);
          return false;
        }
      }

      case 'availabilities':
        setIsSaving(true);
        try {
          // formData.availabilities is a flat Set of `${day}-${hour}` cell
          // keys from the hourly grid; one OnboardingAvailability row per
          // active cell, all with is_active = true.
          const availabilityData: OnboardingAvailability[] = [];
          for (const key of formData.availabilities) {
            const sepIdx = key.lastIndexOf('-');
            const day = key.slice(0, sepIdx) as DayEnum;
            const hour = Number(key.slice(sepIdx + 1));
            availabilityData.push({ day, hour_of_day: hour, is_active: true });
          }

          const { error } = await OnboardingService.saveAvailability(availabilityData);

          if (error) {
            Logger.error('Failed to save availability', error as Error);
            Alert.alert(t('alerts.error'), t('onboarding.validation.failedToSaveAvailability'));
            setIsSaving(false);
            return false;
          }

          // Mark onboarding as completed - this is CRITICAL and must succeed
          const { error: completeError } = await OnboardingService.completeOnboarding();

          if (completeError) {
            Logger.error('Failed to mark onboarding as completed', completeError as Error);
            Alert.alert(
              t('alerts.error'),
              t('onboarding.validation.failedToCompleteOnboarding' as TranslationKey) ||
                'Failed to complete onboarding. Please try again.'
            );
            setIsSaving(false);
            return false;
          }

          Logger.info('onboarding_completed', {
            message: 'Onboarding marked as completed in profile',
          });

          Analytics.onboardingCompleted({
            sports: formData.selectedSportIds,
            duration_seconds: Math.round((Date.now() - onboardingStartTimeRef.current) / 1000),
          });

          // Set persistent PostHog person properties for cohort segmentation
          posthogClient?.setPersonProperties({
            sports: formData.selectedSportNames,
            gender: formData.gender || null,
            city: formData.city || null,
            province: formData.province || null,
          });

          // Read both attribution signals upfront so we can resolve a unified
          // acquisition source even if only one signal is present.
          const [pendingRaw, channelRaw] = await Promise.all([
            AsyncStorage.getItem(PENDING_REFERRAL_KEY),
            AsyncStorage.getItem(ACQUISITION_CHANNEL_KEY),
          ]);

          // Parse pending referral (supports new JSON and legacy plain string)
          let pendingForSource: PendingReferral | null = null;
          if (pendingRaw) {
            try {
              const parsed = JSON.parse(pendingRaw);
              pendingForSource =
                typeof parsed === 'object' && parsed.code
                  ? parsed
                  : { code: pendingRaw, type: 'referral' as const };
            } catch {
              pendingForSource = { code: pendingRaw, type: 'referral' as const };
            }
          }

          // Attribute pending referral if one was stored before signup
          try {
            if (pendingForSource) {
              const pending: PendingReferral = pendingForSource;

              const userId = await DatabaseService.Auth.getCurrentUserId();
              const {
                data: { user },
              } = await supabase.auth.getUser();
              if (userId) {
                // Only attribute referral if a referral code is present
                // (non-referral links like /join/{code} or /match/{id} have empty code)
                if (pending.code) {
                  const result = await attributeReferral(
                    pending.code,
                    userId,
                    user?.email ?? undefined,
                    pending.type,
                    pending.targetId
                  );
                  Analytics.referralAttributed({
                    invitation_type: pending.type,
                    referral_code: pending.code,
                    target_id: pending.targetId,
                  });
                  // Set PostHog user properties for cohort analysis
                  if (result.success && result.referrerId) {
                    posthogClient?.identify(userId, {
                      referred_by_player_id: result.referrerId,
                      referral_invitation_type: pending.type,
                      referral_target_id: pending.targetId ?? null,
                    });
                  }
                }
              }
              await AsyncStorage.removeItem(PENDING_REFERRAL_KEY);

              // If the referral was for a group/community, trigger the join action
              // and store pending navigation so Home can redirect after mounting
              if (pending.type === 'group' && pending.targetId && userId) {
                try {
                  const joinResult = await joinGroupByInviteCode(pending.targetId, userId);
                  if (joinResult.success && joinResult.groupId) {
                    await AsyncStorage.setItem(
                      '@rallia/pending-navigation',
                      JSON.stringify({
                        screen: 'GroupDetail',
                        params: { groupId: joinResult.groupId, groupName: joinResult.groupName },
                      })
                    );
                  }
                } catch (e) {
                  Logger.warn('Post-onboarding group join failed', { error: e });
                }
              } else if (pending.type === 'community' && pending.targetId && userId) {
                try {
                  const joinResult = await requestToJoinCommunityByInviteCode(
                    pending.targetId,
                    userId
                  );
                  if (joinResult.success && joinResult.communityId) {
                    await AsyncStorage.setItem(
                      '@rallia/pending-navigation',
                      JSON.stringify({
                        screen: 'CommunityDetail',
                        params: {
                          communityId: joinResult.communityId,
                          communityName: joinResult.communityName,
                        },
                      })
                    );
                  }
                } catch (e) {
                  Logger.warn('Post-onboarding community join request failed', { error: e });
                }
              } else if (pending.type === 'match' && pending.targetId) {
                // Store pending navigation so Home opens the match detail sheet
                await AsyncStorage.setItem(
                  '@rallia/pending-navigation',
                  JSON.stringify({
                    screen: 'MatchDetail',
                    params: { matchId: pending.targetId },
                  })
                );
              }
            }
          } catch (referralError) {
            Logger.warn('Failed to attribute referral', { error: referralError });
          }

          // Persist acquisition channel from pre-onboarding
          try {
            if (channelRaw) {
              const channelUserId = await DatabaseService.Auth.getCurrentUserId();
              if (channelUserId) {
                await supabase
                  .from('profile')
                  .update({ acquisition_channel: channelRaw })
                  .eq('id', channelUserId);
              }
              await AsyncStorage.removeItem(ACQUISITION_CHANNEL_KEY);
            }
          } catch (channelError) {
            Logger.warn('Failed to persist acquisition channel', { error: channelError });
          }

          // Fire a unified `user_acquired` event with a single mutually-exclusive
          // source bucket so growth dashboards can show a clean stacked view.
          // Resolution priority: referral_link > referral_code > discovery_<chip> > unknown.
          try {
            const source = resolveAcquisitionSource(pendingForSource, channelRaw);
            Analytics.userAcquired({
              source,
              has_referral: Boolean(pendingForSource?.code),
              referral_invitation_type: pendingForSource?.code ? pendingForSource.type : undefined,
            });
            const acquiredUserId = await DatabaseService.Auth.getCurrentUserId();
            if (acquiredUserId) {
              posthogClient?.identify(acquiredUserId, { acquisition_source: source });
            }
          } catch (sourceError) {
            Logger.warn('Failed to fire user_acquired', { error: sourceError });
          }

          // Refetch profile, player, and sports immediately after marking onboarding as completed
          // This ensures:
          // 1. Profile: header updates, onboarding_completed flag is recognized
          // 2. Player: critical - player was null before onboarding, now exists in DB
          // 3. Sports: sport selector updates with user's selected sports
          await Promise.all([refetchProfile(), refetchPlayer()]);
          refetchSports();

          successHaptic();
          setIsSaving(false);
          return true;
        } catch (error) {
          Logger.error('Unexpected error saving availability', error as Error);
          Alert.alert(t('alerts.error'), t('onboarding.validation.unexpectedError'));
          setIsSaving(false);
          return false;
        }

      default:
        return true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentStepId,
    formData,
    hasTennis,
    hasPickleball,
    refetchProfile,
    refetchPlayer,
    refetchSports,
    lastUploadedProfileUrl,
  ]);

  // Handle next button press
  const handleNext = useCallback(async () => {
    Keyboard.dismiss();
    const isValid = await validateAndSaveStep();
    if (isValid) {
      mediumHaptic();
      goToNextStep();
    }
  }, [validateAndSaveStep, goToNextStep]);

  // Handle back navigation
  const handleBack = useCallback(() => {
    Keyboard.dismiss();
    lightHaptic();
    goToPrevStep();
  }, [goToPrevStep]);

  // Handle back to landing
  const handleBackToLanding = useCallback(() => {
    Keyboard.dismiss();
    Analytics.onboardingAbandoned({
      last_step: currentStepId,
      step_index: currentStep,
      duration_seconds: Math.round((Date.now() - onboardingStartTimeRef.current) / 1000),
    });
    resetWizard();
    onBackToLanding();
  }, [resetWizard, onBackToLanding, currentStepId, currentStep]);

  // Animated styles for step container
  const animatedStepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  // Render step content
  const renderStep = (stepId: OnboardingStepId, _index: number) => {
    switch (stepId) {
      case 'personal':
        return (
          <PersonalInfoStep
            formData={formData}
            onUpdateFormData={updateFormData}
            onPickImage={pickImage}
            colors={colors}
            t={t}
            isDark={isDark}
          />
        );
      case 'tennis-rating':
        return (
          <RatingStep
            sport="tennis"
            formData={formData}
            onUpdateFormData={updateFormData}
            onContinue={goToNextStep}
            colors={colors}
            t={t}
            isDark={isDark}
          />
        );
      case 'pickleball-rating':
        return (
          <RatingStep
            sport="pickleball"
            formData={formData}
            onUpdateFormData={updateFormData}
            onContinue={goToNextStep}
            colors={colors}
            t={t}
            isDark={isDark}
          />
        );
      case 'preferences':
        return (
          <PreferencesStep
            formData={formData}
            onUpdateFormData={updateFormData}
            hasTennis={hasTennis}
            hasPickleball={hasPickleball}
            colors={colors}
            t={t}
            isDark={isDark}
          />
        );
      case 'favorite-sites':
        return (
          <FavoriteSitesStep
            formData={formData}
            onUpdateFormData={updateFormData}
            colors={colors}
            t={t}
            isDark={isDark}
            sportIds={formData.selectedSportIds}
            sportNames={formData.selectedSportNames}
            hasTennis={hasTennis}
            hasPickleball={hasPickleball}
            latitude={formData.latitude}
            longitude={formData.longitude}
          />
        );
      case 'availabilities':
        return (
          <AvailabilitiesStep
            formData={formData}
            onUpdateFormData={updateFormData}
            colors={colors}
            t={t}
            isDark={isDark}
            locale={locale}
          />
        );
      case 'success':
        return (
          <SuccessStep
            onComplete={onComplete}
            onAdvanceToSuggestions={handleAdvanceToSuggestions}
            colors={colors}
            t={t}
            isDark={isDark}
            selectedSports={selectedSportsForSuccess}
            currentSport={selectedSport}
            onSelectInitialSport={handleSelectInitialSport}
            playerId={successPlayerId}
          />
        );
      case 'suggestions':
        return (
          <SuggestionsStep
            suggestions={matchSuggestions}
            isLoading={suggestionsLoading}
            onComplete={onComplete}
            onRefresh={handleRefreshSuggestions}
            colors={colors}
            t={t}
            locale={locale}
            isDark={isDark}
            currentSport={selectedSport}
            playerId={successPlayerId}
          />
        );
      default:
        return null;
    }
  };

  // Show loading state while fetching existing data
  if (isLoadingData) {
    return (
      <View
        style={[
          styles.container,
          styles.loadingContainer,
          { backgroundColor: colors.cardBackground },
        ]}
      >
        <ActivityIndicator size="large" color={colors.buttonActive} />
      </View>
    );
  }

  // If showing success or suggestions screen, render without header/progress/footer
  if (currentStepId === 'success' || currentStepId === 'suggestions') {
    return (
      <View style={[styles.container, { backgroundColor: colors.cardBackground }]}>
        {currentStepId === 'success' ? (
          <SuccessStep
            onComplete={onComplete}
            onAdvanceToSuggestions={handleAdvanceToSuggestions}
            colors={colors}
            t={t}
            isDark={isDark}
            selectedSports={selectedSportsForSuccess}
            currentSport={selectedSport}
            onSelectInitialSport={handleSelectInitialSport}
            playerId={successPlayerId}
          />
        ) : (
          <SuggestionsStep
            suggestions={matchSuggestions}
            isLoading={suggestionsLoading}
            onComplete={onComplete}
            onRefresh={handleRefreshSuggestions}
            colors={colors}
            t={t}
            locale={locale}
            isDark={isDark}
            currentSport={selectedSport}
            playerId={successPlayerId}
          />
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.cardBackground }]}>
      {/* Fixed Header */}
      <WizardHeader
        currentStep={currentStep}
        onBack={handleBack}
        onBackToLanding={handleBackToLanding}
        onClose={onClose}
        colors={colors}
        t={t}
      />

      {/* Fixed Progress bar */}
      <ProgressBar
        currentStep={currentStep}
        totalSteps={totalSteps}
        stepName={getStepName(currentStepId, t)}
        colors={colors}
        t={t}
      />

      {/* Scrollable Step content */}
      <View style={styles.stepsViewport} pointerEvents="box-none">
        <Animated.View
          style={[styles.stepsContainer, { width: SCREEN_WIDTH * steps.length }, animatedStepStyle]}
          pointerEvents="box-none"
        >
          {steps.map((stepId, index) => (
            <View
              key={stepId}
              style={[styles.stepWrapper, { width: SCREEN_WIDTH }]}
              pointerEvents="box-none"
            >
              {renderStep(stepId, index)}
            </View>
          ))}
        </Animated.View>
      </View>

      {/* Fixed Footer */}
      <View
        style={[styles.footer, { borderTopColor: colors.border, paddingBottom: spacingPixels[4] }]}
      >
        {!isLastStep ? (
          <TouchableOpacity
            style={[
              styles.nextButton,
              { backgroundColor: isButtonDisabled ? colors.buttonInactive : colors.buttonActive },
            ]}
            onPress={handleNext}
            disabled={isButtonDisabled}
            accessibilityLabel={t('common.next')}
            accessibilityRole="button"
          >
            {isSaving ? (
              <ActivityIndicator color={colors.buttonTextActive} />
            ) : (
              <>
                <Text
                  size="lg"
                  weight="semibold"
                  color={isButtonDisabled ? colors.textMuted : colors.buttonTextActive}
                >
                  {t('common.next')}
                </Text>
                <Ionicons
                  name="arrow-forward"
                  size={20}
                  color={isButtonDisabled ? colors.textMuted : colors.buttonTextActive}
                />
              </>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[
              styles.nextButton,
              { backgroundColor: isButtonDisabled ? colors.buttonInactive : colors.buttonActive },
            ]}
            onPress={handleNext}
            disabled={isButtonDisabled}
            accessibilityLabel={t('onboarding.complete')}
            accessibilityRole="button"
          >
            {isSaving ? (
              <ActivityIndicator color={colors.buttonTextActive} />
            ) : (
              <>
                <Text
                  size="lg"
                  weight="semibold"
                  color={isButtonDisabled ? colors.textMuted : colors.buttonTextActive}
                >
                  {t('onboarding.complete')}
                </Text>
                <Ionicons
                  name="checkmark"
                  size={20}
                  color={isButtonDisabled ? colors.textMuted : colors.buttonTextActive}
                />
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  headerLeft: {
    width: 40,
  },
  headerCenter: {
    flex: 1,
  },
  headerRight: {
    width: 40,
    alignItems: 'flex-end',
  },
  headerButton: {
    padding: spacingPixels[1],
  },
  progressContainer: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacingPixels[2],
  },
  progressBarBg: {
    height: 4,
    borderRadius: radiusPixels.full,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: radiusPixels.full,
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
  footer: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[4],
    borderTopWidth: 1,
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});

export default OnboardingWizard;
