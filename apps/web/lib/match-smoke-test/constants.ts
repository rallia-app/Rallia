export const MATCH_SMOKE_TEST_CURRENCY = 'CAD';

/** Stable identifier for this willingness-to-pay experiment (attached to every event). */
export const SMOKE_TEST_ID = 'wtp_smoke_v2_2026';

// ---- Sport ----

export const SPORT_OPTIONS = ['tennis', 'pickleball'] as const;
export type SportOption = (typeof SPORT_OPTIONS)[number];

// ---- Level (NTRP for tennis, DUPR for pickleball) ----

export const NTRP_OPTIONS = [
  '1.0',
  '1.5',
  '2.0',
  '2.5',
  '3.0',
  '3.5',
  '4.0',
  '4.5',
  '5.0',
  '5.5',
  '6.0',
  '6.5',
] as const;

export const DUPR_OPTIONS = [
  '2.0',
  '2.5',
  '3.0',
  '3.5',
  '4.0',
  '4.5',
  '5.0',
  '5.5',
  '6.0',
  '6.5',
  '7.0',
  '8.0',
] as const;

/** A rating is just the numeric string on either scale. */
export type RatingOption = string;

export const DEFAULT_RATING: RatingOption = '4.0';

export function getRatingOptions(sport: SportOption): readonly string[] {
  return sport === 'pickleball' ? DUPR_OPTIONS : NTRP_OPTIONS;
}

/** Union of both scales — used for server-side validation. */
export const ALL_RATING_OPTIONS: readonly string[] = Array.from(
  new Set<string>([...NTRP_OPTIONS, ...DUPR_OPTIONS])
);

export function ratingScaleLabel(sport: SportOption): 'NTRP' | 'DUPR' {
  return sport === 'pickleball' ? 'DUPR' : 'NTRP';
}

// ---- Match shape ----
// Singles only (no doubles) per the brief; format is kept for schema continuity.

export const MATCH_FORMAT_OPTIONS = ['singles'] as const;
export type MatchFormatOption = (typeof MATCH_FORMAT_OPTIONS)[number];
export const DEFAULT_MATCH_FORMAT: MatchFormatOption = 'singles';

export const MATCH_NATURE_OPTIONS = ['recreational', 'competitive'] as const;
export type MatchNatureOption = (typeof MATCH_NATURE_OPTIONS)[number];

export const LOCATION_OPTIONS = ['address'] as const;
export type LocationOption = (typeof LOCATION_OPTIONS)[number];

export { FLEXIBLE_TIME_SLOT } from './time-selection';
export type { TimeDayOption } from './time-selection';

// ---- Value-proposition A/B (F1) ----

export const VALUE_PROP_VARIANTS = ['A', 'B'] as const;
export type ValuePropVariant = (typeof VALUE_PROP_VARIANTS)[number];

// ---- Pricing (three options; monthly price is the A/B factor F2) ----

export const MATCH_PLAN_TIERS = ['single', 'weekly', 'monthly'] as const;
export type MatchPlanTier = (typeof MATCH_PLAN_TIERS)[number];

/** Randomized monthly price in cents — fixed per session. */
export const MONTHLY_PRICE_VARIANTS = [699, 999, 1299] as const;
export type MonthlyPriceVariant = (typeof MONTHLY_PRICE_VARIANTS)[number];

export const SINGLE_PRICE_CENTS = 199;
export const WEEKLY_PRICE_CENTS = 499;

export interface MatchPlanConfig {
  tier: MatchPlanTier;
  amountCents: number;
  /** Recurrence hint for copy: one-off | weekly | monthly. */
  recurrence: 'once' | 'week' | 'month';
}

export function getMatchPlans(monthlyPriceCents: number): Record<MatchPlanTier, MatchPlanConfig> {
  return {
    single: { tier: 'single', amountCents: SINGLE_PRICE_CENTS, recurrence: 'once' },
    weekly: { tier: 'weekly', amountCents: WEEKLY_PRICE_CENTS, recurrence: 'week' },
    monthly: { tier: 'monthly', amountCents: monthlyPriceCents, recurrence: 'month' },
  };
}

export function getMatchPlan(tier: MatchPlanTier, monthlyPriceCents: number): MatchPlanConfig {
  return getMatchPlans(monthlyPriceCents)[tier];
}

export function isValidMonthlyPrice(value: unknown): value is MonthlyPriceVariant {
  return typeof value === 'number' && (MONTHLY_PRICE_VARIANTS as readonly number[]).includes(value);
}

export function formatMatchPlanPrice(
  amountCents: number,
  locale = 'en-CA',
  currency: string = MATCH_SMOKE_TEST_CURRENCY
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountCents / 100);
}

// ---- Random A/B assignment (browser-side, once per session) ----

export function pickValuePropVariant(): ValuePropVariant {
  return Math.random() < 0.5 ? 'A' : 'B';
}

export function pickMonthlyPriceVariant(): MonthlyPriceVariant {
  const index = Math.floor(Math.random() * MONTHLY_PRICE_VARIANTS.length);
  return MONTHLY_PRICE_VARIANTS[index] ?? MONTHLY_PRICE_VARIANTS[0];
}
