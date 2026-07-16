'use client';

import { validateEmail, validatePhoneNumber } from '@rallia/shared-utils';
import { usePlacesAutocomplete } from '@rallia/shared-hooks';
import type {
  FacilityAvailabilitySlotRow,
  FacilitySearchResult,
  PlacePrediction,
} from '@rallia/shared-types';
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ChevronRight,
  Info,
  Loader2,
  Lock,
  MessageSquare,
  Sparkles,
  Users,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trackSmokeEvent, type SmokeEventContext } from '@/lib/match-smoke-test/analytics';
import {
  getMatchPlans,
  getRatingOptions,
  ratingScaleLabel,
  formatMatchPlanPrice,
  MATCH_NATURE_OPTIONS,
  SPORT_OPTIONS,
  type MatchNatureOption,
  type MatchPlanTier,
  type RatingOption,
  type SportOption,
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
  getOrCreateExperiment,
  persistRequestContext,
  type SmokeExperiment,
} from '@/lib/match-smoke-test/session';

const WIZARD_STEPS = [
  'intro',
  'preferences',
  'location',
  'day',
  'time',
  'contact',
  'recap',
  'plan',
  'reveal',
] as const;

const AUTO_ADVANCE_MS = 320;

type Step = (typeof WIZARD_STEPS)[number];
type QuestionStep = 'preferences' | 'location' | 'day' | 'time';

const QUESTION_STEPS: QuestionStep[] = ['preferences', 'location', 'day', 'time'];

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
  if (isFlexibleTimeSlot(timeSlot)) return translate('courts.timeFlexible');
  const parsed = parseTimeSlot(timeSlot);
  if (!parsed) return timeSlot;

  let dayLabel: string;
  if (parsed.day === 'today') dayLabel = translate('courts.days.today');
  else if (parsed.day === 'tomorrow') dayLabel = translate('courts.days.tomorrow');
  else dayLabel = getDayWeekdayName(parsed.day, locale);

  const timeLabel = formatHourLabel(parsed.hour, locale);
  return translate('courts.timeWindow', { day: dayLabel, window: timeLabel });
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

  if (state === 'selected') return `${base} font-medium text-primary-foreground/90`;
  if (state === 'disabled') return `${base} font-normal opacity-50`;

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
  const tw = useTranslations('findAMatch.courts');
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
  onSwitchLanguage: () => void;
  otherLangLabel: string;
  children: ReactNode;
}

function WizardShell({
  step,
  showBack,
  onBack,
  questionStep,
  onSwitchLanguage,
  otherLangLabel,
  children,
}: WizardShellProps) {
  const t = useTranslations('findAMatch.wizard');

  return (
    <div className="flex min-h-[100svh] w-full flex-col">
      <div className="fixed inset-x-0 top-0 z-20 h-1 bg-muted/80">
        <div
          className="h-full bg-[var(--primary-500)] transition-all duration-500 ease-out"
          style={{ width: `${stepProgress(step)}%` }}
        />
      </div>

      <div className="fixed right-4 top-4 z-30">
        <button
          type="button"
          onClick={onSwitchLanguage}
          className="rounded-full border border-border bg-card/80 px-3 py-1.5 text-xs font-semibold text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
        >
          {otherLangLabel}
        </button>
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

export default function FindAMatchClient() {
  const t = useTranslations('findAMatch');
  const tw = useTranslations('findAMatch.wizard');
  const locale = useLocale();
  const langue: 'fr' | 'en' = locale.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  const advanceTimer = useRef<number | null>(null);

  const [experiment, setExperiment] = useState<SmokeExperiment | null>(null);

  const [step, setStep] = useState<Step>('intro');
  const [sport, setSport] = useState<SportOption | null>(null);
  const [rating, setRating] = useState<RatingOption | null>(null);
  const [matchNature, setMatchNature] = useState<MatchNatureOption | null>(null);

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
  const [selectedFacilityCity, setSelectedFacilityCity] = useState<string | null>(null);
  const [selectedFacilityTimezone, setSelectedFacilityTimezone] = useState('America/Toronto');
  const [facilityAvailabilitySlots, setFacilityAvailabilitySlots] = useState<
    FacilityAvailabilitySlotRow[]
  >([]);
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);
  const [isSearchingFacilities, setIsSearchingFacilities] = useState(false);
  const [facilitySearchError, setFacilitySearchError] = useState<string | null>(null);
  const [isOutOfArea, setIsOutOfArea] = useState(false);

  const [timeSlot, setTimeSlot] = useState<string | null>(null);
  const [timeDay, setTimeDay] = useState<TimeDayOption | null>(null);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);

  const [email, setEmail] = useState('');
  const [phoneDigits, setPhoneDigits] = useState('');

  const [selectedPlanTier, setSelectedPlanTier] = useState<MatchPlanTier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const facilitySearchRequest = useRef(0);
  const availabilityLoadedFor = useRef<string | null>(null);
  const pageViewFired = useRef(false);
  const prefsCompletedFired = useRef(false);
  const courtsViewedFired = useRef(false);
  const pricingViewedFired = useRef(false);
  const revealFired = useRef(false);

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

  const eventContext = useCallback(
    (exp: SmokeExperiment, overrides?: Partial<SmokeEventContext>): SmokeEventContext => ({
      test_id: exp.testId,
      variant_valueprop: exp.variantValueProp,
      variant_price: exp.variantPriceCents,
      sport,
      ville: selectedFacilityCity,
      langue,
      forfait: selectedPlanTier,
      session_id: exp.sessionId,
      ...overrides,
    }),
    [sport, selectedFacilityCity, langue, selectedPlanTier]
  );

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

  // Assign the A/B experiment once on mount, then fire page_view.
  useEffect(() => {
    setExperiment(getOrCreateExperiment());
  }, []);

  useEffect(() => {
    if (!experiment || pageViewFired.current) return;
    pageViewFired.current = true;
    trackSmokeEvent('page_view', eventContext(experiment));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experiment]);

  useEffect(() => () => clearAdvanceTimer(), [clearAdvanceTimer]);

  useEffect(() => {
    if (step === 'time' && !timeDay) setStep('day');
  }, [step, timeDay]);

  useEffect(() => {
    if (step === 'day' && !selectedFacilityId && !isOutOfArea) setStep('location');
  }, [step, selectedFacilityId, isOutOfArea]);

  useEffect(() => {
    if (step !== 'time' || !timeDay || !timeSlot) return;
    const parsed = parseTimeSlot(timeSlot);
    if (parsed?.day === timeDay) setSelectedHour(parsed.hour);
  }, [step, timeDay, timeSlot]);

  // courts_viewed — first time the availability screen is shown.
  useEffect(() => {
    if (step !== 'day' || !experiment || courtsViewedFired.current) return;
    courtsViewedFired.current = true;
    trackSmokeEvent('courts_viewed', eventContext(experiment), {
      courts_available: Boolean(selectedFacilityId),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, experiment]);

  // pricing_viewed — first time the pricing screen is shown.
  useEffect(() => {
    if (step !== 'plan' || !experiment || pricingViewedFired.current) return;
    pricingViewedFired.current = true;
    trackSmokeEvent('pricing_viewed', eventContext(experiment));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, experiment]);

  // test_reveal_shown — the "this was a test" screen.
  useEffect(() => {
    if (step !== 'reveal' || !experiment || revealFired.current) return;
    revealFired.current = true;
    trackSmokeEvent('test_reveal_shown', eventContext(experiment));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, experiment]);

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

  const markPreferencesCompleted = useCallback(() => {
    if (!experiment || prefsCompletedFired.current) return;
    prefsCompletedFired.current = true;
    trackSmokeEvent('preferences_completed', eventContext(experiment));
  }, [experiment, eventContext]);

  const loadNearbyFacilities = useCallback(
    async (coordinates: { latitude: number; longitude: number }, sportChoice: SportOption) => {
      const requestId = ++facilitySearchRequest.current;
      setIsSearchingFacilities(true);
      setFacilitySearchError(null);
      setIsOutOfArea(false);
      setNearbyFacilities([]);
      setSelectedFacilityId(null);
      setSelectedFacilityName(null);
      setSelectedFacilityCity(null);

      try {
        const facilities = await searchFacilitiesNearCoordinates({
          sport: sportChoice,
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
        });
        if (requestId !== facilitySearchRequest.current) return;

        setNearbyFacilities(facilities);
        if (facilities.length === 0) {
          setIsOutOfArea(true);
          markPreferencesCompleted();
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
    [tw, markPreferencesCompleted]
  );

  const handleAddressQueryChange = (value: string) => {
    setAddressQuery(value);
    setHomeAddress(null);
    setHomePostalCode(null);
    setHomeCoordinates(null);
    setNearbyFacilities([]);
    setSelectedFacilityId(null);
    setSelectedFacilityName(null);
    setSelectedFacilityCity(null);
    setFacilitySearchError(null);
    setIsOutOfArea(false);
    setError(null);
    clearPredictions();
  };

  const handleSelectPlace = async (prediction: PlacePrediction) => {
    if (!sport) return;
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

    void loadNearbyFacilities({ latitude: details.latitude, longitude: details.longitude }, sport);
  };

  const selectSport = (option: SportOption) => {
    setSport(option);
    // Level scales differ per sport — clear a rating that isn't on the new scale.
    setRating(prev => (prev && getRatingOptions(option).includes(prev) ? prev : null));
    setError(null);
  };

  const selectFacility = (facility: FacilitySearchResult) => {
    setSelectedFacilityId(facility.id);
    setSelectedFacilityName(facility.name);
    setSelectedFacilityCity(facility.city ?? null);
    setSelectedFacilityTimezone(facility.timezone ?? 'America/Toronto');
    setFacilityAvailabilitySlots([]);
    setError(null);
    void loadFacilityAvailability(facility.id);
    markPreferencesCompleted();
    scheduleAdvance('day');
  };

  const getDayLabel = (day: TimeDayOption): string => {
    if (day === 'today') return t('courts.days.today');
    if (day === 'tomorrow') return t('courts.days.tomorrow');
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
    setTimeSlot(slot);
    setError(null);
    clearAdvanceTimer();
    setStep('contact');
  };

  const handleSubmitContact = async () => {
    if (!experiment || !sport || !rating || !matchNature || !timeSlot) return;

    const trimmedEmail = email.trim();
    if (!validateEmail(trimmedEmail)) {
      setError(t('contact.errors.email'));
      return;
    }
    if (validatePhoneNumber(phoneDigits).length !== 10) {
      setError(t('contact.errors.phone'));
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/match-smoke-test/capture-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sport,
          rating,
          matchNature,
          timeSlot,
          locationType: 'address',
          homeAddress,
          postalCode: homePostalCode ?? undefined,
          facilityId: selectedFacilityId,
          city: selectedFacilityCity ?? undefined,
          email: trimmedEmail,
          phone: phoneDigits,
          langue,
          sessionId: experiment.sessionId,
          variantValueProp: experiment.variantValueProp,
          variantPriceCents: experiment.variantPriceCents,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t('contact.errors.generic'));
      }

      persistRequestContext({
        sport,
        rating,
        matchNature,
        timeSlot,
        locationType: 'address',
        facilityId: selectedFacilityId ?? undefined,
        facilityName: selectedFacilityName ?? undefined,
        city: selectedFacilityCity ?? undefined,
      });
      trackSmokeEvent('contact_submitted', eventContext(experiment), { has_phone: true });
      setStep('recap');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('contact.errors.generic'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSelectPlan = (tier: MatchPlanTier) => {
    if (!experiment) return;
    setSelectedPlanTier(tier);
    setError(null);
    const plans = getMatchPlans(experiment.variantPriceCents);
    trackSmokeEvent('plan_selected', eventContext(experiment, { forfait: tier }), {
      amount_cents: plans[tier].amountCents,
    });
  };

  const handlePaymentIntent = () => {
    if (!experiment || !selectedPlanTier) return;
    const plans = getMatchPlans(experiment.variantPriceCents);
    trackSmokeEvent(
      'payment_intent_click',
      eventContext(experiment, { forfait: selectedPlanTier }),
      { amount_cents: plans[selectedPlanTier].amountCents }
    );
    clearRequestContext();
    setStep('reveal');
    setError(null);
  };

  const switchLanguage = () => {
    const target = langue === 'fr' ? 'en-US' : 'fr-CA';
    // Remember the manual choice so the geo default doesn't override it.
    document.cookie = `smoke_lang=${target}; path=/; max-age=31536000; samesite=lax`;
    window.location.assign(`/${target}/find-a-match`);
  };

  const otherLangLabel = langue === 'fr' ? 'EN' : 'FR';

  const shellProps = {
    onSwitchLanguage: switchLanguage,
    otherLangLabel,
  };

  if (!experiment) return null;

  const plans = getMatchPlans(experiment.variantPriceCents);
  const unlimitedSelected = selectedPlanTier === 'weekly' || selectedPlanTier === 'monthly';

  const renderRecapSummary = () => {
    if (!sport || !rating || !matchNature || !timeSlot) return null;
    const where = selectedFacilityName
      ? homeAddress
        ? t('recap.whereFacility', { facility: selectedFacilityName, address: homeAddress })
        : selectedFacilityName
      : homeAddress
        ? t('recap.whereAddress', { address: homeAddress })
        : null;
    return (
      <div className="rounded-2xl border bg-muted/30 p-4 text-sm">
        <ul className="space-y-1.5 text-muted-foreground">
          <li>{t('recap.sport', { sport: t(`preferences.sports.${sport}`) })}</li>
          <li>{t('recap.level', { scale: ratingScaleLabel(sport), rating })}</li>
          <li>{t('recap.nature', { nature: t(`preferences.natures.${matchNature}`) })}</li>
          <li>{t('recap.when', { time: formatTimeSlotLabel(timeSlot, locale, t) })}</li>
          {where && <li>{where}</li>}
        </ul>
      </div>
    );
  };

  // ---- Steps ----

  if (step === 'intro') {
    const variant = experiment.variantValueProp;
    return (
      <WizardShell step={step} {...shellProps}>
        <div className="flex flex-col gap-6">
          <Badge className="w-fit bg-[var(--secondary-500)] px-3 py-1 text-white hover:bg-[var(--secondary-500)]">
            {t(`valueProp.${variant}.badge`)}
          </Badge>
          <div className="flex flex-col gap-4">
            <h1 className="text-3xl font-bold leading-tight text-balance sm:text-4xl md:text-5xl">
              {t(`valueProp.${variant}.headline`)}
            </h1>
            <p className="text-lg text-muted-foreground text-balance sm:text-xl">
              {t(`valueProp.${variant}.subheadline`)}
            </p>
          </div>
          <Button
            onClick={() => {
              trackSmokeEvent('value_prop_click', eventContext(experiment));
              setStep('preferences');
            }}
            className="mt-2 h-14 w-full bg-[var(--primary-600)] text-base font-semibold text-white hover:bg-[var(--primary-700)] sm:w-fit sm:px-8"
          >
            {t(`valueProp.${variant}.cta`)}
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </WizardShell>
    );
  }

  if (step === 'preferences') {
    const levelOptions = sport ? getRatingOptions(sport) : [];
    const canContinue = Boolean(sport && rating && matchNature);
    return (
      <WizardShell
        step={step}
        showBack
        onBack={() => setStep('intro')}
        questionStep="preferences"
        {...shellProps}
      >
        <div className="flex flex-col gap-3">
          <h2 className="text-2xl font-bold text-balance sm:text-3xl">{t('preferences.title')}</h2>
          <p className="text-muted-foreground">{t('preferences.subtitle')}</p>
        </div>

        {/* Sport */}
        <div className="flex flex-col gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('preferences.sportLabel')}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {SPORT_OPTIONS.map(option => (
              <button
                key={option}
                type="button"
                onClick={() => selectSport(option)}
                className={optionClass(sport === option)}
              >
                <span className="text-lg font-semibold">{t(`preferences.sports.${option}`)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Level */}
        {sport && (
          <div className="flex flex-col gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('preferences.levelLabel', { scale: ratingScaleLabel(sport) })}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {levelOptions.map(option => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setRating(option);
                    setError(null);
                  }}
                  className={ratingChipClass(rating === option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Nature */}
        <div className="flex flex-col gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('preferences.natureLabel')}
          </p>
          <div className="flex flex-col gap-3">
            {MATCH_NATURE_OPTIONS.map(option => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setMatchNature(option);
                  setError(null);
                }}
                className={optionClass(matchNature === option)}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="flex flex-col gap-1 text-left">
                    <span className="text-lg font-semibold">
                      {t(`preferences.natures.${option}`)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {t(`preferences.natureHints.${option}`)}
                    </span>
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </span>
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">{t('preferences.singlesNote')}</p>

        <Button
          onClick={() => setStep('location')}
          disabled={!canContinue}
          className="h-14 w-full bg-[var(--primary-600)] text-base font-semibold text-white hover:bg-[var(--primary-700)]"
        >
          {t('preferences.continueCta')}
          <ArrowRight className="ml-2 h-5 w-5" />
        </Button>
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
          setStep('preferences');
        }}
        questionStep="location"
        {...shellProps}
      >
        <div className="flex flex-col gap-3">
          <h2 className="text-2xl font-bold text-balance sm:text-3xl">{t('location.question')}</h2>
          <p className="text-muted-foreground">{t('location.hint')}</p>
        </div>

        <div className="relative">
          <Input
            value={addressQuery}
            onChange={e => handleAddressQueryChange(e.target.value)}
            placeholder={t('location.placeholder')}
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
            {isSearchingFacilities ? t('location.searching') : t('location.resolving')}
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
                        ? t('location.openSlots', { count: openSlots })
                        : t('location.noOpenSlots')}
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
        {...shellProps}
      >
        <div className="flex flex-col gap-3">
          <h2 className="text-2xl font-bold text-balance sm:text-3xl">{t('courts.dayQuestion')}</h2>
          <p className="text-muted-foreground">
            {t(selectedFacilityId ? 'courts.dayHint' : 'courts.dayHintNoFacility')}
          </p>
        </div>

        <div className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-muted/20 px-3.5 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--primary-600)]" />
          <span>{t('courts.bookingExcludedNote')}</span>
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
                          ? t('courts.loading')
                          : openCount > 0
                            ? t('courts.openSlots', { count: openCount })
                            : t('courts.noOpenSlots')}
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
        {...shellProps}
      >
        <div className="flex flex-col gap-3">
          <h2 className="text-2xl font-bold text-balance sm:text-3xl">
            {t('courts.timeQuestion')}
          </h2>
          <p className="text-muted-foreground">
            {t(selectedFacilityId ? 'courts.timeHint' : 'courts.timeHintNoFacility', {
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

  if (step === 'contact') {
    const emailValid = validateEmail(email.trim());
    const phoneValid = validatePhoneNumber(phoneDigits).length === 10;
    return (
      <WizardShell
        step={step}
        showBack
        onBack={() => {
          setError(null);
          setStep(timeDay ? 'time' : 'day');
        }}
        {...shellProps}
      >
        <div className="flex flex-col gap-3">
          <Badge className="w-fit bg-[var(--primary-500)] text-white hover:bg-[var(--primary-500)]">
            {t('contact.badge')}
          </Badge>
          <h2 className="text-2xl font-bold sm:text-3xl">{t('contact.title')}</h2>
          <p className="text-muted-foreground">{t('contact.subtitle')}</p>
        </div>

        <div className="flex flex-col gap-3">
          <Input
            value={email}
            onChange={e => {
              setEmail(e.target.value);
              setError(null);
            }}
            placeholder={t('contact.emailPlaceholder')}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            className="h-14 rounded-2xl border-2 px-5 text-lg"
          />
          <Input
            value={phoneDigits}
            onChange={e => {
              setPhoneDigits(formatPhoneInput(e.target.value));
              setError(null);
            }}
            placeholder={t('contact.phonePlaceholder')}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            className="h-14 rounded-2xl border-2 px-5 text-lg"
          />
        </div>

        {error && <p className="text-sm text-[var(--secondary-500)]">{error}</p>}

        <Button
          onClick={handleSubmitContact}
          disabled={isSubmitting || !emailValid || !phoneValid}
          className="h-14 w-full bg-[var(--primary-600)] text-base font-semibold text-white hover:bg-[var(--primary-700)]"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              {t('contact.submitting')}
            </>
          ) : (
            <>
              {t('contact.continueCta')}
              <ArrowRight className="ml-2 h-5 w-5" />
            </>
          )}
        </Button>
        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <Lock className="h-3 w-3 shrink-0" />
          {t('contact.privacyNote')}
        </p>
      </WizardShell>
    );
  }

  if (step === 'recap') {
    return (
      <WizardShell
        step={step}
        showBack
        onBack={() => {
          setError(null);
          setStep('contact');
        }}
        {...shellProps}
      >
        <div className="flex flex-col gap-3">
          <h2 className="text-2xl font-bold text-balance sm:text-3xl">{t('recap.title')}</h2>
          <p className="text-muted-foreground">{t('recap.subtitle')}</p>
        </div>

        {renderRecapSummary()}

        <ul className="flex flex-col gap-4">
          <li className="flex gap-3">
            <Users className="mt-0.5 h-5 w-5 shrink-0 text-[var(--primary-600)]" />
            <span className="text-sm">{t('recap.point1')}</span>
          </li>
          <li className="flex gap-3">
            <MessageSquare className="mt-0.5 h-5 w-5 shrink-0 text-[var(--primary-600)]" />
            <span className="text-sm">{t('recap.point2')}</span>
          </li>
          <li className="flex gap-3">
            <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-[var(--primary-600)]" />
            <span className="text-sm">{t('recap.point3')}</span>
          </li>
        </ul>

        <Button
          onClick={() => {
            setError(null);
            setStep('plan');
          }}
          className="h-14 w-full bg-[var(--primary-600)] text-base font-semibold text-white hover:bg-[var(--primary-700)]"
        >
          {t('recap.continueCta')}
          <ArrowRight className="ml-2 h-5 w-5" />
        </Button>
      </WizardShell>
    );
  }

  if (step === 'plan') {
    return (
      <WizardShell
        step={step}
        showBack
        onBack={() => {
          setError(null);
          setStep('recap');
        }}
        {...shellProps}
      >
        <div className="flex flex-col gap-3">
          <h2 className="text-2xl font-bold text-balance sm:text-3xl">{t('plans.title')}</h2>
          <p className="text-muted-foreground">{t('plans.subtitle')}</p>
        </div>

        <div className="flex flex-col gap-3">
          {/* Pay per game */}
          <button
            type="button"
            onClick={() => handleSelectPlan('single')}
            className={optionClass(selectedPlanTier === 'single')}
          >
            <span className="flex items-start justify-between gap-4">
              <span className="flex flex-col gap-1 text-left">
                <span className="text-lg font-semibold">{t('plans.single.title')}</span>
                <span className="text-2xl font-bold text-[var(--primary-700)] dark:text-[var(--primary-500)]">
                  {formatMatchPlanPrice(plans.single.amountCents, locale)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {t('plans.single.description')}
                </span>
              </span>
              <ChevronRight
                className={`mt-1 h-5 w-5 shrink-0 ${selectedPlanTier === 'single' ? 'text-primary' : 'text-muted-foreground'}`}
              />
            </span>
          </button>

          {/* Unlimited — one plan, choose how you pay */}
          <div
            className={`rounded-2xl border-2 px-5 py-4 transition-all duration-200 ${
              unlimitedSelected ? 'border-primary bg-primary/10 shadow-sm' : 'border-border'
            }`}
          >
            <div className="flex flex-col gap-1 text-left">
              <span className="text-lg font-semibold">{t('plans.unlimited.title')}</span>
              <span className="text-sm text-muted-foreground">
                {t('plans.unlimited.description')}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {(['weekly', 'monthly'] as const).map(tier => {
                const active = selectedPlanTier === tier;
                const price =
                  tier === 'weekly'
                    ? t('plans.priceWeek', {
                        price: formatMatchPlanPrice(plans.weekly.amountCents, locale),
                      })
                    : t('plans.priceMonth', {
                        price: formatMatchPlanPrice(plans.monthly.amountCents, locale),
                      });
                return (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => handleSelectPlan(tier)}
                    className={`flex flex-col items-center gap-0.5 rounded-xl border-2 px-3 py-2.5 text-center transition-all duration-150 ${
                      active
                        ? 'border-primary bg-primary/15'
                        : 'border-border bg-card hover:border-primary/40 hover:bg-muted/50'
                    }`}
                  >
                    <span className="text-sm font-semibold">{t(`plans.billing.${tier}`)}</span>
                    <span className="text-base font-bold text-[var(--primary-700)] dark:text-[var(--primary-500)]">
                      {price}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-muted/20 px-3.5 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--primary-600)]" />
          <span>{t('plans.bookingExcluded')}</span>
        </div>

        {error && <p className="text-sm text-[var(--secondary-500)]">{error}</p>}

        <Button
          onClick={handlePaymentIntent}
          disabled={!selectedPlanTier}
          className="h-14 w-full bg-[var(--primary-600)] text-base font-semibold text-white hover:bg-[var(--primary-700)]"
        >
          {t('plans.proceedCta')}
          <ArrowRight className="ml-2 h-5 w-5" />
        </Button>
      </WizardShell>
    );
  }

  if (step === 'reveal') {
    return (
      <WizardShell step={step} {...shellProps}>
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/15">
            <Sparkles className="h-10 w-10 text-primary" />
          </div>
          <Badge className="bg-[var(--primary-500)] text-white hover:bg-[var(--primary-500)]">
            {t('reveal.badge')}
          </Badge>
          <div className="flex flex-col gap-3">
            <h2 className="text-2xl font-bold sm:text-3xl">{t('reveal.headline')}</h2>
            <p className="text-muted-foreground">{t('reveal.message')}</p>
            <p className="text-sm font-medium text-foreground">{t('reveal.thanks')}</p>
            <p className="text-sm text-muted-foreground">{t('reveal.purpose')}</p>
            <p className="text-xs text-muted-foreground">{t('reveal.deletion')}</p>
          </div>
        </div>
      </WizardShell>
    );
  }

  return null;
}
