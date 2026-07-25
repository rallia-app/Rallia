'use client';

import { GENDER_VALUES } from '@rallia/shared-types';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Mail,
  MapPin,
  ShieldCheck,
  Trophy,
  User,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  ConsentCheckboxRow,
  GoogleIcon,
  OptionButton,
  StepHeader,
  Stepper,
} from './wizard-primitives';
import { PROFILE_STEPS, type WebOnboardingController } from './use-web-onboarding';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

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

  return (
    <Stepper
      totalSteps={PROFILE_STEPS.length}
      currentIndex={controller.profileStepIndex}
      currentLabel={t(`steps.${PROFILE_STEPS[controller.profileStepIndex].labelKey}`)}
      counterLabel={t('stepCounter', {
        current: controller.profileStepIndex + 1,
        total: PROFILE_STEPS.length,
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

export function RatingStep({
  controller,
  t,
  sportName,
}: {
  controller: WebOnboardingController;
  t: Translator;
  sportName: string;
}) {
  const { rating } = controller;

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 pt-6">
        <StepHeader
          icon={Trophy}
          title={t('rating.title', { sport: sportName })}
          description={t('rating.description')}
        />
        {rating.isLoadingRatings ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto pr-1">
            {rating.ratings.map(r => (
              <OptionButton
                key={r.id}
                selected={rating.selectedRatingId === r.id}
                onClick={() => rating.setSelectedRatingId(r.id)}
                compact
              >
                {r.label}
              </OptionButton>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function LocationStep({
  controller,
  t,
}: {
  controller: WebOnboardingController;
  t: Translator;
}) {
  const { location } = controller;

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 pt-6">
        <StepHeader
          icon={MapPin}
          title={t('location.title')}
          description={t('location.description')}
        />
        <div className="space-y-2">
          <Label htmlFor="postalCode">{t('location.postalCode')}</Label>
          <Input
            id="postalCode"
            value={location.postalCode}
            onChange={e => location.handlePostalCodeChange(e.target.value)}
            onBlur={location.handlePostalCodeBlur}
            placeholder="H2X 1Y4"
            required
            className="h-11 text-lg tracking-wide"
          />
          {location.isGeocoding && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              {t('location.geocoding')}
            </p>
          )}
          {!location.isGeocoding && location.latitude != null && location.postalCode && (
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
      </CardContent>
    </Card>
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

  const isLastStep = controller.step === 'location';

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
          (controller.step === 'consent' && !controller.consent.isComplete)
        }
      >
        {controller.isSubmitting && <Loader2 className="size-4 animate-spin" />}
        {isLastStep ? finishLabel : t('continue')}
        {!controller.isSubmitting && !isLastStep && <ArrowRight className="size-4" />}
      </Button>
    </div>
  );
}
