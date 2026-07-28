import { NextRequest, NextResponse } from 'next/server';

import { getAnonClient } from '@/lib/supabase';
import type { AvailabilitySlotDto } from '@/lib/types';

export const runtime = 'nodejs';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { facilityId?: unknown };
    const facilityId = body.facilityId;

    if (typeof facilityId !== 'string' || !UUID_REGEX.test(facilityId)) {
      return NextResponse.json({ error: 'Invalid facility.' }, { status: 400 });
    }

    const { data, error } = await getAnonClient()
      .from('facility_availability_snapshot')
      .select('slot_start, slot_end')
      .eq('facility_id', facilityId)
      .eq('is_available', true)
      .gt('slot_start', new Date().toISOString())
      .order('slot_start', { ascending: true });

    if (error) {
      console.error('Availability lookup failed:', error);
      return NextResponse.json({ error: 'Availability lookup failed.' }, { status: 500 });
    }

    return NextResponse.json({ slots: (data ?? []) as AvailabilitySlotDto[] });
  } catch (error) {
    console.error('Availability lookup error:', error);
    return NextResponse.json({ error: 'Availability lookup failed.' }, { status: 500 });
  }
}
