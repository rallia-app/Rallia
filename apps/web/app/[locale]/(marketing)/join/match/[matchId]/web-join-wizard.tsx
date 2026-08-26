'use client';

import { QRCodeSVG } from 'qrcode.react';
import { getTimeDifferenceFromNow } from '@rallia/shared-utils';
import { ArrowRight, CheckCircle2, Loader2, LogOut, MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { WebJoinMatchContext } from './_lib/match-context';
import { MatchActionLinks } from './_components/match-action-links';

import {
  AuthStep,
  ConsentStep,
  FavoritesStep,
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
import { AppStoreBadges, StepHeader } from '@/components/web-onboarding/wizard-primitives';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { webJoinCompleted, webJoinStarted } from '@/lib/analytics';

type JoinStatus = 'joined' | 'requested' | 'waitlisted';

interface WebJoinWizardProps {
  match: WebJoinMatchContext;
  locale: string;
}

async function requestJoinComplete(body: Record<string, unknown>): Promise<JoinStatus> {
  const res = await fetch('/api/web-join/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Submit failed');
  }
  return data.joinStatus as JoinStatus;
}

async function requestExistingJoinStatus(matchId: string): Promise<JoinStatus | null> {
  const params = new URLSearchParams({ matchId });
  const res = await fetch(`/api/web-join/complete?${params}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Status check failed');
  }
  return data.joinStatus as JoinStatus | null;
}

async function requestLeaveMatch(matchId: string): Promise<void> {
  const res = await fetch('/api/web-join/leave', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchId }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Leave failed');
  }
}

/** Turn a stable join error code from the API into a friendly, localized message. */
function joinErrorMessage(code: string, t: ReturnType<typeof useTranslations<'webJoin'>>): string {
  switch (code) {
    case 'MATCH_STARTED':
      return t('errors.matchStarted');
    case 'GENDER_MISMATCH':
      return t('errors.genderMismatch');
    case 'MATCH_UNAVAILABLE':
      return t('errors.matchUnavailable');
    case 'ALREADY_HOST':
      return t('errors.alreadyHost');
    case 'ELIGIBILITY_UNVERIFIED':
      return t('errors.eligibilityUnverified');
    case 'MINIMUM_AGE':
      return t('errors.minimumAge');
    case 'ONBOARDING_INCOMPLETE':
      return t('errors.onboardingIncomplete');
    default:
      return t('errors.submitFailed');
  }
}

export function WebJoinWizard({ match, locale: pageLocale }: WebJoinWizardProps) {
  const t = useTranslations('webJoin');

  const [isLeaving, setIsLeaving] = useState(false);
  const [joinStatus, setJoinStatus] = useState<JoinStatus | null>(null);

  // Players can only leave before the match starts.
  const matchStarted =
    getTimeDifferenceFromNow(match.match_date, match.start_time, match.timezone || 'UTC') <= 0;

  const isRequestMode = match.join_mode === 'request';
  const matchCapacity = match.format === 'doubles' ? 4 : 2;
  const joinedCount = match.participants?.filter(p => p.status === 'joined').length ?? 0;
  const isFull = joinedCount >= matchCapacity;

  // A full game always waitlists the joiner, regardless of join_mode — mirror
  // the backend precedence (availableSpots <= 0 wins over request mode) so the
  // pre-join copy matches the outcome.
  const finishCtaLabel = isFull
    ? t('finishWaitlist')
    : isRequestMode
      ? t('finishRequest')
      : t('finish');
  const reviewCtaLabel = isFull
    ? t('review.waitlistCta')
    : isRequestMode
      ? t('review.requestCta')
      : t('review.cta');

  const matchDeepLink = `${typeof window !== 'undefined' ? window.location.origin : ''}/${pageLocale}/match/${match.id}?utm_source=web_join&utm_medium=qr&utm_campaign=join_match`;

  /**
   * An onboarded player either already has a participation (show the outcome)
   * or still needs to confirm this specific game. A brand-new account starts at
   * consent, exactly like the mobile onboarding wizard.
   */
  const resolveAuthenticatedStep = useCallback(
    async (supabase: SupabaseClient, userId: string) => {
      const { data: profile, error: profileError } = await supabase
        .from('profile')
        .select('onboarding_completed, first_name, last_name')
        .eq('id', userId)
        .maybeSingle();

      if (profileError) throw new Error(profileError.message);

      if (profile?.onboarding_completed) {
        const status = await requestExistingJoinStatus(match.id);
        setJoinStatus(status);
        return {
          step: status ? 'success' : 'review',
          firstName: profile.first_name,
          lastName: profile.last_name,
        };
      }

      setJoinStatus(null);
      return {
        step: 'consent',
        firstName: profile?.first_name,
        lastName: profile?.last_name,
      };
    },
    [match.id]
  );

  const submitJoin = useCallback(
    async (payload: OnboardingProfilePayload | null) => {
      const body = payload
        ? {
            matchId: match.id,
            locale: pageLocale,
            personal: payload.personal,
            sportId: payload.sportId,
            ratingScoreId: payload.ratingScoreId,
            location: payload.location,
            favoriteFacilityIds: payload.favoriteFacilityIds,
          }
        : { matchId: match.id, locale: pageLocale };

      const status = await requestJoinComplete(body);
      setJoinStatus(status);
      webJoinCompleted({
        match_id: match.id,
        join_status: status,
        existing_user: payload === null,
      });
      return status;
    },
    [match.id, pageLocale]
  );

  const onSubmitProfile = useCallback(
    async (payload: OnboardingProfilePayload) => {
      await submitJoin(payload);
      return 'success';
    },
    [submitJoin]
  );

  const mapSubmitError = useCallback(
    (err: unknown) => joinErrorMessage(err instanceof Error ? err.message : '', t),
    [t]
  );

  // The game's facility is the obvious first favourite; the player can still untick it.
  const pinnedFacilities = useMemo(
    () =>
      match.facility_id && match.facility
        ? [{ id: match.facility_id, name: match.facility.name, city: match.facility.city }]
        : [],
    [match.facility_id, match.facility]
  );

  const controller = useWebOnboarding({
    sportId: match.sport_id,
    returnPath: `/${pageLocale}/join/match/${match.id}`,
    locale: pageLocale,
    t,
    resolveAuthenticatedStep,
    onSubmitProfile,
    mapSubmitError,
    preselectedFacilityIds: pinnedFacilities.map(f => f.id),
  });

  const { step, setStep, setErrorMessage, setIsSubmitting, isSubmitting } = controller;

  useEffect(() => {
    webJoinStarted({ match_id: match.id, sport_slug: match.sport?.slug });
  }, [match.id, match.sport?.slug]);

  // Signing out clears the participation we resolved for the previous session.
  useEffect(() => {
    const {
      data: { subscription },
    } = controller.supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') setJoinStatus(null);
    });
    return () => subscription.unsubscribe();
  }, [controller.supabase]);

  const handleReviewJoin = useCallback(async () => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await submitJoin(null);
      setStep('success');
    } catch (err) {
      setErrorMessage(joinErrorMessage(err instanceof Error ? err.message : '', t));
    } finally {
      setIsSubmitting(false);
    }
  }, [submitJoin, setStep, setErrorMessage, setIsSubmitting, t]);

  const handleLeave = useCallback(async () => {
    setIsLeaving(true);
    setErrorMessage(null);
    try {
      await requestLeaveMatch(match.id);
      setJoinStatus(null);
      setStep('left');
    } catch (err) {
      setErrorMessage(joinErrorMessage(err instanceof Error ? err.message : '', t));
    } finally {
      setIsLeaving(false);
    }
  }, [match.id, setStep, setErrorMessage, t]);

  if (!controller.isReady) {
    return (
      <Card className="w-full overflow-hidden shadow-md">
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <Loader2 className="size-7 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">{t('progress')}…</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <OnboardingStepper controller={controller} t={t} />
      <OnboardingError message={controller.errorMessage} />

      <div key={step} className="animate-fade-in">
        {step === 'review' && (
          <Card>
            <CardContent className="flex flex-col gap-5 pt-6">
              <StepHeader
                icon={CheckCircle2}
                title={
                  isFull
                    ? t('review.waitlistTitle')
                    : isRequestMode
                      ? t('review.requestTitle')
                      : t('review.title')
                }
                description={
                  isFull
                    ? t('review.waitlistDescription')
                    : isRequestMode
                      ? t('review.requestDescription')
                      : t('review.description')
                }
              />
              <Button
                type="button"
                size="lg"
                className="w-full font-semibold"
                onClick={handleReviewJoin}
                disabled={isSubmitting}
              >
                {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
                {reviewCtaLabel}
                {!isSubmitting ? <ArrowRight className="size-4" /> : null}
              </Button>
            </CardContent>
          </Card>
        )}

        {step === 'auth' && (
          <AuthStep
            controller={controller}
            t={t}
            title={
              isFull
                ? t('auth.waitlistTitle')
                : isRequestMode
                  ? t('auth.requestTitle')
                  : t('auth.title')
            }
            description={
              isFull
                ? t('auth.waitlistDescription')
                : isRequestMode
                  ? t('auth.requestDescription')
                  : t('auth.description')
            }
          />
        )}

        {step === 'consent' && <ConsentStep controller={controller} />}
        {step === 'personal' && <PersonalStep controller={controller} t={t} />}
        {step === 'rating' && (
          <RatingStep controller={controller} t={t} sportName={match.sport?.name ?? ''} />
        )}
        {step === 'location' && <LocationStep controller={controller} t={t} />}
        {step === 'favorites' && (
          <FavoritesStep controller={controller} t={t} pinned={pinnedFacilities} />
        )}

        {step === 'success' && (
          <SuccessCard
            joinStatus={joinStatus}
            match={match}
            matchDeepLink={matchDeepLink}
            matchId={match.id}
            canLeave={!matchStarted}
            isLeaving={isLeaving}
            onLeave={handleLeave}
            t={t}
          />
        )}

        {step === 'left' && <LeftCard matchId={match.id} t={t} />}
      </div>

      <OnboardingNav controller={controller} t={t} finishLabel={finishCtaLabel} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Match-specific terminal cards
// ---------------------------------------------------------------------------

function SuccessCard({
  joinStatus,
  match,
  matchDeepLink,
  matchId,
  canLeave,
  isLeaving,
  onLeave,
  t,
}: {
  joinStatus: JoinStatus | null;
  match: WebJoinMatchContext;
  matchDeepLink: string;
  matchId: string;
  canLeave: boolean;
  isLeaving: boolean;
  onLeave: () => void;
  t: ReturnType<typeof useTranslations<'webJoin'>>;
}) {
  const title =
    joinStatus === 'requested'
      ? t('success.requestTitle')
      : joinStatus === 'waitlisted'
        ? t('success.waitlistTitle')
        : t('success.joinedTitle');
  const description =
    joinStatus === 'requested'
      ? t('success.requestDescription')
      : joinStatus === 'waitlisted'
        ? t('success.waitlistDescription')
        : t('success.joinedDescription');
  const fullDescription =
    joinStatus === 'joined' ? description : `${description} ${t('success.chatLocked')}`;

  return (
    <Card className="overflow-hidden border-primary/20">
      <div className="h-1.5 w-full bg-gradient-to-r from-primary via-primary/80 to-primary/50" />
      <CardContent className="flex flex-col items-center gap-6 px-6 pb-8 pt-8 text-center">
        <div className="relative">
          <div className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
          <div className="relative flex size-16 items-center justify-center rounded-full bg-primary/10">
            <CheckCircle2 className="size-9 text-primary" />
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
          <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
            {fullDescription}
          </p>
          <MatchActionLinks match={match} className="justify-center" />
        </div>

        {joinStatus === 'joined' && (
          <Button asChild size="lg" className="w-full font-semibold">
            <Link href={`/join/match/${matchId}/chat`}>
              <MessageCircle className="size-4" />
              {t('success.chatCta')}
            </Link>
          </Button>
        )}

        {joinStatus && canLeave && (
          <button
            type="button"
            onClick={onLeave}
            disabled={isLeaving}
            className="flex items-center gap-1.5 text-sm font-medium text-destructive hover:underline disabled:opacity-60"
          >
            {isLeaving && <Loader2 className="size-4 animate-spin" />}
            {t('success.leaveCta')}
          </button>
        )}

        <div className="flex w-full flex-col items-center gap-4 rounded-2xl border bg-muted/30 px-6 py-6">
          <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <QRCodeSVG value={matchDeepLink} size={172} level="M" />
          </div>
          <p className="text-sm font-medium text-foreground">{t('success.qrHint')}</p>

          <AppStoreBadges placement="join_dialog" matchId={matchId} />
        </div>
      </CardContent>
    </Card>
  );
}

function LeftCard({
  matchId,
  t,
}: {
  matchId: string;
  t: ReturnType<typeof useTranslations<'webJoin'>>;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col items-center gap-6 px-6 pb-8 pt-8 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <LogOut className="size-8" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight">{t('left.title')}</h2>
          <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
            {t('left.description')}
          </p>
        </div>
        <AppStoreBadges placement="join_dialog" matchId={matchId} />
      </CardContent>
    </Card>
  );
}
