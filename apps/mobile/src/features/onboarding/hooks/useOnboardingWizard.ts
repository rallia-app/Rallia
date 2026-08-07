/**
 * useOnboardingWizard Hook
 *
 * Manages onboarding wizard state and step navigation.
 * Handles dynamic step calculation based on selected sports.
 * Loads existing user data to pre-populate form fields.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DatabaseService, {
  Logger,
  supabase,
  getPendingPolicyConsents,
  type PendingPolicyConsent,
} from '@rallia/shared-services';
import type { FacilitySearchResult } from '@rallia/shared-types';

import {
  cellKey,
  emptyGrid,
  type HourGrid,
} from '#/features/onboarding/components/HourlyAvailabilityGrid';
import * as Analytics from '#/services/analytics';

/**
 * AsyncStorage key written by pre-onboarding's SportStep (via SportContext).
 * Kept in sync with `GUEST_SPORTS_STORAGE_KEY` in apps/mobile/src/context/SportContext.tsx.
 */
export const GUEST_SPORTS_STORAGE_KEY = '@rallia/guest-selected-sports';

interface GuestSportEntry {
  id: string;
  name: string;
}

export type OnboardingStepId =
  | 'consent'
  | 'personal'
  | 'tennis-rating'
  | 'pickleball-rating'
  | 'preferences'
  | 'favorite-sites'
  | 'availabilities'
  | 'success'
  | 'suggestions';

export interface OnboardingFormData {
  // Consent (signup only — existing users signing in never see this step)
  hasAcceptedPrivacy: boolean;
  hasAcceptedTerms: boolean;

  // Personal Info
  firstName: string;
  lastName: string;
  dateOfBirth: Date | null;
  gender: string;
  phoneNumber: string;
  phoneVerified: boolean;
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

  // Availabilities — flat `Set<string>` of `${day}-${hour}` cell keys from
  // the 7×17 weekly hourly grid (hours 6..22 inclusive). See
  // HourlyAvailabilityGrid for the cell-key helpers; save flow in
  // OnboardingWizard converts to OnboardingAvailability[] with hour_of_day.
  availabilities: HourGrid;
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

const DEFAULT_AVAILABILITIES: HourGrid = emptyGrid();

const INITIAL_FORM_DATA: OnboardingFormData = {
  hasAcceptedPrivacy: false,
  hasAcceptedTerms: false,
  firstName: '',
  lastName: '',
  dateOfBirth: null,
  gender: '',
  phoneNumber: '',
  phoneVerified: false,
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
  maxTravelDistance: 10,
  matchDuration: '90', // Legacy field (90 = 1.5h)
  tennisMatchDuration: '90',
  pickleballMatchDuration: '90',
  tennisMatchType: 'competitive',
  pickleballMatchType: 'competitive',
  favoriteFacilities: [],
  availabilities: DEFAULT_AVAILABILITIES,
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
    case 'consent':
      return formData.hasAcceptedPrivacy && formData.hasAcceptedTerms;

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
      // Require at least 2 favorites; when both sports selected, need 2 per sport.
      // Must match the gate in OnboardingWizard (isButtonDisabled +
      // validateAndSaveStep) and the MIN_* constants in FavoriteSitesStep.
      const bothSports =
        formData.selectedSportNames.includes('tennis') &&
        formData.selectedSportNames.includes('pickleball');
      if (bothSports) {
        const counts = computeFavoriteSportCounts(formData);
        return counts.tennisCount >= 2 && counts.pickleballCount >= 2;
      }
      return formData.favoriteFacilities.length >= 2;
    }

    case 'availabilities':
      // Availabilities have defaults, check if at least one cell is selected
      return formData.availabilities.size > 0;

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
      // The sports picked during pre-onboarding live in this AsyncStorage key
      // (written by SportContext while the user was still a guest). For a
      // brand-new user it is the ONLY source of their sports until player_sport
      // rows exist, and the favorite-sites step is unusable without it
      // ("Veuillez d'abord sélectionner un sport"). Read it up front, isolated
      // from the auth/DB calls so a flaky session lookup or a rejected query
      // can't wipe the selection.
      let guestSports: GuestSportEntry[] | null = null;
      try {
        const guestRaw = await AsyncStorage.getItem(GUEST_SPORTS_STORAGE_KEY);
        if (guestRaw) {
          const parsed = JSON.parse(guestRaw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            guestSports = parsed as GuestSportEntry[];
          }
        }
      } catch (guestError) {
        Logger.warn('Failed to read pre-onboarding sport selection', { error: guestError });
      }

      // Apply the guest selection to the form unless sports are already set.
      // Safe to call from any failure path — it never clobbers loaded data.
      const seedSportsFromGuest = () => {
        if (!guestSports) return;
        const ids = guestSports.map(s => s.id);
        const names = guestSports.map(s => s.name);
        setFormData(prev =>
          prev.selectedSportIds.length > 0
            ? prev
            : { ...prev, selectedSportIds: ids, selectedSportNames: names }
        );
      };

      try {
        // Resolve the user id from the cached session first (local, no network),
        // then fall back to the network-validated lookup. getCurrentUserId()
        // calls supabase.auth.getUser(), which hits the network and returns null
        // on a transient error even when a valid session exists — that false
        // null used to make this one-shot effect bail and load no sports.
        let userId: string | null = null;
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          userId = session?.user?.id ?? null;
        } catch {
          // ignore — fall through to the network-validated lookup
        }
        if (!userId) {
          userId = await DatabaseService.Auth.getCurrentUserId();
        }

        if (!userId) {
          // No session at all: still seed the sport selection so the wizard is
          // usable, then stop — we can't read or write user rows without a user.
          seedSportsFromGuest();
          setIsLoadingData(false);
          return;
        }

        // Fetch all user data in parallel
        const [profileRes, playerRes, sportsRes, ratingsRes, availRes, pendingConsents] =
          await Promise.all([
            DatabaseService.Profile.getProfile(userId),
            DatabaseService.Player.getPlayer(userId),
            DatabaseService.PlayerSport.getPlayerSports(userId),
            DatabaseService.Rating.getPlayerRatings(userId),
            DatabaseService.Availability.getPlayerAvailability(userId),
            getPendingPolicyConsents().catch((consentError): PendingPolicyConsent[] | null => {
              Logger.warn('Failed to load pending policy consents', { error: consentError });
              return null;
            }),
          ]);

        const updates: Partial<OnboardingFormData> = {};

        // Seed consent checkboxes from already-accepted policy versions, so a
        // user re-entering onboarding after already accepting isn't stuck
        // re-checking boxes that are already satisfied server-side. If the
        // lookup failed we leave both unchecked — consent must never be
        // pre-checked unless it's recorded server-side.
        if (pendingConsents) {
          const pendingTypes = new Set(pendingConsents.map(p => p.policy_type));
          updates.hasAcceptedPrivacy = !pendingTypes.has('privacy');
          updates.hasAcceptedTerms = !pendingTypes.has('terms');
        }

        // Seed sports from the guest selection up front so a query that returns
        // no player_sport rows (or one that throws) still leaves the wizard with
        // the sports the user picked. Authoritative DB rows below override this.
        if (guestSports) {
          updates.selectedSportIds = guestSports.map(s => s.id);
          updates.selectedSportNames = guestSports.map(s => s.name);
        }

        // Profile data
        if (profileRes.data) {
          updates.firstName = profileRes.data.first_name || '';
          updates.lastName = profileRes.data.last_name || '';
          updates.dateOfBirth = profileRes.data.birth_date
            ? new Date(profileRes.data.birth_date)
            : null;
          updates.phoneNumber = profileRes.data.phone || '';
          updates.phoneVerified = !!profileRes.data.phone_verified;
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
            updates.playingHand = playerRes.data.playing_hand;
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
              updates.tennisMatchType = ps.preferred_match_type;
            }
            if (sport?.name === 'pickleball' && ps.preferred_match_type) {
              updates.pickleballMatchType = ps.preferred_match_type;
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
        } else if (guestSports) {
          // No player_sport rows yet — first wizard load after a guest
          // pre-onboarding. selectedSport* was already seeded from the guest
          // selection above; persist it to player_sport so subsequent steps
          // (preferences, favorites, ratings) have a real row to write against.
          // Failure here is non-fatal: the in-memory selection still drives the
          // wizard and the rows can be created on a later save.
          try {
            await Promise.all(
              guestSports.map((sport, index) =>
                DatabaseService.PlayerSport.addPlayerSport({
                  player_id: userId,
                  sport_id: sport.id,
                  is_primary: index === 0,
                })
              )
            );
          } catch (guestError) {
            Logger.warn('Failed to persist pre-onboarding sport selection to player_sport', {
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

        // Availability data — populate the hour grid directly. One cell per
        // active row; the grid is keyed by the same DB DayEnum the row carries.
        if (availRes.data && availRes.data.length > 0) {
          const availabilities: Set<string> = new Set();
          for (const avail of availRes.data) {
            if (avail.is_active) {
              availabilities.add(cellKey(avail.day, avail.hour_of_day));
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
        // Don't let a failed DB load strand the user on "select a sport first":
        // apply the pre-onboarding sport selection so the wizard stays usable.
        seedSportsFromGuest();
      } finally {
        setIsLoadingData(false);
      }
    };

    loadExistingData();
  }, []);

  // Calculate steps dynamically based on selected sports (resolved from
  // pre-onboarding's saved player_sport rows in the load-existing-data effect)
  const steps = useMemo<OnboardingStepId[]>(() => {
    const baseSteps: OnboardingStepId[] = ['consent', 'personal'];

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
