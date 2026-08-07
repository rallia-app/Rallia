import type { DateRangeFilter, SpotsAvailableFilter } from '@rallia/shared-types';

export type RecoveryFilters = {
  ratingScoreId?: string;
  distanceKm?: number;
  dateRange?: DateRangeFilter;
  spotsAvailable?: SpotsAvailableFilter;
};

const ALLOWED_DISTANCES = [2, 5, 10];

/**
 * Reads the filters the unfilled-recovery push counted its games with.
 *
 * The count in the message and the list the tap opens have to be the same set,
 * so the sweep sends the filters it used rather than the client guessing them.
 * Anything missing or out of range is dropped instead of substituted: a wrong
 * filter would show a different set than the number promised, which is worse
 * than showing an unfiltered list.
 */
export function buildRecoveryFilters(
  payload: Record<string, unknown> | null | undefined
): RecoveryFilters | undefined {
  if (!payload) return undefined;

  const filters: RecoveryFilters = {};

  if (typeof payload.ratingScoreId === 'string' && payload.ratingScoreId) {
    filters.ratingScoreId = payload.ratingScoreId;
  }

  const distance = Number(payload.distanceKm);
  if (ALLOWED_DISTANCES.includes(distance)) {
    filters.distanceKm = distance;
  }

  if (payload.dateRange === 'week') {
    filters.dateRange = 'week';
  }

  if (Object.keys(filters).length === 0) return undefined;

  // Constant for this notification rather than a payload field: the sweep never
  // counts a full game, so the list must never show one. Sending it would just
  // be a round trip for a value that cannot vary.
  filters.spotsAvailable = 'any';

  return filters;
}
