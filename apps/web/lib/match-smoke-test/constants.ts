export const MATCH_SMOKE_TEST_CURRENCY = 'CAD';

export const RATING_OPTIONS = [
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
export type RatingOption = (typeof RATING_OPTIONS)[number];

export const MATCH_FORMAT_OPTIONS = ['singles', 'doubles'] as const;
export type MatchFormatOption = (typeof MATCH_FORMAT_OPTIONS)[number];

export const MATCH_NATURE_OPTIONS = ['casual', 'competitive'] as const;
export type MatchNatureOption = (typeof MATCH_NATURE_OPTIONS)[number];

export const LOCATION_OPTIONS = ['address'] as const;
export type LocationOption = (typeof LOCATION_OPTIONS)[number];

export { FLEXIBLE_TIME_SLOT } from './time-selection';
export type { TimeDayOption } from './time-selection';

export const MATCH_PLAN_TIERS = ['single', 'pack_3', 'sub_monthly'] as const;
export type MatchPlanTier = (typeof MATCH_PLAN_TIERS)[number];

export interface MatchPlanConfig {
  tier: MatchPlanTier;
  credits: number | null;
  amountCents: number;
  purchasable: boolean;
}

export const MATCH_PLANS: Record<MatchPlanTier, MatchPlanConfig> = {
  single: { tier: 'single', credits: 1, amountCents: 199, purchasable: true },
  pack_3: { tier: 'pack_3', credits: 3, amountCents: 299, purchasable: true },
  sub_monthly: { tier: 'sub_monthly', credits: null, amountCents: 499, purchasable: false },
};

export const PURCHASABLE_PLAN_TIERS = MATCH_PLAN_TIERS.filter(
  tier => MATCH_PLANS[tier].purchasable
);

export function getMatchPlan(tier: MatchPlanTier): MatchPlanConfig {
  return MATCH_PLANS[tier];
}

export function formatMatchPlanPrice(
  amountCents: number,
  currency: string = MATCH_SMOKE_TEST_CURRENCY
): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountCents / 100);
}
