export const MATCH_SMOKE_TEST_CURRENCY = 'CAD';

/**
 * Stable identifier for this willingness-to-pay run (attached to every event).
 *
 * Deliberately distinct from the earlier `wtp_smoke_v2_2026` run hosted inside
 * the main web app. That run only recorded visitors who accepted a cookie
 * banner and never delivered a single `page_view`; this one records everyone
 * and has a working top-of-funnel. Mixing them in one bucket would compare
 * numbers produced under different rules.
 */
export const SMOKE_TEST_ID = 'wtp_smoke_v3_slice_2026';

/**
 * Funnel revision, carried on every event. v3.1 added the simulated liquidity
 * signal before the contact ask, which lifts every downstream conversion —
 * pre/post cohorts must never be pooled, so analysis filters on this.
 */
export const FUNNEL_VERSION = 'v3.1_liquidity';

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

// Step 2 takes a full address or just a postal code — visitors who don't want to
// hand over a street address can still be placed on the map.
export const LOCATION_OPTIONS = ['address', 'postal_code'] as const;
export type LocationOption = (typeof LOCATION_OPTIONS)[number];

// ---- Play-site preference ----
// 'specific' picked a facility; 'flexible' deliberately skipped one; 'none_found'
// had no facility within the radius. Separating the last two keeps "no supply
// here" out of the "prefers to stay flexible" bucket.
export const FACILITY_PREFERENCE_OPTIONS = ['specific', 'flexible', 'none_found'] as const;
export type FacilityPreference = (typeof FACILITY_PREFERENCE_OPTIONS)[number];

export const DEFAULT_MAX_DISTANCE_KM = 25;
export const DISTANCE_OPTIONS_KM = [10, 25, 50] as const;

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

function randomFraction(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return (buffer[0] ?? 0) / 2 ** 32;
}

export function pickValuePropVariant(): ValuePropVariant {
  return randomFraction() < 0.5 ? 'A' : 'B';
}

export function pickMonthlyPriceVariant(): MonthlyPriceVariant {
  const index = Math.floor(randomFraction() * MONTHLY_PRICE_VARIANTS.length);
  return MONTHLY_PRICE_VARIANTS[index] ?? MONTHLY_PRICE_VARIANTS[0];
}
