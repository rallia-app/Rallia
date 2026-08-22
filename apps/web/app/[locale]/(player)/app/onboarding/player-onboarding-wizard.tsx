'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DayEnum } from '@rallia/shared-types';
import { useSports } from '@rallia/shared-hooks';
import {
  MIN_AVAILABILITY_CELLS,
  countSelected,
  emptyGrid,
  parseCellKey,
  type HourGrid,
} from '@rallia/shared-utils';

import { AvailabilityStep } from './availability-step';
import { SportStep } from './sport-step';

import { AvatarPicker } from '@/components/app/inputs/avatar-picker';
import {
  ConsentStep,
  FavoritesStep,
  LocationStep,
  OnboardingError,
  OnboardingNav,
  PersonalStep,
  RatingStep,
} from '@/components/web-onboarding/onboarding-steps';
import {
  useWebOnboarding,
  type OnboardingProfilePayload,
} from '@/components/web-onboarding/use-web-onboarding';
import { Stepper } from '@/components/web-onboarding/wizard-primitives';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/** Our own steps: one before the shared wizard's, two after. */
const SPORT_STEP = 'sport';
const AVAILABILITY_STEP = 'availability';
const CONSENT_STEP = 'consent';
/** Owned by the shared controller; named here for the journey and its label. */
const FAVORITES_STEP = 'favorites';

/**
 * The whole walk, in order. The sport step drops out when the account has one.
 *
 * Consent sits last on purpose. Asking someone to accept the terms before they have
 * seen anything is asking them to agree to a product they have not met; putting it at
 * the finish line makes it the deliberate act it is meant to be, and it is also the
 * point where nothing has been written yet, so declining costs them nothing.
 */
const JOURNEY_STEPS = [
  SPORT_STEP,
  'personal',
  'rating',
  'location',
  FAVORITES_STEP,
  AVAILABILITY_STEP,
  CONSENT_STEP,
];

/**
 * Step → label key under onboarding.stepNames (mobile's own step names, so the two
 * wizards narrate the walk identically). The rating step has no per-sport entry
 * there; webJoin.steps.level covers it.
 */
const STEP_NAME_KEYS: Record<string, string> = {
  [SPORT_STEP]: 'sports',
  personal: 'personal',
  location: 'location',
  [AVAILABILITY_STEP]: 'availability',
  [FAVORITES_STEP]: 'favoriteSites',
  [CONSENT_STEP]: 'consent',
};

interface PlayerOnboardingWizardProps {
  /** Primary sport already on the account, if any — skips the sport step. */
  initialSportId: string | null;
  userId: string;
  /** Existing avatar, so a returning player is not asked for one twice. */
  initialProfilePictureUrl: string | null;
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
 *
 * Presentation notes: one Stepper spans the entire journey (the shared
 * OnboardingStepper only covers the four profile steps, which read as the bar
 * vanishing at availability); step bodies animate in on a keyed remount; and every
 * step's navigation lives in one sticky footer so Continue never scrolls out of
 * reach under the availability grid.
 */
export function PlayerOnboardingWizard({
  initialSportId,
  userId,
  initialProfilePictureUrl,
}: PlayerOnboardingWizardProps) {
  const t = useTranslations('webJoin');
  const tOnboarding = useTranslations('onboarding');
  const locale = useLocale();

  const [sportId, setSportId] = useState<string | null>(initialSportId);
  const sportIdRef = useRef(sportId);
  sportIdRef.current = sportId;

  // The shared wizard submits at its favourites step; we intercept that payload and hold
  // it until availability is collected, then post everything at once.
  const [profilePayload, setProfilePayload] = useState<OnboardingProfilePayload | null>(null);
  const [availability, setAvailability] = useState<HourGrid>(emptyGrid);
  const [profilePictureUrl, setProfilePictureUrl] = useState<string | null>(
    initialProfilePictureUrl
  );
  const [isFinishing, setIsFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  // The level step's heading is "Your {sport} level", so it needs the name, not the id.
  const { sports } = useSports();
  const sportName = sports.find(sport => sport.id === sportId)?.display_name ?? '';

  const journey = useMemo(
    () => (initialSportId ? JOURNEY_STEPS.filter(s => s !== SPORT_STEP) : JOURNEY_STEPS),
    [initialSportId]
  );

  const resolveAuthenticatedStep = useCallback(async (supabase: SupabaseClient, userId: string) => {
    const { data: profile } = await supabase
      .from('profile')
      .select('first_name, last_name')
      .eq('id', userId)
      .maybeSingle();

    return {
      // Straight past the sport step when the account already has a primary sport.
      step: sportIdRef.current ? 'personal' : SPORT_STEP,
      firstName: profile?.first_name ?? null,
      lastName: profile?.last_name ?? null,
    };
  }, []);

  const submitProfile = useCallback(async (payload: OnboardingProfilePayload) => {
    // Nothing is written yet — an account without availability is exactly the
    // half-record this wizard exists to avoid.
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

  const controller = useWebOnboarding({
    sportId,
    returnPath: `/${locale}/app/onboarding`,
    locale,
    t,
    resolveAuthenticatedStep,
    onSubmitProfile: submitProfile,
    mapSubmitError,
    // This wizard asks for consent as its final step, so the controller must not
    // demand it up front.
    deferConsent: true,
  });

  const { setStep, personal, acceptPolicies } = controller;

  const handleFinish = useCallback(async () => {
    if (!profilePayload) return;
    setIsFinishing(true);
    setFinishError(null);

    try {
      // Consent first: it is the only part of this that is a legal record, and the
      // player just gave it explicitly. Writing it before the profile means a failed
      // profile write cannot lose it.
      await acceptPolicies();

      const response = await fetch('/api/player-onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locale,
          personal: profilePayload.personal,
          profilePictureUrl,
          sportId: profilePayload.sportId,
          ratingScoreId: profilePayload.ratingScoreId,
          location: profilePayload.location,
          availability: Array.from(availability)
            .map(parseCellKey)
            .filter((cell): cell is { day: DayEnum; hour: number } => cell !== null),
          favoriteFacilityIds: profilePayload.favoriteFacilityIds,
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
  }, [profilePayload, availability, profilePictureUrl, locale, acceptPolicies, t]);

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

  const { step } = controller;

  // A tall step (the availability grid) leaves the page scrolled down; the next step
  // would otherwise open mid-card. Instant, not smooth — the entry animation is the
  // motion here, and it should start from the top.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  if (!controller.isReady) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const journeyIndex = Math.max(0, journey.indexOf(step));
  const stepLabel =
    step === 'rating' ? t('steps.level') : tOnboarding(`stepNames.${STEP_NAME_KEYS[step]}`);

  return (
    <div className="flex flex-col gap-6">
      <Stepper
        totalSteps={journey.length}
        currentIndex={journeyIndex}
        currentLabel={stepLabel}
        counterLabel={tOnboarding('step', {
          current: journeyIndex + 1,
          total: journey.length,
        })}
      />
      <OnboardingError message={controller.errorMessage} />

      {/* Keyed on the step so each one remounts and plays its entrance. The sticky
          footer stays outside: an animated (transformed) ancestor would become its
          containing block and break position: sticky. */}
      <div
        key={step}
        className="flex flex-col gap-6 duration-500 animate-in fade-in slide-in-from-bottom-3"
      >
        {step === SPORT_STEP && <SportStep selectedSportId={sportId} onSelect={setSportId} />}

        {step === 'personal' && (
          <>
            {/* Sits above the shared PersonalStep rather than inside it: that component is
                also used by the join and booking gates, which do not collect a photo. */}
            <Card>
              <CardContent className="pt-6">
                <AvatarPicker
                  userId={userId}
                  name={`${controller.personal.firstName} ${controller.personal.lastName}`.trim()}
                  value={profilePictureUrl}
                  onChange={setProfilePictureUrl}
                />
              </CardContent>
            </Card>
            <PersonalStep controller={controller} t={t} />
          </>
        )}
        {step === 'rating' && <RatingStep controller={controller} t={t} sportName={sportName} />}
        {step === 'location' && <LocationStep controller={controller} t={t} />}
        {step === FAVORITES_STEP && <FavoritesStep controller={controller} t={t} />}

        {step === AVAILABILITY_STEP && (
          <AvailabilityStep value={availability} onChange={setAvailability} />
        )}

        {step === CONSENT_STEP && (
          <>
            <ConsentStep controller={controller} />
            <OnboardingError message={finishError} />
          </>
        )}
      </div>

      {/* One sticky footer for every step's navigation: Continue stays reachable under
          tall content, and the fade lets cards scroll away beneath it. */}
      <div className="sticky bottom-0 z-10 -mx-4 bg-gradient-to-t from-background via-background/90 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6 sm:-mx-6 sm:px-6">
        {step === SPORT_STEP && (
          <Button
            type="button"
            size="lg"
            className="w-full font-semibold"
            disabled={!sportId}
            onClick={() => setStep('personal')}
          >
            {t('continue')}
            <ArrowRight className="size-4" />
          </Button>
        )}

        <OnboardingNav controller={controller} t={t} finishLabel={t('continue')} />

        {step === AVAILABILITY_STEP && (
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => setStep(FAVORITES_STEP)}
            >
              <ArrowLeft className="size-4" />
              {t('back')}
            </Button>
            <Button
              type="button"
              size="lg"
              className="flex-1 font-semibold"
              disabled={countSelected(availability) < MIN_AVAILABILITY_CELLS}
              onClick={() => setStep(CONSENT_STEP)}
            >
              {t('continue')}
              <ArrowRight className="size-4" />
            </Button>
          </div>
        )}

        {step === CONSENT_STEP && (
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => setStep(AVAILABILITY_STEP)}
              disabled={isFinishing}
            >
              <ArrowLeft className="size-4" />
              {t('back')}
            </Button>
            <Button
              type="button"
              size="lg"
              className="flex-1 font-semibold"
              disabled={!controller.consent.isComplete || isFinishing}
              onClick={() => void handleFinish()}
            >
              {isFinishing && <Loader2 className="size-4 animate-spin" />}
              {/* Not webJoin.finish — that reads "Join game", which belongs to the
                  join gate this controller is shared with. */}
              {tOnboarding('getStarted')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
