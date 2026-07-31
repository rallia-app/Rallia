import {
  SMOKE_TEST_ID,
  pickValuePropVariant,
  type LocationOption,
  type MatchNatureOption,
  type RatingOption,
  type SportOption,
  type ValuePropVariant,
} from './constants';

// ---- Experiment assignment (stable for the whole browser session) ----

const EXPERIMENT_KEY = 'slice_experiment';

export interface SmokeExperiment {
  sessionId: string;
  testId: string;
  variantValueProp: ValuePropVariant;
}

// Only reached from the browser branch below, so `crypto` is always present.
function randomSessionId(): string {
  // randomUUID needs a secure context; getRandomValues does not.
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `sess_${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Reads the session's experiment assignment, creating (and persisting) it on
 * first call. The value-prop variant is drawn once and stays fixed for the
 * session. (Pricing is fixed since v3.2 — entries persisted by the price-A/B
 * build carry an extra variantPriceCents field, which is simply ignored.)
 */
export function getOrCreateExperiment(): SmokeExperiment {
  if (typeof window === 'undefined') {
    return {
      sessionId: 'ssr',
      testId: SMOKE_TEST_ID,
      variantValueProp: 'A',
    };
  }

  try {
    const raw = sessionStorage.getItem(EXPERIMENT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SmokeExperiment>;
      if (
        parsed.sessionId &&
        (parsed.variantValueProp === 'A' || parsed.variantValueProp === 'B')
      ) {
        return {
          sessionId: parsed.sessionId,
          testId: SMOKE_TEST_ID,
          variantValueProp: parsed.variantValueProp,
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
  };
  try {
    sessionStorage.setItem(EXPERIMENT_KEY, JSON.stringify(experiment));
  } catch {
    // sessionStorage unavailable (private mode) — still return the assignment
  }
  return experiment;
}

// ---- Request context (the visitor's choices so far) ----

export const MATCH_SMOKE_SESSION_KEY = 'slice_request';

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
