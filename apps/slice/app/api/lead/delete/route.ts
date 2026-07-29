import { NextRequest, NextResponse } from 'next/server';

import { getAdminClient } from '@/lib/supabase';
import { validateEmail } from '@/lib/validators';

/**
 * Erases a visitor's lead on request. `match_smoke_test_lead` is the only place
 * this app stores personal data — the analytics events carry a session id and
 * segmentation attributes, never the email or phone — so dropping the row is a
 * complete deletion.
 *
 * The response is always `{ ok: true }` on a well-formed email, whether or not
 * a row existed: an unauthenticated endpoint that reported "found" would let
 * anyone test whether an address is in our list.
 */
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const normalizedEmail = String(body?.email ?? '')
      .trim()
      .toLowerCase();

    if (!validateEmail(normalizedEmail)) {
      return NextResponse.json({ error: 'Invalid email.' }, { status: 400 });
    }

    const supabase = getAdminClient();
    const { error } = await supabase
      .from('match_smoke_test_lead')
      .delete()
      .eq('email', normalizedEmail);

    if (error) {
      console.error('Failed to delete match smoke test lead:', error);
      return NextResponse.json({ error: 'Failed to delete your info.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error deleting match smoke test lead:', error);
    return NextResponse.json({ error: 'Failed to delete your info.' }, { status: 500 });
  }
}
