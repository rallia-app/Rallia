/**
 * Canned Google Places / Geocoding / Time Zone fixtures for dev mode.
 *
 * Activated by `shouldUseApiMocks()` in shared-utils — see callers in
 * usePlacesAutocomplete and usePostalCodeGeocode. Tailored to the GMA
 * bounding box that the autocomplete already restricts to.
 */

import type { AddressComponent, PlacePrediction } from '@rallia/shared-types';
import type { PlaceDetails } from '../usePlacesAutocomplete';
import type { PostalCodeLocation } from '../usePostalCodeGeocode';

const MOCK_DELAY_MS = 250;

const wait = (ms = MOCK_DELAY_MS) => new Promise<void>(r => setTimeout(r, ms));

interface MockPlace {
  placeId: string;
  name: string;
  streetNumber: string;
  route: string;
  city: string;
  province: string; // short
  provinceLong: string;
  postalCode: string;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
}

const MOCK_PLACES: MockPlace[] = [
  {
    placeId: 'mock_addr_esplanade',
    name: '4422 Avenue de l’Esplanade',
    streetNumber: '4422',
    route: 'Avenue de l’Esplanade',
    city: 'Montréal',
    province: 'QC',
    provinceLong: 'Québec',
    postalCode: 'H2W 1S4',
    country: 'Canada',
    countryCode: 'CA',
    latitude: 45.5181,
    longitude: -73.5876,
  },
  {
    placeId: 'mock_addr_calixa',
    name: '3819 Avenue Calixa-Lavallée',
    streetNumber: '3819',
    route: 'Avenue Calixa-Lavallée',
    city: 'Montréal',
    province: 'QC',
    provinceLong: 'Québec',
    postalCode: 'H2L 3A7',
    country: 'Canada',
    countryCode: 'CA',
    latitude: 45.527,
    longitude: -73.5687,
  },
  {
    placeId: 'mock_addr_cdn',
    name: '5765 Chemin de la Côte-des-Neiges',
    streetNumber: '5765',
    route: 'Chemin de la Côte-des-Neiges',
    city: 'Montréal',
    province: 'QC',
    provinceLong: 'Québec',
    postalCode: 'H3T 1Y8',
    country: 'Canada',
    countryCode: 'CA',
    latitude: 45.4925,
    longitude: -73.6225,
  },
  {
    placeId: 'mock_addr_bois_boulogne',
    name: '955 Avenue Bois-de-Boulogne',
    streetNumber: '955',
    route: 'Avenue Bois-de-Boulogne',
    city: 'Laval',
    province: 'QC',
    provinceLong: 'Québec',
    postalCode: 'H7N 4G1',
    country: 'Canada',
    countryCode: 'CA',
    latitude: 45.585,
    longitude: -73.7361,
  },
  {
    placeId: 'mock_addr_marie_victorin',
    name: '7415 Boulevard Marie-Victorin',
    streetNumber: '7415',
    route: 'Boulevard Marie-Victorin',
    city: 'Brossard',
    province: 'QC',
    provinceLong: 'Québec',
    postalCode: 'J4W 1A6',
    country: 'Canada',
    countryCode: 'CA',
    latitude: 45.4408,
    longitude: -73.4631,
  },
];

const MOCK_TIMEZONE = 'America/Toronto';

function findPlace(placeId: string): MockPlace {
  return MOCK_PLACES.find(p => p.placeId === placeId) ?? MOCK_PLACES[0]!;
}

function buildAddressComponents(p: MockPlace): AddressComponent[] {
  return [
    { longText: p.streetNumber, shortText: p.streetNumber, types: ['street_number'] },
    { longText: p.route, shortText: p.route, types: ['route'] },
    { longText: p.city, shortText: p.city, types: ['locality', 'political'] },
    {
      longText: p.provinceLong,
      shortText: p.province,
      types: ['administrative_area_level_1', 'political'],
    },
    {
      longText: p.country,
      shortText: p.countryCode,
      types: ['country', 'political'],
    },
    { longText: p.postalCode, shortText: p.postalCode, types: ['postal_code'] },
  ];
}

function fuzzyFilter(query: string): MockPlace[] {
  const q = query.trim().toLowerCase();
  if (!q) return MOCK_PLACES;
  const matches = MOCK_PLACES.filter(
    p =>
      p.name.toLowerCase().includes(q) ||
      p.city.toLowerCase().includes(q) ||
      p.route.toLowerCase().includes(q)
  );
  return matches.length > 0 ? matches : MOCK_PLACES.slice(0, 3);
}

export async function mockPlacePredictions(query: string): Promise<PlacePrediction[]> {
  await wait();
  return fuzzyFilter(query).map(p => ({
    placeId: p.placeId,
    name: p.name,
    address: `${p.streetNumber} ${p.route}, ${p.city}, ${p.province}`,
  }));
}

export async function mockPlaceDetails(placeId: string): Promise<PlaceDetails> {
  await wait();
  const p = findPlace(placeId);
  return {
    placeId: p.placeId,
    name: p.name,
    address: `${p.streetNumber} ${p.route}, ${p.city}, ${p.province} ${p.postalCode}, ${p.country}`,
    latitude: p.latitude,
    longitude: p.longitude,
    timezone: MOCK_TIMEZONE,
    addressComponents: buildAddressComponents(p),
    city: p.city,
    province: p.province,
    postalCode: p.postalCode,
  };
}

/**
 * Deterministic pseudo-coordinates for a postal code so repeated geocodes
 * are stable. Anchors near GMA for CA, near NYC for US.
 */
function deterministicJitter(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  // Map to small offset in [-0.05, 0.05]
  return ((h % 1000) / 1000 - 0.5) * 0.1;
}

function findMockPlaceByPostal(normalizedPostal: string): MockPlace | undefined {
  const normalized = normalizedPostal.toUpperCase();
  const exact = MOCK_PLACES.find(place => place.postalCode.toUpperCase() === normalized);
  if (exact) return exact;

  const fsa = normalized.slice(0, 3);
  return MOCK_PLACES.find(place => place.postalCode.toUpperCase().startsWith(fsa));
}

export async function mockGeocodePostalCode(
  normalizedPostal: string,
  country: 'CA' | 'US'
): Promise<PostalCodeLocation> {
  await wait();
  const matchedPlace = country === 'CA' ? findMockPlaceByPostal(normalizedPostal) : undefined;
  const baseLat = matchedPlace?.latitude ?? (country === 'CA' ? 45.5017 : 40.7128);
  const baseLng = matchedPlace?.longitude ?? (country === 'CA' ? -73.5673 : -74.006);
  const lat = matchedPlace?.latitude ?? baseLat + deterministicJitter(normalizedPostal + 'lat');
  const lng = matchedPlace?.longitude ?? baseLng + deterministicJitter(normalizedPostal + 'lng');
  const formattedAddress = matchedPlace
    ? `${normalizedPostal}, ${matchedPlace.city}, ${matchedPlace.province}, ${matchedPlace.country}`
    : `${normalizedPostal}, ${country === 'CA' ? 'Canada' : 'USA'}`;

  return {
    postalCode: normalizedPostal,
    country,
    formattedAddress,
    ...(matchedPlace?.city && { city: matchedPlace.city }),
    ...(matchedPlace?.province && { province: matchedPlace.province }),
    latitude: lat,
    longitude: lng,
  };
}
