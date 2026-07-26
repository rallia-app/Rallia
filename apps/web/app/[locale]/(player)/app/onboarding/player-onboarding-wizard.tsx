'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, Loader2 } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DayEnum, FacilitySearchResult } from '@rallia/shared-types';
import { useSports } from '@rallia/shared-hooks';
import {
  MIN_AVAILABILITY_CELLS,
  countSelected,
  emptyGrid,
  parseCellKey,
  type HourGrid,
} from '@rallia/shared-utils';

import { AvailabilityStep } from './availability-step';
import { FavoriteFacilitiesStep, MIN_FAVORITE_FACILITIES } from './favorite-facilities-step';
import { SportStep } from './sport-step';

import {
  ConsentStep,
  LocationStep,
  OnboardingError,
  OnboardingNav,
  OnboardingStepper,
  PersonalStep,
  RatingStep,
} from '@/components/web-onboarding/onboarding-steps';
import {
  useWebOnboarding,
  type OnboardingProfilePayload,
} from '@/components/web-onboarding/use-web-onboarding';
import { Button } from '@/components/ui/button';

/** Our own steps: one before the shared wizard's four, two after. */
const SPORT_STEP = 'sport';
const AVAILABILITY_STEP = 'availability';
const FAVORITES_STEP = 'favorites';

interface PlayerOnboardingWizardProps {
  /** Primary sport already on the account, if any — skips the sport step. */
  initialSportId: string | null;
}

/**
 * Onboarding for a player who signed up on the web.
 *
 * Reuses the shared web-onboarding controller and step components rather than
 * forking them, so an account created here is identical to one created through the
 * /games join gate or the /courts booking gate. Two things are layered on top:
 *
 *  - a sport step, because unlike those gates nobody handed us a sport
 *  - prefill of anything already on the account, so a player who started onboarding
 *    on mobile and bounced to the web is not retyping their own name
 *
 * The walk is deliberately linear rather than skipping to the first missing field:
 * the submit payload is all-or-nothing (profile + sport + rating + location), so
 * jumping straight to, say, location would post empty names. Prefill plus a few
 * Continue clicks is the safe version of the same idea.
 */
export function PlayerOnboardingWizard({ initialSportId }: PlayerOnboardingWizardProps) {
  const t = useTranslations('webJoin');
  const locale = useLocale();

  const [sportId, setSportId] = useState<string | null>(initialSportId);
  const sportIdRef = useRef(sportId);
  sportIdRef.current = sportId;

  // The shared wizard submits at its location step; we intercept that payload and hold
  // it until availability and favourites are collected, then post everything at once.
  const [profilePayload, setProfilePayload] = useState<OnboardingProfilePayload | null>(null);
  const [availability, setAvailability] = useState<HourGrid>(emptyGrid);
  const [favorites, setFavorites] = useState<FacilitySearchResult[]>([]);
  const [isFinishing, setIsFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  // The level step's heading is "Your {sport} level", so it needs the name, not the id.
  const { sports } = useSports();
  const sportName = sports.find(sport => sport.id === sportId)?.display_name ?? '';

  const resolveAuthenticatedStep = useCallback(async (supabase: SupabaseClient, userId: string) => {
    const { data: profile } = await supabase
      .from('profile')
      .select('first_name, last_name')
      .eq('id', userId)
      .maybeSingle();

    return {
      // Straight past the sport step when the account already has a primary sport.
      step: sportIdRef.current ? 'consent' : SPORT_STEP,
      firstName: profile?.first_name ?? null,
      lastName: profile?.last_name ?? null,
    };
  }, []);

  const submitProfile = useCallback(async (payload: OnboardingProfilePayload) => {
    // Nothing is written yet — an account without availability or favourites is exactly
    // the half-record this wizard exists to avoid.
    setProfilePayload(payload);
    return AVAILABILITY_STEP;
  }, []);

  const mapSubmitError = useCallback(
    (error: unknown) => {
      const code = error instanceof Error ? error.message : 'SUBMIT_FAILED';
      if (code === 'MINIMUM_AGE') return t('errors.minimumAge');
      return t('errors.submitFailed');
    },
    [t]
  );

  const handleFinish = useCallback(async () => {
    if (!profilePayload) return;
    setIsFinishing(true);
    setFinishError(null);

    try {
      const response = await fetch('/api/player-onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locale,
          personal: profilePayload.personal,
          sportId: profilePayload.sportId,
          ratingScoreId: profilePayload.ratingScoreId,
          location: profilePayload.location,
          availability: Array.from(availability)
            .map(parseCellKey)
            .filter((cell): cell is { day: DayEnum; hour: number } => cell !== null),
          favoriteFacilityIds: favorites.map(facility => facility.id),
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'SUBMIT_FAILED');
      }

      // Full navigation, not router.push: the guard that sent the player here is cached
      // against /app from before the record was complete.
      window.location.assign(`/${locale}/app`);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'SUBMIT_FAILED';
      setFinishError(code === 'MINIMUM_AGE' ? t('errors.minimumAge') : t('errors.submitFailed'));
      setIsFinishing(false);
    }
  }, [profilePayload, availability, favorites, locale, t]);

  const controller = useWebOnboarding({
    sportId,
    returnPath: `/${locale}/app/onboarding`,
    locale,
    t,
    resolveAuthenticatedStep,
    onSubmitProfile: submitProfile,
    mapSubmitError,
  });

  const { setStep, personal } = controller;

  // Prefill gender and birth date, which applyResolvedStep does not carry. Runs once
  // the controller is ready so it cannot clobber something the player just typed.
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (!controller.isReady || prefilledRef.current) return;
    prefilledRef.current = true;

    (async () => {
      const {
        data: { user },
      } = await controller.supabase.auth.getUser();
      if (!user) return;

      const [{ data: profile }, { data: player }] = await Promise.all([
        controller.supabase.from('profile').select('birth_date').eq('id', user.id).maybeSingle(),
        controller.supabase.from('player').select('gender').eq('id', user.id).maybeSingle(),
      ]);

      if (profile?.birth_date) personal.setBirthDate(profile.birth_date);
      if (player?.gender === 'male' || player?.gender === 'female' || player?.gender === 'other') {
        personal.setGender(player.gender);
      }
    })();
  }, [controller.isReady, controller.supabase, personal]);

  if (!controller.isReady) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { step } = controller;

  return (
    <div className="flex flex-col gap-6">
      <OnboardingStepper controller={controller} t={t} />
      <OnboardingError message={controller.errorMessage} />

      {step === SPORT_STEP && (
        <>
          <SportStep selectedSportId={sportId} onSelect={setSportId} />
          <Button
            type="button"
            size="lg"
            className="font-semibold"
            disabled={!sportId}
            onClick={() => setStep('consent')}
          >
            {t('continue')}
            <ArrowRight className="size-4" />
          </Button>
        </>
      )}

      {step === 'consent' && <ConsentStep controller={controller} />}
      {step === 'personal' && <PersonalStep controller={controller} t={t} />}
      {step === 'rating' && <RatingStep controller={controller} t={t} sportName={sportName} />}
      {step === 'location' && <LocationStep controller={controller} t={t} />}

      <OnboardingNav controller={controller} t={t} finishLabel={t('continue')} />

      {step === AVAILABILITY_STEP && (
        <>
          <AvailabilityStep value={availability} onChange={setAvailability} />
          <Button
            type="button"
            size="lg"
            className="font-semibold"
            disabled={countSelected(availability) < MIN_AVAILABILITY_CELLS}
            onClick={() => setStep(FAVORITES_STEP)}
          >
            {t('continue')}
            <ArrowRight className="size-4" />
          </Button>
        </>
      )}

      {step === FAVORITES_STEP && profilePayload && (
        <>
          <FavoriteFacilitiesStep
            sportId={profilePayload.sportId}
            latitude={profilePayload.location.latitude}
            longitude={profilePayload.location.longitude}
            selected={favorites}
            onToggle={facility =>
              setFavorites(current =>
                current.some(entry => entry.id === facility.id)
                  ? current.filter(entry => entry.id !== facility.id)
                  : [...current, facility]
              )
            }
          />
          <OnboardingError message={finishError} />
          <Button
            type="button"
            size="lg"
            className="font-semibold"
            disabled={favorites.length < MIN_FAVORITE_FACILITIES || isFinishing}
            onClick={() => void handleFinish()}
          >
            {isFinishing && <Loader2 className="size-4 animate-spin" />}
            {t('continue')}
          </Button>
        </>
      )}
    </div>
  );
}
