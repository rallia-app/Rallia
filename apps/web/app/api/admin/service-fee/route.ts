import { requireApiRole } from '@/lib/supabase/check-admin';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

// Fee changes reprice every future paid registration — super_admin only.
const ALLOWED_ROLES = ['super_admin'];

async function getAuthedAdminDb() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { adminDb: null, error: 'Unauthorized' as const };
  }

  const { allowed } = await requireApiRole(user.id, ALLOWED_ROLES);
  if (!allowed) {
    return { adminDb: null, error: 'Forbidden' as const };
  }

  return { adminDb: createServiceRoleClient(), error: null };
}

export async function GET() {
  const { adminDb, error } = await getAuthedAdminDb();
  if (error || !adminDb) {
    return NextResponse.json({ error }, { status: error === 'Unauthorized' ? 401 : 403 });
  }

  const { data, error: dbError } = await adminDb
    .from('platform_service_fee_default')
    .select('pct_bps, flat_cents, cap_cents, updated_at')
    .single();
  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }
  return NextResponse.json({
    pctBps: data.pct_bps,
    flatCents: data.flat_cents,
    capCents: data.cap_cents,
    updatedAt: data.updated_at,
  });
}

export async function PUT(request: NextRequest) {
  const { adminDb, error } = await getAuthedAdminDb();
  if (error || !adminDb) {
    return NextResponse.json({ error }, { status: error === 'Unauthorized' ? 401 : 403 });
  }

  const body = await request.json().catch(() => null);
  const pctBps = Number(body?.pctBps);
  const flatCents = Number(body?.flatCents);
  const capCents = Number(body?.capCents);

  // Same bounds the table constraints enforce; checked here for a clean 400.
  const valid =
    Number.isInteger(pctBps) &&
    pctBps >= 0 &&
    pctBps <= 10000 &&
    Number.isInteger(flatCents) &&
    flatCents >= 0 &&
    Number.isInteger(capCents) &&
    capCents >= 0;
  if (!valid) {
    return NextResponse.json({ error: 'Invalid fee parameters' }, { status: 400 });
  }

  const { error: dbError } = await adminDb
    .from('platform_service_fee_default')
    .update({
      pct_bps: pctBps,
      flat_cents: flatCents,
      cap_cents: capCents,
      updated_at: new Date().toISOString(),
    })
    .eq('id', true);
  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
