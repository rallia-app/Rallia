import { AdminCheckError, requireApiRole } from '@/lib/supabase/check-admin';
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { allowed } = await requireApiRole(user.id, ['super_admin', 'moderator', 'support']);
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: organizations, error } = await supabase
      .from('organization')
      .select('id, name, slug')
      .order('name');

    if (error) throw error;

    return NextResponse.json({ organizations: organizations || [] });
  } catch (error) {
    if (error instanceof AdminCheckError) {
      return NextResponse.json({ error: 'Admin check unavailable' }, { status: 503 });
    }
    console.error('[Admin Org List] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch organizations' },
      { status: 500 }
    );
  }
}
