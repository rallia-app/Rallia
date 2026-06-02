import { requireApiRole } from '@/lib/supabase/check-admin';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import type { Json } from '@/types';
import { NextRequest, NextResponse } from 'next/server';

// Email broadcasts are a high-impact action (can reach every user) — super_admin only.
const ALLOWED_ROLES = ['super_admin'];

interface Audience {
  sportId?: string | null;
  city?: string | null;
  locale?: string | null;
  activeSince?: string | null;
  onlySubscribers?: boolean | null;
}

interface Recipient {
  userId: string;
  email: string;
  firstName: string | null;
  locale: string | null;
}

async function getAuthedAdminDb() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { user: null, adminDb: null, accessToken: null, error: 'Unauthorized' as const };
  }

  const { allowed } = await requireApiRole(user.id, ALLOWED_ROLES);
  if (!allowed) {
    return { user: null, adminDb: null, accessToken: null, error: 'Forbidden' as const };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  return {
    user,
    adminDb: createServiceRoleClient(),
    accessToken: session?.access_token ?? null,
    error: null,
  };
}

/** Resolve the eligible recipient list for an audience via the consent-aware RPC. */
async function resolveRecipients(
  adminDb: ReturnType<typeof createServiceRoleClient>,
  audience: Audience
): Promise<Recipient[]> {
  const { data, error } = await adminDb.rpc('get_broadcast_recipients', {
    p_sport_id: audience.sportId ?? undefined,
    p_city: audience.city ?? undefined,
    p_locale: audience.locale ?? undefined,
    p_active_since: audience.activeSince ?? undefined,
    p_only_subscribers: audience.onlySubscribers ?? undefined,
  });

  if (error) {
    throw new Error(`get_broadcast_recipients failed: ${error.message}`);
  }

  return (data ?? []).map(row => ({
    userId: row.user_id,
    email: row.email,
    firstName: row.first_name,
    locale: row.preferred_locale,
  }));
}

/** Invoke the send-broadcast edge function, forwarding the admin session token. */
async function invokeSendBroadcast(
  payload: Record<string, unknown>,
  accessToken: string
): Promise<{
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const gatewayKey =
    process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !gatewayKey) {
    throw new Error('Supabase configuration missing');
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/send-broadcast`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Gateway auth uses the anon/publishable key; app auth is the forwarded
      // admin session token, which send-broadcast validates (getUser + role).
      apikey: gatewayKey,
      Authorization: `Bearer ${gatewayKey}`,
      'x-admin-token': accessToken,
    },
    body: JSON.stringify(payload),
  });

  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON response */
  }
  return { ok: res.ok, status: res.status, body };
}

function parseContent(raw: Record<string, unknown>): {
  subject: string;
  body: string;
  ctaText: string | null;
  ctaUrl: string | null;
  error?: string;
} {
  const subject = typeof raw.subject === 'string' ? raw.subject.trim() : '';
  const body = typeof raw.body === 'string' ? raw.body.trim() : '';
  const ctaText = typeof raw.ctaText === 'string' ? raw.ctaText.trim() : '';
  const ctaUrl = typeof raw.ctaUrl === 'string' ? raw.ctaUrl.trim() : '';

  if (!subject || !body) {
    return { subject, body, ctaText: null, ctaUrl: null, error: 'subject and body are required' };
  }
  if ((ctaText && !ctaUrl) || (!ctaText && ctaUrl)) {
    return {
      subject,
      body,
      ctaText: null,
      ctaUrl: null,
      error: 'CTA requires both a label and a URL',
    };
  }
  return { subject, body, ctaText: ctaText || null, ctaUrl: ctaUrl || null };
}

export async function POST(request: NextRequest) {
  try {
    const { user, adminDb, accessToken, error } = await getAuthedAdminDb();
    if (error || !adminDb || !user) {
      return NextResponse.json({ error }, { status: error === 'Unauthorized' ? 401 : 403 });
    }

    const raw = (await request.json()) as Record<string, unknown>;
    const action = typeof raw.action === 'string' ? raw.action : 'send';
    const audience = (raw.audience ?? {}) as Audience;

    // ---- count: recipient preview ----------------------------------------
    if (action === 'count') {
      const recipients = await resolveRecipients(adminDb, audience);
      return NextResponse.json({ count: recipients.length });
    }

    const content = parseContent(raw);
    if (content.error) {
      return NextResponse.json({ error: content.error }, { status: 400 });
    }

    // ---- test: single preview send to the admin --------------------------
    if (action === 'test') {
      const testEmail =
        (typeof raw.testEmail === 'string' && raw.testEmail.trim()) || user.email || '';
      if (!testEmail) {
        return NextResponse.json({ error: 'No test email address available' }, { status: 400 });
      }
      const previewLocale = typeof raw.locale === 'string' ? raw.locale : 'en-US';
      const result = await invokeSendBroadcast(
        {
          subject: content.subject,
          body: content.body,
          ctaText: content.ctaText,
          ctaUrl: content.ctaUrl,
          testEmail,
          recipients: [
            { userId: user.id, email: testEmail, firstName: null, locale: previewLocale },
          ],
        },
        accessToken ?? ''
      );
      if (!result.ok || !result.body.success) {
        return NextResponse.json(
          { error: (result.body.error as string) ?? 'Test send failed' },
          { status: 502 }
        );
      }
      return NextResponse.json({ success: true, testEmail });
    }

    // ---- send: resolve audience, persist campaign, dispatch --------------
    const recipients = await resolveRecipients(adminDb, audience);
    if (recipients.length === 0) {
      return NextResponse.json({ error: 'No recipients match this audience' }, { status: 400 });
    }

    const { data: broadcast, error: insertError } = await adminDb
      .from('email_broadcast')
      .insert({
        created_by: user.id,
        subject: content.subject,
        body: content.body,
        cta_text: content.ctaText,
        cta_url: content.ctaUrl,
        audience: (audience ?? {}) as unknown as Json,
        recipients_total: recipients.length,
        status: 'sending',
      })
      .select()
      .single();

    if (insertError || !broadcast) {
      return NextResponse.json(
        { error: insertError?.message ?? 'Failed to create broadcast' },
        { status: 500 }
      );
    }

    let result: Awaited<ReturnType<typeof invokeSendBroadcast>>;
    try {
      result = await invokeSendBroadcast(
        {
          broadcastId: broadcast.id,
          subject: content.subject,
          body: content.body,
          ctaText: content.ctaText,
          ctaUrl: content.ctaUrl,
          recipients,
        },
        accessToken ?? ''
      );
    } catch (invokeError) {
      await adminDb.from('email_broadcast').update({ status: 'failed' }).eq('id', broadcast.id);
      return NextResponse.json(
        {
          error:
            invokeError instanceof Error ? invokeError.message : 'Failed to dispatch broadcast',
        },
        { status: 502 }
      );
    }

    if (!result.ok || !result.body.success) {
      await adminDb.from('email_broadcast').update({ status: 'failed' }).eq('id', broadcast.id);
      return NextResponse.json(
        { error: (result.body.error as string) ?? 'Broadcast dispatch failed' },
        { status: 502 }
      );
    }

    await adminDb.rpc('log_admin_action', {
      p_admin_id: user.id,
      p_action_type: 'send',
      p_entity_type: 'email_broadcast',
      p_entity_id: broadcast.id,
      p_new_data: {
        subject: content.subject,
        audience,
        recipients_total: recipients.length,
        sent: result.body.sent ?? null,
        failed: result.body.failed ?? null,
      } as unknown as Json,
    });

    return NextResponse.json({
      success: true,
      broadcastId: broadcast.id,
      total: recipients.length,
      sent: result.body.sent ?? 0,
      failed: result.body.failed ?? 0,
      skipped: result.body.skipped ?? 0,
    });
  } catch (err) {
    console.error('[Admin Broadcasts POST]', err);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const { adminDb, error } = await getAuthedAdminDb();
    if (error || !adminDb) {
      return NextResponse.json({ error }, { status: error === 'Unauthorized' ? 401 : 403 });
    }

    const { data, error: queryError } = await adminDb
      .from('email_broadcast')
      .select(
        'id, subject, audience, recipients_total, sent_count, failed_count, status, created_at, completed_at'
      )
      .order('created_at', { ascending: false })
      .limit(50);

    if (queryError) {
      return NextResponse.json({ error: queryError.message }, { status: 500 });
    }

    return NextResponse.json({ broadcasts: data ?? [] });
  } catch (err) {
    console.error('[Admin Broadcasts GET]', err);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}
