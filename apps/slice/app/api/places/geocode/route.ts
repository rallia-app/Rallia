import { NextRequest, NextResponse } from 'next/server';

import { geocodePostalCode } from '@/lib/places/server';
import { normalizePostalCode } from '@/lib/validators';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { postalCode?: unknown };
    const postalCode = body.postalCode;

    if (typeof postalCode !== 'string' || !postalCode) {
      return NextResponse.json({ error: 'postalCode is required' }, { status: 400 });
    }

    const normalized = normalizePostalCode(postalCode);
    if (!normalized) {
      return NextResponse.json({ error: 'Invalid postal code' }, { status: 400 });
    }

    const location = await geocodePostalCode(normalized.normalized, normalized.country);
    if (!location) {
      return NextResponse.json({ error: 'Postal code not found' }, { status: 404 });
    }

    return NextResponse.json({ location });
  } catch (error) {
    console.error('Postal code geocode error:', error);
    return NextResponse.json({ error: 'Failed to geocode postal code' }, { status: 500 });
  }
}
