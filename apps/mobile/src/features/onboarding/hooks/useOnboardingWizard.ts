/**
 * useOnboardingWizard Hook
 *
 * Manages onboarding wizard state and step navigation.
 * Handles dynamic step calculation based on selected sports.
 * Loads existing user data to pre-populate form fields.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DatabaseService, { Logger, supabase } from '@rallia/shared-services';
import type { FacilitySearchResult, PeriodEnum } from '@rallia/shared-types';
import * as Analytics from '../../../services/analytics';

/**
 * AsyncStorage key written by pre-onboarding's SportStep (via SportContext).
 * Kept in sync with `GUEST_SPORTS_STORAGE_KEY` in apps/mobile/src/context/SportContext.tsx.
 */
const GUEST_SPORTS_STORAGE_KEY = '@rallia/guest-selected-sports';

interface GuestSportEntry {
  id: string;
  name: string;
}

export type OnboardingStepId =
  | 'personal'
  | 'tennis-rating'
  | 'pickleball-rating'
  | 'preferences'
  | 'favorite-sites'
  | 'availabilities'
  | 'success'
  | 'suggestions';

export interface OnboardingFormData {
  // Personal Info
  firstName: string;
  lastName: string;
  dateOfBirth: Date | null;
  gender: string;
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

  // Availabilities — keyed by short day label and by period_enum value.
  // The DB enum is the source of truth, so we use those exact keys here to
  // remove the AM/PM/EVE → morning/afternoon/evening translation that lived
  // in OnboardingWizard's save flow before the 6-block refactor.
  availabilities: Record<string, Record<PeriodEnum, boolean>>;
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

const EMPTY_DAY: Record<PeriodEnum, boolean> = {
  early: false,
  morning: false,
  midday: false,
  afternoon: false,
  evening: false,
  late: false,
};

const DEFAULT_AVAILABILITIES: Record<string, Record<PeriodEnum, boolean>> = {
  Mon: { ...EMPTY_DAY },
  Tue: { ...EMPTY_DAY },
  Wed: { ...EMPTY_DAY },
  Thu: { ...EMPTY_DAY },
  Fri: { ...EMPTY_DAY },
  Sat: { ...EMPTY_DAY },
  Sun: { ...EMPTY_DAY },
};

const INITIAL_FORM_DATA: OnboardingFormData = {
  firstName: '',
  lastName: '',
  dateOfBirth: null,
  gender: '',
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
  maxTravelDistance: 20,
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
        formData.dateOfBirth &&
        formData.gender
      );

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
      return Object.values(formData.availabilities).some(slots =>
        Object.values(slots).some(Boolean)
      );

    case 'success':
    case 'suggestions':
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
    // Skip success and suggestions steps - they're not real steps to complete
    if (stepId === 'success' || stepId === 'suggestions') continue;

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
          updates.dateOfBirth = profileRes.data.birth_date
            ? new Date(profileRes.data.birth_date)
            : null;
          // Store the saved URL - we'll display this but not re-upload it
          if (profileRes.data.profile_picture_url) {
            updates.savedProfilePictureUrl = profileRes.data.profile_picture_url;
            updates.profileImage = profileRes.data.profile_picture_url;
          }
        }

        // Player data (gender, preferences, location, privacy settings)
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
          // Load privacy_show_availability (defaults to true if not set)
          // This ensures the visibility toggle shows the user's saved preference
          updates.privacyShowAvailability = playerRes.data.privacy_show_availability ?? true;
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
        } else {
          // Pre-onboarding's SportStep stores the guest selection in AsyncStorage
          // (see SportContext.GUEST_SPORTS_STORAGE_KEY). The player_sport rows are
          // only created later (here on first wizard load), so fall back to that
          // selection so dynamic rating steps appear.
          try {
            const guestRaw = await AsyncStorage.getItem(GUEST_SPORTS_STORAGE_KEY);
            if (guestRaw) {
              const guestSports = JSON.parse(guestRaw) as GuestSportEntry[];
              if (Array.isArray(guestSports) && guestSports.length > 0) {
                updates.selectedSportIds = guestSports.map(s => s.id);
                updates.selectedSportNames = guestSports.map(s => s.name);

                // Persist to player_sport so subsequent steps (preferences,
                // favorites, ratings) have a real row to write against.
                await Promise.all(
                  guestSports.map((sport, index) =>
                    DatabaseService.PlayerSport.addPlayerSport({
                      player_id: userId,
                      sport_id: sport.id,
                      is_primary: index === 0,
                    })
                  )
                );
              }
            }
          } catch (guestError) {
            Logger.warn('Failed to hydrate sports from pre-onboarding selection', {
              error: guestError,
            });
          }
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

          // Period keys match the DB enum 1:1 — no translation map needed.
          const availabilities: Record<string, Record<PeriodEnum, boolean>> = {
            Mon: { ...EMPTY_DAY },
            Tue: { ...EMPTY_DAY },
            Wed: { ...EMPTY_DAY },
            Thu: { ...EMPTY_DAY },
            Fri: { ...EMPTY_DAY },
            Sat: { ...EMPTY_DAY },
            Sun: { ...EMPTY_DAY },
          };

          for (const avail of availRes.data) {
            const day = dayMap[avail.day];
            if (day && avail.is_active) {
              availabilities[day][avail.period as PeriodEnum] = true;
            }
          }

          updates.availabilities = availabilities;
        }

        // Load favorite facilities from player_favorite_facility table
        // This is critical for step completion check - without it, the wizard
        // thinks favorite-sites step is incomplete even if user already saved favorites
        const { data: favoritesData, error: favoritesError } = await supabase
          .from('player_favorite_facility')
          .select(
            `
            facility_id,
            display_order,
            facility:facility_id (
              id,
              name,
              address,
              city,
              data_provider_id,
              timezone,
              facility_sport (
                sport_id
              )
            )
          `
          )
          .eq('player_id', userId)
          .order('display_order', { ascending: true });

        if (favoritesError) {
          Logger.warn('Failed to load favorite facilities', { error: favoritesError });
        } else if (favoritesData && favoritesData.length > 0) {
          // player_favorite_facility's unique constraint is
          // (player_id, facility_id, sport_id) — so a facility favorited for
          // BOTH tennis and pickleball returns two rows with the same
          // facility_id. Dedupe by facility id; the embedded `facility_sport`
          // join already carries the facility's full sport list, so we don't
          // lose multi-sport coverage by collapsing duplicate rows.
          const byId = new Map<string, FacilitySearchResult>();
          for (const item of favoritesData) {
            const facility = item.facility as unknown as {
              id: string;
              name: string;
              address: string | null;
              city: string | null;
              data_provider_id: string | null;
              timezone: string | null;
              facility_sport: Array<{ sport_id: string }>;
            };
            const id = facility?.id || item.facility_id;
            if (byId.has(id)) continue;
            const sportIds = facility?.facility_sport?.map(fs => fs.sport_id) ?? [];
            byId.set(id, {
              id,
              name: facility?.name || 'Unknown Facility',
              city: facility?.city || null,
              address: facility?.address || null,
              distance_meters: null,
              data_provider_id: facility?.data_provider_id || null,
              data_provider_type: null,
              booking_url_template: null,
              external_provider_id: null,
              timezone: facility?.timezone || null,
              sport_ids: sportIds,
            });
          }
          const favoriteFacilities: FacilitySearchResult[] = Array.from(byId.values());
          updates.favoriteFacilities = favoriteFacilities;
          Logger.debug('Loaded favorite facilities', {
            count: favoriteFacilities.length,
            sportIdsSample: favoriteFacilities
              .slice(0, 2)
              .map(f => ({ name: f.name, sports: f.sport_ids })),
          });
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

  // Calculate steps dynamically based on selected sports (resolved from
  // pre-onboarding's saved player_sport rows in the load-existing-data effect)
  const steps = useMemo<OnboardingStepId[]>(() => {
    const baseSteps: OnboardingStepId[] = ['personal'];

    // Add rating steps based on selected sports
    if (hasTennis) baseSteps.push('tennis-rating');
    if (hasPickleball) baseSteps.push('pickleball-rating');

    // Add preferences, favorite sites, and availabilities
    baseSteps.push('preferences', 'favorite-sites', 'availabilities', 'success', 'suggestions');

    return baseSteps;
  }, [hasTennis, hasPickleball]);

  const totalSteps = steps.length - 2; // Don't count success or suggestions as steps
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
      Analytics.onboardingStepCompleted({
        step_name: steps[currentStepIndex],
        step_index: currentStepIndex,
      });

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
