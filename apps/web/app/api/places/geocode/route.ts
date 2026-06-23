import { geocodePostalCode } from '@/lib/places/server';
import { normalizePostalCode, shouldUseApiMocks } from '@rallia/shared-utils';
import { mockGeocodePostalCode } from '@rallia/shared-hooks/src/devMocks/googlePlaces';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { postalCode } = await request.json();

    if (!postalCode || typeof postalCode !== 'string') {
      return NextResponse.json({ error: 'postalCode is required' }, { status: 400 });
    }

    const normalized = normalizePostalCode(postalCode);
    if (!normalized) {
      return NextResponse.json({ error: 'Invalid postal code' }, { status: 400 });
    }

    const location = shouldUseApiMocks()
      ? await mockGeocodePostalCode(normalized.normalized, normalized.country)
      : await geocodePostalCode(normalized.normalized, normalized.country);

    if (!location) {
      return NextResponse.json({ error: 'Postal code not found' }, { status: 404 });
    }

    return NextResponse.json({ location });
  } catch (error) {
    console.error('Postal code geocode error:', error);
    return NextResponse.json({ error: 'Failed to geocode postal code' }, { status: 500 });
  }
}
