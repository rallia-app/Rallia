import { NextRequest, NextResponse } from 'next/server';
import { shouldUseApiMocks } from '@rallia/shared-utils';
import { buildMockPlacesSearchResponse } from './mocks';

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    if (shouldUseApiMocks()) {
      return NextResponse.json(await buildMockPlacesSearchResponse(query));
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      console.error('GOOGLE_PLACES_API_KEY is not configured');
      return NextResponse.json({ error: 'Google Places API not configured' }, { status: 500 });
    }

    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'places.displayName,places.formattedAddress,places.addressComponents,places.location',
      },
      body: JSON.stringify({
        textQuery: query,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Google Places API error:', errorText);
      return NextResponse.json({ error: 'Failed to search places' }, { status: response.status });
    }

    const data = await response.json();

    // Parse the first place result if available
    if (data.places && data.places.length > 0) {
      const place = data.places[0];
      const addressComponents: Array<{ types?: string[]; longText?: string }> =
        place.addressComponents || [];

      // Extract address parts from components
      const getComponent = (types: string[]) => {
        const component = addressComponents.find(c =>
          types.some((type: string) => c.types?.includes(type))
        );
        return component?.longText || '';
      };

      const streetNumber = getComponent(['street_number']);
      const route = getComponent(['route']);
      const city =
        getComponent(['locality']) ||
        getComponent(['administrative_area_level_3']) ||
        getComponent(['sublocality_level_1']);
      const country = getComponent(['country']);
      const postalCode = getComponent(['postal_code']);
      const latitude = place.location?.latitude || null;
      const longitude = place.location?.longitude || null;

      // Fetch timezone using Google Time Zone API if we have coordinates
      let timezone: string | null = null;
      if (latitude && longitude) {
        try {
          const timestamp = Math.floor(Date.now() / 1000);
          const timezoneResponse = await fetch(
            `https://maps.googleapis.com/maps/api/timezone/json?location=${latitude},${longitude}&timestamp=${timestamp}&key=${apiKey}`
          );

          if (timezoneResponse.ok) {
            const timezoneData = await timezoneResponse.json();
            if (timezoneData.status === 'OK' && timezoneData.timeZoneId) {
              timezone = timezoneData.timeZoneId;
            }
          }
        } catch (tzError) {
          console.error('Timezone API error:', tzError);
          // Continue without timezone - not critical
        }
      }

      return NextResponse.json({
        places: data.places,
        parsed: {
          name: place.displayName?.text || '',
          address: [streetNumber, route].filter(Boolean).join(' '),
          formattedAddress: place.formattedAddress || '',
          city,
          country,
          postalCode,
          latitude,
          longitude,
          timezone,
        },
      });
    }

    return NextResponse.json({ places: [], parsed: null });
  } catch (error) {
    console.error('Places search error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
