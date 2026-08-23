'use client';

import { useSports } from '@rallia/shared-hooks';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

import { GetStartedHandoff } from './get-started-handoff';

import {
  AuthStep,
  AvailabilitySelectStep,
  ConsentStep,
  FavoritesStep,
  LocationStep,
  OnboardingError,
  OnboardingNav,
  OnboardingStepper,
  PersonalStep,
  RatingStep,
  SportSelectStep,
} from '@/components/web-onboarding/onboarding-steps';
import {
  useWebOnboarding,
  type OnboardingProfilePayload,
} from '@/components/web-onboarding/use-web-onboarding';
import { webOnboardingCompleted, webOnboardingStarted } from '@/lib/analytics';
import { signInProviderOf, type SignInProvider } from '@/lib/web-onboarding/sign-in-provider';

const DONE_STEP = 'done';

/** Inbound context captured on the landing URL, written on the account at submit. */
export type GetStartedAttribution = {
  utm?: { source?: string; medium?: string; campaign?: string; term?: string; content?: string };
  referralCode?: string;
};

interface GetStartedWizardProps {
  locale: string;
  platform: 'ios' | 'android' | null;
  attribution: GetStartedAttribution;
  /** Attribution query to keep across the OAuth round trip. */
  returnQuery: string;
  installUrl: string;
}

async function requestComplete(body: Record<string, unknown>): Promise<void> {
  const res = await fetch('/api/web-onboarding/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(typeof data?.error === 'string' ? data.error : 'SUBMIT_FAILED');
  }
}

/**
 * The /get-started walk: auth, consent, about you, sport, level, location, courts,
 * availability, then the install hand-off. Built on the shared controller with its
 * opt-in sport and availability steps, so an account created here is the same shape
 * as one from the join and booking gates, plus the two things those never collect.
 */
export function GetStartedWizard({
  locale,
  platform,
  attribution,
  returnQuery,
  installUrl,
}: GetStartedWizardProps) {
  const t = useTranslations('webJoin');
  const tFunnel = useTranslations('webOnboarding.funnel');

  const [provider, setProvider] = useState<SignInProvider>('other');
  const [email, setEmail] = useState<string | null>(null);
  const [existingUser, setExistingUser] = useState(false);

  const referred = !!attribution.referralCode;
  const hasUtm = !!attribution.utm && Object.keys(attribution.utm).length > 0;

  const rememberSignIn = useCallback(async (supabase: SupabaseClient) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setProvider(signInProviderOf(user));
    setEmail(user.email ?? null);
  }, []);

  const resolveAuthenticatedStep = useCallback(
    async (supabase: SupabaseClient, userId: string) => {
      const [{ data: profile, error: profileError }, { data: primarySport }] = await Promise.all([
        supabase
          .from('profile')
          .select('onboarding_completed, first_name, last_name')
          .eq('id', userId)
          .maybeSingle(),
        supabase
          .from('player_sport')
          .select('sport_id')
          .eq('player_id', userId)
          .eq('is_primary', true)
          .maybeSingle(),
      ]);
      if (profileError) throw new Error(profileError.message);

      await rememberSignIn(supabase);

      if (profile?.onboarding_completed) {
        setExistingUser(true);
        return { step: DONE_STEP };
      }

      return {
        step: 'consent',
        firstName: profile?.first_name,
        lastName: profile?.last_name,
        sportId: primarySport?.sport_id ?? null,
      };
    },
    [rememberSignIn]
  );

  const onSubmitProfile = useCallback(
    async (payload: OnboardingProfilePayload) => {
      await requestComplete({
        locale,
        personal: payload.personal,
        sportId: payload.sportId,
        ratingScoreId: payload.ratingScoreId,
        location: payload.location,
        favoriteFacilityIds: payload.favoriteFacilityIds,
        availability: payload.availability ?? [],
        attribution,
      });
      return DONE_STEP;
    },
    [locale, attribution]
  );

  const mapSubmitError = useCallback(
    (error: unknown) => {
      const code = error instanceof Error ? error.message : '';
      if (code === 'MINIMUM_AGE') return t('errors.minimumAge');
      if (code === 'ONBOARDING_INCOMPLETE') return t('errors.onboardingIncomplete');
      return t('errors.submitFailed');
    },
    [t]
  );

  const controller = useWebOnboarding({
    sportId: null,
    includeSportStep: true,
    includeAvailabilityStep: true,
    returnPath: `/${locale}/get-started${returnQuery}`,
    locale,
    t,
    resolveAuthenticatedStep,
    onSubmitProfile,
    mapSubmitError,
  });

  const { step } = controller;

  // The level step's heading names the sport, so resolve the id the player just picked.
  const { sports } = useSports();
  const sportName = sports.find(sport => sport.id === controller.sportId)?.display_name ?? '';

  useEffect(() => {
    webOnboardingStarted({ referred, has_utm: hasUtm });
  }, [referred, hasUtm]);

  const completedRef = useRef(false);
  useEffect(() => {
    if (step !== DONE_STEP || completedRef.current) return;
    completedRef.current = true;
    webOnboardingCompleted({ existing_user: existingUser, provider, referred, has_utm: hasUtm });
  }, [step, existingUser, provider, referred, hasUtm]);

  // A tall step (the availability grid) leaves the page scrolled down; the next one
  // should open from the top.
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

  if (step === DONE_STEP) {
    return (
      <GetStartedHandoff
        provider={provider}
        email={email}
        platform={platform}
        installUrl={installUrl}
        referralCode={attribution.referralCode}
      />
    );
  }

  return (
    <div className="flex w-full flex-col gap-6">
      {step === 'auth' && (
        <div className="space-y-2">
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {tFunnel('heading')}
          </h1>
          <p className="text-muted-foreground">{tFunnel('subheading')}</p>
        </div>
      )}

      <OnboardingStepper controller={controller} t={t} />
      <OnboardingError message={controller.errorMessage} />

      <div key={step} className="animate-fade-in flex flex-col gap-6">
        {step === 'auth' && (
          <AuthStep
            controller={controller}
            t={t}
            title={tFunnel('auth.title')}
            description={tFunnel('auth.description')}
          />
        )}
        {step === 'consent' && <ConsentStep controller={controller} />}
        {step === 'personal' && <PersonalStep controller={controller} t={t} />}
        {step === 'sport' && <SportSelectStep controller={controller} />}
        {step === 'rating' && <RatingStep controller={controller} t={t} sportName={sportName} />}
        {step === 'location' && <LocationStep controller={controller} t={t} />}
        {step === 'favorites' && <FavoritesStep controller={controller} t={t} />}
        {step === 'availability' && <AvailabilitySelectStep controller={controller} />}
      </div>

      {/* Sticky so Continue stays reachable under the tall availability grid. */}
      <div className="sticky bottom-0 z-10 -mx-4 bg-gradient-to-t from-background via-background/90 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6 sm:-mx-6 sm:px-6">
        <OnboardingNav controller={controller} t={t} finishLabel={tFunnel('finish')} />
      </div>
    </div>
  );
}
