'use client';

import { normalizePostalCode, validateEmail, validatePhoneNumber } from '@/lib/validators';
import { usePlacesAutocomplete } from '@/lib/places/usePlacesAutocomplete';
import type { AvailabilitySlotDto, FacilityDto, PlacePrediction } from '@/lib/types';
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ChevronRight,
  Info,
  Loader2,
  Lock,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { trackSmokeEvent, type SmokeEventContext } from '@/lib/analytics';
import { SmokeBrandLockup } from '@/lib/brand';
import {
  FUNNEL_VERSION,
  getMatchPlans,
  getRatingOptions,
  ratingScaleLabel,
  formatMatchPlanPrice,
  MATCH_NATURE_OPTIONS,
  SPORT_OPTIONS,
  type FacilityPreference,
  type LocationOption,
  type MatchNatureOption,
  type MatchPlanTier,
  type RatingOption,
  type SportOption,
  type TimeDayOption,
} from '@/lib/constants';
import {
  countAvailabilitySlotsForDay,
  countAvailabilitySlotsForHour,
  fetchFacilityAvailabilitySlots,
  getHourAvailabilityTier,
  getMaxAvailabilityCountForHours,
  type HourAvailabilityTier,
} from '@/lib/facility-availability';
import {
  DEFAULT_MAX_DISTANCE_KM,
  DISTANCE_OPTIONS_KM,
  countFutureOpenAvailabilities,
  formatFacilityDistance,
  searchFacilitiesNearCoordinates,
} from '@/lib/facilities';
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
} from '@/lib/time-selection';
import { estimateLiquidity } from '@/lib/liquidity';
import { formatPhoneInput } from '@/lib/phone';
import {
  clearRequestContext,
  getOrCreateExperiment,
  persistRequestContext,
  type SmokeExperiment,
} from '@/lib/session';

const WIZARD_STEPS = [
  'intro',
  'preferences',
  'location',
  'day',
  'time',
  'liquidity',
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
  return `group smk-option${active ? ' smk-option--active' : ''}`;
}

function chipClass(active: boolean): string {
  return `smk-chip${active ? ' smk-chip--active' : ''}`;
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

function hourChipClass(state: HourCellState, tier: HourAvailabilityTier): string {
  if (state === 'selected') return 'smk-hour smk-hour--selected';
  if (state === 'disabled') return 'smk-hour';
  switch (tier) {
    case 'high':
      return 'smk-hour smk-hour--high';
    case 'medium':
      return 'smk-hour smk-hour--medium';
    case 'none':
      return 'smk-hour smk-hour--none';
    default:
      return 'smk-hour';
  }
}

function hourCountClass(state: HourCellState, tier: HourAvailabilityTier): string {
  const base = 'text-[10px] leading-none';

  if (state === 'selected') return `${base} font-medium opacity-80`;
  if (state === 'disabled') return `${base} font-normal opacity-50`;

  switch (tier) {
    case 'high':
      return `${base} smk-text-green font-bold`;
    case 'medium':
      return `${base} smk-text-green font-semibold`;
    case 'low':
      return `${base} smk-text-muted font-medium`;
    case 'none':
    default:
      return `${base} smk-text-muted font-normal opacity-80`;
  }
}

const AVAILABILITY_LEGEND_SWATCH: Record<HourAvailabilityTier, string> = {
  high: 'border-2 border-[color:var(--smk-lime-deep)] bg-[#e9f8b2]',
  medium: 'border-2 border-[#bcca87] bg-[color:var(--smk-lime-tint)]',
  low: 'border-2 border-[color:var(--smk-line)] bg-white',
  none: 'border-2 border-dashed border-[color:var(--smk-line-strong)] bg-transparent',
};

/** Decorative sliced-ball, echoing the logo mark. */
function SlicedBall({ size = 110, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" className={className} aria-hidden>
      <path
        d="M14.93 29.07 A10 10 0 0 1 29.07 14.93 Z"
        fill="var(--smk-lime)"
        stroke="var(--smk-ink)"
        strokeWidth="1.6"
        transform="translate(-1.4 -1.4)"
      />
      <path
        d="M14.93 29.07 A10 10 0 0 0 29.07 14.93 Z"
        fill="var(--smk-lime)"
        stroke="var(--smk-ink)"
        strokeWidth="1.6"
        transform="translate(1.4 1.4)"
      />
    </svg>
  );
}

/** Faint court lines behind the intro landing. */
function CourtBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg
        className="absolute -bottom-40 -right-28 h-[78vh] w-auto rotate-[10deg] opacity-[0.06]"
        viewBox="0 0 400 780"
        fill="none"
        stroke="var(--smk-ink)"
        strokeWidth="5"
      >
        <rect x="10" y="10" width="380" height="760" rx="4" />
        <line x1="10" y1="390" x2="390" y2="390" />
        <rect x="55" y="130" width="290" height="520" />
        <line x1="200" y1="130" x2="200" y2="650" />
      </svg>
      <SlicedBall
        size={120}
        className="smk-float absolute right-[7%] top-[14%] hidden opacity-90 sm:block"
      />
    </div>
  );
}

function stepProgress(step: Step): number {
  return ((WIZARD_STEPS.indexOf(step) + 1) / WIZARD_STEPS.length) * 100;
}

function questionNumber(step: QuestionStep): number {
  return QUESTION_STEPS.indexOf(step) + 1;
}

// Level-guide rows — mirror the onboarding rating descriptions we reuse.
const NTRP_GUIDE_KEYS = ['1_5', '2_0', '2_5', '3_0', '3_5', '4_0', '4_5', '5_0', '5_5', '6_0'];
const DUPR_GUIDE_KEYS = ['1_0', '2_0', '2_5', '3_0', '3_5', '4_0', '4_5', '5_0', '5_5', '6_0'];

/** Info popover explaining the NTRP/DUPR scale, like the app onboarding. */
function LevelGuidePopover({ sport }: { sport: SportOption }) {
  const tp = useTranslations('findAMatch.preferences.levelInfo');
  const tr = useTranslations('onboarding.ratingStep');
  const scale = ratingScaleLabel(sport);
  const isPickleball = sport === 'pickleball';
  const keys = isPickleball ? DUPR_GUIDE_KEYS : NTRP_GUIDE_KEYS;
  const descNamespace = isPickleball ? 'duprDescriptions' : 'ntrpDescriptions';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--smk-ink)] underline decoration-[var(--smk-lime)] decoration-2 underline-offset-4 transition-opacity hover:opacity-70"
        >
          <Info className="h-3.5 w-3.5" />
          {tp('trigger')}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-[60vh] w-80 overflow-y-auto rounded-2xl border-2 border-[color:var(--smk-ink)] bg-white text-[color:var(--smk-ink)] shadow-[5px_5px_0_var(--smk-ink)]"
      >
        <div className="flex flex-col gap-1">
          <p className="smk-title text-sm">{tp('title', { scale })}</p>
          <p className="smk-text-muted text-xs">{tp('subtitle')}</p>
        </div>
        <ul className="mt-3 flex flex-col gap-2.5">
          {keys.map(key => (
            <li key={key} className="flex gap-2.5 text-left">
              <span className="smk-title mt-0.5 inline-flex h-6 min-w-[2.75rem] shrink-0 items-center justify-center rounded-md border border-[color:var(--smk-lime-deep)] bg-[color:var(--smk-lime-tint)] px-1 text-xs">
                {key.replace('_', '.')}
              </span>
              <span className="smk-text-muted text-xs leading-snug">
                {tr(`${descNamespace}.${key}`)}
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

interface WizardShellProps {
  step: Step;
  showBack?: boolean;
  onBack?: () => void;
  questionStep?: QuestionStep;
  onSwitchLanguage: () => void;
  otherLangLabel: string;
  /** Decorative court scene behind the content — used on the intro landing. */
  backdrop?: boolean;
  children: ReactNode;
}

function WizardShell({
  step,
  showBack,
  onBack,
  questionStep,
  onSwitchLanguage,
  otherLangLabel,
  backdrop,
  children,
}: WizardShellProps) {
  const t = useTranslations('findAMatch.wizard');

  return (
    <div className="relative flex min-h-[100svh] w-full flex-col overflow-hidden">
      {backdrop && <CourtBackdrop />}

      <div className="smk-progress">
        <div className="smk-progress-fill" style={{ width: `${stepProgress(step)}%` }} />
      </div>

      <div className="fixed left-4 top-4 z-30 sm:left-6">
        <SmokeBrandLockup />
      </div>

      <div className="fixed right-4 top-4 z-30">
        <button type="button" onClick={onSwitchLanguage} className="smk-lang">
          {otherLangLabel}
        </button>
      </div>

      <div className="relative z-10 flex flex-1 flex-col justify-center px-5 py-24 sm:px-8">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-8">
          {(showBack || questionStep) && (
            <div className="flex min-h-8 items-center justify-between gap-4">
              {showBack && onBack ? (
                <button
                  type="button"
                  onClick={onBack}
                  className="smk-text-muted inline-flex items-center gap-1.5 text-sm font-medium transition-colors hover:text-[color:var(--smk-ink)]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  {t('back')}
                </button>
              ) : (
                <span />
              )}
              {questionStep && (
                <span className="flex items-center gap-2">
                  <span className="flex items-center gap-1.5" aria-hidden>
                    {QUESTION_STEPS.map((qs, index) => (
                      <span
                        key={qs}
                        className={`h-1.5 rounded-full transition-all duration-300 ${
                          index < questionNumber(questionStep)
                            ? 'w-6 bg-[var(--smk-ink)]'
                            : 'w-2.5 bg-[var(--smk-line-strong)]'
                        }`}
                      />
                    ))}
                  </span>
                  <span className="smk-title smk-text-muted text-xs">
                    {t('stepOf', {
                      current: questionNumber(questionStep),
                      total: QUESTION_STEPS.length,
                    })}
                  </span>
                </span>
              )}
            </div>
          )}

          <div key={step} className="smk-step flex flex-col gap-8">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FindAMatchClient({ geoCity = null }: { geoCity?: string | null }) {
  const t = useTranslations('findAMatch');
  const locale = useLocale();
  const langue: 'fr' | 'en' = locale.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  const advanceTimer = useRef<number | null>(null);

  const [experiment, setExperiment] = useState<SmokeExperiment | null>(null);

  const [step, setStep] = useState<Step>('intro');
  const [sport, setSport] = useState<SportOption | null>(null);
  const [rating, setRating] = useState<RatingOption | null>(null);
  const [matchNature, setMatchNature] = useState<MatchNatureOption | null>(null);

  const [addressQuery, setAddressQuery] = useState('');
  /** What we echo back on the recap screen. Display only — never submitted. */
  const [locationLabel, setLocationLabel] = useState<string | null>(null);
  const [homePostalCode, setHomePostalCode] = useState<string | null>(null);
  const [homeCity, setHomeCity] = useState<string | null>(null);
  const [homeRegion, setHomeRegion] = useState<string | null>(null);
  const [locationType, setLocationType] = useState<LocationOption>('address');
  const [isResolvingPostal, setIsResolvingPostal] = useState(false);
  const [homeCoordinates, setHomeCoordinates] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [nearbyFacilities, setNearbyFacilities] = useState<FacilityDto[]>([]);
  const [selectedFacilityId, setSelectedFacilityId] = useState<string | null>(null);
  const [selectedFacilityName, setSelectedFacilityName] = useState<string | null>(null);
  const [selectedFacilityCity, setSelectedFacilityCity] = useState<string | null>(null);
  const [selectedFacilityTimezone, setSelectedFacilityTimezone] = useState('America/Toronto');
  const [facilityAvailabilitySlots, setFacilityAvailabilitySlots] = useState<AvailabilitySlotDto[]>(
    []
  );
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);
  const [isSearchingFacilities, setIsSearchingFacilities] = useState(false);
  const [facilitySearchError, setFacilitySearchError] = useState<string | null>(null);
  // True when the visitor moves on without a specific play site — either by
  // choosing to stay flexible, or because nothing was within the radius.
  const [skippedFacility, setSkippedFacility] = useState(false);
  const [facilityPreference, setFacilityPreference] = useState<FacilityPreference | null>(null);
  const [searchCompleted, setSearchCompleted] = useState(false);
  const [maxDistanceKm, setMaxDistanceKm] = useState<number>(DEFAULT_MAX_DISTANCE_KM);

  const [timeSlot, setTimeSlot] = useState<string | null>(null);
  const [timeDay, setTimeDay] = useState<TimeDayOption | null>(null);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);

  const [email, setEmail] = useState('');
  const [phoneDigits, setPhoneDigits] = useState('');

  const [selectedPlanTier, setSelectedPlanTier] = useState<MatchPlanTier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [eraseState, setEraseState] = useState<'idle' | 'deleting' | 'done' | 'error'>('idle');

  const facilitySearchRequest = useRef(0);
  const availabilityLoadedFor = useRef<string | null>(null);
  const pageViewFired = useRef(false);
  const prefsCompletedFired = useRef(false);
  const courtsViewedFired = useRef(false);
  const liquidityViewedFired = useRef(false);
  const pricingViewedFired = useRef(false);
  const revealFired = useRef(false);

  // Simulated liquidity numbers — deterministic from the visitor's own inputs.
  const liquidity = useMemo(
    () =>
      sport && rating && timeSlot
        ? estimateLiquidity({ sport, rating, maxDistanceKm, timeSlot })
        : null,
    [sport, rating, maxDistanceKm, timeSlot]
  );

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
  });

  const eventContext = useCallback(
    (exp: SmokeExperiment, overrides?: Partial<SmokeEventContext>): SmokeEventContext => ({
      test_id: exp.testId,
      funnel_version: FUNNEL_VERSION,
      variant_valueprop: exp.variantValueProp,
      variant_price: exp.variantPriceCents,
      sport,
      // Precise facility city once chosen; otherwise the IP-geo city so early
      // funnel events (page_view, value_prop_click…) still carry a `ville`.
      ville: selectedFacilityCity ?? geoCity,
      langue,
      forfait: selectedPlanTier,
      session_id: exp.sessionId,
      ...overrides,
    }),
    [sport, selectedFacilityCity, geoCity, langue, selectedPlanTier]
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
    if (step === 'liquidity' && !liquidity) setStep(timeDay ? 'time' : 'day');
  }, [step, liquidity, timeDay]);

  useEffect(() => {
    if (step === 'day' && !selectedFacilityId && !skippedFacility) setStep('location');
  }, [step, selectedFacilityId, skippedFacility]);

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
      facility_preference: facilityPreference,
      max_distance_km: maxDistanceKm,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, experiment]);

  // liquidity_viewed — first time the simulated liquidity signal is shown.
  useEffect(() => {
    if (step !== 'liquidity' || !experiment || !liquidity || liquidityViewedFired.current) return;
    liquidityViewedFired.current = true;
    trackSmokeEvent('liquidity_viewed', eventContext(experiment), {
      players_shown: liquidity.playerCount,
      match_likelihood_pct: liquidity.likelihoodPct,
      confidence_shown: liquidity.confidence,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, experiment, liquidity]);

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
    async (
      coordinates: { latitude: number; longitude: number },
      sportChoice: SportOption,
      distanceKm: number
    ) => {
      const requestId = ++facilitySearchRequest.current;
      setIsSearchingFacilities(true);
      setSearchCompleted(false);
      setFacilitySearchError(null);
      setSkippedFacility(false);
      setFacilityPreference(null);
      setNearbyFacilities([]);
      setSelectedFacilityId(null);
      setSelectedFacilityName(null);
      setSelectedFacilityCity(null);

      try {
        const facilities = await searchFacilitiesNearCoordinates({
          sport: sportChoice,
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          maxDistanceKm: distanceKm,
        });
        if (requestId !== facilitySearchRequest.current) return;

        // No auto-advance on an empty result: the location step surfaces an
        // empty state so the visitor can widen the radius or continue anyway.
        setNearbyFacilities(facilities);
        setSearchCompleted(true);
      } catch {
        if (requestId !== facilitySearchRequest.current) return;
        setFacilitySearchError(t('location.errors.searchFailed'));
      } finally {
        if (requestId === facilitySearchRequest.current) {
          setIsSearchingFacilities(false);
        }
      }
    },
    [t]
  );

  const resetResolvedLocation = () => {
    setLocationLabel(null);
    setHomePostalCode(null);
    setHomeCity(null);
    setHomeRegion(null);
    setHomeCoordinates(null);
    setNearbyFacilities([]);
    setSelectedFacilityId(null);
    setSelectedFacilityName(null);
    setSelectedFacilityCity(null);
    setFacilitySearchError(null);
    setSkippedFacility(false);
    setFacilityPreference(null);
    setSearchCompleted(false);
    setError(null);
  };

  /**
   * Step 2 takes a street address or just a postal code. A postal code resolves
   * straight through the geocoder — no dropdown to pick from something the
   * visitor already knows exactly.
   */
  const handleAddressQueryChange = (value: string) => {
    setAddressQuery(value);
    resetResolvedLocation();
    clearPredictions();

    const postal = normalizePostalCode(value);
    if (postal && sport) {
      void resolvePostalCode(postal.normalized);
    }
  };

  const resolvePostalCode = async (normalized: string) => {
    if (!sport) return;
    setIsResolvingPostal(true);
    try {
      const res = await fetch('/api/places/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postalCode: normalized }),
      });
      if (!res.ok) {
        setFacilitySearchError(t('location.errors.postalNotFound'));
        return;
      }

      const { location } = (await res.json()) as {
        location: {
          latitude: number;
          longitude: number;
          postalCode: string;
          city?: string;
          province?: string;
        };
      };

      setLocationType('postal_code');
      setLocationLabel([location.postalCode, location.city].filter(Boolean).join(', '));
      setHomePostalCode(location.postalCode);
      setHomeCity(location.city ?? null);
      setHomeRegion(location.province ?? null);
      setHomeCoordinates({ latitude: location.latitude, longitude: location.longitude });

      void loadNearbyFacilities(
        { latitude: location.latitude, longitude: location.longitude },
        sport,
        maxDistanceKm
      );
    } catch {
      setFacilitySearchError(t('location.errors.postalNotFound'));
    } finally {
      setIsResolvingPostal(false);
    }
  };

  const handleSelectDistance = (distanceKm: number) => {
    setMaxDistanceKm(distanceKm);
    setError(null);
    if (sport && homeCoordinates) {
      void loadNearbyFacilities(homeCoordinates, sport, distanceKm);
    }
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
      setFacilitySearchError(t('location.errors.notFound'));
      return;
    }

    // The address is shown back to the visitor but never leaves the browser —
    // only the postal code, city and region are submitted.
    setAddressQuery(details.address);
    setLocationLabel(details.address);
    setLocationType('address');
    setHomeCoordinates({ latitude: details.latitude, longitude: details.longitude });
    setHomeCity(details.city ?? null);
    setHomeRegion(details.province ?? null);
    setHomePostalCode(
      details.postalCode ? (normalizePostalCode(details.postalCode)?.normalized ?? null) : null
    );

    void loadNearbyFacilities(
      { latitude: details.latitude, longitude: details.longitude },
      sport,
      maxDistanceKm
    );
  };

  /**
   * Move on without a specific play site. `preference` separates a deliberate
   * "any court near me" from "nothing was within the radius", which read very
   * differently when sizing supply in a city.
   */
  const continueWithoutFacility = (
    preference: Extract<FacilityPreference, 'flexible' | 'none_found'>
  ) => {
    setSkippedFacility(true);
    setFacilityPreference(preference);
    setSelectedFacilityId(null);
    setSelectedFacilityName(null);
    setSelectedFacilityCity(null);
    markPreferencesCompleted();
    clearAdvanceTimer();
    setStep('day');
  };

  const selectSport = (option: SportOption) => {
    setSport(option);
    // Level scales differ per sport — clear a rating that isn't on the new scale.
    setRating(prev => (prev && getRatingOptions(option).includes(prev) ? prev : null));
    setError(null);
  };

  const selectFacility = (facility: FacilityDto) => {
    setSelectedFacilityId(facility.id);
    setSelectedFacilityName(facility.name);
    setSelectedFacilityCity(facility.city ?? null);
    setSelectedFacilityTimezone(facility.timezone ?? 'America/Toronto');
    setFacilityAvailabilitySlots([]);
    setSkippedFacility(false);
    setFacilityPreference('specific');
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
    setStep('liquidity');
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
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sport,
          rating,
          matchNature,
          timeSlot,
          locationType,
          postalCode: homePostalCode ?? undefined,
          homeCity: homeCity ?? undefined,
          homeRegion: homeRegion ?? undefined,
          maxDistanceKm,
          facilityId: selectedFacilityId,
          facilityPreference: facilityPreference ?? undefined,
          city: selectedFacilityCity ?? undefined,
          email: trimmedEmail,
          phone: phoneDigits,
          langue,
          sessionId: experiment.sessionId,
          variantValueProp: experiment.variantValueProp,
          variantPriceCents: experiment.variantPriceCents,
          liquidityPlayersShown: liquidity?.playerCount,
          liquidityPctShown: liquidity?.likelihoodPct,
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
        locationType,
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
      {
        amount_cents: plans[selectedPlanTier].amountCents,
        players_shown: liquidity?.playerCount ?? null,
        match_likelihood_pct: liquidity?.likelihoodPct ?? null,
        confidence_shown: liquidity?.confidence ?? null,
      }
    );
    clearRequestContext();
    setStep('reveal');
    setError(null);
  };

  /**
   * The reveal screen already knows which email was captured, so erasing takes
   * one tap here — the /erase page is for people who ask later.
   */
  const handleEraseMyInfo = async () => {
    const normalized = email.trim().toLowerCase();
    if (!validateEmail(normalized)) return;

    setEraseState('deleting');
    try {
      const response = await fetch('/api/lead/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalized }),
      });
      if (!response.ok) throw new Error('delete failed');
      setEraseState('done');
    } catch {
      setEraseState('error');
    }
  };

  const erasePath = langue === 'fr' ? '/fr/erase' : '/erase';

  const switchLanguage = () => {
    const target = langue === 'fr' ? 'en-US' : 'fr-CA';
    // Remember the manual choice so the geo default doesn't override it.
    document.cookie = `slice_lang=${target}; path=/; max-age=31536000; samesite=lax`;
    window.location.assign(target === 'fr-CA' ? '/fr' : '/');
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
      ? locationLabel
        ? t('recap.whereFacility', { facility: selectedFacilityName, address: locationLabel })
        : selectedFacilityName
      : locationLabel
        ? t('recap.whereAddress', { address: locationLabel })
        : null;
    return (
      <div className="smk-panel p-5 text-sm">
        <ul className="flex flex-col gap-2.5">
          {[
            t('recap.sport', { sport: t(`preferences.sports.${sport}`) }),
            t('recap.level', { scale: ratingScaleLabel(sport), rating }),
            t('recap.nature', { nature: t(`preferences.natures.${matchNature}`) }),
            t('recap.when', { time: formatTimeSlotLabel(timeSlot, locale, t) }),
            ...(where ? [where] : []),
          ].map(line => (
            <li key={line} className="flex items-start gap-2.5">
              <span className="smk-pill-dot mt-1.5" aria-hidden />
              <span className="text-[color:var(--smk-ink-soft)]">{line}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  // ---- Steps ----

  if (step === 'intro') {
    const variant = experiment.variantValueProp;
    return (
      <WizardShell step={step} backdrop {...shellProps}>
        <div className="flex flex-col gap-6">
          <span className="smk-pill w-fit">
            <span className="smk-pill-dot" aria-hidden />
            {t(`valueProp.${variant}.badge`)}
          </span>
          <div className="flex flex-col gap-4">
            <h1 className="smk-display text-4xl leading-[1.05] sm:text-5xl md:text-6xl">
              {t(`valueProp.${variant}.headline`)}
            </h1>
            <p className="smk-text-muted text-lg text-balance leading-relaxed sm:text-xl">
              {t(`valueProp.${variant}.subheadline`)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              trackSmokeEvent('value_prop_click', eventContext(experiment));
              setStep('preferences');
            }}
            className="smk-btn mt-2 w-full sm:w-fit"
          >
            {t(`valueProp.${variant}.cta`)}
            <ArrowRight className="h-5 w-5" />
          </button>
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
          <h2 className="smk-display text-3xl sm:text-4xl">{t('preferences.title')}</h2>
          <p className="smk-text-muted">{t('preferences.subtitle')}</p>
        </div>

        {/* Sport */}
        <div className="flex flex-col gap-3">
          <p className="smk-tag">{t('preferences.sportLabel')}</p>
          <div className="grid grid-cols-2 gap-2.5">
            {SPORT_OPTIONS.map(option => (
              <button
                key={option}
                type="button"
                onClick={() => selectSport(option)}
                className={optionClass(sport === option)}
              >
                <span className="smk-title text-lg">{t(`preferences.sports.${option}`)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Level */}
        {sport && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="smk-tag">
                {t('preferences.levelLabel', { scale: ratingScaleLabel(sport) })}
              </p>
              <LevelGuidePopover sport={sport} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {levelOptions.map(option => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setRating(option);
                    setError(null);
                  }}
                  className={chipClass(rating === option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Nature */}
        <div className="flex flex-col gap-3">
          <p className="smk-tag">{t('preferences.natureLabel')}</p>
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
                    <span className="smk-title text-lg">{t(`preferences.natures.${option}`)}</span>
                    <span className="smk-text-muted text-sm">
                      {t(`preferences.natureHints.${option}`)}
                    </span>
                  </span>
                  <ChevronRight className="smk-text-muted h-5 w-5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                </span>
              </button>
            ))}
          </div>
        </div>

        <p className="smk-text-muted text-xs">{t('preferences.singlesNote')}</p>

        <button
          type="button"
          onClick={() => setStep('location')}
          disabled={!canContinue}
          className="smk-btn w-full"
        >
          {t('preferences.continueCta')}
          <ArrowRight className="h-5 w-5" />
        </button>
      </WizardShell>
    );
  }

  if (step === 'location') {
    const isResolvingAddress = isLoadingPredictions || isSearchingFacilities || isResolvingPostal;
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
          <h2 className="smk-display text-3xl sm:text-4xl">{t('location.question')}</h2>
          <p className="smk-text-muted">{t('location.hint')}</p>
          <p className="smk-text-muted text-sm">{t('location.postalCodeHint')}</p>
        </div>

        <div className="relative">
          <input
            value={addressQuery}
            onChange={e => handleAddressQueryChange(e.target.value)}
            placeholder={
              geoCity
                ? t('location.placeholderWithCity', { city: geoCity })
                : t('location.placeholder')
            }
            autoFocus
            className="smk-input"
          />

          {predictions.length > 0 && homeCoordinates === null && (
            <div className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-10 overflow-hidden rounded-2xl border-2 border-[color:var(--smk-ink)] bg-white shadow-[5px_5px_0_var(--smk-ink)]">
              {predictions.map(prediction => (
                <button
                  key={prediction.placeId}
                  type="button"
                  onClick={() => void handleSelectPlace(prediction)}
                  className="flex w-full flex-col gap-0.5 border-b border-[color:var(--smk-line)] px-4 py-3 text-left last:border-b-0 hover:bg-[color:var(--smk-lime-tint)]"
                >
                  <span className="font-medium">{prediction.name}</span>
                  {prediction.address && (
                    <span className="smk-text-muted text-sm">{prediction.address}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {homeCoordinates && (
          <div className="flex flex-col gap-2.5">
            <p className="smk-tag">{t('location.distanceLabel')}</p>
            <div className="grid grid-cols-3 gap-2">
              {DISTANCE_OPTIONS_KM.map(km => (
                <button
                  key={km}
                  type="button"
                  onClick={() => handleSelectDistance(km)}
                  disabled={isSearchingFacilities}
                  className={chipClass(maxDistanceKm === km)}
                >
                  {t('location.distanceOption', { km: String(km) })}
                </button>
              ))}
            </div>
          </div>
        )}

        {isResolvingAddress && (
          <div className="smk-text-muted flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            {isSearchingFacilities ? t('location.searching') : t('location.resolving')}
          </div>
        )}

        {facilitySearchError && !isSearchingFacilities && (
          <p className="smk-text-muted text-sm">{facilitySearchError}</p>
        )}

        {placesError && !isResolvingAddress && (
          <p className="smk-text-error text-sm font-medium">{placesError}</p>
        )}

        {/* Offered even where we have courts mapped: plenty of players just want
            a game near them and don't care which site it lands at. */}
        {homeCoordinates && searchCompleted && !isSearchingFacilities && (
          <button
            type="button"
            onClick={() => continueWithoutFacility('flexible')}
            className={optionClass(false)}
          >
            <span className="flex w-full items-center justify-between gap-3 text-left">
              <span className="flex flex-col gap-1">
                <span className="smk-title text-lg">{t('location.flexibleTitle')}</span>
                <span className="smk-text-muted text-sm">
                  {t('location.flexibleSubtitle', { km: String(maxDistanceKm) })}
                </span>
              </span>
              <ArrowRight className="h-5 w-5 shrink-0" />
            </span>
          </button>
        )}

        {nearbyFacilities.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <p className="smk-tag">{t('location.orPickSite')}</p>
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
                      <span className="smk-title text-lg">{facility.name}</span>
                      {facility.distance_meters != null && (
                        <span className="smk-text-muted shrink-0 text-sm">
                          {formatFacilityDistance(facility.distance_meters, locale)}
                        </span>
                      )}
                    </span>
                    {address && <span className="smk-text-muted text-sm">{address}</span>}
                    <span
                      className={
                        openSlots > 0
                          ? 'smk-text-green text-sm font-semibold'
                          : 'smk-text-muted text-sm'
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

        {homeCoordinates &&
          searchCompleted &&
          !isSearchingFacilities &&
          !facilitySearchError &&
          nearbyFacilities.length === 0 && (
            <div className="flex flex-col gap-3 rounded-2xl border-2 border-dashed border-[color:var(--smk-line-strong)] bg-white/60 p-5">
              <p className="text-sm font-semibold text-[color:var(--smk-ink)]">
                {t('location.noResultsRadius', { km: String(maxDistanceKm) })}
              </p>
              <p className="smk-text-muted text-sm">{t('location.widenHint')}</p>
              <button
                type="button"
                onClick={() => continueWithoutFacility('none_found')}
                className="smk-btn w-full"
              >
                {t('location.continueAnyway')}
                <ArrowRight className="h-5 w-5" />
              </button>
            </div>
          )}

        {error && <p className="smk-text-error text-sm font-medium">{error}</p>}
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
          <h2 className="smk-display text-3xl sm:text-4xl">{t('courts.dayQuestion')}</h2>
          <p className="smk-text-muted">
            {t(selectedFacilityId ? 'courts.dayHint' : 'courts.dayHintNoFacility')}
          </p>
        </div>

        <div className="smk-note">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--smk-lime-deep)]" />
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
                className={optionClass(timeDay === day && selectable)}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="flex flex-col gap-1 text-left">
                    <span className="smk-title text-lg">{getDayLabel(day)}</span>
                    {selectedFacilityId && (
                      <span
                        className={
                          openCount > 0
                            ? 'smk-text-green text-sm font-semibold'
                            : 'smk-text-muted text-sm'
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
                    <ChevronRight className="smk-text-muted h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100" />
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
          <h2 className="smk-display text-3xl sm:text-4xl">{t('courts.timeQuestion')}</h2>
          <p className="smk-text-muted">
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

        {error && <p className="smk-text-error text-sm font-medium">{error}</p>}
      </WizardShell>
    );
  }

  if (step === 'liquidity' && liquidity && sport && rating) {
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
          <span className="smk-pill w-fit">
            <span className="smk-pill-dot" aria-hidden />
            {t('liquidity.badge')}
          </span>
          <h2 className="smk-display text-3xl sm:text-4xl">
            {t('liquidity.title', { count: liquidity.playerCount })}
          </h2>
          <p className="smk-text-muted">
            {t('liquidity.subtitle', {
              scale: ratingScaleLabel(sport),
              rating,
              km: String(maxDistanceKm),
            })}
          </p>
        </div>

        <div className="smk-panel flex flex-col gap-2 p-5">
          <span className="flex items-center gap-2 text-base font-semibold text-[color:var(--smk-ink)]">
            <Users className="h-4 w-4 shrink-0 text-[color:var(--smk-lime-deep)]" />
            {t(`liquidity.confidence.${liquidity.confidence}`)}
          </span>
          <p className="smk-text-muted text-sm">{t('liquidity.hint')}</p>
        </div>

        <button
          type="button"
          onClick={() => {
            setError(null);
            setStep('contact');
          }}
          className="smk-btn w-full"
        >
          {t('liquidity.continueCta')}
          <ArrowRight className="h-5 w-5" />
        </button>
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
          setStep(liquidity ? 'liquidity' : timeDay ? 'time' : 'day');
        }}
        {...shellProps}
      >
        <div className="flex flex-col gap-3">
          <span className="smk-pill w-fit">
            <span className="smk-pill-dot" aria-hidden />
            {t('contact.badge')}
          </span>
          <h2 className="smk-display text-3xl sm:text-4xl">{t('contact.title')}</h2>
          <p className="smk-text-muted">{t('contact.subtitle')}</p>
        </div>

        <div className="flex flex-col gap-3">
          <input
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
            className="smk-input"
          />
          <input
            value={phoneDigits}
            onChange={e => {
              setPhoneDigits(formatPhoneInput(e.target.value));
              setError(null);
            }}
            placeholder={t('contact.phonePlaceholder')}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            className="smk-input"
          />
        </div>

        {error && <p className="smk-text-error text-sm font-medium">{error}</p>}

        <button
          type="button"
          onClick={handleSubmitContact}
          disabled={isSubmitting || !emailValid || !phoneValid}
          className="smk-btn w-full"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              {t('contact.submitting')}
            </>
          ) : (
            <>
              {t('contact.continueCta')}
              <ArrowRight className="h-5 w-5" />
            </>
          )}
        </button>
        <p className="smk-text-muted flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-center text-xs">
          <Lock className="h-3 w-3 shrink-0" />
          <span>{t('contact.privacyNote')}</span>
          <a
            href={erasePath}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold underline underline-offset-2 transition-colors hover:text-[color:var(--smk-ink)]"
          >
            {t('contact.eraseLink')}
          </a>
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
          <h2 className="smk-display text-3xl sm:text-4xl">{t('recap.title')}</h2>
          <p className="smk-text-muted">{t('recap.subtitle')}</p>
        </div>

        {renderRecapSummary()}

        <ul className="flex flex-col gap-4">
          {(
            [
              [Users, t('recap.point1')],
              [MessageSquare, t('recap.point2')],
              [CalendarClock, t('recap.point3')],
              [ShieldCheck, t('recap.point4')],
            ] as const
          ).map(([IconComponent, text]) => (
            <li key={text} className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-[color:var(--smk-ink)] bg-[var(--smk-lime)]">
                <IconComponent className="h-4 w-4 text-[color:var(--smk-ink)]" />
              </span>
              <span className="pt-1.5 text-sm text-[color:var(--smk-ink-soft)]">{text}</span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => {
            setError(null);
            setStep('plan');
          }}
          className="smk-btn w-full"
        >
          {t('recap.continueCta')}
          <ArrowRight className="h-5 w-5" />
        </button>
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
          <h2 className="smk-display text-3xl sm:text-4xl">{t('plans.title')}</h2>
          <p className="smk-text-muted">{t('plans.subtitle')}</p>
          {liquidity && (
            <span className="smk-pill w-fit">
              <Users className="h-3.5 w-3.5 shrink-0" />
              {t('plans.liquidityChip', {
                count: liquidity.playerCount,
                confidence: t(`plans.confidence.${liquidity.confidence}`),
              })}
            </span>
          )}
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
                <span className="smk-title text-lg">{t('plans.single.title')}</span>
                <span className="smk-display text-3xl">
                  {formatMatchPlanPrice(plans.single.amountCents, locale)}
                </span>
                <span className="smk-text-muted text-sm">{t('plans.single.description')}</span>
              </span>
              <ChevronRight
                className={`mt-1 h-5 w-5 shrink-0 ${
                  selectedPlanTier === 'single'
                    ? 'text-[color:var(--smk-ink)]'
                    : 'text-[color:var(--smk-muted)]'
                }`}
              />
            </span>
          </button>

          {/* Unlimited — one plan, choose how you pay */}
          <div
            className={`rounded-[1.25rem] border-2 p-5 transition-all duration-200 ${
              unlimitedSelected
                ? 'border-[color:var(--smk-ink)] bg-[color:var(--smk-lime-tint)] shadow-[4px_4px_0_var(--smk-ink)]'
                : 'border-[color:var(--smk-line)] bg-white'
            }`}
          >
            <div className="flex flex-col gap-1 text-left">
              <span className="smk-title text-lg">{t('plans.unlimited.title')}</span>
              <span className="smk-text-muted text-sm">{t('plans.unlimited.description')}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {(['weekly', 'monthly'] as const).map(tier => {
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
                    className={`${chipClass(selectedPlanTier === tier)} h-auto flex-col gap-0.5 px-3 py-2.5`}
                  >
                    <span className="text-sm">{t(`plans.billing.${tier}`)}</span>
                    <span className="text-base font-bold">{price}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="smk-note">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--smk-lime-deep)]" />
          <span>{t('plans.bookingExcluded')}</span>
        </div>

        <div className="smk-note">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--smk-lime-deep)]" />
          <span>{t('plans.refundNote')}</span>
        </div>

        {error && <p className="smk-text-error text-sm font-medium">{error}</p>}

        <button
          type="button"
          onClick={handlePaymentIntent}
          disabled={!selectedPlanTier}
          className="smk-btn w-full"
        >
          {t('plans.proceedCta')}
          <ArrowRight className="h-5 w-5" />
        </button>
      </WizardShell>
    );
  }

  if (step === 'reveal') {
    return (
      <WizardShell step={step} {...shellProps}>
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-[color:var(--smk-ink)] bg-[var(--smk-lime)] shadow-[4px_4px_0_var(--smk-ink)]">
            <Sparkles className="h-9 w-9 text-[color:var(--smk-ink)]" />
          </div>
          <span className="smk-pill">
            <span className="smk-pill-dot" aria-hidden />
            {t('reveal.badge')}
          </span>
          <div className="flex flex-col gap-3">
            <h2 className="smk-display text-3xl sm:text-4xl">{t('reveal.headline')}</h2>
            <p className="smk-text-muted">{t('reveal.message')}</p>
            <p className="smk-text-muted">{t('reveal.simulatedNote')}</p>
            <p className="text-sm font-semibold text-[color:var(--smk-ink)]">
              {t('reveal.thanks')}
            </p>
            <p className="smk-text-muted text-sm">{t('reveal.purpose')}</p>
          </div>

          <div className="flex w-full flex-col items-center gap-2 border-t border-[color:var(--smk-line-strong)] pt-6">
            {eraseState === 'done' ? (
              <p className="text-sm font-semibold text-[color:var(--smk-ink)]">
                {t('reveal.eraseDone')}
              </p>
            ) : (
              <>
                <p className="smk-text-muted text-sm">{t('reveal.eraseIntro')}</p>
                <button
                  type="button"
                  onClick={handleEraseMyInfo}
                  disabled={eraseState === 'deleting'}
                  className="smk-text-muted inline-flex items-center gap-1.5 text-sm font-semibold underline underline-offset-4 transition-colors hover:text-[color:var(--smk-ink)] disabled:opacity-60"
                >
                  {eraseState === 'deleting' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('reveal.eraseDeleting')}
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4" />
                      {t('reveal.eraseCta')}
                    </>
                  )}
                </button>
                {eraseState === 'error' && (
                  <p className="smk-text-error text-sm font-medium">{t('reveal.eraseError')}</p>
                )}
              </>
            )}
          </div>
        </div>
      </WizardShell>
    );
  }

  return null;
}

interface TimePickerProps {
  timeDay: TimeDayOption;
  locale: string;
  timezone: string;
  availabilitySlots: AvailabilitySlotDto[];
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
        <div className="smk-note flex-wrap gap-x-4 gap-y-2">
          {(['high', 'medium', 'low', 'none'] as const).map(tier => (
            <span key={tier} className="smk-text-muted inline-flex items-center gap-2 text-xs">
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
          <p className="smk-tag mb-2.5">{tw(`periods.${group.id}`)}</p>
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
