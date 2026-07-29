import { NextRequest, NextResponse } from 'next/server';

import { fetchPlaceDetails } from '@/lib/places/server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { placeId?: unknown };
    const placeId = body.placeId;

    if (typeof placeId !== 'string' || !placeId) {
      return NextResponse.json({ error: 'placeId is required' }, { status: 400 });
    }

    const details = await fetchPlaceDetails(placeId);
    if (!details) {
      return NextResponse.json({ error: 'Place not found' }, { status: 404 });
    }

    return NextResponse.json({ details });
  } catch (error) {
    console.error('Place details error:', error);
    return NextResponse.json({ error: 'Failed to load place details.' }, { status: 500 });
  }
}
