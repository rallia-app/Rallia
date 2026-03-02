/**
 * Facility Service
 * Handles all facility-related database operations using Supabase.
 */

import { supabase } from '../supabase';
import type {
  FacilitySearchResult,
  FacilitiesPage,
  Facility,
  FacilityContact,
  FacilityImage,
  Court,
} from '@rallia/shared-types';

const DEFAULT_PAGE_SIZE = 20;

// Filter types for facility search
export type FacilityTypeFilter =
  | 'park'
  | 'club'
  | 'indoor_center'
  | 'private'
  | 'other'
  | 'community_club'
  | 'municipal'
  | 'university'
  | 'school'
  | 'community_center';

export type SurfaceTypeFilter =
  | 'hard'
  | 'clay'
  | 'grass'
  | 'synthetic'
  | 'carpet'
  | 'concrete'
  | 'asphalt';

export type CourtTypeFilter = 'indoor' | 'outdoor';

export type LightingFilter = 'all' | 'with_lights' | 'no_lights';

export type MembershipFilter = 'all' | 'public' | 'members_only';

export interface SearchFacilitiesParams {
  sportIds: string[];
  latitude: number;
  longitude: number;
  searchQuery?: string;
  /** Maximum distance in kilometers */
  maxDistanceKm?: number;
  /** Filter by facility types */
  facilityTypes?: FacilityTypeFilter[];
  /** Filter by court surface types */
  surfaceTypes?: SurfaceTypeFilter[];
  /** Filter by court types (indoor/outdoor) */
  courtTypes?: CourtTypeFilter[];
  /** Filter by court lighting (true = has lights, false = no lights) */
  hasLighting?: boolean;
  /** Filter by membership requirement (true = members only, false = public) */
  membershipRequired?: boolean;
  limit?: number;
  offset?: number;
}

export interface GetFacilityByIdParams {
  facilityId: string;
  sportId: string;
  latitude?: number;
  longitude?: number;
}

export interface GetFacilityWithDetailsParams {
  facilityId: string;
  sportId: string;
  latitude?: number;
  longitude?: number;
}

export interface FacilityWithDetails extends FacilitySearchResult {
  /** Full facility record */
  facilityData: Facility;
  /** Courts that support the selected sport */
  courts: Court[];
  /** Facility contacts (general and reservation) */
  contacts: FacilityContact[];
  /** Whether the organization can accept payments (Stripe charges_enabled) */
  paymentsEnabled: boolean;
  /** Facility images ordered by display_order */
  images?: FacilityImage[];
}

/**
 * Get a single facility by ID with the same shape as FacilitySearchResult.
 * Optionally calculates distance if coordinates are provided.
 * Returns null if facility not found or doesn't support the specified sport.
 */
export async function getFacilityById(
  params: GetFacilityByIdParams
): Promise<FacilitySearchResult | null> {
  const { facilityId, sportId, latitude, longitude } = params;

  // Fetch facility with related data
  const { data: facility, error } = await supabase
    .from('facility')
    .select(
      `
      id,
      name,
      city,
      address,
      latitude,
      longitude,
      data_provider_id,
      external_provider_id,
      timezone,
      organization:organization_id (
        data_provider_id
      ),
      facility_sports:facility_sport!inner (
        sport_id
      )
    `
    )
    .eq('id', facilityId)
    .eq('is_active', true)
    .eq('facility_sport.sport_id', sportId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows returned - facility doesn't exist or doesn't support this sport
      return null;
    }
    throw new Error(`Failed to get facility: ${error.message}`);
  }

  if (!facility) {
    return null;
  }

  // Get provider ID (facility-level takes precedence over organization-level)
  // Handle organization as array (Supabase returns relations as arrays)
  const orgData = Array.isArray(facility.organization)
    ? facility.organization[0]
    : facility.organization;
  const orgProviderId =
    orgData && typeof orgData === 'object' && 'data_provider_id' in orgData
      ? (orgData.data_provider_id as string | null)
      : null;
  const providerId = facility.data_provider_id || orgProviderId || null;

  // Fetch provider details if we have a provider ID
  let providerType: string | null = null;
  let bookingUrlTemplate: string | null = null;

  if (providerId) {
    const { data: provider } = await supabase
      .from('data_provider')
      .select('provider_type, booking_url_template')
      .eq('id', providerId)
      .single();

    if (provider) {
      providerType = provider.provider_type;
      bookingUrlTemplate = provider.booking_url_template;
    }
  }

  // Calculate distance if coordinates provided
  let distanceMeters: number | null = null;
  if (
    latitude !== undefined &&
    longitude !== undefined &&
    facility.latitude &&
    facility.longitude
  ) {
    // Haversine formula for distance calculation
    const R = 6371000; // Earth's radius in meters
    const lat1Rad = (latitude * Math.PI) / 180;
    const lat2Rad = (Number(facility.latitude) * Math.PI) / 180;
    const deltaLat = ((Number(facility.latitude) - latitude) * Math.PI) / 180;
    const deltaLon = ((Number(facility.longitude) - longitude) * Math.PI) / 180;

    const a =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    distanceMeters = R * c;
  }

  return {
    id: facility.id,
    name: facility.name,
    city: facility.city,
    address: facility.address,
    distance_meters: distanceMeters,
    data_provider_id: providerId,
    data_provider_type: providerType,
    booking_url_template: bookingUrlTemplate,
    external_provider_id: facility.external_provider_id,
    timezone: facility.timezone,
    sport_ids: [sportId],
  };
}

/**
 * Search facilities nearby, sorted by distance from user location.
 * Uses PostGIS RPC function for distance calculations.
 * Supports filtering by distance, facility type, surface type, and court type.
 */
export async function searchFacilitiesNearby(
  params: SearchFacilitiesParams
): Promise<FacilitiesPage> {
  const {
    sportIds,
    latitude,
    longitude,
    searchQuery,
    maxDistanceKm,
    facilityTypes,
    surfaceTypes,
    courtTypes,
    hasLighting,
    membershipRequired,
    limit = DEFAULT_PAGE_SIZE,
    offset = 0,
  } = params;

  // Fetch facilities and total count in parallel
  const [facilitiesResult, countResult] = await Promise.all([
    supabase.rpc('search_facilities_nearby', {
      p_sport_ids: sportIds,
      p_latitude: latitude,
      p_longitude: longitude,
      p_search_query: searchQuery || null,
      p_max_distance_km: maxDistanceKm || null,
      p_facility_types: facilityTypes?.length ? facilityTypes : null,
      p_surface_types: surfaceTypes?.length ? surfaceTypes : null,
      p_court_types: courtTypes?.length ? courtTypes : null,
      p_has_lighting: hasLighting ?? null,
      p_membership_required: membershipRequired ?? null,
      p_limit: limit + 1, // Fetch one extra to check if more exist
      p_offset: offset,
    }),
    // Only fetch count on first page (offset === 0) to avoid unnecessary queries
    offset === 0
      ? supabase.rpc('search_facilities_nearby_count', {
          p_sport_ids: sportIds,
          p_latitude: latitude,
          p_longitude: longitude,
          p_search_query: searchQuery || null,
          p_max_distance_km: maxDistanceKm || null,
          p_facility_types: facilityTypes?.length ? facilityTypes : null,
          p_surface_types: surfaceTypes?.length ? surfaceTypes : null,
          p_court_types: courtTypes?.length ? courtTypes : null,
          p_has_lighting: hasLighting ?? null,
          p_membership_required: membershipRequired ?? null,
        })
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (facilitiesResult.error) {
    throw new Error(`Failed to search facilities: ${facilitiesResult.error.message}`);
  }

  const facilities = (facilitiesResult.data ?? []) as FacilitySearchResult[];
  const hasMore = facilities.length > limit;

  // Remove the extra item used for pagination check
  if (hasMore) {
    facilities.pop();
  }

  return {
    facilities,
    hasMore,
    nextOffset: hasMore ? offset + limit : null,
    totalCount: countResult.data ?? undefined,
  };
}

/**
 * Get facility with detailed information including courts and contacts.
 * Used for the FacilityDetail screen.
 */
export async function getFacilityWithDetails(
  params: GetFacilityWithDetailsParams
): Promise<FacilityWithDetails | null> {
  const { facilityId, sportId, latitude, longitude } = params;

  // First get the basic facility search result (includes distance calculation)
  const facilitySearchResult = await getFacilityById({
    facilityId,
    sportId,
    latitude,
    longitude,
  });

  if (!facilitySearchResult) {
    return null;
  }

  // Fetch full facility data
  const { data: facilityData, error: facilityError } = await supabase
    .from('facility')
    .select('*')
    .eq('id', facilityId)
    .single();

  if (facilityError || !facilityData) {
    return null;
  }

  // Fetch courts that support the selected sport
  const { data: courtsData, error: courtsError } = await supabase
    .from('court')
    .select(
      `
      *,
      court_sports:court_sport!inner (
        sport_id
      )
    `
    )
    .eq('facility_id', facilityId)
    .eq('is_active', true)
    .eq('court_sport.sport_id', sportId)
    .order('court_number', { ascending: true });

  // Fetch contacts (general and reservation)
  const { data: contactsData, error: contactsError } = await supabase
    .from('facility_contact')
    .select('*')
    .eq('facility_id', facilityId)
    .in('contact_type', ['general', 'reservation'])
    .order('is_primary', { ascending: false });

  // Fetch facility images (ordered by display_order, primary first)
  const { data: imagesData, error: imagesError } = await supabase
    .from('facility_image')
    .select('*')
    .eq('facility_id', facilityId)
    .order('is_primary', { ascending: false })
    .order('display_order', { ascending: true });

  if (imagesError) {
    console.error('❌ Error fetching facility images:', imagesError);
  }

  // Fetch Stripe account status for the organization
  const facility = facilityData as Facility;
  const organizationId = facility.organization_id;
  let paymentsEnabled = false;

  if (organizationId) {
    const { data: stripeAccount } = await supabase
      .from('organization_stripe_account')
      .select('charges_enabled')
      .eq('organization_id', organizationId)
      .single();

    paymentsEnabled = stripeAccount?.charges_enabled === true;
  }

  // Handle any errors gracefully - return empty arrays
  const courts = courtsError ? [] : (courtsData as unknown as Court[]) || [];
  const contacts = contactsError ? [] : (contactsData as FacilityContact[]) || [];
  const images = imagesError || !imagesData ? [] : (imagesData as FacilityImage[]);

  return {
    ...facilitySearchResult,
    facilityData: facility,
    courts,
    contacts,
    paymentsEnabled,
    images,
  };
}

/**
 * Facility service object for grouped exports
 */
export const facilityService = {
  getFacilityById,
  getFacilityWithDetails,
  searchFacilitiesNearby,
};

export default facilityService;
