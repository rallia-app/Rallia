/**
 * "For you" Filter Preset
 *
 * The canonical definition of "the most relevant games for this player",
 * expressed as regular public-match filters so it stays server-side,
 * paginable, and transparent in the filter bar. Mirrors the profile facts
 * the relevance scorer (`scoreNearbyMatch`) weighs heaviest: exact rating,
 * joinability, and location (travel range OR favorite facility).
 */

import type { DistanceFilter, SpotsAvailableFilter, RatingFilter } from '@rallia/shared-types';
import { DEFAULT_DISTANCE, type PublicMatchFilters } from './usePublicMatchFilters';

export interface ForYouPresetInputs {
  /** Player's rating score ID for the selected sport (exact match, never a band) */
  playerRatingScoreId?: string | null;
  /** Player's max travel distance preference in km */
  maxTravelDistanceKm?: number | null;
}

export interface ForYouPreset {
  rating: RatingFilter;
  /**
   * Always the unfiltered default: location is an OR (travel range OR
   * favorite facility) the server-side distance filter can't express, so the
   * preset clears it and callers apply `matchesForYouLocation` client-side.
   */
  distance: DistanceFilter;
  spotsAvailable: SpotsAvailableFilter;
  /**
   * False when the profile carries neither a rating nor a travel range — the
   * preset would barely narrow the feed, so callers hide the control.
   */
  isMeaningful: boolean;
}

export function buildForYouPreset(inputs: ForYouPresetInputs): ForYouPreset {
  const { playerRatingScoreId, maxTravelDistanceKm } = inputs;

  const rating: RatingFilter = playerRatingScoreId ? [playerRatingScoreId] : [];
  const hasTravelRange = maxTravelDistanceKm != null && maxTravelDistanceKm > 0;

  return {
    rating,
    distance: DEFAULT_DISTANCE,
    spotsAvailable: 'any',
    isMeaningful: rating.length > 0 || hasTravelRange,
  };
}

export interface ForYouLocationInputs {
  maxTravelDistanceKm?: number | null;
  favoriteFacilityIds?: string[];
}

/**
 * Location rule for the "For you" feed: within the player's travel range OR
 * at one of their favorite facilities. Lenient on missing data — a match is
 * only dropped when it is known to violate both arms.
 */
export function matchesForYouLocation(
  match: { distance_meters?: number | null; facility_id?: string | null },
  inputs: ForYouLocationInputs
): boolean {
  const { maxTravelDistanceKm, favoriteFacilityIds } = inputs;
  if (match.facility_id && favoriteFacilityIds?.includes(match.facility_id)) return true;
  if (maxTravelDistanceKm == null || maxTravelDistanceKm <= 0) return true;
  if (match.distance_meters == null) return true;
  return match.distance_meters <= maxTravelDistanceKm * 1000;
}

/**
 * Whether the current filter state matches the preset exactly. Derived, never
 * stored: hand-tweaking any preset dimension turns the toggle off on its own.
 * A non-meaningful preset is never considered active, so setting a single
 * overlapping filter by hand can't light the control up.
 */
export function isForYouPresetActive(
  filters: Pick<PublicMatchFilters, 'rating' | 'distance' | 'spotsAvailable'>,
  preset: ForYouPreset
): boolean {
  return (
    preset.isMeaningful &&
    filters.spotsAvailable === preset.spotsAvailable &&
    filters.distance === preset.distance &&
    filters.rating.length === preset.rating.length &&
    preset.rating.every(id => filters.rating.includes(id))
  );
}
