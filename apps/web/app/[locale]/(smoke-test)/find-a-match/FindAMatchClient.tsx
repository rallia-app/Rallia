'use client';

import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import type { Appearance } from '@stripe/stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { validatePhoneNumber } from '@rallia/shared-utils';
import { usePlacesAutocomplete } from '@rallia/shared-hooks';
import type {
  FacilityAvailabilitySlotRow,
  FacilitySearchResult,
  PlacePrediction,
} from '@rallia/shared-types';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Lock,
  MessageSquare,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  matchSmokeTestCheckoutStarted,
  matchSmokeTestCheckoutViewed,
  matchSmokeTestCompleted,
  matchSmokeTestDone,
  matchSmokeTestFailed,
  matchSmokeTestFormSubmitted,
  matchSmokeTestPhoneCodeSent,
  matchSmokeTestPhoneStepViewed,
  matchSmokeTestPhoneVerified,
  matchSmokeTestPlanPickerViewed,
  matchSmokeTestPlanSelected,
  matchSmokeTestPromiseContinued,
  matchSmokeTestPromiseViewed,
  matchSmokeTestSubscriptionInterest,
} from '@/lib/analytics';
import {
  MATCH_FORMAT_OPTIONS,
  MATCH_NATURE_OPTIONS,
  MATCH_PLAN_TIERS,
  MATCH_PLANS,
  MATCH_SMOKE_TEST_CURRENCY,
  RATING_OPTIONS,
  formatMatchPlanPrice,
  getMatchPlan,
  type MatchFormatOption,
  type MatchNatureOption,
  type MatchPlanConfig,
  type MatchPlanTier,
  type RatingOption,
  type TimeDayOption,
} from '@/lib/match-smoke-test/constants';
import {
  countAvailabilitySlotsForDay,
  countAvailabilitySlotsForHour,
  fetchFacilityAvailabilitySlots,
  getHourAvailabilityTier,
  getMaxAvailabilityCountForHours,
  type HourAvailabilityTier,
} from '@/lib/match-smoke-test/facility-availability';
import {
  countFutureOpenAvailabilities,
  formatFacilityDistance,
  searchFacilitiesNearCoordinates,
} from '@/lib/match-smoke-test/facilities';
import {
  TIME_DAY_OPTIONS,
  TIME_HOUR_GROUPS,
  encodeTimeSlot,
  formatHourLabel,
  getDayWeekdayName,
  isDaySelectable,
  isFlexibleTimeSlot,
  isHourSelectable,
  parseTimeSlot,
} from '@/lib/match-smoke-test/time-selection';
import { formatPhoneInput } from '@/lib/match-smoke-test/phone';
import {
  clearRequestContext,
  persistRequestContext,
  readRequestContext,
} from '@/lib/match-smoke-test/session';

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

const WIZARD_STEPS = [
  'intro',
  'rating',
  'matchType',
  'location',
  'day',
  'time',
  'promise',
  'plan',
  'checkout',
  'phone',
  'done',
  'reveal',
] as const;

const DEFAULT_PLAN_TIER: MatchPlanTier = 'pack_3';
const AUTO_ADVANCE_MS = 380;

type Step = (typeof WIZARD_STEPS)[number];
type QuestionStep = 'rating' | 'matchType' | 'day' | 'time' | 'location';
type PhonePhase = 'enter' | 'verify';

const QUESTION_STEPS: QuestionStep[] = ['rating', 'matchType', 'location', 'day', 'time'];

function paymentAnalyticsProps(rating: RatingOption, plan: MatchPlanConfig) {
  return {
    rating,
    plan_tier: plan.tier,
    amount_cents: plan.amountCents,
    currency: MATCH_SMOKE_TEST_CURRENCY,
    credits: plan.credits,
  };
}

function getAppearance(theme: string | undefined): Appearance {
  const isDark = theme === 'dark';
  return {
    theme: isDark ? 'night' : 'stripe',
    variables: {
      colorPrimary: '#14b8a6',
      colorDanger: isDark ? '#ff6b6b' : '#ed6a6d',
      borderRadius: '8px',
      fontFamily: 'Inter, sans-serif',
      fontSizeBase: '15px',
      ...(isDark && { colorBackground: '#232323' }),
    },
    rules: {
      '.Input': {
        borderColor: isDark ? '#3a3a3a' : '#e2e8f0',
        boxShadow: 'none',
      },
      '.Input:focus': {
        borderColor: '#14b8a6',
        boxShadow: '0 0 0 2px rgba(20,184,166,0.2)',
      },
      '.Label': {
        fontWeight: '500',
      },
    },
  };
}

function optionClass(active: boolean): string {
  return `group w-full rounded-2xl border-2 px-5 py-4 text-left transition-all duration-200 ${
    active
      ? 'border-primary bg-primary/10 shadow-sm'
      : 'border-border hover:border-primary/40 hover:bg-muted/50'
  }`;
}

function formatTimeSlotLabel(
  timeSlot: string,
  locale: string,
  translate: (key: string, values?: Record<string, string>) => string
): string {
  if (isFlexibleTimeSlot(timeSlot)) return translate('form.timeFlexible');
  const parsed = parseTimeSlot(timeSlot);
  if (!parsed) return timeSlot;

  let dayLabel: string;
  if (parsed.day === 'today') dayLabel = translate('form.timeDays.today');
  else if (parsed.day === 'tomorrow') dayLabel = translate('form.timeDays.tomorrow');
  else dayLabel = getDayWeekdayName(parsed.day, locale);

  const timeLabel = formatHourLabel(parsed.hour, locale);

  return translate('form.timeWindow', { day: dayLabel, window: timeLabel });
}

type HourCellState = 'default' | 'disabled' | 'selected';

function getHourCellState(
  hour: number,
  selectedHour: number | null,
  selectable: boolean
): HourCellState {
  if (!selectable) return 'disabled';
  if (selectedHour === hour) return 'selected';
  return 'default';
}

function ratingChipClass(active: boolean): string {
  const base =
    'flex h-11 items-center justify-center rounded-xl text-sm font-semibold transition-all duration-150';
  return active
    ? `${base} scale-[1.02] bg-primary text-primary-foreground shadow-sm`
    : `${base} border border-border bg-card text-foreground hover:border-primary/40 hover:bg-muted/50`;
}

function hourChipClass(state: HourCellState, tier: HourAvailabilityTier): string {
  const base =
    'flex min-h-[3.25rem] flex-col items-center justify-center rounded-xl px-1 py-2 text-sm font-semibold transition-all duration-150';

  switch (state) {
    case 'disabled':
      return `${base} cursor-not-allowed bg-muted/25 text-muted-foreground/45`;
    case 'selected':
      return `${base} scale-[1.02] bg-primary text-primary-foreground shadow-sm ring-2 ring-primary/30`;
    default:
      switch (tier) {
        case 'high':
          return `${base} border-2 border-primary/55 bg-primary/20 text-foreground hover:bg-primary/25`;
        case 'medium':
          return `${base} border border-primary/35 bg-primary/10 text-foreground hover:bg-primary/15`;
        case 'low':
          return `${base} border border-border bg-card text-foreground hover:border-primary/30 hover:bg-muted/40`;
        case 'none':
        default:
          return `${base} border border-dashed border-muted-foreground/30 bg-muted/20 text-muted-foreground hover:border-muted-foreground/45`;
      }
  }
}

function hourCountClass(state: HourCellState, tier: HourAvailabilityTier): string {
  const base = 'text-[10px] leading-none';

  if (state === 'selected') {
    return `${base} font-medium text-primary-foreground/90`;
  }
  if (state === 'disabled') {
    return `${base} font-normal opacity-50`;
  }

  switch (tier) {
    case 'high':
      return `${base} font-bold text-primary`;
    case 'medium':
      return `${base} font-semibold text-[var(--primary-600)]`;
    case 'low':
      return `${base} font-medium text-muted-foreground`;
    case 'none':
    default:
      return `${base} font-normal text-muted-foreground/65`;
  }
}

const AVAILABILITY_LEGEND_SWATCH: Record<HourAvailabilityTier, string> = {
  high: 'border-2 border-primary/55 bg-primary/20',
  medium: 'border border-primary/35 bg-primary/10',
  low: 'border border-border bg-card',
  none: 'border border-dashed border-muted-foreground/30 bg-muted/20',
};

interface TimePickerProps {
  timeDay: TimeDayOption;
  locale: string;
  timezone: string;
  availabilitySlots: FacilityAvailabilitySlotRow[];
  selectedHour: number | null;
  onSelectHour: (hour: number) => void;
  showAvailability: boolean;
}

function TimePicker({
  timeDay,
  locale,
  timezone,
  availabilitySlots,
  selectedHour,
  onSelectHour,
  showAvailability,
}: TimePickerProps) {
  const tw = useTranslations('findAMatch.wizard.time');
  const allHours = TIME_HOUR_GROUPS.flatMap(group => group.hours);
  const maxOpenCount = showAvailability
    ? getMaxAvailabilityCountForHours(availabilitySlots, timeDay, allHours, timezone)
    : 0;

  return (
    <div className="space-y-5">
      {showAvailability && (
        <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
          {(['high', 'medium', 'low', 'none'] as const).map(tier => (
            <span
              key={tier}
              className="inline-flex items-center gap-2 text-xs text-muted-foreground"
            >
              <span
                className={`h-3 w-5 shrink-0 rounded-sm ${AVAILABILITY_LEGEND_SWATCH[tier]}`}
                aria-hidden
              />
              {tw(`availabilityLegend.${tier}`)}
            </span>
          ))}
        </div>
      )}

      {TIME_HOUR_GROUPS.map(group => (
        <div key={group.id}>
          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {tw(`periods.${group.id}`)}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {group.hours.map(hour => {
              const selectable = isHourSelectable(timeDay, hour);
              const state = getHourCellState(hour, selectedHour, selectable);
              const openCount = showAvailability
                ? countAvailabilitySlotsForHour(availabilitySlots, timeDay, hour, timezone)
                : 0;
              const tier: HourAvailabilityTier = showAvailability
                ? getHourAvailabilityTier(openCount, maxOpenCount)
                : 'low';
              const countLabel =
                openCount > 0 ? tw('openCourts', { count: openCount }) : tw('noOpenCourts');

              return (
                <button
                  key={hour}
                  type="button"
                  disabled={state === 'disabled'}
                  onClick={() => onSelectHour(hour)}
                  className={hourChipClass(state, tier)}
                  aria-label={
                    showAvailability
                      ? `${formatHourLabel(hour, locale, true)}, ${countLabel}`
                      : formatHourLabel(hour, locale, true)
                  }
                >
                  <span className="flex flex-col items-center gap-0.5">
                    <span>{formatHourLabel(hour, locale, true)}</span>
                    {showAvailability && (
                      <span className={hourCountClass(state, tier)}>{countLabel}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function normalizePostalCode(value: string): string {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.length <= 3) return compact;
  return `${compact.slice(0, 3)} ${compact.slice(3, 6)}`;
}

function stepProgress(step: Step): number {
  return ((WIZARD_STEPS.indexOf(step) + 1) / WIZARD_STEPS.length) * 100;
}

function questionNumber(step: QuestionStep): number {
  return QUESTION_STEPS.indexOf(step) + 1;
}

interface WizardShellProps {
  step: Step;
  showBack?: boolean;
  onBack?: () => void;
  questionStep?: QuestionStep;
  children: ReactNode;
}

function WizardShell({ step, showBack, onBack, questionStep, children }: WizardShellProps) {
  const t = useTranslations('findAMatch.wizard');

  return (
    <div className="flex min-h-[100svh] w-full flex-col">
      <div className="fixed inset-x-0 top-0 z-20 h-1 bg-muted/80">
        <div
          className="h-full bg-[var(--primary-500)] transition-all duration-500 ease-out"
          style={{ width: `${stepProgress(step)}%` }}
        />
      </div>

      <div className="flex flex-1 flex-col justify-center px-5 py-20 sm:px-8">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-8">
          {(showBack || questionStep) && (
            <div className="flex min-h-8 items-center justify-between gap-4">
              {showBack && onBack ? (
                <button
                  type="button"
                  onClick={onBack}
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ArrowLeft className="h-4 w-4" />
                  {t('back')}
                </button>
              ) : (
                <span />
              )}
              {questionStep && (
                <p className="text-sm font-medium text-muted-foreground">
                  {t('stepOf', {
                    current: questionNumber(questionStep),
                    total: QUESTION_STEPS.length,
                  })}
                </p>
              )}
            </div>
          )}

          <div key={step} className="animate-fade-in flex flex-col gap-8">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

interface PaymentFormProps {
  formattedAmount: string;
  onSuccess: () => void;
}

function PaymentForm({ formattedAmount, onSuccess }: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const t = useTranslations('findAMatch');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!stripe || !elements) return;
    setIsSubmitting(true);
    // Smoke test: never charge — simulate processing, then reveal it was a test.
    await new Promise(resolve => setTimeout(resolve, 1100));
    onSuccess();
  };

  return (
    <div className="flex flex-col gap-4">
      <PaymentElement options={{ layout: 'accordion' }} />
      <Button
        onClick={handleSubmit}
        disabled={isSubmitting || !stripe || !elements}
        className="h-12 w-full bg-[var(--primary-600)] text-base font-semibold text-white hover:bg-[var(--primary-700)]"
      >
        {isSubmitting ? t('payment.processing') : t('payment.submit', { amount: formattedAmount })}
      </Button>
    </div>
  );
}

interface Props {
  defaultPaymentIntentId?: string;
}

export default function FindAMatchClient({ defaultPaymentIntentId }: Props) {
  const t = useTranslations('findAMatch');
  const tw = useTranslations('findAMatch.wizard');
  const locale = useLocale();
  const { resolvedTheme } = useTheme();
  const advanceTimer = useRef<number | null>(null);

  const [step, setStep] = useState<Step>('intro');
  const [rating, setRating] = useState<RatingOption | null>(null);
  const [matchFormat, setMatchFormat] = useState<MatchFormatOption | null>(null);
  const [matchNature, setMatchNature] = useState<MatchNatureOption | null>(null);
  const [timeSlot, setTimeSlot] = useState<string | null>(null);
  const [timeDay, setTimeDay] = useState<TimeDayOption | null>(null);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [addressQuery, setAddressQuery] = useState('');
  const [homeAddress, setHomeAddress] = useState<string | null>(null);
  const [homePostalCode, setHomePostalCode] = useState<string | null>(null);
  const [homeCoordinates, setHomeCoordinates] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [nearbyFacilities, setNearbyFacilities] = useState<FacilitySearchResult[]>([]);
  const [selectedFacilityId, setSelectedFacilityId] = useState<string | null>(null);
  const [selectedFacilityName, setSelectedFacilityName] = useState<string | null>(null);
  const [selectedFacilityTimezone, setSelectedFacilityTimezone] = useState('America/Toronto');
  const [facilityAvailabilitySlots, setFacilityAvailabilitySlots] = useState<
    FacilityAvailabilitySlotRow[]
  >([]);
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);
  const [isSearchingFacilities, setIsSearchingFacilities] = useState(false);
  const [facilitySearchError, setFacilitySearchError] = useState<string | null>(null);
  const [isOutOfArea, setIsOutOfArea] = useState(false);
  const [selectedPlanTier, setSelectedPlanTier] = useState<MatchPlanTier>(DEFAULT_PLAN_TIER);
  const [activePlan, setActivePlan] = useState<MatchPlanConfig>(getMatchPlan(DEFAULT_PLAN_TIER));
  const [subscriptionNoteVisible, setSubscriptionNoteVisible] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [phoneDigits, setPhoneDigits] = useState('');
  const [phonePhase, setPhonePhase] = useState<PhonePhase>('enter');
  const [otpCode, setOtpCode] = useState('');
  const [devCodeHint, setDevCodeHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const facilitySearchRequest = useRef(0);
  const availabilityLoadedFor = useRef<string | null>(null);

  const {
    predictions,
    isLoading: isLoadingPredictions,
    error: placesError,
    clearPredictions,
    getPlaceDetails,
  } = usePlacesAutocomplete({
    searchQuery: addressQuery,
    enabled: step === 'location' && homeCoordinates === null,
    minQueryLength: 3,
    scope: 'worldwide',
  });

  const selectedPlan = getMatchPlan(selectedPlanTier);
  const formattedAmount = formatMatchPlanPrice(activePlan.amountCents);
  const effectiveRating = rating ?? readRequestContext()?.rating ?? '4.0';
  const effectivePaymentIntentId =
    paymentIntentId ?? defaultPaymentIntentId ?? readRequestContext()?.paymentIntentId ?? null;

  const clearAdvanceTimer = useCallback(() => {
    if (advanceTimer.current !== null) {
      window.clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
  }, []);

  const scheduleAdvance = useCallback(
    (next: Step) => {
      clearAdvanceTimer();
      advanceTimer.current = window.setTimeout(() => {
        setStep(next);
        setError(null);
      }, AUTO_ADVANCE_MS);
    },
    [clearAdvanceTimer]
  );

  useEffect(() => {
    if (step === 'time' && !timeDay) setStep('day');
  }, [step, timeDay]);

  useEffect(() => {
    if (step === 'day' && !selectedFacilityId && !isOutOfArea) setStep('location');
  }, [step, selectedFacilityId, isOutOfArea]);

  useEffect(() => () => clearAdvanceTimer(), [clearAdvanceTimer]);

  const resetFlow = useCallback(() => {
    clearAdvanceTimer();
    clearRequestContext();
    setStep('intro');
    setRating(null);
    setMatchFormat(null);
    setMatchNature(null);
    setTimeSlot(null);
    setTimeDay(null);
    setSelectedHour(null);
    setAddressQuery('');
    setHomeAddress(null);
    setHomePostalCode(null);
    setHomeCoordinates(null);
    setNearbyFacilities([]);
    setSelectedFacilityId(null);
    setSelectedFacilityName(null);
    setSelectedFacilityTimezone('America/Toronto');
    setFacilityAvailabilitySlots([]);
    availabilityLoadedFor.current = null;
    setIsLoadingAvailability(false);
    setFacilitySearchError(null);
    setIsOutOfArea(false);
    setIsSearchingFacilities(false);
    setSelectedPlanTier(DEFAULT_PLAN_TIER);
    setActivePlan(getMatchPlan(DEFAULT_PLAN_TIER));
    setSubscriptionNoteVisible(false);
    setClientSecret(null);
    setPaymentIntentId(null);
    setPhoneDigits('');
    setPhonePhase('enter');
    setOtpCode('');
    setDevCodeHint(null);
    setError(null);
    setIsSubmitting(false);
  }, [clearAdvanceTimer]);

  useEffect(() => {
    if (!defaultPaymentIntentId) return;
    const ctx = readRequestContext();
    if (ctx?.rating) setRating(ctx.rating);
    if (ctx?.matchFormat) setMatchFormat(ctx.matchFormat);
    if (ctx?.matchNature) setMatchNature(ctx.matchNature);
    if (ctx?.timeSlot) setTimeSlot(ctx.timeSlot);
    if (ctx?.facilityId) setSelectedFacilityId(ctx.facilityId);
    if (ctx?.facilityName) setSelectedFacilityName(ctx.facilityName);
    if (ctx?.planTier) {
      setSelectedPlanTier(ctx.planTier);
      setActivePlan(getMatchPlan(ctx.planTier));
    }
    setPaymentIntentId(defaultPaymentIntentId);
    setStep('phone');
    const plan = ctx?.planTier ? getMatchPlan(ctx.planTier) : getMatchPlan(DEFAULT_PLAN_TIER);
    matchSmokeTestCompleted(paymentAnalyticsProps(ctx?.rating ?? '4.0', plan));
  }, [defaultPaymentIntentId]);

  useEffect(() => {
    if (step !== 'time' || !timeDay || !timeSlot) return;
    const parsed = parseTimeSlot(timeSlot);
    if (parsed?.day === timeDay) setSelectedHour(parsed.hour);
  }, [step, timeDay, timeSlot]);

  useEffect(() => {
    if (step !== 'promise' || !rating) return;
    matchSmokeTestPromiseViewed({ rating });
  }, [step, rating]);

  useEffect(() => {
    if (step !== 'plan' || !rating) return;
    matchSmokeTestPlanPickerViewed({ rating });
  }, [step, rating]);

  useEffect(() => {
    if (step !== 'checkout' || !rating) return;
    matchSmokeTestCheckoutViewed(paymentAnalyticsProps(rating, activePlan));
  }, [step, rating, activePlan]);

  useEffect(() => {
    if (step !== 'phone' || !effectivePaymentIntentId) return;
    matchSmokeTestPhoneStepViewed({
      rating: effectiveRating,
      payment_intent_id: effectivePaymentIntentId,
    });
  }, [step, effectivePaymentIntentId, effectiveRating]);

  const loadFacilityAvailability = useCallback(async (facilityId: string) => {
    availabilityLoadedFor.current = facilityId;
    setIsLoadingAvailability(true);
    try {
      const slots = await fetchFacilityAvailabilitySlots(facilityId);
      setFacilityAvailabilitySlots(slots);
    } catch {
      setFacilityAvailabilitySlots([]);
    } finally {
      setIsLoadingAvailability(false);
    }
  }, []);

  useEffect(() => {
    if (step !== 'day' && step !== 'time') return;
    if (!selectedFacilityId || isLoadingAvailability) return;
    if (availabilityLoadedFor.current === selectedFacilityId) return;
    void loadFacilityAvailability(selectedFacilityId);
  }, [step, selectedFacilityId, isLoadingAvailability, loadFacilityAvailability]);

  const loadNearbyFacilities = useCallback(
    async (coordinates: { latitude: number; longitude: number }) => {
      const requestId = ++facilitySearchRequest.current;
      setIsSearchingFacilities(true);
      setFacilitySearchError(null);
      setIsOutOfArea(false);
      setNearbyFacilities([]);
      setSelectedFacilityId(null);
      setSelectedFacilityName(null);

      try {
        const facilities = await searchFacilitiesNearCoordinates(coordinates);
        if (requestId !== facilitySearchRequest.current) return;

        setNearbyFacilities(facilities);
        if (facilities.length === 0) {
          setIsOutOfArea(true);
          setStep('day');
        }
      } catch {
        if (requestId !== facilitySearchRequest.current) return;
        setFacilitySearchError(tw('location.errors.searchFailed'));
      } finally {
        if (requestId === facilitySearchRequest.current) {
          setIsSearchingFacilities(false);
        }
      }
    },
    [tw]
  );

  const handleAddressQueryChange = (value: string) => {
    setAddressQuery(value);
    setHomeAddress(null);
    setHomePostalCode(null);
    setHomeCoordinates(null);
    setNearbyFacilities([]);
    setSelectedFacilityId(null);
    setSelectedFacilityName(null);
    setFacilitySearchError(null);
    setIsOutOfArea(false);
    setError(null);
    clearPredictions();
  };

  const handleSelectPlace = async (prediction: PlacePrediction) => {
    clearPredictions();
    setAddressQuery(
      prediction.address ? `${prediction.name}, ${prediction.address}` : prediction.name
    );
    setError(null);

    const details = await getPlaceDetails(prediction.placeId);
    if (!details) {
      setFacilitySearchError(tw('location.errors.notFound'));
      return;
    }

    setHomeAddress(details.address);
    setAddressQuery(details.address);
    setHomeCoordinates({ latitude: details.latitude, longitude: details.longitude });
    if (details.postalCode) {
      setHomePostalCode(normalizePostalCode(details.postalCode));
    }

    void loadNearbyFacilities({
      latitude: details.latitude,
      longitude: details.longitude,
    });
  };

  const advanceToPromise = useCallback(
    (slotOverride?: string) => {
      const effectiveSlot = slotOverride ?? timeSlot;
      if (!rating || !matchFormat || !matchNature || !effectiveSlot) return;
      if (!selectedFacilityId && !isOutOfArea) return;
      if (!homeAddress) {
        setError(t('form.errors.address'));
        return;
      }

      matchSmokeTestFormSubmitted({
        rating,
        match_format: matchFormat,
        match_nature: matchNature,
        time_slot: effectiveSlot,
        location_type: 'address',
        has_postal_code: Boolean(homePostalCode),
        geolocation_granted: false,
      });

      if (slotOverride) setTimeSlot(slotOverride);
      setStep('promise');
      setError(null);
    },
    [
      rating,
      matchFormat,
      matchNature,
      timeSlot,
      selectedFacilityId,
      isOutOfArea,
      homeAddress,
      homePostalCode,
      t,
    ]
  );

  const handleContinueToPlans = () => {
    if (!rating) return;
    matchSmokeTestPromiseContinued({ rating });
    setStep('plan');
    setError(null);
  };

  const handleSelectPlan = (tier: MatchPlanTier) => {
    const plan = getMatchPlan(tier);
    if (!plan.purchasable) {
      if (rating) matchSmokeTestSubscriptionInterest({ rating });
      setSubscriptionNoteVisible(true);
      return;
    }
    setSelectedPlanTier(tier);
    setSubscriptionNoteVisible(false);
    setError(null);
    if (rating) matchSmokeTestPlanSelected(paymentAnalyticsProps(rating, plan));
  };

  const handlePurchase = async () => {
    if (!rating || !matchFormat || !matchNature || !timeSlot) return;

    const plan = getMatchPlan(selectedPlanTier);
    if (!plan.purchasable) {
      setError(t('payment.genericError'));
      return;
    }

    setError(null);
    setActivePlan(plan);

    if (!stripePromise) {
      setError(t('payment.genericError'));
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/match-smoke-test/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating,
          matchFormat,
          matchNature,
          timeSlot,
          locationType: 'address',
          homeAddress,
          postalCode: homePostalCode ?? undefined,
          facilityId: selectedFacilityId,
          facilityName: selectedFacilityName ?? undefined,
          planTier: plan.tier,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t('payment.genericError'));
      }

      const data = await res.json();
      setClientSecret(data.clientSecret);
      setPaymentIntentId(data.paymentIntentId);
      persistRequestContext({
        rating,
        matchFormat,
        matchNature,
        timeSlot,
        locationType: 'address',
        facilityId: selectedFacilityId ?? undefined,
        facilityName: selectedFacilityName ?? undefined,
        planTier: plan.tier,
        paymentIntentId: data.paymentIntentId,
        amountCents: plan.amountCents,
        credits: plan.credits,
      });
      setStep('checkout');
      matchSmokeTestCheckoutStarted(paymentAnalyticsProps(rating, plan));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('payment.genericError'));
      matchSmokeTestFailed({
        ...paymentAnalyticsProps(rating, plan),
        stage: 'intent_create',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePaymentSuccess = () => {
    if (!rating) return;
    matchSmokeTestCompleted(paymentAnalyticsProps(rating, activePlan));
    clearRequestContext();
    setStep('reveal');
    setError(null);
  };

  const handleSendPhoneCode = async () => {
    if (!effectivePaymentIntentId) return;
    const digits = validatePhoneNumber(phoneDigits);
    if (digits.length !== 10) {
      setError(t('phone.errors.invalidPhone'));
      return;
    }

    setError(null);
    setIsSubmitting(true);
    setDevCodeHint(null);

    try {
      const res = await fetch('/api/match-smoke-test/send-phone-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneDigits: digits,
          paymentIntentId: effectivePaymentIntentId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('phone.errors.sendFailed'));

      if (data.devCode) setDevCodeHint(String(data.devCode));
      setPhonePhase('verify');
      matchSmokeTestPhoneCodeSent({
        rating: effectiveRating,
        payment_intent_id: effectivePaymentIntentId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('phone.errors.sendFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyPhone = async () => {
    if (!effectivePaymentIntentId) return;
    const digits = validatePhoneNumber(phoneDigits);
    const code = otpCode.replace(/\D/g, '');
    if (digits.length !== 10) {
      setError(t('phone.errors.invalidPhone'));
      return;
    }
    if (code.length !== 6) {
      setError(t('phone.errors.invalidCode'));
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/match-smoke-test/verify-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneDigits: digits,
          code,
          paymentIntentId: effectivePaymentIntentId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('phone.errors.verifyFailed'));

      matchSmokeTestPhoneVerified({
        rating: effectiveRating,
        payment_intent_id: effectivePaymentIntentId,
      });
      matchSmokeTestDone({
        rating: effectiveRating,
        payment_intent_id: effectivePaymentIntentId,
      });
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('phone.errors.verifyFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectRating = (option: RatingOption) => {
    setRating(option);
    setError(null);
    scheduleAdvance('matchType');
  };

  const selectFormat = (option: MatchFormatOption) => {
    setMatchFormat(option);
    setError(null);
    if (matchNature) scheduleAdvance('location');
  };

  const selectNature = (option: MatchNatureOption) => {
    setMatchNature(option);
    setError(null);
    if (matchFormat) scheduleAdvance('location');
  };

  const getDayLabel = (day: TimeDayOption): string => {
    if (day === 'today') return t('form.timeDays.today');
    if (day === 'tomorrow') return t('form.timeDays.tomorrow');
    return getDayWeekdayName(day, locale);
  };

  const selectDay = (day: TimeDayOption) => {
    if (!isDaySelectable(day)) return;
    setTimeDay(day);
    setSelectedHour(null);
    setTimeSlot(null);
    setError(null);
    scheduleAdvance('time');
  };

  const handleSelectHour = (hour: number) => {
    if (!timeDay || !isHourSelectable(timeDay, hour)) return;
    const slot = encodeTimeSlot(timeDay, hour);
    setSelectedHour(hour);
    setError(null);
    clearAdvanceTimer();
    advanceToPromise(slot);
  };

  const selectFacility = (facility: FacilitySearchResult) => {
    setSelectedFacilityId(facility.id);
    setSelectedFacilityName(facility.name);
    setSelectedFacilityTimezone(facility.timezone ?? 'America/Toronto');
    setFacilityAvailabilitySlots([]);
    setError(null);
    void loadFacilityAvailability(facility.id);
    scheduleAdvance('day');
  };

  const renderConditionSummary = () => {
    if (!rating || !matchFormat || !matchNature || !timeSlot) return null;
    return (
      <div className="rounded-2xl border bg-muted/30 p-4 text-sm">
        <p className="font-medium">{t('promise.summaryTitle')}</p>
        <ul className="mt-2 space-y-1 text-muted-foreground">
          <li>{t('promise.summaryLevel', { rating })}</li>
          <li>{t('promise.summaryFormat', { format: t(`form.formats.${matchFormat}`) })}</li>
          <li>{t('promise.summaryNature', { nature: t(`form.natures.${matchNature}`) })}</li>
          <li>{t('promise.summaryTime', { time: formatTimeSlotLabel(timeSlot, locale, t) })}</li>
          <li>
            {selectedFacilityName && homeAddress
              ? t('promise.summaryFacility', {
                  facility: selectedFacilityName,
                  address: homeAddress,
                })
              : homeAddress
                ? t('promise.summaryAddress', { address: homeAddress })
                : null}
          </li>
        </ul>
      </div>
    );
  };

  if (step === 'intro') {
    return (
      <WizardShell step={step}>
        <div className="flex flex-col gap-6">
          <Badge className="w-fit bg-[var(--secondary-500)] px-3 py-1 text-white hover:bg-[var(--secondary-500)]">
            {t('hero.badge')}
          </Badge>
          <div className="flex flex-col gap-4">
            <h1 className="text-3xl font-bold leading-tight text-balance sm:text-4xl md:text-5xl">
              {tw('intro.headline')}
            </h1>
            <p className="text-lg text-muted-foreground text-balance sm:text-xl">
              {tw('intro.subheadline', { count: QUESTION_STEPS.length })}
            </p>
          </div>
          <Button
            onClick={() => setStep('rating')}
            className="mt-2 h-14 w-full bg-[var(--primary-600)] text-base font-semibold text-white hover:bg-[var(--primary-700)] sm:w-fit sm:px-8"
          >
            {tw('intro.cta')}
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </WizardShell>
    );
  }

  if (step === 'rating') {
    return (
      <WizardShell step={step} showBack onBack={() => setStep('intro')} questionStep="rating">
        <div className="flex flex-col gap-3">
          <h2 className="text-2xl font-bold text-balance sm:text-3xl">{tw('rating.question')}</h2>
          <p className="text-muted-foreground">{tw('rating.hint')}</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {RATING_OPTIONS.map(option => (
            <button
              key={option}
              type="button"
              onClick={() => selectRating(option)}
              className={ratingChipClass(rating === option)}
            >
              {option}
            </button>
          ))}
        </div>
      </WizardShell>
    );
  }

  if (step === 'matchType') {
    return (
      <WizardShell
        step={step}
        showBack
        onBack={() => {
          clearAdvanceTimer();
          setStep('rating');
        }}
        questionStep="matchType"
      >
        <div className="flex flex-col gap-3">
          <h2 className="text-2xl font-bold text-balance sm:text-3xl">
            {tw('matchType.question')}
          </h2>
          <p className="text-muted-foreground">{tw('matchType.hint')}</p>
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {tw('format.question')}
          </p>
          {MATCH_FORMAT_OPTIONS.map(option => (
            <button
              key={option}
              type="button"
              onClick={() => selectFormat(option)}
              className={optionClass(matchFormat === option)}
            >
              <span className="flex flex-col gap-1 text-left">
                <span className="flex items-center justify-between gap-3">
                  <span className="text-lg font-semibold">{t(`form.formats.${option}`)}</span>
                  <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </span>
                <span className="text-sm text-muted-foreground">
                  {t(`form.formatHints.${option}`)}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {tw('nature.question')}
          </p>
          {MATCH_NATURE_OPTIONS.map(option => (
            <button
              key={option}
              type="button"
              onClick={() => selectNature(option)}
              className={optionClass(matchNature === option)}
            >
              <span className="flex flex-col gap-1 text-left">
                <span className="flex items-center justify-between gap-3">
                  <span className="text-lg font-semibold">{t(`form.natures.${option}`)}</span>
                  <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </span>
                <span className="text-sm text-muted-foreground">
                  {t(`form.natureHints.${option}`)}
                </span>
              </span>
            </button>
          ))}
        </div>
      </WizardShell>
    );
  }

  if (step === 'location') {
    const isResolvingAddress = isLoadingPredictions || isSearchingFacilities;

    return (
      <WizardShell
        step={step}
        showBack
        onBack={() => {
          clearAdvanceTimer();
          setStep('matchType');
        }}
        questionStep="location"
      >
        <div className="flex flex-col gap-3">
          <h2 className="text-2xl font-bold text-balance sm:text-3xl">{tw('location.question')}</h2>
          <p className="text-muted-foreground">{tw('location.hint')}</p>
        </div>

        <div className="relative">
          <Input
            value={addressQuery}
            onChange={e => handleAddressQueryChange(e.target.value)}
            placeholder={t('form.addressPlaceholder')}
            autoFocus
            className="h-14 rounded-2xl border-2 px-5 text-lg"
          />

          {predictions.length > 0 && homeCoordinates === null && (
            <div className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-10 overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
              {predictions.map(prediction => (
                <button
                  key={prediction.placeId}
                  type="button"
                  onClick={() => void handleSelectPlace(prediction)}
                  className="flex w-full flex-col gap-0.5 border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-muted/50"
                >
                  <span className="font-medium">{prediction.name}</span>
                  {prediction.address && (
                    <span className="text-sm text-muted-foreground">{prediction.address}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {isResolvingAddress && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {isSearchingFacilities ? tw('location.searching') : tw('location.resolving')}
          </div>
        )}

        {facilitySearchError && !isSearchingFacilities && (
          <p className="text-sm text-muted-foreground">{facilitySearchError}</p>
        )}

        {placesError && !isResolvingAddress && (
          <p className="text-sm text-destructive">{placesError}</p>
        )}

        {nearbyFacilities.length > 0 && (
          <div className="flex flex-col gap-2">
            {nearbyFacilities.map(facility => {
              const openSlots = countFutureOpenAvailabilities(facility);
              const address = [facility.address, facility.city].filter(Boolean).join(', ');
              return (
                <button
                  key={facility.id}
                  type="button"
                  onClick={() => selectFacility(facility)}
                  className={optionClass(selectedFacilityId === facility.id)}
                >
                  <span className="flex flex-col gap-1 text-left">
                    <span className="flex items-start justify-between gap-3">
                      <span className="text-lg font-semibold">{facility.name}</span>
                      {facility.distance_meters != null && (
                        <span className="shrink-0 text-sm text-muted-foreground">
                          {formatFacilityDistance(facility.distance_meters, locale)}
                        </span>
                      )}
                    </span>
                    {address && <span className="text-sm text-muted-foreground">{address}</span>}
                    <span
                      className={
                        openSlots > 0
                          ? 'text-sm font-medium text-[var(--primary-600)]'
                          : 'text-sm text-muted-foreground'
                      }
                    >
                      {openSlots > 0
                        ? tw('location.openSlots', { count: openSlots })
                        : tw('location.noOpenSlots')}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {error && <p className="text-sm text-[var(--secondary-500)]">{error}</p>}
      </WizardShell>
    );
  }

  if (step === 'day') {
    return (
      <WizardShell
        step={step}
        showBack
        onBack={() => {
          clearAdvanceTimer();
          setStep('location');
        }}
        questionStep="day"
      >
        <div className="flex flex-col gap-3">
          <h2 className="text-2xl font-bold text-balance sm:text-3xl">{tw('day.question')}</h2>
          <p className="text-muted-foreground">
            {tw(selectedFacilityId ? 'day.hint' : 'day.hintNoFacility')}
          </p>
        </div>
        <div className="flex flex-col gap-3">
          {TIME_DAY_OPTIONS.map(day => {
            const selectable = isDaySelectable(day);
            const openCount = countAvailabilitySlotsForDay(
              facilityAvailabilitySlots,
              day,
              selectedFacilityTimezone
            );
            return (
              <button
                key={day}
                type="button"
                disabled={!selectable}
                onClick={() => selectDay(day)}
                className={
                  optionClass(timeDay === day && selectable) +
                  (!selectable
                    ? ' cursor-not-allowed opacity-40 hover:border-border hover:bg-transparent'
                    : '')
                }
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="flex flex-col gap-1 text-left">
                    <span className="text-lg font-semibold">{getDayLabel(day)}</span>
                    {selectedFacilityId && (
                      <span
                        className={
                          openCount > 0
                            ? 'text-sm font-medium text-[var(--primary-600)]'
                            : 'text-sm text-muted-foreground'
                        }
                      >
                        {isLoadingAvailability
                          ? tw('day.loading')
                          : openCount > 0
                            ? tw('day.openSlots', { count: openCount })
                            : tw('day.noOpenSlots')}
                      </span>
                    )}
                  </span>
                  {selectable && (
                    <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </WizardShell>
    );
  }

  if (step === 'time' && timeDay) {
    return (
      <WizardShell
        step={step}
        showBack
        onBack={() => {
          clearAdvanceTimer();
          setError(null);
          setStep('day');
        }}
        questionStep="time"
      >
        <div className="flex flex-col gap-3">
          <h2 className="text-2xl font-bold text-balance sm:text-3xl">{tw('time.question')}</h2>
          <p className="text-muted-foreground">
            {tw(selectedFacilityId ? 'time.hint' : 'time.hintNoFacility', {
              day: getDayLabel(timeDay),
            })}
          </p>
        </div>

        <TimePicker
          timeDay={timeDay}
          locale={locale}
          timezone={selectedFacilityTimezone}
          availabilitySlots={facilityAvailabilitySlots}
          selectedHour={selectedHour}
          onSelectHour={handleSelectHour}
          showAvailability={Boolean(selectedFacilityId)}
        />

        {error && <p className="text-sm text-[var(--secondary-500)]">{error}</p>}
      </WizardShell>
    );
  }

  if (step === 'promise' && rating && matchFormat && matchNature && timeSlot) {
    return (
      <WizardShell step={step} showBack onBack={() => setStep('time')}>
        <div className="flex flex-col gap-3">
          <h2 className="text-2xl font-bold text-balance sm:text-3xl">{t('promise.title')}</h2>
          <p className="text-muted-foreground">{t('promise.subtitle')}</p>
        </div>

        {renderConditionSummary()}

        <ul className="flex flex-col gap-4">
          <li className="flex gap-3">
            <Users className="mt-0.5 h-5 w-5 shrink-0 text-[var(--primary-600)]" />
            <span className="text-sm">{t('promise.point1')}</span>
          </li>
          <li className="flex gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[var(--primary-600)]" />
            <span className="text-sm">{t('promise.point2')}</span>
          </li>
          <li className="flex gap-3">
            <MessageSquare className="mt-0.5 h-5 w-5 shrink-0 text-[var(--primary-600)]" />
            <span className="text-sm">{t('promise.point3')}</span>
          </li>
        </ul>

        <Button
          onClick={handleContinueToPlans}
          className="h-14 w-full bg-[var(--primary-600)] text-base font-semibold text-white hover:bg-[var(--primary-700)]"
        >
          {t('promise.continueCta')}
          <ArrowRight className="ml-2 h-5 w-5" />
        </Button>
      </WizardShell>
    );
  }

  if (step === 'plan' && rating) {
    return (
      <WizardShell
        step={step}
        showBack
        onBack={() => {
          setStep('promise');
          setError(null);
          setSubscriptionNoteVisible(false);
        }}
      >
        <div className="flex flex-col gap-3">
          <h2 className="text-2xl font-bold text-balance sm:text-3xl">{t('plans.title')}</h2>
          <p className="text-muted-foreground">{t('plans.subtitle')}</p>
        </div>

        <div className="flex flex-col gap-3">
          {MATCH_PLAN_TIERS.map(tier => {
            const plan = getMatchPlan(tier);
            const isSelected = selectedPlanTier === tier && plan.purchasable;
            const isDisabled = !plan.purchasable;

            return (
              <button
                key={tier}
                type="button"
                onClick={() => handleSelectPlan(tier)}
                className={`${optionClass(isSelected)} ${isDisabled ? 'cursor-default opacity-60 hover:border-border hover:bg-transparent' : ''}`}
              >
                <span className="flex items-start justify-between gap-4">
                  <span className="flex flex-col gap-1 text-left">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-semibold">{t(`plans.${tier}.title`)}</span>
                      {tier === 'pack_3' && (
                        <Badge className="bg-[var(--secondary-500)] text-white hover:bg-[var(--secondary-500)]">
                          {t('plans.bestValue')}
                        </Badge>
                      )}
                      {isDisabled && (
                        <Badge variant="outline" className="text-muted-foreground">
                          {t('plans.comingSoon')}
                        </Badge>
                      )}
                    </span>
                    <span className="text-2xl font-bold text-[var(--primary-700)] dark:text-[var(--primary-500)]">
                      {t(`plans.${tier}.price`)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {t(`plans.${tier}.description`)}
                    </span>
                    {tier === 'pack_3' && plan.purchasable && (
                      <span className="text-xs text-muted-foreground">
                        {t('plans.perSearch', {
                          amount: formatMatchPlanPrice(Math.round(plan.amountCents / 3)),
                        })}
                      </span>
                    )}
                  </span>
                  {!isDisabled && (
                    <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {subscriptionNoteVisible && (
          <p className="text-sm text-muted-foreground">{t('plans.subscriptionNote')}</p>
        )}
        {error && <p className="text-sm text-[var(--secondary-500)]">{error}</p>}

        <Button
          onClick={handlePurchase}
          disabled={isSubmitting || !selectedPlan.purchasable}
          className="h-14 w-full bg-[var(--primary-600)] text-base font-semibold text-white hover:bg-[var(--primary-700)]"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              {t('payment.processing')}
            </>
          ) : (
            <>
              {t('plans.continueCta')}
              <ArrowRight className="ml-2 h-5 w-5" />
            </>
          )}
        </Button>
      </WizardShell>
    );
  }

  if (step === 'checkout' && clientSecret && stripePromise && rating) {
    return (
      <WizardShell
        step={step}
        showBack
        onBack={() => {
          setStep('plan');
          setClientSecret(null);
          setError(null);
        }}
      >
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-bold sm:text-3xl">{t('payment.title')}</h2>
          <p className="text-muted-foreground">
            {activePlan.tier === 'pack_3'
              ? t('payment.subtitlePack', { amount: formattedAmount })
              : t('payment.subtitleSingle', { amount: formattedAmount })}
          </p>
        </div>
        <Elements
          key={resolvedTheme}
          stripe={stripePromise}
          options={{ clientSecret, appearance: getAppearance(resolvedTheme) }}
        >
          <PaymentForm formattedAmount={formattedAmount} onSuccess={handlePaymentSuccess} />
        </Elements>
        {error && <p className="text-sm text-[var(--secondary-500)]">{error}</p>}
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" />
          {t('payment.secureNote')}
        </p>
      </WizardShell>
    );
  }

  if (step === 'phone' && effectivePaymentIntentId) {
    return (
      <WizardShell step={step}>
        <div className="flex flex-col gap-3">
          <Badge className="w-fit bg-[var(--primary-500)] text-white hover:bg-[var(--primary-500)]">
            {t('phone.badge')}
          </Badge>
          <h2 className="text-2xl font-bold sm:text-3xl">{t('phone.title')}</h2>
          <p className="text-muted-foreground">{t('phone.subtitle')}</p>
        </div>

        <Input
          value={phoneDigits}
          onChange={e => {
            setPhoneDigits(formatPhoneInput(e.target.value));
            setError(null);
          }}
          placeholder={t('phone.placeholder')}
          type="tel"
          autoComplete="tel"
          disabled={phonePhase === 'verify'}
          className="h-14 rounded-2xl border-2 px-5 text-lg"
        />

        {phonePhase === 'verify' && (
          <Input
            value={otpCode}
            onChange={e => {
              setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6));
              setError(null);
            }}
            placeholder={t('phone.codePlaceholder')}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            className="h-14 rounded-2xl border-2 px-5 text-lg tracking-widest"
          />
        )}

        {devCodeHint && (
          <p className="text-xs text-muted-foreground">
            {t('phone.devCodeHint', { code: devCodeHint })}
          </p>
        )}

        {error && <p className="text-sm text-[var(--secondary-500)]">{error}</p>}

        {phonePhase === 'enter' ? (
          <Button
            onClick={handleSendPhoneCode}
            disabled={isSubmitting || validatePhoneNumber(phoneDigits).length !== 10}
            className="h-14 w-full bg-[var(--primary-600)] text-base font-semibold text-white hover:bg-[var(--primary-700)]"
          >
            {isSubmitting ? t('phone.sending') : t('phone.sendCode')}
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            <Button
              onClick={handleVerifyPhone}
              disabled={isSubmitting || otpCode.length !== 6}
              className="h-14 w-full bg-[var(--primary-600)] text-base font-semibold text-white hover:bg-[var(--primary-700)]"
            >
              {isSubmitting ? t('phone.verifying') : t('phone.verifyCode')}
            </Button>
            <button
              type="button"
              onClick={() => {
                setPhonePhase('enter');
                setOtpCode('');
                setDevCodeHint(null);
                setError(null);
              }}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              {t('phone.changeNumber')}
            </button>
          </div>
        )}
      </WizardShell>
    );
  }

  if (step === 'reveal') {
    return (
      <WizardShell step={step}>
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/15">
            <ShieldCheck className="h-10 w-10 text-primary" />
          </div>
          <Badge className="bg-[var(--primary-500)] text-white hover:bg-[var(--primary-500)]">
            {t('reveal.badge')}
          </Badge>
          <div className="flex flex-col gap-3">
            <h2 className="text-2xl font-bold sm:text-3xl">{t('reveal.headline')}</h2>
            <p className="text-muted-foreground">{t('reveal.message')}</p>
            <p className="text-sm font-medium text-foreground">{t('reveal.thanks')}</p>
            <p className="text-xs text-muted-foreground">{t('reveal.note')}</p>
          </div>
        </div>
      </WizardShell>
    );
  }

  if (step === 'done') {
    return (
      <WizardShell step={step}>
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/15">
            <CheckCircle2 className="h-10 w-10 text-primary" />
          </div>
          <Badge className="bg-[var(--primary-500)] text-white hover:bg-[var(--primary-500)]">
            {t('done.badge')}
          </Badge>
          <div className="flex flex-col gap-3">
            <h2 className="text-2xl font-bold sm:text-3xl">{t('done.headline')}</h2>
            <p className="text-muted-foreground">{t('done.message')}</p>
            <p className="text-sm text-muted-foreground">{t('done.smsNote')}</p>
            <p className="text-xs text-muted-foreground">{t('done.previewNote')}</p>
          </div>
        </div>
      </WizardShell>
    );
  }

  return null;
}
