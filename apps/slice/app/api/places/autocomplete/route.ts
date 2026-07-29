import { NextRequest, NextResponse } from 'next/server';

import { autocompletePlaces } from '@/lib/places/server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { input?: unknown };
    const input = body.input;

    if (typeof input !== 'string' || input.trim().length < 3) {
      return NextResponse.json({ predictions: [] });
    }

    return NextResponse.json({ predictions: await autocompletePlaces(input.trim()) });
  } catch (error) {
    console.error('Places autocomplete error:', error);
    return NextResponse.json({ error: 'Failed to search places.' }, { status: 500 });
  }
}
