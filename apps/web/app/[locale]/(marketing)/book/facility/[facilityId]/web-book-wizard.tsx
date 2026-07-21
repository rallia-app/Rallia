'use client';

import { CalendarX, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  AppStoreBadges,
  OptionButton,
} from '../../../_components/web-onboarding/wizard-primitives';

import type { WebBookCourtOption, WebBookFacilityContext } from './_lib/facility-context';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { webBookCompleted, webBookRedirected, webBookStarted } from '@/lib/analytics';

interface WebBookWizardProps {
  facility: WebBookFacilityContext;
  locale: string;
}

async function requestBookComplete(body: Record<string, unknown>): Promise<void> {
  const res = await fetch('/api/web-book/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Submit failed');
  }
}

function bookErrorMessage(code: string, t: ReturnType<typeof useTranslations<'webBook'>>): string {
  switch (code) {
    case 'MINIMUM_AGE':
      return t('errors.minimumAge');
    case 'FACILITY_UNAVAILABLE':
      return t('errors.facilityUnavailable');
    default:
      return t('errors.submitFailed');
  }
}

export function WebBookWizard({ facility, locale: pageLocale }: WebBookWizardProps) {
  const t = useTranslations('webBook');

  const hasSlot = facility.selectedGroup !== null;

  // Same rule as the mobile external-booking sheet: only courts that carry
  // their own provider URL are offered — the redirect always lands on the
  // exact court+slot page the user picked, never a generic fallback.
  const bookableCourts = useMemo(
    () => facility.selectedGroup?.courts.filter(c => c.bookingUrl !== null) ?? [],
    [facility.selectedGroup]
  );

  const [completedAsExisting, setCompletedAsExisting] = useState<boolean | null>(null);

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
      await requestBookComplete({
        facilityId: facility.id,
        locale: pageLocale,
        personal: payload.personal,
        sportId: payload.sportId,
        ratingScoreId: payload.ratingScoreId,
        location: payload.location,
      });
      setCompletedAsExisting(false);
      return 'redirect';
    },
    [facility.id, pageLocale]
  );

  const mapSubmitError = useCallback(
    (err: unknown) => bookErrorMessage(err instanceof Error ? err.message : '', t),
    [t]
  );

  const returnQuery = facility.selectedGroup
    ? `?start=${encodeURIComponent(facility.selectedGroup.slotStart)}&end=${encodeURIComponent(facility.selectedGroup.slotEnd)}`
    : '';

  const controller = useWebOnboarding({
    sportId: facility.sport?.id ?? null,
    returnPath: `/${pageLocale}/book/facility/${facility.id}${returnQuery}`,
    locale: pageLocale,
    t,
    resolveAuthenticatedStep,
    onSubmitProfile,
    mapSubmitError,
  });

  const { step } = controller;

  useEffect(() => {
    webBookStarted({ facility_id: facility.id, has_slot: hasSlot });
  }, [facility.id, hasSlot]);

  // An existing player reaches `redirect` without any API call — the gate was
  // already satisfied — so the completion event fires here.
  useEffect(() => {
    if (step !== 'redirect' || completedAsExisting !== null) return;
    setCompletedAsExisting(true);
    webBookCompleted({ facility_id: facility.id, existing_user: true, has_slot: hasSlot });
  }, [step, completedAsExisting, facility.id, hasSlot]);

  useEffect(() => {
    if (completedAsExisting === false) {
      webBookCompleted({ facility_id: facility.id, existing_user: false, has_slot: hasSlot });
    }
  }, [completedAsExisting, facility.id, hasSlot]);

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

  // The clicked slot vanished (booked out or a stale link): say so instead of
  // silently redirecting somewhere else.
  if (facility.slotMissing) {
    return <SlotGoneCard facility={facility} t={t} />;
  }

  // Nothing to redirect to at all (parks, first-come facilities).
  if (hasSlot ? bookableCourts.length === 0 : !facility.facilityBookingUrl) {
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
          <RedirectCard facility={facility} bookableCourts={bookableCourts} t={t} />
        )}
      </div>

      <OnboardingNav controller={controller} t={t} finishLabel={t('finish')} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Terminal cards
// ---------------------------------------------------------------------------

function courtLabel(
  court: WebBookCourtOption,
  t: ReturnType<typeof useTranslations<'webBook'>>
): string {
  if (court.courtName) return court.courtName;
  if (court.courtNumber != null) return t('courtNumber', { number: court.courtNumber });
  return t('courtCountSingular');
}

/**
 * Web analogue of the mobile external-booking sheet: shows the picked slot,
 * lets the user choose a court when several share the time (auto-picked when
 * there's only one), and the CTA opens that court's exact provider page.
 */
function RedirectCard({
  facility,
  bookableCourts,
  t,
}: {
  facility: WebBookFacilityContext;
  bookableCourts: WebBookCourtOption[];
  t: ReturnType<typeof useTranslations<'webBook'>>;
}) {
  const locale = useLocale();
  const group = facility.selectedGroup;
  const hasMultipleCourts = bookableCourts.length > 1;

  const [selectedCourtKey, setSelectedCourtKey] = useState<string | null>(
    bookableCourts.length === 1
      ? (bookableCourts[0].externalSlotId ?? bookableCourts[0].externalCourtId)
      : null
  );

  const selectedCourt =
    bookableCourts.find(c => (c.externalSlotId ?? c.externalCourtId) === selectedCourtKey) ?? null;

  // Slot flow: the picked court's exact URL. Facility flow: the provider's
  // booking entry point.
  const destination = group ? (selectedCourt?.bookingUrl ?? null) : facility.facilityBookingUrl;

  const slotLine = group
    ? (() => {
        const start = new Date(group.slotStart);
        const end = new Date(group.slotEnd);
        const zone = facility.timezone ?? undefined;
        const day = start.toLocaleDateString(locale, {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
          timeZone: zone,
        });
        const time = `${start.toLocaleTimeString(locale, {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: zone,
        })} – ${end.toLocaleTimeString(locale, {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: zone,
        })}`;
        return `${day} · ${time}`;
      })()
    : null;

  return (
    <Card className="overflow-hidden border-primary/20">
      <div className="h-1.5 w-full bg-gradient-to-r from-primary via-primary/80 to-primary/50" />
      <CardContent className="flex flex-col gap-6 px-6 pb-8 pt-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="relative">
            <div className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
            <div className="relative flex size-16 items-center justify-center rounded-full bg-primary/10">
              <CheckCircle2 className="size-9 text-primary" />
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight">{t('redirect.title')}</h2>
            {slotLine && <p className="text-sm font-medium text-foreground">{slotLine}</p>}
            <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
              {group ? t('redirect.descriptionSlot') : t('redirect.description')}
            </p>
          </div>
        </div>

        {hasMultipleCourts && (
          <div className="space-y-2">
            <span className="text-sm font-semibold">{t('redirect.selectCourt')}</span>
            <div className="grid grid-cols-2 gap-2">
              {bookableCourts.map(court => {
                const key = court.externalSlotId ?? court.externalCourtId;
                return (
                  <OptionButton
                    key={key}
                    selected={selectedCourtKey === key}
                    onClick={() => setSelectedCourtKey(key)}
                  >
                    <span className="flex flex-col items-center gap-0.5">
                      <span>{courtLabel(court, t)}</span>
                      {court.priceCents != null && court.priceCents > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {(court.priceCents / 100).toLocaleString(locale, {
                            style: 'currency',
                            currency: court.currency ?? 'CAD',
                          })}
                        </span>
                      )}
                    </span>
                  </OptionButton>
                );
              })}
            </div>
          </div>
        )}

        {group && !hasMultipleCourts && selectedCourt && (
          <p className="text-center text-sm text-muted-foreground">
            {courtLabel(selectedCourt, t)}
          </p>
        )}

        {destination ? (
          <Button asChild size="lg" className="w-full font-semibold">
            <a
              href={destination}
              onClick={() =>
                webBookRedirected({ facility_id: facility.id, has_slot: group !== null })
              }
            >
              <ExternalLink className="size-4" />
              {t('redirect.cta')}
            </a>
          </Button>
        ) : (
          <Button size="lg" className="w-full font-semibold" disabled>
            <ExternalLink className="size-4" />
            {t('redirect.selectCourtFirst')}
          </Button>
        )}

        <div className="flex w-full flex-col items-center gap-4 rounded-2xl border bg-muted/30 px-6 py-6">
          <p className="text-sm font-medium text-foreground">{t('redirect.appHint')}</p>
          <AppStoreBadges placement="web_book" facilityId={facility.id} />
        </div>
      </CardContent>
    </Card>
  );
}

/** The clicked slot no longer has open rows — offer the remaining slots instead. */
function SlotGoneCard({
  facility,
  t,
}: {
  facility: WebBookFacilityContext;
  t: ReturnType<typeof useTranslations<'webBook'>>;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col items-center gap-6 px-6 pb-8 pt-8 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <CalendarX className="size-8" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight">{t('slotGone.title')}</h2>
          <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
            {t('slotGone.description')}
          </p>
        </div>
        <Button asChild size="lg" className="w-full font-semibold">
          <Link href={`/book/facility/${facility.id}`}>{t('slotGone.cta')}</Link>
        </Button>
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
