/**
 * Dev-mode canned response for /api/places/search.
 * Mirrors the shape returned by the real Google Places + Time Zone fetch.
 */

interface MockPlace {
  placeId: string;
  name: string;
  streetNumber: string;
  route: string;
  city: string;
  province: string;
  provinceLong: string;
  postalCode: string;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
}

const MOCK_PLACES: MockPlace[] = [
  {
    placeId: 'mock_jeanne_mance',
    name: 'Parc Jeanne-Mance Tennis Courts',
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
    placeId: 'mock_kent_park',
    name: 'Kent Park Tennis Club',
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
    placeId: 'mock_laval_centre',
    name: 'Centre Sportif Laval',
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
];

const MOCK_TIMEZONE = 'America/Toronto';

function pickPlace(query: string): MockPlace {
  const q = query.trim().toLowerCase();
  return (
    MOCK_PLACES.find(
      p =>
        p.name.toLowerCase().includes(q) ||
        p.city.toLowerCase().includes(q) ||
        p.route.toLowerCase().includes(q)
    ) ?? MOCK_PLACES[0]!
  );
}

function toGooglePlaceShape(p: MockPlace) {
  return {
    displayName: { text: p.name },
    formattedAddress: `${p.streetNumber} ${p.route}, ${p.city}, ${p.province} ${p.postalCode}, ${p.country}`,
    location: { latitude: p.latitude, longitude: p.longitude },
    addressComponents: [
      { longText: p.streetNumber, shortText: p.streetNumber, types: ['street_number'] },
      { longText: p.route, shortText: p.route, types: ['route'] },
      { longText: p.city, shortText: p.city, types: ['locality', 'political'] },
      {
        longText: p.provinceLong,
        shortText: p.province,
        types: ['administrative_area_level_1', 'political'],
      },
      { longText: p.country, shortText: p.countryCode, types: ['country', 'political'] },
      { longText: p.postalCode, shortText: p.postalCode, types: ['postal_code'] },
    ],
  };
}

export async function buildMockPlacesSearchResponse(query: string) {
  await new Promise(r => setTimeout(r, 250));
  const p = pickPlace(query);
  const place = toGooglePlaceShape(p);
  return {
    places: [place],
    parsed: {
      name: p.name,
      address: `${p.streetNumber} ${p.route}`,
      formattedAddress: place.formattedAddress,
      city: p.city,
      country: p.country,
      postalCode: p.postalCode,
      latitude: p.latitude,
      longitude: p.longitude,
      timezone: MOCK_TIMEZONE,
    },
  };
}
