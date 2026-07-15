import { searchFacilitiesNearby } from '@rallia/shared-services';
import type { FacilitySearchResult } from '@rallia/shared-types';

import type { SportOption } from './constants';

import { createClient } from '@/lib/supabase/client';

const DEFAULT_MAX_DISTANCE_KM = 25;
const FACILITY_SEARCH_LIMIT = 15;

const sportIdCache = new Map<SportOption, string>();

export async function getSportId(sport: SportOption): Promise<string> {
  const cached = sportIdCache.get(sport);
  if (cached) return cached;

  const supabase = createClient();
  const { data, error } = await supabase.from('sport').select('id').eq('slug', sport).single();
  if (error || !data?.id) {
    throw new Error(`Failed to resolve ${sport} sport`);
  }

  sportIdCache.set(sport, data.id);
  return data.id;
}

/** Future open snapshot rows returned inline by search_facilities_nearby. */
export function countFutureOpenAvailabilities(facility: FacilitySearchResult): number {
  return facility.availability_slots?.length ?? 0;
}

export function formatFacilityDistance(meters: number | null, locale: string): string {
  if (meters == null) return '';

  if (meters < 1000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(meters)} m`;
  }

  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(meters / 1000)} km`;
}

export async function searchFacilitiesNearCoordinates(params: {
  sport: SportOption;
  latitude: number;
  longitude: number;
}): Promise<FacilitySearchResult[]> {
  const sportId = await getSportId(params.sport);
  const page = await searchFacilitiesNearby({
    sportIds: [sportId],
    latitude: params.latitude,
    longitude: params.longitude,
    maxDistanceKm: DEFAULT_MAX_DISTANCE_KM,
    limit: FACILITY_SEARCH_LIMIT,
    offset: 0,
  });

  return page.facilities;
}
