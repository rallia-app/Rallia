'use client';

import { usePostalCodeGeocode, useAuth } from '@rallia/shared-hooks';
import { GENDER_VALUES } from '@rallia/shared-types';
import { formatPostalCodeInput, meetsMinimumAge } from '@rallia/shared-utils';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient, User as SupabaseUser } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/client';

/** Steps this hook owns. Callers add their own terminal steps (success, review, …). */
export type OnboardingStep = 'auth' | 'consent' | 'personal' | 'rating' | 'location';

/** The four profile-building steps, in order. `auth` sits outside the stepper. */
export const PROFILE_STEPS: Array<{ id: OnboardingStep; labelKey: string }> = [
  { id: 'consent', labelKey: 'consent' },
  { id: 'personal', labelKey: 'profile' },
  { id: 'rating', labelKey: 'level' },
  { id: 'location', labelKey: 'location' },
];

export type RatingOption = { id: string; label: string; value: number | null };

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
  };
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
  /** Sport the rating step loads levels for. Null defers the fetch. */
  sportId: string | null;
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
  }>;
  /**
   * Called once the location step validates, with the full profile payload.
   * Return the step to land on; throw to surface an error on the current step.
   */
  onSubmitProfile: (payload: OnboardingProfilePayload) => Promise<OnboardingStep | string | void>;
  /** Turns a thrown submit error into localized copy. Defaults to a generic message. */
  mapSubmitError?: (error: unknown) => string;
}

export function useWebOnboarding({
  sportId,
  returnPath,
  locale,
  t,
  resolveAuthenticatedStep,
  onSubmitProfile,
  mapSubmitError,
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

  // Location
  const [postalCode, setPostalCode] = useState('');
  const [locationCity, setLocationCity] = useState('');
  const [locationProvince, setLocationProvince] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);

  const profileStepIndex = PROFILE_STEPS.findIndex(s => s.id === step);
  const isProfileStep = profileStepIndex !== -1;

  const applyResolvedStep = useCallback(
    (state: {
      step: OnboardingStep | string;
      firstName?: string | null;
      lastName?: string | null;
    }) => {
      if (state.firstName) setFirstName(state.firstName);
      if (state.lastName) setLastName(state.lastName);
      setStep(state.step);
    },
    []
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
        const data = (await res.json()) as { ratings: RatingOption[] };
        if (!cancelled) {
          setRatings(data.ratings);
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

  const handlePostalCodeBlur = useCallback(async () => {
    const validation = validateFormat(postalCode);
    if (!validation.isValid || !validation.normalized) return;

    const result = await geocode(validation.normalized);
    if (result) {
      setPostalCode(result.postalCode);
      setLatitude(result.latitude);
      setLongitude(result.longitude);
      setLocationCity(result.city ?? '');
      setLocationProvince(result.province ?? '');
    }
  }, [postalCode, validateFormat, geocode]);

  const goNext = useCallback(async () => {
    setErrorMessage(null);

    if (step === 'consent') {
      if (!hasAcceptedPrivacy || !hasAcceptedTerms) {
        setErrorMessage(t('errors.consentRequired'));
        return;
      }

      setIsSubmitting(true);
      try {
        // Re-fetch current versions rather than caching them — robust to
        // policy_versions being bumped mid-onboarding. Same write path as the
        // mobile consent step (accept_policy_consent RPC).
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

        setStep('personal');
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
      setStep('rating');
      return;
    }

    if (step === 'rating') {
      if (!selectedRatingId) {
        setErrorMessage(t('errors.selectRating'));
        return;
      }
      setStep('location');
      return;
    }

    if (step === 'location') {
      if (!postalCode.trim() || latitude == null || longitude == null) {
        setErrorMessage(t('errors.invalidPostalCode'));
        return;
      }
      if (!sportId || !selectedRatingId) {
        setErrorMessage(t('errors.submitFailed'));
        return;
      }

      setIsSubmitting(true);
      try {
        const nextStep = await onSubmitProfile({
          personal: { firstName, lastName, gender, birthDate },
          sportId,
          ratingScoreId: selectedRatingId,
          location: {
            postalCode,
            city: locationCity || postalCode,
            province: locationProvince || 'QC',
            latitude,
            longitude,
          },
        });
        if (nextStep) setStep(nextStep);
      } catch (err) {
        setErrorMessage(mapSubmitError?.(err) ?? t('errors.submitFailed'));
      } finally {
        setIsSubmitting(false);
      }
    }
  }, [
    step,
    hasAcceptedPrivacy,
    hasAcceptedTerms,
    supabase,
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
    sportId,
    onSubmitProfile,
    mapSubmitError,
    t,
  ]);

  const goBack = useCallback(() => {
    setErrorMessage(null);
    if (profileStepIndex > 0) {
      setStep(PROFILE_STEPS[profileStepIndex - 1].id);
    }
  }, [profileStepIndex]);

  return {
    supabase,
    step,
    setStep,
    isReady,
    isSubmitting,
    setIsSubmitting,
    errorMessage,
    setErrorMessage,
    profileStepIndex,
    isProfileStep,

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
    rating: { ratings, selectedRatingId, setSelectedRatingId, isLoadingRatings },
    location: {
      postalCode,
      handlePostalCodeChange,
      handlePostalCodeBlur,
      locationCity,
      locationProvince,
      latitude,
      isGeocoding,
    },

    goNext,
    goBack,
  };
}

export type WebOnboardingController = ReturnType<typeof useWebOnboarding>;
