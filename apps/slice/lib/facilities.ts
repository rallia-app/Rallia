import { DEFAULT_MAX_DISTANCE_KM, type SportOption } from './constants';
import type { FacilityDto } from './types';

export { DEFAULT_MAX_DISTANCE_KM, DISTANCE_OPTIONS_KM } from './constants';

/** Future open snapshot rows returned inline by the search route. */
export function countFutureOpenAvailabilities(facility: FacilityDto): number {
  return facility.availability_slots?.length ?? 0;
}

export function formatFacilityDistance(meters: number | null, locale: string): string {
  if (meters == null) return '';

  if (meters < 1000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(meters)} m`;
  }

  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(meters / 1000)} km`;
}

/** Goes through our own origin so the browser never contacts the database. */
export async function searchFacilitiesNearCoordinates(params: {
  sport: SportOption;
  latitude: number;
  longitude: number;
  maxDistanceKm?: number;
}): Promise<FacilityDto[]> {
  const response = await fetch('/api/facilities/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sport: params.sport,
      latitude: params.latitude,
      longitude: params.longitude,
      maxDistanceKm: params.maxDistanceKm ?? DEFAULT_MAX_DISTANCE_KM,
    }),
  });

  if (!response.ok) throw new Error('Facility search failed');

  const data = (await response.json()) as { facilities?: FacilityDto[] };
  return data.facilities ?? [];
}
