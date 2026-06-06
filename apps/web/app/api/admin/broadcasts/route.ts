import {
  getAuthedAdminBroadcastDb,
  parseSegment,
  resolveSegmentRecipients,
  type Recipient,
} from '@/lib/admin/broadcasts';
import { createServiceRoleClient } from '@/lib/supabase/server';
import type { Json } from '@/types';
import { NextRequest, NextResponse } from 'next/server';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Parse + validate a recipient list (array or delimited string) into deduped, lowercased emails. */
function parseEmails(raw: unknown): string[] {
  const tokens = Array.isArray(raw)
    ? raw.flatMap(v => (typeof v === 'string' ? v.split(/[\s,;]+/) : []))
    : typeof raw === 'string'
      ? raw.split(/[\s,;]+/)
      : [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const email = token.trim().toLowerCase();
    if (email && EMAIL_RE.test(email)) seen.add(email);
  }
  return [...seen];
}

/**
 * Build the recipient list from an explicit email list. Matches against profile
 * to enrich known users with their id/name/locale (so they get personalization
 * and a working unsubscribe link); unmatched addresses are sent as-is.
 */
async function resolveRecipients(
  adminDb: ReturnType<typeof createServiceRoleClient>,
  emails: string[]
): Promise<Recipient[]> {
  if (emails.length === 0) return [];

  const { data, error } = await adminDb
    .from('profile')
    .select('id, email, first_name, preferred_locale')
    .in('email', emails);

  if (error) {
    throw new Error(`profile lookup failed: ${error.message}`);
  }

  const byEmail = new Map(
    (data ?? [])
      .filter((p): p is typeof p & { email: string } => Boolean(p.email))
      .map(p => [p.email.toLowerCase(), p])
  );

  // Honor broadcast opt-out. The in-app settings toggle AND the email
  // unsubscribe link both write notification_preference(admin_broadcast, email,
  // enabled=false). Drop those known users so they don't receive the broadcast.
  // (Default is opt-in, so a missing row = still subscribed; external addresses
  // with no matching profile can't opt out here and are sent as-is.)
  const matchedUserIds = [...byEmail.values()].map(p => p.id);
  const optedOut = new Set<string>();
  if (matchedUserIds.length > 0) {
    const { data: prefs, error: prefError } = await adminDb
      .from('notification_preference')
      .select('user_id')
      .eq('notification_type', 'admin_broadcast')
      .eq('channel', 'email')
      .eq('enabled', false)
      .in('user_id', matchedUserIds);
    if (prefError) {
      throw new Error(`broadcast opt-out lookup failed: ${prefError.message}`);
    }
    for (const row of prefs ?? []) optedOut.add(row.user_id);
  }

  return emails
    .map(email => {
      const p = byEmail.get(email);
      return p
        ? { userId: p.id, email: p.email, firstName: p.first_name, locale: p.preferred_locale }
        : { userId: null, email, firstName: null, locale: null };
    })
    .filter(r => !(r.userId !== null && optedOut.has(r.userId)));
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
    const { user, adminDb, accessToken, error } = await getAuthedAdminBroadcastDb();
    if (error || !adminDb || !user) {
      return NextResponse.json({ error }, { status: error === 'Unauthorized' ? 401 : 403 });
    }

    const raw = (await request.json()) as Record<string, unknown>;
    const action = typeof raw.action === 'string' ? raw.action : 'send';

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

    // ---- send: resolve recipients, persist campaign, dispatch ------------
    // Audience is either a pasted email list or a segment resolved server-side
    // via get_broadcast_recipients (consent + deliverability baked in).
    const audienceMode = raw.audienceMode === 'segment' ? 'segment' : 'list';
    let recipients: Recipient[];
    let audienceMeta: Record<string, unknown>;

    if (audienceMode === 'segment') {
      const filters = parseSegment(raw.segment);
      recipients = await resolveSegmentRecipients(adminDb, filters);
      audienceMeta = { source: 'segment', count: recipients.length, filters };
    } else {
      const emails = parseEmails(raw.emails);
      if (emails.length === 0) {
        return NextResponse.json({ error: 'No valid recipient emails provided' }, { status: 400 });
      }
      recipients = await resolveRecipients(adminDb, emails);
      audienceMeta = { source: 'email_list', count: recipients.length };
    }

    if (recipients.length === 0) {
      return NextResponse.json(
        { error: 'No eligible recipients for this audience' },
        { status: 400 }
      );
    }

    const { data: broadcast, error: insertError } = await adminDb
      .from('email_broadcast')
      .insert({
        created_by: user.id,
        subject: content.subject,
        body: content.body,
        cta_text: content.ctaText,
        cta_url: content.ctaUrl,
        audience: audienceMeta as unknown as Json,
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
    const { adminDb, error } = await getAuthedAdminBroadcastDb();
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
