import { autocompletePlaces } from '@/lib/places/server';
import { shouldUseApiMocks } from '@rallia/shared-utils';
import { mockPlacePredictions } from '@rallia/shared-hooks/src/devMocks/googlePlaces';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { input, scope } = await request.json();

    if (!input || typeof input !== 'string') {
      return NextResponse.json({ error: 'Input is required' }, { status: 400 });
    }

    const trimmed = input.trim();
    const resolvedScope = scope === 'worldwide' ? 'worldwide' : 'gma';
    const predictions = shouldUseApiMocks()
      ? await mockPlacePredictions(trimmed)
      : await autocompletePlaces(trimmed, resolvedScope);

    return NextResponse.json({ predictions });
  } catch (error) {
    console.error('Places autocomplete error:', error);
    return NextResponse.json({ error: 'Failed to search places' }, { status: 500 });
  }
}
