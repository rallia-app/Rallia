import type {
  LocationOption,
  MatchFormatOption,
  MatchNatureOption,
  MatchPlanTier,
  RatingOption,
} from './constants';

export const MATCH_SMOKE_SESSION_KEY = 'rallia_match_smoke_request';

export interface MatchSmokeRequestContext {
  rating: RatingOption;
  matchFormat: MatchFormatOption;
  matchNature: MatchNatureOption;
  timeSlot: string;
  locationType: LocationOption;
  facilityId?: string;
  facilityName?: string;
  planTier: MatchPlanTier;
  paymentIntentId?: string;
  amountCents: number;
  credits: number | null;
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
