import { fetchPlaceDetails } from '@/lib/places/server';
import { shouldUseApiMocks } from '@rallia/shared-utils';
import { mockPlaceDetails } from '@rallia/shared-hooks/src/devMocks/googlePlaces';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { placeId } = await request.json();

    if (!placeId || typeof placeId !== 'string') {
      return NextResponse.json({ error: 'placeId is required' }, { status: 400 });
    }

    const details = shouldUseApiMocks()
      ? await mockPlaceDetails(placeId)
      : await fetchPlaceDetails(placeId);

    if (!details) {
      return NextResponse.json({ error: 'Place not found' }, { status: 404 });
    }

    return NextResponse.json({ details });
  } catch (error) {
    console.error('Place details error:', error);
    return NextResponse.json({ error: 'Failed to fetch place details' }, { status: 500 });
  }
}
