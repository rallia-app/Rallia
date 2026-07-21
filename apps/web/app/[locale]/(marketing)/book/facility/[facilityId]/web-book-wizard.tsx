'use client';

import { CalendarX, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  AuthStep,
  ConsentStep,
  LocationStep,
  OnboardingError,
  OnboardingNav,
  OnboardingStepper,
  PersonalStep,
  RatingStep,
} from '../../../_components/web-onboarding/onboarding-steps';
import {
  useWebOnboarding,
  type OnboardingProfilePayload,
} from '../../../_components/web-onboarding/use-web-onboarding';
import { AppStoreBadges } from '../../../_components/web-onboarding/wizard-primitives';

import type { WebBookFacilityContext } from './_lib/facility-context';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { webBookCompleted, webBookRedirected, webBookStarted } from '@/lib/analytics';

/** How long the redirect card is visible before the browser leaves for the provider. */
const REDIRECT_DELAY_MS = 1200;

interface WebBookWizardProps {
  facility: WebBookFacilityContext;
  locale: string;
}

async function requestBookComplete(body: Record<string, unknown>): Promise<string> {
  const res = await fetch('/api/web-book/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Submit failed');
  }
  return data.bookingUrl as string;
}

function bookErrorMessage(code: string, t: ReturnType<typeof useTranslations<'webBook'>>): string {
  switch (code) {
    case 'MINIMUM_AGE':
      return t('errors.minimumAge');
    case 'FACILITY_UNAVAILABLE':
      return t('errors.facilityUnavailable');
    case 'NO_BOOKING_URL':
      return t('errors.noBookingUrl');
    default:
      return t('errors.submitFailed');
  }
}

export function WebBookWizard({ facility, locale: pageLocale }: WebBookWizardProps) {
  const t = useTranslations('webBook');

  const hasSlot = facility.selectedSlot !== null;
  const slotId = facility.selectedSlot?.externalSlotId ?? null;

  const [bookingUrl, setBookingUrl] = useState<string | null>(null);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * An already-onboarded visitor has nothing left to fill in, so the gate is
   * satisfied the moment we know who they are. A new account starts at consent,
   * exactly like the mobile onboarding wizard.
   */
  const resolveAuthenticatedStep = useCallback(async (supabase: SupabaseClient, userId: string) => {
    const { data: profile, error } = await supabase
      .from('profile')
      .select('onboarding_completed, first_name, last_name')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw new Error(error.message);

    return {
      step: profile?.onboarding_completed ? 'redirect' : 'consent',
      firstName: profile?.first_name,
      lastName: profile?.last_name,
    };
  }, []);

  const onSubmitProfile = useCallback(
    async (payload: OnboardingProfilePayload) => {
      const url = await requestBookComplete({
        facilityId: facility.id,
        slotId,
        locale: pageLocale,
        personal: payload.personal,
        sportId: payload.sportId,
        ratingScoreId: payload.ratingScoreId,
        location: payload.location,
      });
      setBookingUrl(url);
      webBookCompleted({ facility_id: facility.id, existing_user: false, has_slot: hasSlot });
      return 'redirect';
    },
    [facility.id, slotId, pageLocale, hasSlot]
  );

  const mapSubmitError = useCallback(
    (err: unknown) => bookErrorMessage(err instanceof Error ? err.message : '', t),
    [t]
  );

  const controller = useWebOnboarding({
    sportId: facility.sport?.id ?? null,
    returnPath: `/${pageLocale}/book/facility/${facility.id}${slotId ? `?slot=${encodeURIComponent(slotId)}` : ''}`,
    locale: pageLocale,
    t,
    resolveAuthenticatedStep,
    onSubmitProfile,
    mapSubmitError,
  });

  const { step, setErrorMessage } = controller;

  useEffect(() => {
    webBookStarted({ facility_id: facility.id, has_slot: hasSlot });
  }, [facility.id, hasSlot]);

  /**
   * An existing player reaches `redirect` without going through the API, so we
   * confirm the destination here. Re-resolving server-side also means a stale
   * page still gets a fresh URL.
   */
  useEffect(() => {
    if (step !== 'redirect' || bookingUrl) return;
    let cancelled = false;

    (async () => {
      try {
        const url = await requestBookComplete({
          facilityId: facility.id,
          slotId,
          locale: pageLocale,
        });
        if (cancelled) return;
        setBookingUrl(url);
        webBookCompleted({ facility_id: facility.id, existing_user: true, has_slot: hasSlot });
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(bookErrorMessage(err instanceof Error ? err.message : '', t));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, bookingUrl, facility.id, slotId, pageLocale, hasSlot, setErrorMessage, t]);

  // Hand the visitor off to the provider once we have a destination.
  useEffect(() => {
    if (step !== 'redirect' || !bookingUrl) return;

    redirectTimer.current = setTimeout(() => {
      webBookRedirected({ facility_id: facility.id, has_slot: hasSlot });
      window.location.assign(bookingUrl);
    }, REDIRECT_DELAY_MS);

    return () => {
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    };
  }, [step, bookingUrl, facility.id, hasSlot]);

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

  // Parks and other first-come facilities have nothing to redirect to.
  if (!facility.bookingUrl) {
    return <NoBookingUrlCard facilityId={facility.id} t={t} />;
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <OnboardingStepper controller={controller} t={t} />
      <OnboardingError message={controller.errorMessage} />

      <div key={step} className="animate-fade-in">
        {step === 'auth' && (
          <AuthStep
            controller={controller}
            t={t}
            title={t('auth.title')}
            description={hasSlot ? t('auth.descriptionSlot') : t('auth.description')}
          />
        )}

        {step === 'consent' && <ConsentStep controller={controller} />}
        {step === 'personal' && <PersonalStep controller={controller} t={t} />}
        {step === 'rating' && (
          <RatingStep controller={controller} t={t} sportName={facility.sport?.name ?? ''} />
        )}
        {step === 'location' && <LocationStep controller={controller} t={t} />}

        {step === 'redirect' && (
          <RedirectCard bookingUrl={bookingUrl} facilityId={facility.id} hasSlot={hasSlot} t={t} />
        )}
      </div>

      <OnboardingNav controller={controller} t={t} finishLabel={t('finish')} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Terminal cards
// ---------------------------------------------------------------------------

function RedirectCard({
  bookingUrl,
  facilityId,
  hasSlot,
  t,
}: {
  bookingUrl: string | null;
  facilityId: string;
  hasSlot: boolean;
  t: ReturnType<typeof useTranslations<'webBook'>>;
}) {
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

        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight">{t('redirect.title')}</h2>
          <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
            {t('redirect.description')}
          </p>
        </div>

        {bookingUrl ? (
          <Button asChild size="lg" className="w-full font-semibold">
            <a
              href={bookingUrl}
              onClick={() => webBookRedirected({ facility_id: facilityId, has_slot: hasSlot })}
            >
              <ExternalLink className="size-4" />
              {t('redirect.cta')}
            </a>
          </Button>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('redirect.preparing')}
          </div>
        )}

        <div className="flex w-full flex-col items-center gap-4 rounded-2xl border bg-muted/30 px-6 py-6">
          <p className="text-sm font-medium text-foreground">{t('redirect.appHint')}</p>
          <AppStoreBadges placement="web_book" facilityId={facilityId} />
        </div>
      </CardContent>
    </Card>
  );
}

function NoBookingUrlCard({
  facilityId,
  t,
}: {
  facilityId: string;
  t: ReturnType<typeof useTranslations<'webBook'>>;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col items-center gap-6 px-6 pb-8 pt-8 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <CalendarX className="size-8" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight">{t('noBooking.title')}</h2>
          <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
            {t('noBooking.description')}
          </p>
        </div>
        <AppStoreBadges placement="web_book" facilityId={facilityId} />
      </CardContent>
    </Card>
  );
}
