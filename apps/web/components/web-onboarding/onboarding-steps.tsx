'use client';

import { GENDER_VALUES } from '@rallia/shared-types';
import {
  RATING_SYSTEM_URLS,
  ratingDescriptionKey,
  ratingSkillLevelKey,
  ratingSkillTier,
  type RatingSkillTier,
} from '@rallia/shared-utils';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Lock,
  Mail,
  MapPin,
  ShieldCheck,
  Sparkles,
  Star,
  StarHalf,
  Trophy,
  User,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { AvailabilityStep } from './availability-step';
import { FavoriteFacilitiesStep, type PinnedFacility } from './favorite-facilities-step';
import { SportStep } from './sport-step';
import {
  ConsentCheckboxRow,
  GoogleIcon,
  OptionButton,
  StepHeader,
  Stepper,
} from './wizard-primitives';
import type { WebOnboardingController } from './use-web-onboarding';

import { AddressAutocomplete } from '@/components/app/inputs/address-autocomplete';
import { QueryProvider } from '@/components/query-provider';
import { SharedSupabaseSync } from '@/components/shared-supabase-sync';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

type Translator = (key: string, values?: Record<string, string | number>) => string;

/** Progress bar above the profile steps. Renders nothing outside them. */
export function OnboardingStepper({
  controller,
  t,
}: {
  controller: WebOnboardingController;
  t: Translator;
}) {
  if (!controller.isProfileStep) return null;

  // controller.profileSteps, not the exported PROFILE_STEPS: a caller that defers
  // consent has one fewer step, and counting the one it removed would read "2 of 4"
  // on a three-step walk.
  const steps = controller.profileSteps;

  return (
    <Stepper
      totalSteps={steps.length}
      currentIndex={controller.profileStepIndex}
      currentLabel={t(`steps.${steps[controller.profileStepIndex].labelKey}`)}
      counterLabel={t('stepCounter', {
        current: controller.profileStepIndex + 1,
        total: steps.length,
      })}
    />
  );
}

export function OnboardingError({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive"
    >
      <span className="leading-relaxed">{message}</span>
    </div>
  );
}

/**
 * Sign-in / sign-up card. Title and description are passed in so each surface
 * can frame the gate in its own words (join a game vs. book a court).
 */
export function AuthStep({
  controller,
  t,
  title,
  description,
}: {
  controller: WebOnboardingController;
  t: Translator;
  title: string;
  description: string;
}) {
  const { auth } = controller;

  return (
    <Card className="overflow-hidden">
      <div className="h-1 w-full bg-gradient-to-r from-primary to-primary/60" />
      <CardContent className="flex flex-col gap-5 pt-6">
        <StepHeader icon={User} title={title} description={description} />

        {auth.authPhase === 'email' ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full font-semibold"
              onClick={auth.handleGoogleSignIn}
              disabled={auth.isAuthLoading || auth.isGoogleLoading}
            >
              {auth.isGoogleLoading ? <Loader2 className="size-4 animate-spin" /> : <GoogleIcon />}
              {t('auth.google')}
            </Button>

            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {t('auth.orEmail')}
              </span>
              <Separator className="flex-1" />
            </div>

            <form onSubmit={auth.handleEmailAuth} className="flex flex-col gap-3">
              <div className="space-y-2">
                <Label htmlFor="email">{t('auth.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  value={auth.email}
                  onChange={e => auth.setEmail(e.target.value)}
                  placeholder={t('auth.emailPlaceholder')}
                  required
                  autoComplete="email"
                  className="h-11"
                />
              </div>
              <Button
                type="submit"
                size="lg"
                disabled={auth.isAuthLoading || auth.isGoogleLoading}
                className="w-full font-semibold"
              >
                {auth.isAuthLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Mail className="size-4" />
                )}
                {t('auth.continue')}
              </Button>
            </form>
          </>
        ) : (
          <form onSubmit={auth.handleEmailAuth} className="flex flex-col gap-3">
            <div className="space-y-2">
              <Label htmlFor="otp">{t('auth.otp')}</Label>
              <Input
                id="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={auth.otp}
                onChange={e => auth.setOtp(e.target.value.replace(/\D/g, ''))}
                required
                autoFocus
                className="h-14 text-center text-2xl font-semibold tracking-[0.4em]"
                placeholder="••••••"
              />
              <p className="text-xs text-muted-foreground">
                {t('auth.otpHint', { email: auth.email })}
              </p>
            </div>
            <Button
              type="submit"
              size="lg"
              disabled={auth.isAuthLoading || auth.otp.length < 6}
              className="w-full font-semibold"
            >
              {auth.isAuthLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowRight className="size-4" />
              )}
              {t('auth.verify')}
            </Button>
            <div className="flex items-center justify-between pt-1">
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0 text-muted-foreground"
                onClick={auth.handleChangeEmail}
                disabled={auth.isAuthLoading}
              >
                {t('auth.changeEmail')}
              </Button>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0"
                onClick={auth.handleResend}
                disabled={auth.isAuthLoading}
              >
                {t('auth.resend')}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export function ConsentStep({ controller }: { controller: WebOnboardingController }) {
  // Same copy as the mobile onboarding consent step — one source of truth.
  const tConsent = useTranslations('auth.consent');
  const tConsentStep = useTranslations('onboarding.consentStep');
  const { consent } = controller;

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 pt-6">
        <StepHeader
          icon={ShieldCheck}
          title={tConsentStep('title')}
          description={tConsentStep('subtitle')}
        />
        <div className="flex flex-col gap-3">
          <ConsentCheckboxRow
            id="consent-privacy"
            checked={consent.hasAcceptedPrivacy}
            onCheckedChange={consent.setHasAcceptedPrivacy}
            prefix={tConsent('privacyPrefix')}
            linkLabel={tConsent('privacyLink')}
            suffix={tConsent('privacySuffix')}
            href="/privacy"
          />
          <ConsentCheckboxRow
            id="consent-terms"
            checked={consent.hasAcceptedTerms}
            onCheckedChange={consent.setHasAcceptedTerms}
            prefix={tConsent('termsPrefix')}
            linkLabel={tConsent('termsLink')}
            suffix={tConsent('termsSuffix')}
            href="/terms"
          />
        </div>
      </CardContent>
    </Card>
  );
}

export function PersonalStep({
  controller,
  t,
}: {
  controller: WebOnboardingController;
  t: Translator;
}) {
  const { personal } = controller;

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 pt-6">
        <StepHeader
          icon={User}
          title={t('personal.title')}
          description={t('personal.description')}
        />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="firstName">{t('personal.firstName')}</Label>
            <Input
              id="firstName"
              value={personal.firstName}
              onChange={e => personal.setFirstName(e.target.value)}
              required
              className="h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">{t('personal.lastName')}</Label>
            <Input
              id="lastName"
              value={personal.lastName}
              onChange={e => personal.setLastName(e.target.value)}
              required
              className="h-11"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="birthDate">{t('personal.birthDate')}</Label>
          <Input
            id="birthDate"
            type="date"
            value={personal.birthDate}
            onChange={e => personal.setBirthDate(e.target.value)}
            required
            className="h-11"
          />
        </div>
        <div className="space-y-2">
          <Label>{t('personal.gender')}</Label>
          <div className="grid grid-cols-3 gap-2">
            {GENDER_VALUES.map(value => (
              <OptionButton
                key={value}
                selected={personal.gender === value}
                onClick={() => personal.setGender(value)}
              >
                {t(`personal.genderOptions.${value}`)}
              </OptionButton>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Tier → icon, mirroring mobile's star-outline / star-half / star / trophy ladder. */
const TIER_ICONS: Record<RatingSkillTier, LucideIcon> = {
  beginner: Star,
  intermediate: StarHalf,
  advanced: Sparkles,
  professional: Trophy,
};

/**
 * Skill-level picker.
 *
 * Shows what each level actually means rather than a bare "NTRP 3.5" — nobody self-rates
 * accurately from a number alone, and a wrong rating here mismatches every game the
 * player is offered. Level names, descriptions and the reference link are the same ones
 * mobile shows, resolved through the shared score → key mappings.
 */
export function RatingStep({
  controller,
  t,
  sportName,
}: {
  controller: WebOnboardingController;
  t: Translator;
  sportName: string;
}) {
  const tRating = useTranslations('onboarding.ratingStep');
  const tOverlay = useTranslations('onboarding.ratingOverlay');
  const { rating } = controller;
  const system = rating.systemCode;

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 pt-6">
        <StepHeader
          icon={Trophy}
          title={t('rating.title', { sport: sportName })}
          description={t('rating.description')}
        />

        {system && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              {tRating(system === 'dupr' ? 'duprBadge' : 'ntrpBadge')}
            </span>
            <a
              href={RATING_SYSTEM_URLS[system]}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              {tOverlay(system === 'dupr' ? 'learnMoreDupr' : 'learnMoreNtrp')}
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </div>
        )}

        {rating.isLoadingRatings ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid max-h-[26rem] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {rating.ratings.map(r => {
              const selected = rating.selectedRatingId === r.id;
              const tier = r.value != null ? ratingSkillTier(r.value) : null;
              const Icon = tier ? TIER_ICONS[tier] : Trophy;
              const levelKey =
                system && r.value != null ? ratingSkillLevelKey(system, r.value) : null;
              const description =
                system && r.value != null ? tRating(ratingDescriptionKey(system, r.value)) : null;

              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => rating.setSelectedRatingId(r.id)}
                  aria-pressed={selected}
                  className={cn(
                    'flex flex-col gap-1.5 rounded-xl border-2 p-3.5 text-left transition-all outline-none',
                    'focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    selected
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border hover:border-primary/40 hover:bg-primary/5'
                  )}
                >
                  <span className="flex items-center gap-2">
                    <Icon
                      className={cn(
                        'size-4 shrink-0',
                        selected ? 'text-primary' : 'text-primary/70'
                      )}
                      aria-hidden="true"
                    />
                    <span
                      className={cn(
                        'font-semibold',
                        selected ? 'text-foreground' : 'text-muted-foreground'
                      )}
                    >
                      {levelKey ? tRating(`skillLevels.${levelKey}`) : r.label}
                    </span>
                  </span>
                  {/* The raw label ("NTRP 3.5") stays visible: it is what other players
                      see on a profile, so hiding it here would surprise them later. */}
                  <span
                    className={cn(
                      'text-sm font-medium tabular-nums',
                      selected ? 'text-primary' : 'text-muted-foreground'
                    )}
                  >
                    {r.label}
                  </span>
                  {description && (
                    <span className="text-xs leading-snug text-muted-foreground">
                      {description}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Where the player is based.
 *
 * Asks for the address first and the postal code second, because that ordering does the
 * work for them: picking an address fills the postal code, the city and precise
 * coordinates in one action. Anyone who would rather not share a street address just
 * skips the top field and types the postal code, which is the only required part.
 *
 * Copy comes from onboarding.locationStep — the same keys mobile's location step uses,
 * including its privacy reassurance, since "why do you want my address" is the obvious
 * next thought and it deserves an answer on the same screen.
 */
export function LocationStep({
  controller,
  t,
}: {
  controller: WebOnboardingController;
  t: Translator;
}) {
  const tLocation = useTranslations('onboarding.locationStep');
  const tCommon = useTranslations('common');
  const { location } = controller;
  const hasArea = location.latitude != null && !!location.postalCode;

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 pt-6">
        <StepHeader icon={MapPin} title={tLocation('title')} description={tLocation('subtitle')} />

        <div className="space-y-1.5">
          <AddressAutocomplete
            value={location.address}
            onSelect={location.selectAddress}
            onClear={() => void location.clearAddress()}
            label={`${tLocation('address')} · ${tCommon('optional')}`}
            placeholder={tLocation('addressPlaceholder')}
          />
          <p className="text-xs text-muted-foreground">{tLocation('addressHint')}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="postalCode">{tLocation('postalCode')}</Label>
          <Input
            id="postalCode"
            value={location.postalCode}
            onChange={e => location.handlePostalCodeChange(e.target.value)}
            onBlur={location.handlePostalCodeBlur}
            placeholder={tLocation('postalCodePlaceholder')}
            required
            aria-required="true"
            className="h-11 text-lg tracking-wide"
          />
          {location.isGeocoding && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              {t('location.geocoding')}
            </p>
          )}
          {!location.isGeocoding && hasArea && (
            <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-3.5" />
              <span>
                {t('location.detected')} ·{' '}
                {location.locationCity && location.locationProvince
                  ? `${location.locationCity}, ${location.locationProvince}`
                  : location.postalCode}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-start gap-2.5 rounded-xl bg-muted/50 px-3.5 py-3">
          <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-foreground">{tLocation('privacyTitle')}</p>
            <p className="text-xs leading-snug text-muted-foreground">
              {tLocation('privacyDescription')}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Favourite courts for the chosen sport, searched around the geocoded location step.
 *
 * Carries its own QueryProvider and SharedSupabaseSync because the join and booking
 * gates live under the marketing layout, which has neither, and useFacilitySearch
 * needs both. Surfaces that already provide them simply nest a second, harmless pair.
 */
export function FavoritesStep({
  controller,
  t,
  pinned,
}: {
  controller: WebOnboardingController;
  t: Translator;
  pinned?: PinnedFacility[];
}) {
  if (!controller.sportId) return null;

  return (
    <QueryProvider>
      <SharedSupabaseSync />
      <FavoriteFacilitiesStep
        sportId={controller.sportId}
        latitude={controller.location.latitude}
        longitude={controller.location.longitude}
        selectedIds={controller.favorites.selectedIds}
        onToggle={controller.favorites.toggle}
        pinned={pinned}
        t={t}
      />
    </QueryProvider>
  );
}

/**
 * Sport picker for surfaces that opted into the controller's sport step. Carries its
 * own SharedSupabaseSync for the same reason FavoritesStep does: useSports reads
 * through the shared singleton, which the marketing layout never wires up.
 */
export function SportSelectStep({ controller }: { controller: WebOnboardingController }) {
  return (
    <>
      <SharedSupabaseSync />
      <SportStep selectedSportId={controller.sport.selectedId} onSelect={controller.sport.select} />
    </>
  );
}

/** Weekly grid for surfaces that opted into the controller's availability step. */
export function AvailabilitySelectStep({ controller }: { controller: WebOnboardingController }) {
  return (
    <AvailabilityStep
      value={controller.availability.grid}
      onChange={controller.availability.setGrid}
    />
  );
}

/**
 * Back/continue footer for the profile steps. `finishLabel` is what the last
 * step's button reads, so each surface can name its own outcome.
 */
export function OnboardingNav({
  controller,
  t,
  finishLabel,
}: {
  controller: WebOnboardingController;
  t: Translator;
  finishLabel: string;
}) {
  if (!controller.isProfileStep) return null;

  const isLastStep = controller.isFinalProfileStep;

  return (
    <div className="flex gap-3">
      {controller.profileStepIndex > 0 && (
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={controller.goBack}
          disabled={controller.isSubmitting}
        >
          <ArrowLeft className="size-4" />
          {t('back')}
        </Button>
      )}
      <Button
        type="button"
        size="lg"
        className="flex-1 font-semibold"
        onClick={controller.goNext}
        disabled={
          controller.isSubmitting ||
          (controller.step === 'consent' && !controller.consent.isComplete) ||
          (controller.step === 'sport' && !controller.sport.isComplete) ||
          (controller.step === 'favorites' && !controller.favorites.isComplete) ||
          (controller.step === 'availability' && !controller.availability.isComplete)
        }
      >
        {controller.isSubmitting && <Loader2 className="size-4 animate-spin" />}
        {isLastStep ? finishLabel : t('continue')}
        {!controller.isSubmitting && !isLastStep && <ArrowRight className="size-4" />}
      </Button>
    </div>
  );
}
