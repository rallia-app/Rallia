import type { PlaceDetails, PlacePrediction, PostalCodeLocation } from '../types';

/**
 * Vendored from apps/web/lib/places/server.ts, trimmed to what this funnel uses:
 * worldwide autocomplete (no Greater-Montreal restriction), place details, and
 * postal-code geocoding. The API key stays server-side, which is what keeps
 * googleapis.com out of the browser's network tab.
 */

const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const PLACE_DETAILS_URL = 'https://places.googleapis.com/v1/places';
const TIMEZONE_URL = 'https://maps.googleapis.com/maps/api/timezone/json';
const GEOCODING_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

function getApiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error('Google Places API not configured');
  return key;
}

interface AddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

function pickComponent(
  components: AddressComponent[],
  types: string[],
  useShort = false
): string | undefined {
  const match = components.find(c => types.some(type => c.types?.includes(type)));
  const value = useShort ? match?.shortText : match?.longText;
  return value || undefined;
}

export async function autocompletePlaces(input: string): Promise<PlacePrediction[]> {
  const response = await fetch(AUTOCOMPLETE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': getApiKey() },
    body: JSON.stringify({ input }),
  });

  if (!response.ok) {
    console.error('Places autocomplete error:', await response.text());
    throw new Error('Failed to fetch place suggestions');
  }

  const data = (await response.json()) as {
    suggestions?: {
      placePrediction?: {
        placeId: string;
        structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
        text?: { text?: string };
      };
    }[];
  };

  return (data.suggestions ?? [])
    .map(s => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map(p => ({
      placeId: p.placeId,
      name: p.structuredFormat?.mainText?.text || p.text?.text || '',
      address: p.structuredFormat?.secondaryText?.text || '',
    }));
}

export async function fetchPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  const apiKey = getApiKey();

  const response = await fetch(`${PLACE_DETAILS_URL}/${placeId}`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'displayName,formattedAddress,location,addressComponents',
    },
  });

  if (!response.ok) {
    console.error('Place details error:', await response.text());
    return null;
  }

  const data = (await response.json()) as {
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
    addressComponents?: AddressComponent[];
  };

  const lat = data.location?.latitude;
  const lng = data.location?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  const components = data.addressComponents ?? [];

  // Non-critical: the wizard falls back to a default timezone without it.
  let timezone: string | undefined;
  try {
    const tz = await fetch(
      `${TIMEZONE_URL}?location=${lat},${lng}&timestamp=${Math.floor(Date.now() / 1000)}&key=${apiKey}`
    );
    if (tz.ok) {
      const tzData = (await tz.json()) as { status?: string; timeZoneId?: string };
      if (tzData.status === 'OK') timezone = tzData.timeZoneId;
    }
  } catch {
    // ignore
  }

  const city =
    pickComponent(components, ['locality']) ??
    pickComponent(components, ['administrative_area_level_3']) ??
    pickComponent(components, ['sublocality_level_1']);

  return {
    placeId,
    name: data.displayName?.text || '',
    address: data.formattedAddress || '',
    latitude: lat,
    longitude: lng,
    ...(timezone && { timezone }),
    ...(city && { city }),
    ...(pickComponent(components, ['administrative_area_level_1'], true) && {
      province: pickComponent(components, ['administrative_area_level_1'], true),
    }),
    ...(pickComponent(components, ['postal_code']) && {
      postalCode: pickComponent(components, ['postal_code']),
    }),
  };
}

export async function geocodePostalCode(
  postalCode: string,
  country: 'CA' | 'US'
): Promise<PostalCodeLocation | null> {
  const url = `${GEOCODING_URL}?address=${encodeURIComponent(postalCode)}&components=country:${country}&key=${getApiKey()}`;

  const response = await fetch(url);
  if (!response.ok) {
    console.error('Geocoding error:', response.status);
    throw new Error('Failed to geocode postal code');
  }

  const data = (await response.json()) as {
    status?: string;
    results?: {
      geometry?: { location?: { lat?: number; lng?: number } };
      formatted_address?: string;
      address_components?: { long_name?: string; short_name?: string; types?: string[] }[];
    }[];
  };

  if (data.status === 'ZERO_RESULTS' || !data.results?.length) return null;
  if (data.status !== 'OK') throw new Error('Failed to geocode postal code');

  const first = data.results[0];
  const lat = first.geometry?.location?.lat;
  const lng = first.geometry?.location?.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  // The geocoding API uses snake_case components, unlike the Places API above.
  const components: AddressComponent[] = (first.address_components ?? []).map(c => ({
    longText: c.long_name,
    shortText: c.short_name,
    types: c.types,
  }));

  const city =
    pickComponent(components, ['locality']) ??
    pickComponent(components, ['administrative_area_level_3']) ??
    pickComponent(components, ['sublocality_level_1']);
  const province = pickComponent(components, ['administrative_area_level_1'], true);

  return {
    postalCode,
    country,
    formattedAddress: first.formatted_address || postalCode,
    ...(city && { city }),
    ...(province && { province }),
    latitude: lat,
    longitude: lng,
  };
}
