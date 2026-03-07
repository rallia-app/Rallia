/**
 * useOnboardingWizard Hook
 *
 * Manages onboarding wizard state and step navigation.
 * Handles dynamic step calculation based on selected sports.
 * Loads existing user data to pre-populate form fields.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import DatabaseService, { Logger } from '@rallia/shared-services';
import type { FacilitySearchResult } from '@rallia/shared-types';

export type OnboardingStepId =
  | 'personal'
  | 'location'
  | 'sports'
  | 'tennis-rating'
  | 'pickleball-rating'
  | 'preferences'
  | 'favorite-sites'
  | 'availabilities'
  | 'success';

export interface OnboardingFormData {
  // Personal Info
  firstName: string;
  lastName: string;
  username: string;
  dateOfBirth: Date | null;
  gender: string;
  phoneNumber: string;
  profileImage: string | null;
  /** URL of the already-saved profile picture from DB (to avoid re-uploading) */
  savedProfilePictureUrl: string | null;

  // Location Info
  address: string;
  city: string;
  province: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;

  // Sports
  selectedSportNames: string[];
  selectedSportIds: string[];

  // Ratings
  tennisRatingId: string | null;
  pickleballRatingId: string | null;

  // Preferences
  playingHand: 'left' | 'right' | 'both';
  maxTravelDistance: number;
  matchDuration: '30' | '60' | '90' | '120'; // Legacy field, kept for backward compatibility
  tennisMatchDuration: '30' | '60' | '90' | '120';
  pickleballMatchDuration: '30' | '60' | '90' | '120';
  tennisMatchType: 'casual' | 'competitive' | 'both';
  pickleballMatchType: 'casual' | 'competitive' | 'both';

  // Favorite facilities (up to 6 for dual-sport users)
  favoriteFacilities: FacilitySearchResult[];

  // Availabilities
  availabilities: Record<string, { AM: boolean; PM: boolean; EVE: boolean }>;
  privacyShowAvailability: boolean;
}

interface UseOnboardingWizardReturn {
  // Current state
  currentStep: number;
  currentStepId: OnboardingStepId;
  totalSteps: number;

  // Loading state
  isLoadingData: boolean;

  // Form data
  formData: OnboardingFormData;
  updateFormData: (updates: Partial<OnboardingFormData>) => void;

  // Navigation
  goToNextStep: () => void;
  goToPrevStep: () => void;
  canGoNext: boolean;
  canGoBack: boolean;
  isLastStep: boolean;
  isComplete: boolean;

  // Reset
  resetWizard: () => void;

  // Computed
  hasTennis: boolean;
  hasPickleball: boolean;
  steps: OnboardingStepId[];
}

const DEFAULT_AVAILABILITIES = {
  Mon: { AM: false, PM: false, EVE: false },
  Tue: { AM: false, PM: false, EVE: false },
  Wed: { AM: false, PM: false, EVE: false },
  Thu: { AM: false, PM: false, EVE: false },
  Fri: { AM: false, PM: false, EVE: false },
  Sat: { AM: false, PM: false, EVE: false },
  Sun: { AM: false, PM: false, EVE: false },
};

const INITIAL_FORM_DATA: OnboardingFormData = {
  firstName: '',
  lastName: '',
  username: '',
  dateOfBirth: null,
  gender: '',
  phoneNumber: '',
  profileImage: null,
  savedProfilePictureUrl: null,
  address: '',
  city: '',
  province: '',
  postalCode: '',
  latitude: null,
  longitude: null,
  selectedSportNames: [],
  selectedSportIds: [],
  tennisRatingId: null,
  pickleballRatingId: null,
  playingHand: 'right',
  maxTravelDistance: 15,
  matchDuration: '90', // Legacy field (90 = 1.5h)
  tennisMatchDuration: '90',
  pickleballMatchDuration: '90',
  tennisMatchType: 'competitive',
  pickleballMatchType: 'competitive',
  favoriteFacilities: [],
  availabilities: DEFAULT_AVAILABILITIES,
  privacyShowAvailability: true,
};

/**
 * Compute per-sport favorite counts for the favorite-sites step.
 * Each facility's sport_ids is compared against the user's selected sport IDs
 * to determine how many tennis and pickleball facilities have been selected.
 */
export function computeFavoriteSportCounts(formData: OnboardingFormData): {
  tennisCount: number;
  pickleballCount: number;
  totalCount: number;
} {
  const hasTennis = formData.selectedSportNames.includes('tennis');
  const hasPickleball = formData.selectedSportNames.includes('pickleball');

  // Map sport names to their IDs
  const tennisIndex = formData.selectedSportNames.indexOf('tennis');
  const pickleballIndex = formData.selectedSportNames.indexOf('pickleball');
  const tennisSportId = tennisIndex >= 0 ? formData.selectedSportIds[tennisIndex] : null;
  const pickleballSportId =
    pickleballIndex >= 0 ? formData.selectedSportIds[pickleballIndex] : null;

  let tennisCount = 0;
  let pickleballCount = 0;

  for (const facility of formData.favoriteFacilities) {
    const sportIds = facility.sport_ids ?? [];
    if (hasTennis && tennisSportId && sportIds.includes(tennisSportId)) {
      tennisCount++;
    }
    if (hasPickleball && pickleballSportId && sportIds.includes(pickleballSportId)) {
      pickleballCount++;
    }
  }

  return {
    tennisCount,
    pickleballCount,
    totalCount: formData.favoriteFacilities.length,
  };
}

/**
 * Check if a step is complete based on form data
 */
function isStepComplete(stepId: OnboardingStepId, formData: OnboardingFormData): boolean {
  switch (stepId) {
    case 'personal':
      return !!(
        formData.firstName.trim() &&
        formData.lastName.trim() &&
        formData.username.trim() &&
        formData.dateOfBirth &&
        formData.gender &&
        formData.phoneNumber.trim()
      );

    case 'location':
      // Postal code is required (pre-populated from pre-onboarding), address is optional
      return !!formData.postalCode.trim();

    case 'sports':
      return formData.selectedSportIds.length > 0;

    case 'tennis-rating':
      return !!formData.tennisRatingId;

    case 'pickleball-rating':
      return !!formData.pickleballRatingId;

    case 'preferences':
      // Preferences have defaults, but check if user has made selections
      return !!(formData.playingHand && formData.maxTravelDistance);

    case 'favorite-sites': {
      // Require at least 3 favorites; when both sports selected, need 3 per sport
      const bothSports =
        formData.selectedSportNames.includes('tennis') &&
        formData.selectedSportNames.includes('pickleball');
      if (bothSports) {
        const counts = computeFavoriteSportCounts(formData);
        return counts.tennisCount >= 3 && counts.pickleballCount >= 3;
      }
      return formData.favoriteFacilities.length >= 3;
    }

    case 'availabilities':
      // Availabilities have defaults, check if at least one slot is selected
      return Object.values(formData.availabilities).some(
        slots => slots.AM || slots.PM || slots.EVE
      );

    case 'success':
      return true;

    default:
      return false;
  }
}

/**
 * Find the first incomplete step index
 */
function findFirstIncompleteStepIndex(
  steps: OnboardingStepId[],
  formData: OnboardingFormData
): number {
  for (let i = 0; i < steps.length; i++) {
    const stepId = steps[i];
    // Skip success step - it's not a real step to complete
    if (stepId === 'success') continue;

    if (!isStepComplete(stepId, formData)) {
      return i;
    }
  }
  // All steps complete, go to last real step (availabilities) so user can review/complete
  return Math.max(0, steps.indexOf('availabilities'));
}

export function useOnboardingWizard(): UseOnboardingWizardReturn {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [formData, setFormData] = useState<OnboardingFormData>(INITIAL_FORM_DATA);
  const [isComplete, setIsComplete] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [hasInitializedStep, setHasInitializedStep] = useState(false);

  // Computed values
  const hasTennis = formData.selectedSportNames.includes('tennis');
  const hasPickleball = formData.selectedSportNames.includes('pickleball');

  /**
   * Load existing user data on mount to pre-populate form fields
   */
  useEffect(() => {
    const loadExistingData = async () => {
      try {
        const userId = await DatabaseService.Auth.getCurrentUserId();
        if (!userId) {
          setIsLoadingData(false);
          return;
        }

        // Fetch all user data in parallel
        const [profileRes, playerRes, sportsRes, ratingsRes, availRes] = await Promise.all([
          DatabaseService.Profile.getProfile(userId),
          DatabaseService.Player.getPlayer(userId),
          DatabaseService.PlayerSport.getPlayerSports(userId),
          DatabaseService.Rating.getPlayerRatings(userId),
          DatabaseService.Availability.getPlayerAvailability(userId),
        ]);

        const updates: Partial<OnboardingFormData> = {};

        // Profile data
        if (profileRes.data) {
          updates.firstName = profileRes.data.first_name || '';
          updates.lastName = profileRes.data.last_name || '';
          updates.username = profileRes.data.display_name || '';
          updates.dateOfBirth = profileRes.data.birth_date
            ? new Date(profileRes.data.birth_date)
            : null;
          updates.phoneNumber = profileRes.data.phone || '';
          // Store the saved URL - we'll display this but not re-upload it
          if (profileRes.data.profile_picture_url) {
            updates.savedProfilePictureUrl = profileRes.data.profile_picture_url;
            updates.profileImage = profileRes.data.profile_picture_url;
          }
        }

        // Player data (gender, preferences, location)
        if (playerRes.data) {
          // Location data is stored in player table
          updates.address = playerRes.data.address || '';
          updates.city = playerRes.data.city || '';
          updates.province = playerRes.data.province || '';
          updates.postalCode = playerRes.data.postal_code || '';
          updates.latitude = playerRes.data.latitude || null;
          updates.longitude = playerRes.data.longitude || null;
          updates.gender = playerRes.data.gender || '';
          if (playerRes.data.playing_hand) {
            updates.playingHand = playerRes.data.playing_hand as 'left' | 'right' | 'both';
          }
          if (playerRes.data.max_travel_distance) {
            updates.maxTravelDistance = playerRes.data.max_travel_distance;
          }
        }

        // Sports data
        if (sportsRes.data && sportsRes.data.length > 0) {
          const sportIds: string[] = [];
          const sportNames: string[] = [];

          for (const ps of sportsRes.data) {
            sportIds.push(ps.sport_id);
            // Get sport name from joined data if available
            const sport = (ps as { sport?: { name: string } }).sport;
            if (sport?.name) {
              sportNames.push(sport.name);
            }

            // Extract match type preferences
            if (sport?.name === 'tennis' && ps.preferred_match_type) {
              updates.tennisMatchType = ps.preferred_match_type as
                | 'casual'
                | 'competitive'
                | 'both';
            }
            if (sport?.name === 'pickleball' && ps.preferred_match_type) {
              updates.pickleballMatchType = ps.preferred_match_type as
                | 'casual'
                | 'competitive'
                | 'both';
            }
            // Extract match duration preferences
            if (sport?.name === 'tennis' && ps.preferred_match_duration) {
              updates.tennisMatchDuration = ps.preferred_match_duration as
                | '30'
                | '60'
                | '90'
                | '120';
              updates.matchDuration = ps.preferred_match_duration as '30' | '60' | '90' | '120'; // Keep legacy field in sync
            }
            if (sport?.name === 'pickleball' && ps.preferred_match_duration) {
              updates.pickleballMatchDuration = ps.preferred_match_duration as
                | '30'
                | '60'
                | '90'
                | '120';
              // Only update legacy field if tennis duration wasn't set
              if (!updates.tennisMatchDuration) {
                updates.matchDuration = ps.preferred_match_duration as '30' | '60' | '90' | '120';
              }
            }
          }

          updates.selectedSportIds = sportIds;
          updates.selectedSportNames = sportNames;
        }

        // Ratings data
        if (ratingsRes.data && ratingsRes.data.length > 0) {
          for (const rating of ratingsRes.data) {
            // Get sport name from nested rating_score -> rating_system -> sport
            const ratingScore = (
              rating as {
                rating_score?: {
                  rating_system?: { sport?: { name: string } };
                };
              }
            ).rating_score;
            const sportName = ratingScore?.rating_system?.sport?.name;

            if (sportName === 'tennis') {
              updates.tennisRatingId = rating.rating_score_id;
            } else if (sportName === 'pickleball') {
              updates.pickleballRatingId = rating.rating_score_id;
            }
          }
        }

        // Availability data
        if (availRes.data && availRes.data.length > 0) {
          const dayMap: Record<string, string> = {
            monday: 'Mon',
            tuesday: 'Tue',
            wednesday: 'Wed',
            thursday: 'Thu',
            friday: 'Fri',
            saturday: 'Sat',
            sunday: 'Sun',
          };

          const periodMap: Record<string, 'AM' | 'PM' | 'EVE'> = {
            morning: 'AM',
            afternoon: 'PM',
            evening: 'EVE',
          };

          // Start with all false
          const availabilities: Record<string, { AM: boolean; PM: boolean; EVE: boolean }> = {
            Mon: { AM: false, PM: false, EVE: false },
            Tue: { AM: false, PM: false, EVE: false },
            Wed: { AM: false, PM: false, EVE: false },
            Thu: { AM: false, PM: false, EVE: false },
            Fri: { AM: false, PM: false, EVE: false },
            Sat: { AM: false, PM: false, EVE: false },
            Sun: { AM: false, PM: false, EVE: false },
          };

          for (const avail of availRes.data) {
            const day = dayMap[avail.day];
            const period = periodMap[avail.period];
            if (day && period && avail.is_active) {
              availabilities[day][period] = true;
            }
          }

          updates.availabilities = availabilities;
        }

        // Apply all updates at once
        if (Object.keys(updates).length > 0) {
          setFormData(prev => ({ ...prev, ...updates }));
        }

        Logger.debug('Loaded existing onboarding data', { updates });
      } catch (error) {
        Logger.error('Failed to load existing onboarding data', error as Error);
      } finally {
        setIsLoadingData(false);
      }
    };

    loadExistingData();
  }, []);

  // Calculate steps dynamically based on selected sports
  const steps = useMemo<OnboardingStepId[]>(() => {
    const baseSteps: OnboardingStepId[] = ['personal', 'location', 'sports'];

    // Add rating steps based on selected sports
    if (hasTennis) baseSteps.push('tennis-rating');
    if (hasPickleball) baseSteps.push('pickleball-rating');

    // Add preferences, favorite sites, and availabilities
    baseSteps.push('preferences', 'favorite-sites', 'availabilities', 'success');

    return baseSteps;
  }, [hasTennis, hasPickleball]);

  const totalSteps = steps.length - 1; // Don't count success as a step
  const currentStep = Math.min(currentStepIndex + 1, totalSteps);
  const currentStepId = steps[currentStepIndex] || 'personal';
  const isLastStep = currentStepId === 'availabilities';
  const canGoBack = currentStepIndex > 0;
  const canGoNext = currentStepIndex < steps.length - 1;

  /**
   * After data is loaded, jump to the first incomplete step
   * This runs only once after initial data load
   */
  useEffect(() => {
    if (!isLoadingData && !hasInitializedStep && steps.length > 0) {
      const firstIncompleteIndex = findFirstIncompleteStepIndex(steps, formData);
      if (firstIncompleteIndex > 0) {
        Logger.debug('Starting onboarding at first incomplete step', {
          stepIndex: firstIncompleteIndex,
          stepId: steps[firstIncompleteIndex],
        });
        setCurrentStepIndex(firstIncompleteIndex);
      }
      setHasInitializedStep(true);
    }
  }, [isLoadingData, hasInitializedStep, steps, formData]);

  /**
   * Update form data
   */
  const updateFormData = useCallback((updates: Partial<OnboardingFormData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
  }, []);

  /**
   * Go to next step
   */
  const goToNextStep = useCallback(() => {
    if (currentStepIndex < steps.length - 1) {
      Logger.logNavigation('onboarding_next_step', {
        from: steps[currentStepIndex],
        to: steps[currentStepIndex + 1],
      });

      // If completing availabilities, go to success
      if (steps[currentStepIndex] === 'availabilities') {
        setIsComplete(true);
      }

      setCurrentStepIndex(prev => prev + 1);
    }
  }, [currentStepIndex, steps]);

  /**
   * Go to previous step
   */
  const goToPrevStep = useCallback(() => {
    if (currentStepIndex > 0) {
      Logger.logNavigation('onboarding_prev_step', {
        from: steps[currentStepIndex],
        to: steps[currentStepIndex - 1],
      });
      setCurrentStepIndex(prev => prev - 1);
    }
  }, [currentStepIndex, steps]);

  /**
   * Reset wizard to initial state
   */
  const resetWizard = useCallback(() => {
    setCurrentStepIndex(0);
    setFormData(INITIAL_FORM_DATA);
    setIsComplete(false);
  }, []);

  return {
    currentStep,
    currentStepId,
    totalSteps,
    isLoadingData,
    formData,
    updateFormData,
    goToNextStep,
    goToPrevStep,
    canGoNext,
    canGoBack,
    isLastStep,
    isComplete,
    resetWizard,
    hasTennis,
    hasPickleball,
    steps,
  };
}

export default useOnboardingWizard;
