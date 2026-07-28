import { NextRequest, NextResponse } from 'next/server';

import { DISTANCE_OPTIONS_KM, SPORT_OPTIONS, type SportOption } from '@/lib/constants';
import { getAnonClient } from '@/lib/supabase';
import type { AvailabilitySlotDto, FacilityDto } from '@/lib/types';

export const runtime = 'nodejs';

const FACILITY_SEARCH_LIMIT = 15;

const sportIdCache = new Map<SportOption, string>();

async function getSportId(sport: SportOption): Promise<string> {
  const cached = sportIdCache.get(sport);
  if (cached) return cached;

  const { data, error } = await getAnonClient()
    .from('sport')
    .select('id')
    .eq('slug', sport)
    .single<{ id: string }>();

  if (error || !data?.id) throw new Error(`Failed to resolve ${sport} sport`);

  sportIdCache.set(sport, data.id);
  return data.id;
}

interface NearbyFacilityRow {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  timezone: string | null;
  distance_meters: number | null;
  availability_slots: { slot_start: string; slot_end: string }[] | null;
}

/**
 * Runs the facility search server-side so the browser never talks to the
 * database directly, and maps the row down to only what the funnel renders.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      sport?: unknown;
      latitude?: unknown;
      longitude?: unknown;
      maxDistanceKm?: unknown;
    };

    const sport = body.sport;
    if (typeof sport !== 'string' || !SPORT_OPTIONS.includes(sport as SportOption)) {
      return NextResponse.json({ error: 'Invalid sport.' }, { status: 400 });
    }

    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return NextResponse.json({ error: 'Invalid coordinates.' }, { status: 400 });
    }

    const maxDistanceKm = Number(body.maxDistanceKm);
    if (!(DISTANCE_OPTIONS_KM as readonly number[]).includes(maxDistanceKm)) {
      return NextResponse.json({ error: 'Invalid distance.' }, { status: 400 });
    }

    const sportId = await getSportId(sport as SportOption);

    const { data, error } = await getAnonClient().rpc('search_facilities_nearby', {
      p_sport_ids: [sportId],
      p_latitude: latitude,
      p_longitude: longitude,
      p_search_query: null,
      p_max_distance_km: maxDistanceKm,
      p_facility_types: null,
      p_surface_types: null,
      p_court_types: null,
      p_has_lighting: null,
      p_membership_required: null,
      p_has_availabilities: null,
      p_limit: FACILITY_SEARCH_LIMIT,
      p_offset: 0,
      p_user_gender: null,
      p_player_id: null,
      p_favorites_only: null,
      p_organization_nature: null,
      p_has_open_slots: null,
      p_slot_date: null,
      p_min_hour: null,
      p_max_hour: null,
    });

    if (error) {
      console.error('Facility search failed:', error);
      return NextResponse.json({ error: 'Facility search failed.' }, { status: 500 });
    }

    const facilities: FacilityDto[] = ((data ?? []) as NearbyFacilityRow[]).map(row => ({
      id: row.id,
      name: row.name,
      city: row.city,
      address: row.address,
      timezone: row.timezone,
      distance_meters: row.distance_meters,
      availability_slots: (row.availability_slots ?? null) as AvailabilitySlotDto[] | null,
    }));

    return NextResponse.json({ facilities });
  } catch (error) {
    console.error('Facility search error:', error);
    return NextResponse.json({ error: 'Facility search failed.' }, { status: 500 });
  }
}
