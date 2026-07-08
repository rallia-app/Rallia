'use client';

import { QRCodeSVG } from 'qrcode.react';
import { usePostalCodeGeocode } from '@rallia/shared-hooks';
import { GENDER_VALUES } from '@rallia/shared-types';
import {
  formatPostalCodeInput,
  getTimeDifferenceFromNow,
  meetsMinimumAge,
} from '@rallia/shared-utils';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  LogOut,
  Mail,
  MapPin,
  MessageCircle,
  ShieldCheck,
  Trophy,
  User,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { WebJoinMatchContext } from './_lib/match-context';
import { MatchActionLinks } from './_components/match-action-links';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { createClient } from '@/lib/supabase/client';
import { Link } from '@/i18n/navigation';
import { useAuth } from '@rallia/shared-hooks';
import { appStoreClicked, webJoinCompleted, webJoinStarted } from '@/lib/analytics';
import { cn } from '@/lib/utils';

const APP_STORE_URL = 'https://apps.apple.com/app/rallia/id6760482014';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.mathisl971.ralliaapp';

type WizardStep =
  | 'auth'
  | 'review'
  | 'consent'
  | 'personal'
  | 'rating'
  | 'location'
  | 'success'
  | 'left';

type RatingOption = { id: string; label: string; value: number | null };

type JoinStatus = 'joined' | 'requested' | 'waitlisted';

const PROFILE_STEPS: Array<{ id: WizardStep; labelKey: string }> = [
  { id: 'consent', labelKey: 'consent' },
  { id: 'personal', labelKey: 'profile' },
  { id: 'rating', labelKey: 'level' },
  { id: 'location', labelKey: 'location' },
];

interface WebJoinWizardProps {
  match: WebJoinMatchContext;
  locale: string;
}

/** Wait for Supabase auth hydration before deciding guest vs signed-in. */
async function resolveInitialUser(supabase: SupabaseClient): Promise<SupabaseUser | null> {
  const sessionResult = await supabase.auth.getSession();
  if (sessionResult.data.session?.user) return sessionResult.data.session.user;

  // `getSession()` can be empty for a moment after client navigation while
  // cookies/local storage settle, but `getUser()` gives us a bounded fallback.
  const userResult = await supabase.auth.getUser();
  return userResult.data.user ?? null;
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

type AuthenticatedWizardState = {
  step: WizardStep;
  joinStatus: JoinStatus | null;
  firstName?: string | null;
  lastName?: string | null;
};

async function loadAuthenticatedWizardState(
  supabase: SupabaseClient,
  matchId: string,
  userId: string
): Promise<AuthenticatedWizardState> {
  const { data: profile, error: profileError } = await supabase
    .from('profile')
    .select('onboarding_completed, first_name, last_name')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) {
    throw new Error(profileError.message);
  }

  if (profile?.onboarding_completed) {
    const status = await requestExistingJoinStatus(matchId);
    if (status) {
      return {
        step: 'success',
        joinStatus: status,
        firstName: profile.first_name,
        lastName: profile.last_name,
      };
    }
    return {
      step: 'review',
      joinStatus: null,
      firstName: profile.first_name,
      lastName: profile.last_name,
    };
  }

  // Brand-new account (onboarding not completed): consent comes first, exactly
  // like the mobile onboarding wizard's consent step. accept_policy_consent is
  // idempotent, so returning users who bailed mid-onboarding just re-accept.
  return {
    step: 'consent',
    joinStatus: null,
    firstName: profile?.first_name,
    lastName: profile?.last_name,
  };
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
    default:
      return t('errors.submitFailed');
  }
}

export function WebJoinWizard({ match, locale: pageLocale }: WebJoinWizardProps) {
  const t = useTranslations('webJoin');
  // Same copy as the mobile onboarding consent step — one source of truth.
  const tConsent = useTranslations('auth.consent');
  const tConsentStep = useTranslations('onboarding.consentStep');

  const supabase = useMemo(() => createClient(), []);
  const { signInWithProvider, signInWithEmail, verifyOtp } = useAuth({ client: supabase });
  const { geocode, isLoading: isGeocoding, validateFormat } = usePostalCodeGeocode();

  const [step, setStep] = useState<WizardStep>('auth');
  const [isReady, setIsReady] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [joinStatus, setJoinStatus] = useState<JoinStatus | null>(null);

  // Players can only leave before the match starts.
  const matchStarted =
    getTimeDifferenceFromNow(match.match_date, match.start_time, match.timezone || 'UTC') <= 0;

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

  const applyAuthenticatedWizardState = useCallback((state: AuthenticatedWizardState) => {
    if (state.firstName) setFirstName(state.firstName);
    if (state.lastName) setLastName(state.lastName);
    setJoinStatus(state.joinStatus);
    setStep(state.step);
  }, []);

  useEffect(() => {
    webJoinStarted({ match_id: match.id, sport_slug: match.sport?.slug });
  }, [match.id, match.sport?.slug]);

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

        const state = await loadAuthenticatedWizardState(supabase, match.id, user.id);
        if (cancelled) return;
        applyAuthenticatedWizardState(state);
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(joinErrorMessage(err instanceof Error ? err.message : '', t));
        setStep('auth');
      } finally {
        if (!cancelled) setIsReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase, match.id, applyAuthenticatedWizardState, t]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') {
        setStep('auth');
        setJoinStatus(null);
        setAuthPhase('email');
        setOtp('');
        setErrorMessage(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (step !== 'rating') return;

    let cancelled = false;
    setIsLoadingRatings(true);

    (async () => {
      try {
        const res = await fetch(`/api/web-join/ratings?sportId=${match.sport_id}`);
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
  }, [step, match.sport_id, t]);

  const submitJoin = useCallback(
    async (skipProfile = false) => {
      setIsSubmitting(true);
      setErrorMessage(null);

      try {
        const body = skipProfile
          ? { matchId: match.id, locale: pageLocale }
          : {
              matchId: match.id,
              locale: pageLocale,
              personal: { firstName, lastName, gender, birthDate },
              sportId: match.sport_id,
              ...(selectedRatingId ? { ratingScoreId: selectedRatingId } : {}),
              location: {
                postalCode,
                city: locationCity || postalCode,
                province: locationProvince || 'QC',
                latitude: latitude!,
                longitude: longitude!,
              },
            };

        const status = await requestJoinComplete(body);
        setJoinStatus(status);
        setStep('success');
        webJoinCompleted({
          match_id: match.id,
          join_status: status,
          existing_user: skipProfile,
        });
      } catch (err) {
        setErrorMessage(joinErrorMessage(err instanceof Error ? err.message : '', t));
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      match.id,
      match.sport_id,
      pageLocale,
      firstName,
      lastName,
      gender,
      birthDate,
      selectedRatingId,
      postalCode,
      locationCity,
      locationProvince,
      latitude,
      longitude,
      t,
    ]
  );

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
  }, [match.id, t]);

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true);
    setErrorMessage(null);
    const callbackUrl = new URL('/api/auth/callback', window.location.origin);
    callbackUrl.searchParams.set('next', `/${pageLocale}/join/match/${match.id}`);
    const result = await signInWithProvider('google', { redirectTo: callbackUrl.toString() });
    if (!result.success) {
      setErrorMessage(result.error?.message ?? t('errors.authFailed'));
      setIsGoogleLoading(false);
    }
  };

  const sendCode = async () => {
    const callbackUrl = new URL('/api/auth/callback', window.location.origin);
    callbackUrl.searchParams.set('next', `/${pageLocale}/join/match/${match.id}`);
    return signInWithEmail(email, {
      emailRedirectTo: callbackUrl.toString(),
      data: { locale: pageLocale },
    });
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
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
          const state = await loadAuthenticatedWizardState(supabase, match.id, user.id);
          applyAuthenticatedWizardState(state);
        } else {
          setStep('consent');
        }
      }
    }
    setIsAuthLoading(false);
  };

  const handleResend = async () => {
    setErrorMessage(null);
    setIsAuthLoading(true);
    const result = await sendCode();
    if (!result.success) {
      setErrorMessage(result.error?.message ?? t('errors.authFailed'));
    }
    setIsAuthLoading(false);
  };

  const handleChangeEmail = () => {
    setErrorMessage(null);
    setOtp('');
    setAuthPhase('email');
  };

  const handlePostalCodeBlur = async () => {
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
  };

  const goNext = async () => {
    setErrorMessage(null);

    if (step === 'consent') {
      if (!hasAcceptedPrivacy || !hasAcceptedTerms) {
        setErrorMessage(tConsent('required'));
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
      await submitJoin(false);
      return;
    }
  };

  const goBack = () => {
    setErrorMessage(null);
    if (profileStepIndex > 0) {
      setStep(PROFILE_STEPS[profileStepIndex - 1]!.id);
    }
  };

  if (!isReady) {
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
    <div className="w-full flex flex-col gap-4">
      {isProfileStep && (
        <Stepper
          totalSteps={PROFILE_STEPS.length}
          currentIndex={profileStepIndex}
          currentLabel={t(`steps.${PROFILE_STEPS[profileStepIndex]!.labelKey}`)}
          counterLabel={t('stepCounter', {
            current: profileStepIndex + 1,
            total: PROFILE_STEPS.length,
          })}
        />
      )}

      {errorMessage && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive"
        >
          <span className="leading-relaxed">{errorMessage}</span>
        </div>
      )}

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
                onClick={() => submitJoin(true)}
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
          <Card className="overflow-hidden">
            <div className="h-1 w-full bg-gradient-to-r from-primary to-primary/60" />
            <CardContent className="flex flex-col gap-5 pt-6">
              <StepHeader
                icon={User}
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

              {authPhase === 'email' ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="w-full font-semibold"
                    onClick={handleGoogleSignIn}
                    disabled={isAuthLoading || isGoogleLoading}
                  >
                    {isGoogleLoading ? <Loader2 className="size-4 animate-spin" /> : <GoogleIcon />}
                    {t('auth.google')}
                  </Button>

                  <div className="flex items-center gap-3">
                    <Separator className="flex-1" />
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t('auth.orEmail')}
                    </span>
                    <Separator className="flex-1" />
                  </div>

                  <form onSubmit={handleEmailAuth} className="flex flex-col gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="email">{t('auth.email')}</Label>
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder={t('auth.emailPlaceholder')}
                        required
                        autoComplete="email"
                        className="h-11"
                      />
                    </div>
                    <Button
                      type="submit"
                      size="lg"
                      disabled={isAuthLoading || isGoogleLoading}
                      className="w-full font-semibold"
                    >
                      {isAuthLoading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Mail className="size-4" />
                      )}
                      {t('auth.continue')}
                    </Button>
                  </form>
                </>
              ) : (
                <form onSubmit={handleEmailAuth} className="flex flex-col gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="otp">{t('auth.otp')}</Label>
                    <Input
                      id="otp"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={otp}
                      onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                      required
                      autoFocus
                      className="h-14 text-center text-2xl font-semibold tracking-[0.4em]"
                      placeholder="••••••"
                    />
                    <p className="text-xs text-muted-foreground">{t('auth.otpHint', { email })}</p>
                  </div>
                  <Button
                    type="submit"
                    size="lg"
                    disabled={isAuthLoading || otp.length < 6}
                    className="w-full font-semibold"
                  >
                    {isAuthLoading ? (
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
                      onClick={handleChangeEmail}
                      disabled={isAuthLoading}
                    >
                      {t('auth.changeEmail')}
                    </Button>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto px-0"
                      onClick={handleResend}
                      disabled={isAuthLoading}
                    >
                      {t('auth.resend')}
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        )}

        {step === 'consent' && (
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
                  checked={hasAcceptedPrivacy}
                  onCheckedChange={setHasAcceptedPrivacy}
                  prefix={tConsent('privacyPrefix')}
                  linkLabel={tConsent('privacyLink')}
                  suffix={tConsent('privacySuffix')}
                  href="/privacy"
                />
                <ConsentCheckboxRow
                  id="consent-terms"
                  checked={hasAcceptedTerms}
                  onCheckedChange={setHasAcceptedTerms}
                  prefix={tConsent('termsPrefix')}
                  linkLabel={tConsent('termsLink')}
                  suffix={tConsent('termsSuffix')}
                  href="/terms"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {step === 'personal' && (
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
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    required
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">{t('personal.lastName')}</Label>
                  <Input
                    id="lastName"
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
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
                  value={birthDate}
                  onChange={e => setBirthDate(e.target.value)}
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
                      selected={gender === value}
                      onClick={() => setGender(value)}
                    >
                      {t(`personal.genderOptions.${value}`)}
                    </OptionButton>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 'rating' && (
          <Card>
            <CardContent className="flex flex-col gap-5 pt-6">
              <StepHeader
                icon={Trophy}
                title={t('rating.title', { sport: match.sport?.name ?? '' })}
                description={t('rating.description')}
              />
              {isLoadingRatings ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="size-6 animate-spin text-primary" />
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
                  {ratings.map(r => (
                    <OptionButton
                      key={r.id}
                      selected={selectedRatingId === r.id}
                      onClick={() => setSelectedRatingId(r.id)}
                      compact
                    >
                      {r.label}
                    </OptionButton>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {step === 'location' && (
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
                  value={postalCode}
                  onChange={e => setPostalCode(formatPostalCodeInput(e.target.value))}
                  onBlur={handlePostalCodeBlur}
                  placeholder="H2X 1Y4"
                  required
                  className="h-11 text-lg tracking-wide"
                />
                {isGeocoding && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="size-3 animate-spin" />
                    {t('location.geocoding')}
                  </p>
                )}
                {!isGeocoding && latitude != null && postalCode && (
                  <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="size-3.5" />
                    <span>
                      {t('location.detected')} ·{' '}
                      {locationCity && locationProvince
                        ? `${locationCity}, ${locationProvince}`
                        : postalCode}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
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

      {isProfileStep && (
        <div className="flex gap-3">
          {profileStepIndex > 0 && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={goBack}
              disabled={isSubmitting}
            >
              <ArrowLeft className="size-4" />
              {t('back')}
            </Button>
          )}
          <Button
            type="button"
            size="lg"
            className="flex-1 font-semibold"
            onClick={goNext}
            disabled={
              isSubmitting || (step === 'consent' && !(hasAcceptedPrivacy && hasAcceptedTerms))
            }
          >
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            {step === 'location' ? finishCtaLabel : t('continue')}
            {!isSubmitting && step !== 'location' && <ArrowRight className="size-4" />}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StepHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="size-5" />
      </div>
      <div className="space-y-0.5">
        <h2 className="text-lg font-bold leading-tight tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground leading-snug">{description}</p>
      </div>
    </div>
  );
}

function ConsentCheckboxRow({
  id,
  checked,
  onCheckedChange,
  prefix,
  linkLabel,
  suffix,
  href,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  prefix: string;
  linkLabel: string;
  suffix: string;
  href: string;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors',
        checked ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-primary/30'
      )}
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={value => onCheckedChange(value === true)}
        className="mt-0.5"
      />
      <span className="text-sm leading-relaxed text-muted-foreground">
        {prefix}
        <Link
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary underline underline-offset-2"
        >
          {linkLabel}
        </Link>
        {suffix}
      </span>
    </label>
  );
}

function OptionButton({
  selected,
  onClick,
  children,
  compact = false,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'flex items-center justify-center rounded-xl border text-center font-medium transition-all duration-150 outline-none',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50',
        compact ? 'px-2 py-2.5 text-xs' : 'px-3 py-3 text-sm',
        selected
          ? 'border-primary bg-primary/10 text-foreground shadow-sm ring-1 ring-primary/20'
          : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

function Stepper({
  totalSteps,
  currentIndex,
  currentLabel,
  counterLabel,
}: {
  totalSteps: number;
  currentIndex: number;
  currentLabel: string;
  counterLabel: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full rounded-full bg-primary transition-all duration-500 ease-out',
                i <= currentIndex ? 'w-full' : 'w-0'
              )}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-foreground">{currentLabel}</span>
        <span className="text-muted-foreground">{counterLabel}</span>
      </div>
    </div>
  );
}

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

          <AppStoreBadges matchId={matchId} />
        </div>
      </CardContent>
    </Card>
  );
}

function AppStoreBadges({ matchId }: { matchId: string }) {
  return (
    <div className="flex items-center gap-3">
      <a
        href={APP_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() =>
          appStoreClicked({ store: 'app_store', placement: 'join_dialog', match_id: matchId })
        }
      >
        <img src="/app-store-badge-light.svg" alt="App Store" className="block h-10 dark:hidden" />
        <img src="/app-store-badge.svg" alt="App Store" className="hidden h-10 dark:block" />
      </a>
      <a
        href={PLAY_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() =>
          appStoreClicked({ store: 'play_store', placement: 'join_dialog', match_id: matchId })
        }
      >
        <img
          src="/google-play-badge-light.svg"
          alt="Google Play"
          className="block h-10 dark:hidden"
        />
        <img src="/google-play-badge.svg" alt="Google Play" className="hidden h-10 dark:block" />
      </a>
    </div>
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
        <AppStoreBadges matchId={matchId} />
      </CardContent>
    </Card>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}
