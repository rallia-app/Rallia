import { AdminCheckError, requireApiRole } from '@/lib/supabase/check-admin';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

async function getAuthedAdminDb() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { user: null, adminDb: null, error: 'Unauthorized' };
  }

  const { allowed } = await requireApiRole(user.id, ['super_admin']);
  if (!allowed) {
    return { user: null, adminDb: null, error: 'Forbidden' };
  }

  return { user, adminDb: createServiceRoleClient(), error: null };
}

async function checkAnotherActiveContest(
  adminDb: ReturnType<typeof createServiceRoleClient>,
  excludeId?: string
) {
  let query = adminDb
    .from('referral_contest')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true);
  if (excludeId) query = query.neq('id', excludeId);
  const { count } = await query;
  return (count ?? 0) > 0;
}

export async function POST(request: NextRequest) {
  try {
    const { user, adminDb, error } = await getAuthedAdminDb();
    if (error || !adminDb || !user) {
      return NextResponse.json({ error }, { status: error === 'Unauthorized' ? 401 : 403 });
    }

    const {
      titleEn,
      titleFr,
      prizeDescriptionEn,
      prizeDescriptionFr,
      startAt,
      endAt,
      maxWinners,
      isActive,
    } = await request.json();

    if (!titleEn || !prizeDescriptionEn || !startAt || !endAt || !maxWinners) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (new Date(endAt) <= new Date(startAt)) {
      return NextResponse.json({ error: 'end_at must be after start_at' }, { status: 400 });
    }

    if (isActive) {
      const conflict = await checkAnotherActiveContest(adminDb);
      if (conflict) {
        return NextResponse.json(
          { error: 'another_active_contest', message: 'Another contest is already active.' },
          { status: 409 }
        );
      }
    }

    const { data, error: insertError } = await adminDb
      .from('referral_contest')
      .insert({
        title: titleEn,
        prize_description: prizeDescriptionEn,
        title_en: titleEn,
        title_fr: titleFr ?? null,
        prize_description_en: prizeDescriptionEn,
        prize_description_fr: prizeDescriptionFr ?? null,
        start_at: startAt,
        end_at: endAt,
        max_winners: maxWinners,
        is_active: isActive ?? true,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    await adminDb.rpc('log_admin_action', {
      p_admin_id: user.id,
      p_action_type: 'create',
      p_entity_type: 'referral_contest',
      p_entity_id: data.id,
      p_new_data: {
        titleEn,
        titleFr,
        prizeDescriptionEn,
        prizeDescriptionFr,
        startAt,
        endAt,
        maxWinners,
        isActive,
      },
    });

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    if (error instanceof AdminCheckError) {
      return NextResponse.json({ error: 'Admin check unavailable' }, { status: 503 });
    }
    console.error('[Admin Referral Contests POST]', error);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user, adminDb, error } = await getAuthedAdminDb();
    if (error || !adminDb || !user) {
      return NextResponse.json({ error }, { status: error === 'Unauthorized' ? 401 : 403 });
    }

    const {
      id,
      titleEn,
      titleFr,
      prizeDescriptionEn,
      prizeDescriptionFr,
      startAt,
      endAt,
      maxWinners,
      isActive,
    } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'Missing contest ID' }, { status: 400 });
    }

    if (startAt !== undefined && endAt !== undefined && new Date(endAt) <= new Date(startAt)) {
      return NextResponse.json({ error: 'end_at must be after start_at' }, { status: 400 });
    }

    if (isActive === true) {
      const conflict = await checkAnotherActiveContest(adminDb, id);
      if (conflict) {
        return NextResponse.json(
          { error: 'another_active_contest', message: 'Another contest is already active.' },
          { status: 409 }
        );
      }
    }

    const updates: Record<string, unknown> = {};
    if (titleEn !== undefined) {
      updates.title = titleEn;
      updates.title_en = titleEn;
    }
    if (titleFr !== undefined) updates.title_fr = titleFr ?? null;
    if (prizeDescriptionEn !== undefined) {
      updates.prize_description = prizeDescriptionEn;
      updates.prize_description_en = prizeDescriptionEn;
    }
    if (prizeDescriptionFr !== undefined) updates.prize_description_fr = prizeDescriptionFr ?? null;
    if (startAt !== undefined) updates.start_at = startAt;
    if (endAt !== undefined) updates.end_at = endAt;
    if (maxWinners !== undefined) updates.max_winners = maxWinners;
    if (isActive !== undefined) updates.is_active = isActive;

    const { data, error: updateError } = await adminDb
      .from('referral_contest')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    await adminDb.rpc('log_admin_action', {
      p_admin_id: user.id,
      p_action_type: 'update',
      p_entity_type: 'referral_contest',
      p_entity_id: id,
      p_new_data: updates as Record<string, string | number | boolean | null>,
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof AdminCheckError) {
      return NextResponse.json({ error: 'Admin check unavailable' }, { status: 503 });
    }
    console.error('[Admin Referral Contests PATCH]', error);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user, adminDb, error } = await getAuthedAdminDb();
    if (error || !adminDb || !user) {
      return NextResponse.json({ error }, { status: error === 'Unauthorized' ? 401 : 403 });
    }

    const { contestIds } = await request.json();

    if (!contestIds || !Array.isArray(contestIds) || contestIds.length === 0) {
      return NextResponse.json({ error: 'Missing contest IDs' }, { status: 400 });
    }

    const { error: deleteError } = await adminDb
      .from('referral_contest')
      .delete()
      .in('id', contestIds);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    await adminDb.rpc('log_admin_action', {
      p_admin_id: user.id,
      p_action_type: 'delete',
      p_entity_type: 'referral_contest',
      p_entity_id: contestIds[0],
      p_new_data: { deletedIds: contestIds },
    });

    return NextResponse.json({ success: true, deletedCount: contestIds.length });
  } catch (error) {
    if (error instanceof AdminCheckError) {
      return NextResponse.json({ error: 'Admin check unavailable' }, { status: 503 });
    }
    console.error('[Admin Referral Contests DELETE]', error);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}
