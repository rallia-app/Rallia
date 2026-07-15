import {
  SMOKE_TEST_ID,
  pickMonthlyPriceVariant,
  pickValuePropVariant,
  isValidMonthlyPrice,
  type LocationOption,
  type MatchNatureOption,
  type MonthlyPriceVariant,
  type RatingOption,
  type SportOption,
  type ValuePropVariant,
} from './constants';

// ---- Experiment assignment (stable for the whole browser session) ----

const EXPERIMENT_KEY = 'rallia_smoke_experiment';

export interface SmokeExperiment {
  sessionId: string;
  testId: string;
  variantValueProp: ValuePropVariant;
  variantPriceCents: MonthlyPriceVariant;
}

function randomSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `sess_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * Reads the session's experiment assignment, creating (and persisting) it on
 * first call. Both A/B factors are drawn once and stay fixed for the session so
 * the visitor sees a single value-prop variant and a single monthly price.
 */
export function getOrCreateExperiment(): SmokeExperiment {
  if (typeof window === 'undefined') {
    return {
      sessionId: 'ssr',
      testId: SMOKE_TEST_ID,
      variantValueProp: 'A',
      variantPriceCents: 999,
    };
  }

  try {
    const raw = sessionStorage.getItem(EXPERIMENT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SmokeExperiment>;
      if (
        parsed.sessionId &&
        (parsed.variantValueProp === 'A' || parsed.variantValueProp === 'B') &&
        isValidMonthlyPrice(parsed.variantPriceCents)
      ) {
        return {
          sessionId: parsed.sessionId,
          testId: SMOKE_TEST_ID,
          variantValueProp: parsed.variantValueProp,
          variantPriceCents: parsed.variantPriceCents,
        };
      }
    }
  } catch {
    // fall through to a fresh assignment
  }

  const experiment: SmokeExperiment = {
    sessionId: randomSessionId(),
    testId: SMOKE_TEST_ID,
    variantValueProp: pickValuePropVariant(),
    variantPriceCents: pickMonthlyPriceVariant(),
  };
  try {
    sessionStorage.setItem(EXPERIMENT_KEY, JSON.stringify(experiment));
  } catch {
    // sessionStorage unavailable (private mode) — still return the assignment
  }
  return experiment;
}

// ---- Request context (the visitor's choices so far) ----

export const MATCH_SMOKE_SESSION_KEY = 'rallia_match_smoke_request';

export interface MatchSmokeRequestContext {
  sport: SportOption;
  rating: RatingOption;
  matchNature: MatchNatureOption;
  timeSlot: string;
  locationType: LocationOption;
  facilityId?: string;
  facilityName?: string;
  city?: string;
}

export function persistRequestContext(context: MatchSmokeRequestContext): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(MATCH_SMOKE_SESSION_KEY, JSON.stringify(context));
}

export function readRequestContext(): MatchSmokeRequestContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(MATCH_SMOKE_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MatchSmokeRequestContext;
  } catch {
    return null;
  }
}

export function clearRequestContext(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(MATCH_SMOKE_SESSION_KEY);
}
