'use client';

import { usePostalCodeGeocode, useAuth, type PlaceDetails } from '@rallia/shared-hooks';
import { GENDER_VALUES, type DayEnum } from '@rallia/shared-types';
import {
  MIN_AVAILABILITY_CELLS,
  MIN_FAVORITE_FACILITIES,
  countSelected,
  emptyGrid,
  formatPostalCodeInput,
  meetsMinimumAge,
  parseCellKey,
  type HourGrid,
  type RatingSystemCode,
} from '@rallia/shared-utils';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient, User as SupabaseUser } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/client';

/** Steps this hook owns. Callers add their own terminal steps (success, review, …). */
export type OnboardingStep =
  | 'auth'
  | 'consent'
  | 'personal'
  | 'sport'
  | 'rating'
  | 'location'
  | 'favorites'
  | 'availability';

type ProfileStepSpec = { id: OnboardingStep; labelKey: string };

/** The default profile-building steps, in order. `auth` sits outside the stepper. */
export const PROFILE_STEPS: ProfileStepSpec[] = [
  { id: 'consent', labelKey: 'consent' },
  { id: 'personal', labelKey: 'profile' },
  { id: 'rating', labelKey: 'level' },
  { id: 'location', labelKey: 'location' },
  { id: 'favorites', labelKey: 'favorites' },
];

/** Opt-in steps: the sport picker (when no entry point hands us one) and the weekly grid. */
const SPORT_STEP: ProfileStepSpec = { id: 'sport', labelKey: 'sport' };
const AVAILABILITY_STEP: ProfileStepSpec = { id: 'availability', labelKey: 'availability' };

/** The step that submits the profile on the default walk; `controller.finalProfileStep` is the live value. */
export const FINAL_PROFILE_STEP: OnboardingStep = 'favorites';

function buildProfileSteps(options: {
  deferConsent: boolean;
  includeSportStep: boolean;
  includeAvailabilityStep: boolean;
}): ProfileStepSpec[] {
  const steps: ProfileStepSpec[] = [];
  for (const spec of PROFILE_STEPS) {
    if (spec.id === 'consent' && options.deferConsent) continue;
    // The sport is chosen right before the level it scopes.
    if (spec.id === 'rating' && options.includeSportStep) steps.push(SPORT_STEP);
    steps.push(spec);
  }
  if (options.includeAvailabilityStep) steps.push(AVAILABILITY_STEP);
  return steps;
}

export type RatingOption = { id: string; label: string; value: number | null };

export type AvailabilityCell = { day: DayEnum; hour: number };

/** What a brand-new account submits once the last step is done. */
export type OnboardingProfilePayload = {
  personal: {
    firstName: string;
    lastName: string;
    gender: (typeof GENDER_VALUES)[number];
    birthDate: string;
  };
  sportId: string;
  ratingScoreId: string;
  location: {
    postalCode: string;
    city: string;
    province: string;
    latitude: number;
    longitude: number;
    /** Full street address, when the player chose to give one. */
    address?: string;
  };
  /** At least MIN_FAVORITE_FACILITIES, for `sportId`. */
  favoriteFacilityIds: string[];
  /** Only when the caller opted into the availability step; at least MIN_AVAILABILITY_CELLS. */
  availability?: AvailabilityCell[];
};

/** Minimal translator shape — both `webJoin` and `webBook` satisfy it. */
type Translator = (key: string, values?: Record<string, string | number>) => string;

/** Wait for Supabase auth hydration before deciding guest vs signed-in. */
async function resolveInitialUser(supabase: SupabaseClient): Promise<SupabaseUser | null> {
  const sessionResult = await supabase.auth.getSession();
  if (sessionResult.data.session?.user) return sessionResult.data.session.user;

  // `getSession()` can be empty for a moment after client navigation while
  // cookies/local storage settle, but `getUser()` gives us a bounded fallback.
  const userResult = await supabase.auth.getUser();
  return userResult.data.user ?? null;
}

export interface UseWebOnboardingOptions {
  /**
   * Sport the rating step loads levels for. Null defers the fetch; with
   * `includeSportStep` the player's pick takes over when this is null.
   */
  sportId: string | null;
  /** Adds a sport picker before the level step, for surfaces no entry point hands a sport to. */
  includeSportStep?: boolean;
  /** Adds the weekly availability grid after favourites; the payload then carries `availability`. */
  includeAvailabilityStep?: boolean;
  /** Locale-prefixed path Supabase returns to after an OAuth/magic-link round trip. */
  returnPath: string;
  locale: string;
  /** Translator scoped to a namespace carrying the shared onboarding keys. */
  t: Translator;
  /**
   * Decides where an authenticated visitor lands. Runs on mount and again right
   * after OTP verification. Return the step to show; the caller owns whatever
   * surface an already-onboarded user should see.
   */
  resolveAuthenticatedStep: (
    supabase: SupabaseClient,
    userId: string
  ) => Promise<{
    step: OnboardingStep | string;
    firstName?: string | null;
    lastName?: string | null;
    /** Pre-selects the sport step, e.g. from an existing player_sport row. */
    sportId?: string | null;
  }>;
  /**
   * Called once the favourites step validates, with the full profile payload.
   * Return the step to land on; throw to surface an error on the current step.
   */
  onSubmitProfile: (payload: OnboardingProfilePayload) => Promise<OnboardingStep | string | void>;
  /** Turns a thrown submit error into localized copy. Defaults to a generic message. */
  mapSubmitError?: (error: unknown) => string;
  /**
   * Lifts consent out of this hook's step sequence so the caller can ask for it
   * wherever it belongs in a longer journey — for the player wizard, at the very end,
   * once someone has seen what they are agreeing to. The caller then calls
   * `acceptPolicies()` itself before completing.
   *
   * Left off for the join and booking gates: those submit the profile at the favourites
   * step, so consent has to be recorded before it.
   */
  deferConsent?: boolean;
  /**
   * Facilities ticked before the player reaches the favourites step: the game's facility
   * on the join gate, the facility being booked on the booking gate. Read once on mount.
   */
  preselectedFacilityIds?: string[];
}

export function useWebOnboarding({
  sportId: sportIdOption,
  includeSportStep = false,
  includeAvailabilityStep = false,
  returnPath,
  locale,
  t,
  resolveAuthenticatedStep,
  onSubmitProfile,
  mapSubmitError,
  deferConsent = false,
  preselectedFacilityIds,
}: UseWebOnboardingOptions) {
  const supabase = useMemo(() => createClient(), []);
  const { signInWithProvider, signInWithEmail, verifyOtp } = useAuth({ client: supabase });
  const { geocode, isLoading: isGeocoding, validateFormat } = usePostalCodeGeocode();

  const [step, setStep] = useState<OnboardingStep | string>('auth');
  const [isReady, setIsReady] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Auth
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [authPhase, setAuthPhase] = useState<'email' | 'otp'>('email');
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  // Consent
  const [hasAcceptedPrivacy, setHasAcceptedPrivacy] = useState(false);
  const [hasAcceptedTerms, setHasAcceptedTerms] = useState(false);

  // Personal
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [gender, setGender] = useState<(typeof GENDER_VALUES)[number]>('male');
  const [birthDate, setBirthDate] = useState('');

  // Rating
  const [ratings, setRatings] = useState<RatingOption[]>([]);
  const [selectedRatingId, setSelectedRatingId] = useState<string | null>(null);
  const [isLoadingRatings, setIsLoadingRatings] = useState(false);
  const [ratingSystemCode, setRatingSystemCode] = useState<RatingSystemCode | null>(null);

  // Location
  const [postalCode, setPostalCode] = useState('');
  const [locationCity, setLocationCity] = useState('');
  const [locationProvince, setLocationProvince] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  // Optional precise address. When set, its coordinates win over the postal code's
  // centroid — that is the whole point of asking for it.
  const [address, setAddress] = useState('');

  // Favorites
  const [favoriteFacilityIds, setFavoriteFacilityIds] = useState<string[]>(
    () => preselectedFacilityIds ?? []
  );

  // Sport (only when the caller opted into the sport step)
  const [selectedSportId, setSelectedSportId] = useState<string | null>(null);
  const sportId = sportIdOption ?? selectedSportId;

  // Availability (only when the caller opted into the availability step)
  const [availability, setAvailability] = useState<HourGrid>(emptyGrid);

  const profileSteps = useMemo(
    () => buildProfileSteps({ deferConsent, includeSportStep, includeAvailabilityStep }),
    [deferConsent, includeSportStep, includeAvailabilityStep]
  );
  const profileStepIndex = profileSteps.findIndex(s => s.id === step);
  const isProfileStep = profileStepIndex !== -1;
  const finalProfileStep = profileSteps[profileSteps.length - 1].id;
  const isFinalProfileStep = step === finalProfileStep;

  const applyResolvedStep = useCallback(
    (state: {
      step: OnboardingStep | string;
      firstName?: string | null;
      lastName?: string | null;
      sportId?: string | null;
    }) => {
      if (state.firstName) setFirstName(state.firstName);
      if (state.lastName) setLastName(state.lastName);
      if (state.sportId) setSelectedSportId(state.sportId);
      setStep(state.step);
    },
    []
  );

  /** Picking a sport invalidates the level and the courts, which are both sport-scoped. */
  const selectSport = useCallback(
    (nextSportId: string) => {
      if (nextSportId === selectedSportId) return;
      setSelectedSportId(nextSportId);
      setSelectedRatingId(null);
      setRatings([]);
      setFavoriteFacilityIds(preselectedFacilityIds ?? []);
    },
    [selectedSportId, preselectedFacilityIds]
  );

  // Initial guest-vs-signed-in resolution.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const user = await resolveInitialUser(supabase);
        if (cancelled) return;

        if (!user) {
          setStep('auth');
          return;
        }

        const state = await resolveAuthenticatedStep(supabase, user.id);
        if (cancelled) return;
        applyResolvedStep(state);
      } catch {
        if (cancelled) return;
        setErrorMessage(t('errors.submitFailed'));
        setStep('auth');
      } finally {
        if (!cancelled) setIsReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    // resolveAuthenticatedStep is expected to be stable (useCallback) in callers.
  }, [supabase, resolveAuthenticatedStep, applyResolvedStep, t]);

  // Signing out anywhere in the app drops the wizard back to the auth step.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') {
        setStep('auth');
        setAuthPhase('email');
        setOtp('');
        setErrorMessage(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  // Skill levels are sport-scoped, so they load lazily when the step opens.
  useEffect(() => {
    if (step !== 'rating' || !sportId) return;

    let cancelled = false;
    setIsLoadingRatings(true);

    (async () => {
      try {
        const res = await fetch(`/api/web-join/ratings?sportId=${sportId}`);
        if (!res.ok) throw new Error('Failed to load ratings');
        const data = (await res.json()) as {
          ratings: RatingOption[];
          systemCode?: RatingSystemCode;
        };
        if (!cancelled) {
          setRatings(data.ratings);
          setRatingSystemCode(data.systemCode ?? null);
          if (data.ratings.length > 0) {
            setSelectedRatingId(
              prev => prev ?? data.ratings[Math.floor(data.ratings.length / 2)]?.id ?? null
            );
          }
        }
      } catch {
        if (!cancelled) setErrorMessage(t('errors.ratingsLoadFailed'));
      } finally {
        if (!cancelled) setIsLoadingRatings(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, sportId, t]);

  const buildCallbackUrl = useCallback(() => {
    const callbackUrl = new URL('/api/auth/callback', window.location.origin);
    callbackUrl.searchParams.set('next', returnPath);
    return callbackUrl.toString();
  }, [returnPath]);

  const handleGoogleSignIn = useCallback(async () => {
    setIsGoogleLoading(true);
    setErrorMessage(null);
    const result = await signInWithProvider('google', { redirectTo: buildCallbackUrl() });
    if (!result.success) {
      setErrorMessage(result.error?.message ?? t('errors.authFailed'));
      setIsGoogleLoading(false);
    }
  }, [signInWithProvider, buildCallbackUrl, t]);

  const sendCode = useCallback(
    () =>
      signInWithEmail(email, {
        emailRedirectTo: buildCallbackUrl(),
        data: { locale },
      }),
    [signInWithEmail, email, buildCallbackUrl, locale]
  );

  const handleEmailAuth = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setErrorMessage(null);
      setIsAuthLoading(true);

      if (authPhase === 'email') {
        const result = await sendCode();
        if (!result.success) {
          setErrorMessage(result.error?.message ?? t('errors.authFailed'));
        } else {
          setAuthPhase('otp');
        }
      } else {
        const result = await verifyOtp(email, otp);
        if (!result.success) {
          setErrorMessage(result.error?.message ?? t('errors.authFailed'));
        } else {
          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (user) {
            applyResolvedStep(await resolveAuthenticatedStep(supabase, user.id));
          } else {
            setStep('consent');
          }
        }
      }
      setIsAuthLoading(false);
    },
    [
      authPhase,
      sendCode,
      verifyOtp,
      email,
      otp,
      supabase,
      resolveAuthenticatedStep,
      applyResolvedStep,
      t,
    ]
  );

  const handleResend = useCallback(async () => {
    setErrorMessage(null);
    setIsAuthLoading(true);
    const result = await sendCode();
    if (!result.success) {
      setErrorMessage(result.error?.message ?? t('errors.authFailed'));
    }
    setIsAuthLoading(false);
  }, [sendCode, t]);

  const handleChangeEmail = useCallback(() => {
    setErrorMessage(null);
    setOtp('');
    setAuthPhase('email');
  }, []);

  const handlePostalCodeChange = useCallback((value: string) => {
    setPostalCode(formatPostalCodeInput(value));
  }, []);

  /**
   * Adopts a place the player picked from address autocomplete. Its postal code only
   * overwrites what is already there when Google actually returned one — a place
   * without one must not blank out a postal code the player typed themselves, since
   * that field is the required one.
   */
  const selectAddress = useCallback((details: PlaceDetails) => {
    setAddress(details.address);
    setLatitude(details.latitude);
    setLongitude(details.longitude);
    if (details.city) setLocationCity(details.city);
    if (details.province) setLocationProvince(details.province);
    if (details.postalCode) {
      const normalized = formatPostalCodeInput(details.postalCode);
      if (normalized) setPostalCode(normalized);
    }
  }, []);

  /** Drops the precise address and falls back to the postal code's centroid. */
  const clearAddress = useCallback(async () => {
    setAddress('');
    const validation = validateFormat(postalCode);
    if (!validation.isValid || !validation.normalized) return;

    const result = await geocode(validation.normalized);
    if (result) {
      setLatitude(result.latitude);
      setLongitude(result.longitude);
      setLocationCity(result.city ?? '');
      setLocationProvince(result.province ?? '');
    }
  }, [postalCode, validateFormat, geocode]);

  const handlePostalCodeBlur = useCallback(async () => {
    const validation = validateFormat(postalCode);
    if (!validation.isValid || !validation.normalized) return;

    const result = await geocode(validation.normalized);
    if (!result) return;

    setPostalCode(result.postalCode);
    // A chosen address is more precise than the postal code's centroid, so it keeps
    // the coordinates. Without this, blurring the field after picking an address
    // would quietly throw that precision away.
    if (address) return;

    setLatitude(result.latitude);
    setLongitude(result.longitude);
    setLocationCity(result.city ?? '');
    setLocationProvince(result.province ?? '');
  }, [postalCode, address, validateFormat, geocode]);

  /**
   * Records acceptance of every current policy. Throws so the caller decides what a
   * failure means — blocking a gate mid-flow and failing a final submit want
   * different handling.
   *
   * Re-fetches current versions rather than caching them, so a policy bumped
   * mid-onboarding is still recorded accurately. Same write path as mobile's consent
   * step (accept_policy_consent RPC).
   */
  const acceptPolicies = useCallback(async () => {
    const { data: versions, error: versionsError } = await supabase
      .from('policy_versions')
      .select('policy_type, current_version');

    if (versionsError || !versions) {
      throw new Error(versionsError?.message ?? 'Failed to load policy versions');
    }

    await Promise.all(
      versions.map(async v => {
        const { error: acceptError } = await supabase.rpc('accept_policy_consent', {
          p_policy_type: v.policy_type,
          p_version: v.current_version,
        });
        if (acceptError) throw new Error(acceptError.message);
      })
    );
  }, [supabase]);

  const goNext = useCallback(async () => {
    setErrorMessage(null);

    // Each step validates itself; the walk then advances along profileSteps, and the
    // last one submits. Adding a step is one entry in buildProfileSteps plus its check.
    const nextStep = profileSteps[profileStepIndex + 1]?.id;

    if (step === 'consent') {
      if (!hasAcceptedPrivacy || !hasAcceptedTerms) {
        setErrorMessage(t('errors.consentRequired'));
        return;
      }

      setIsSubmitting(true);
      try {
        await acceptPolicies();
        if (nextStep) setStep(nextStep);
      } catch {
        setErrorMessage(t('errors.submitFailed'));
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (step === 'personal') {
      if (!firstName.trim() || !lastName.trim() || !birthDate) {
        setErrorMessage(t('errors.requiredFields'));
        return;
      }
      if (!meetsMinimumAge(birthDate)) {
        setErrorMessage(t('errors.minimumAge'));
        return;
      }
    }

    if (step === 'sport' && !sportId) {
      setErrorMessage(t('errors.selectSport'));
      return;
    }

    if (step === 'rating' && !selectedRatingId) {
      setErrorMessage(t('errors.selectRating'));
      return;
    }

    if (step === 'location' && (!postalCode.trim() || latitude == null || longitude == null)) {
      setErrorMessage(t('errors.invalidPostalCode'));
      return;
    }

    if (step === 'favorites' && favoriteFacilityIds.length < MIN_FAVORITE_FACILITIES) {
      setErrorMessage(t('errors.selectFavorites', { min: MIN_FAVORITE_FACILITIES }));
      return;
    }

    if (step === 'availability' && countSelected(availability) < MIN_AVAILABILITY_CELLS) {
      setErrorMessage(t('errors.selectAvailability', { min: MIN_AVAILABILITY_CELLS }));
      return;
    }

    if (!isFinalProfileStep) {
      if (nextStep) setStep(nextStep);
      return;
    }

    if (!sportId || !selectedRatingId || latitude == null || longitude == null) {
      setErrorMessage(t('errors.submitFailed'));
      return;
    }

    setIsSubmitting(true);
    try {
      const landing = await onSubmitProfile({
        personal: { firstName, lastName, gender, birthDate },
        sportId,
        ratingScoreId: selectedRatingId,
        location: {
          postalCode,
          city: locationCity || postalCode,
          province: locationProvince || 'QC',
          latitude,
          longitude,
          ...(address ? { address } : {}),
        },
        favoriteFacilityIds,
        ...(includeAvailabilityStep
          ? {
              availability: Array.from(availability)
                .map(parseCellKey)
                .filter((cell): cell is AvailabilityCell => cell !== null),
            }
          : {}),
      });
      if (landing) setStep(landing);
    } catch (err) {
      setErrorMessage(mapSubmitError?.(err) ?? t('errors.submitFailed'));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    step,
    profileSteps,
    profileStepIndex,
    isFinalProfileStep,
    hasAcceptedPrivacy,
    hasAcceptedTerms,
    firstName,
    lastName,
    birthDate,
    gender,
    selectedRatingId,
    postalCode,
    latitude,
    longitude,
    locationCity,
    locationProvince,
    address,
    favoriteFacilityIds,
    availability,
    includeAvailabilityStep,
    sportId,
    acceptPolicies,
    onSubmitProfile,
    mapSubmitError,
    t,
  ]);

  const toggleFavoriteFacility = useCallback((facilityId: string) => {
    setFavoriteFacilityIds(current =>
      current.includes(facilityId)
        ? current.filter(id => id !== facilityId)
        : [...current, facilityId]
    );
  }, []);

  const goBack = useCallback(() => {
    setErrorMessage(null);
    if (profileStepIndex > 0) {
      setStep(profileSteps[profileStepIndex - 1].id);
    }
  }, [profileStepIndex, profileSteps]);

  return {
    supabase,
    sportId,
    step,
    setStep,
    isReady,
    isSubmitting,
    setIsSubmitting,
    errorMessage,
    setErrorMessage,
    profileSteps,
    profileStepIndex,
    isProfileStep,
    finalProfileStep,
    isFinalProfileStep,
    acceptPolicies,

    auth: {
      email,
      setEmail,
      otp,
      setOtp,
      authPhase,
      isAuthLoading,
      isGoogleLoading,
      handleGoogleSignIn,
      handleEmailAuth,
      handleResend,
      handleChangeEmail,
    },
    consent: {
      hasAcceptedPrivacy,
      setHasAcceptedPrivacy,
      hasAcceptedTerms,
      setHasAcceptedTerms,
      isComplete: hasAcceptedPrivacy && hasAcceptedTerms,
    },
    personal: {
      firstName,
      setFirstName,
      lastName,
      setLastName,
      gender,
      setGender,
      birthDate,
      setBirthDate,
    },
    rating: {
      ratings,
      selectedRatingId,
      setSelectedRatingId,
      isLoadingRatings,
      systemCode: ratingSystemCode,
    },
    location: {
      postalCode,
      handlePostalCodeChange,
      handlePostalCodeBlur,
      locationCity,
      locationProvince,
      latitude,
      longitude,
      isGeocoding,
      address,
      selectAddress,
      clearAddress,
    },
    favorites: {
      selectedIds: favoriteFacilityIds,
      toggle: toggleFavoriteFacility,
      isComplete: favoriteFacilityIds.length >= MIN_FAVORITE_FACILITIES,
    },
    sport: {
      selectedId: selectedSportId,
      select: selectSport,
      isComplete: !!sportId,
    },
    availability: {
      grid: availability,
      setGrid: setAvailability,
      isComplete: countSelected(availability) >= MIN_AVAILABILITY_CELLS,
    },

    goNext,
    goBack,
  };
}

export type WebOnboardingController = ReturnType<typeof useWebOnboarding>;
