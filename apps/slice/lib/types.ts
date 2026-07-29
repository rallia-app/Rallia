/**
 * Narrowed shapes for what the funnel actually consumes. The upstream row types
 * carry provider ids, booking templates and match counts that have no business
 * reaching this browser, so the API routes map down to these.
 */

export interface AvailabilitySlotDto {
  slot_start: string;
  slot_end: string;
}

export interface FacilityDto {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  timezone: string | null;
  distance_meters: number | null;
  availability_slots: AvailabilitySlotDto[] | null;
}

export interface PlacePrediction {
  placeId: string;
  name: string;
  address: string;
}

export interface PlaceDetails {
  placeId: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  city?: string;
  province?: string;
  postalCode?: string;
}

export interface PostalCodeLocation {
  postalCode: string;
  country: 'CA' | 'US';
  formattedAddress: string;
  city?: string;
  province?: string;
  latitude: number;
  longitude: number;
}
