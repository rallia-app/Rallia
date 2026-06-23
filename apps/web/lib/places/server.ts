import type { PlacePrediction } from '@rallia/shared-types';
import type { PlaceDetails, PlacesScope, PostalCodeLocation } from '@rallia/shared-hooks';

const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const PLACE_DETAILS_URL = 'https://places.googleapis.com/v1/places';
const TIMEZONE_URL = 'https://maps.googleapis.com/maps/api/timezone/json';
const GEOCODING_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

/** GMA bounding box — matches usePlacesAutocomplete client restriction. */
const GMA_LOCATION_RESTRICTION = {
  rectangle: {
    low: { latitude: 45.25, longitude: -74.2 },
    high: { latitude: 45.75, longitude: -73.1 },
  },
};

function getApiKey(): string | null {
  return process.env.GOOGLE_PLACES_API_KEY ?? null;
}

export async function autocompletePlaces(
  input: string,
  scope: PlacesScope = 'gma'
): Promise<PlacePrediction[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Google Places API not configured');
  }

  const restrictions =
    scope === 'worldwide'
      ? {}
      : { includedRegionCodes: ['ca'], locationRestriction: GMA_LOCATION_RESTRICTION };

  const response = await fetch(AUTOCOMPLETE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
    },
    body: JSON.stringify({
      input,
      ...restrictions,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Google Places autocomplete error:', errorText);
    throw new Error('Failed to fetch place suggestions');
  }

  const data = await response.json();

  return (data.suggestions || [])
    .filter((suggestion: { placePrediction?: unknown }) => suggestion.placePrediction)
    .map(
      (suggestion: {
        placePrediction: {
          placeId: string;
          structuredFormat?: {
            mainText?: { text?: string };
            secondaryText?: { text?: string };
          };
          text?: { text?: string };
        };
      }) => {
        const prediction = suggestion.placePrediction;
        return {
          placeId: prediction.placeId,
          name: prediction.structuredFormat?.mainText?.text || prediction.text?.text || '',
          address: prediction.structuredFormat?.secondaryText?.text || '',
        };
      }
    );
}

export async function fetchPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Google Places API not configured');
  }

  // Place IDs are URL-safe tokens; reject anything else to prevent path/host injection.
  if (!/^[A-Za-z0-9_-]+$/.test(placeId)) {
    return null;
  }

  const response = await fetch(`${PLACE_DETAILS_URL}/${encodeURIComponent(placeId)}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'displayName,formattedAddress,location,addressComponents',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Google Place Details API error:', errorText);
    return null;
  }

  const data = await response.json();
  if (!data.location) return null;

  const lat = data.location.latitude;
  const lng = data.location.longitude;

  let timezone: string | undefined;
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const timezoneResponse = await fetch(
      `${TIMEZONE_URL}?location=${lat},${lng}&timestamp=${timestamp}&key=${apiKey}`
    );
    if (timezoneResponse.ok) {
      const timezoneData = await timezoneResponse.json();
      if (timezoneData.status === 'OK' && timezoneData.timeZoneId) {
        timezone = timezoneData.timeZoneId;
      }
    }
  } catch {
    // Non-critical
  }

  const components = (data.addressComponents || []).map(
    (c: { longText?: string; shortText?: string; types?: string[] }) => ({
      longText: c.longText || '',
      shortText: c.shortText || '',
      types: c.types || [],
    })
  );

  const getComponent = (types: string[], useShort = false): string => {
    const component = components.find((c: { types: string[] }) =>
      types.some(type => c.types.includes(type))
    );
    return (useShort ? component?.shortText : component?.longText) || '';
  };

  const city =
    getComponent(['locality']) ||
    getComponent(['administrative_area_level_3']) ||
    getComponent(['sublocality_level_1']);
  const province = getComponent(['administrative_area_level_1'], true);
  const postalCode = getComponent(['postal_code']);

  return {
    placeId,
    name: data.displayName?.text || '',
    address: data.formattedAddress || '',
    latitude: lat,
    longitude: lng,
    ...(timezone && { timezone }),
    ...(components.length > 0 && { addressComponents: components }),
    ...(city && { city }),
    ...(province && { province }),
    ...(postalCode && { postalCode }),
  };
}

// Geocoding API returns snake_case address_components (unlike the new Places API).
function parsePostalAddressComponents(
  components: Array<{ long_name?: string; short_name?: string; types?: string[] }> | undefined
): { city?: string; province?: string } {
  if (!components?.length) return {};
  const get = (types: string[], useShort = false): string => {
    const c = components.find(comp => types.some(type => comp.types?.includes(type)));
    return (useShort ? c?.short_name : c?.long_name) || '';
  };
  const city =
    get(['locality']) || get(['administrative_area_level_3']) || get(['sublocality_level_1']);
  const province = get(['administrative_area_level_1'], true);
  return { ...(city && { city }), ...(province && { province }) };
}

export async function geocodePostalCode(
  postalCode: string,
  country: 'CA' | 'US'
): Promise<PostalCodeLocation | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Google Places API not configured');
  }

  const countryComponent = country === 'CA' ? 'country:CA' : 'country:US';
  const url = `${GEOCODING_URL}?address=${encodeURIComponent(postalCode)}&components=${countryComponent}&key=${apiKey}`;

  const response = await fetch(url);
  if (!response.ok) {
    console.error('Google Geocoding API error:', response.status);
    throw new Error('Failed to geocode postal code');
  }

  const data = await response.json();
  if (data.status === 'ZERO_RESULTS' || !data.results?.length) {
    return null;
  }
  if (data.status !== 'OK') {
    console.error('Geocoding API error:', data.status, data.error_message);
    throw new Error('Failed to geocode postal code');
  }

  const firstResult = data.results[0];
  const location = firstResult.geometry?.location;
  if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
    return null;
  }

  const { city, province } = parsePostalAddressComponents(firstResult.address_components);

  return {
    postalCode,
    country,
    formattedAddress: firstResult.formatted_address || postalCode,
    ...(city && { city }),
    ...(province && { province }),
    latitude: location.lat,
    longitude: location.lng,
  };
}
