/**
 * send-broadcast Edge Function
 *
 * Sends an admin-composed email broadcast to a pre-resolved recipient list.
 * Invoked by the Next.js admin route POST /api/admin/broadcasts, which owns
 * auth (super_admin), audience resolution (get_broadcast_recipients RPC), and
 * the email_broadcast campaign row. This function is a thin render + send +
 * log service modeled on send-morning-digest:
 *   - bounded-concurrency per-recipient send via Resend
 *   - skips @fake-rallia.com seed users (isFakeSeedEmail)
 *   - per-recipient signed unsubscribe token + RFC 8058 List-Unsubscribe header
 *   - logs each send to email_broadcast_recipient and updates email_broadcast
 *
 * Auth: requires the project secret key in the `apikey` header
 * (requireSecretApikey), same as the other server-to-server functions.
 */

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { SignJWT } from 'https://esm.sh/jose@5';

import { isFakeSeedEmail } from '../_shared/email-guards.ts';

import { renderBroadcastEmail } from './template.ts';

// =============================================================================
// CONFIG
// =============================================================================

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const resendApiKey = Deno.env.get('RESEND_API_KEY');
const fromEmail = Deno.env.get('FROM_EMAIL');
const jwtSecret = Deno.env.get('JWT_SECRET') ?? Deno.env.get('SUPABASE_JWT_SECRET');
const appUrl =
  Deno.env.get('NEXT_PUBLIC_BASE_URL') ??
  Deno.env.get('NEXT_PUBLIC_SITE_URL') ??
  'https://rallia.app';

if (!resendApiKey) throw new Error('RESEND_API_KEY is required');
if (!fromEmail) throw new Error('FROM_EMAIL is required');
// jwtSecret is validated lazily: it's only needed to sign per-recipient
// unsubscribe tokens for real broadcasts, not for test sends.

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const resend = new Resend(resendApiKey);

/** Bounded concurrency for the per-recipient send loop. */
const SEND_CONCURRENCY = 8;
/** Soft deadline; stop dispatching new recipients when crossed. */
const MAX_RUN_MS = 240_000;

const ENC = new TextEncoder();

// =============================================================================
// TYPES
// =============================================================================

interface Recipient {
  userId: string;
  email: string;
  firstName: string | null;
  locale: string | null;
}

interface BroadcastRequest {
  broadcastId?: string;
  subject?: string;
  body?: string;
  ctaText?: string | null;
  ctaUrl?: string | null;
  recipients?: Recipient[];
  /** When set, send a single preview to this address (no logging, no opt-out filtering). */
  testEmail?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

async function buildUnsubscribeUrl(userId: string, secret: string): Promise<string> {
  const token = await new SignJWT({ aud: 'admin_broadcast_unsub' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('60d')
    .sign(ENC.encode(secret));
  return `${appUrl}/api/broadcast/unsubscribe?token=${encodeURIComponent(token)}`;
}

/**
 * Authorize the caller by validating the forwarded admin session token
 * (x-admin-token, set by the Next.js /api/admin/broadcasts route) and
 * confirming the user is a super_admin. This avoids depending on a shared
 * static secret matching across the web and edge environments — it validates
 * the actual admin session, so it works identically locally and in prod.
 */
async function authorizeAdmin(req: Request): Promise<{ userId: string } | Response> {
  const token = (req.headers.get('x-admin-token') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ success: false, error: 'Unauthorized' }, 401);

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) return json({ success: false, error: 'Unauthorized' }, 401);

  const { data: admin } = await supabase
    .from('admin')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (!admin || admin.role !== 'super_admin') {
    return json({ success: false, error: 'Forbidden' }, 403);
  }
  return { userId: user.id };
}

/**
 * Bounded parallel-map. Runs `fn` for every item with at most `concurrency` in
 * flight. Each item is processed in its own try/catch by the caller.
 */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(concurrency, items.length); w++) {
    workers.push(
      (async () => {
        while (true) {
          const i = cursor++;
          if (i >= items.length) return;
          await fn(items[i], i);
        }
      })()
    );
  }
  await Promise.all(workers);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// =============================================================================
// ENTRY POINT
// =============================================================================

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
      },
    });
  }

  const auth = await authorizeAdmin(req);
  if (auth instanceof Response) return auth;

  let payload: BroadcastRequest;
  try {
    payload = (await req.json()) as BroadcastRequest;
  } catch {
    return json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const subject = payload.subject?.trim();
  const body = payload.body?.trim();
  if (!subject || !body) {
    return json({ success: false, error: 'subject and body are required' }, 400);
  }

  const ctaText = payload.ctaText?.trim() || null;
  const ctaUrl = payload.ctaUrl?.trim() || null;

  // ---- Test mode: single preview send, no logging --------------------------
  if (payload.testEmail) {
    const previewRecipient = payload.recipients?.[0];
    const { subject: s, html } = renderBroadcastEmail({
      subject,
      body,
      ctaText,
      ctaUrl,
      firstName: previewRecipient?.firstName ?? null,
      locale: previewRecipient?.locale ?? 'en-US',
      unsubscribeUrl: `${appUrl}/api/broadcast/unsubscribe?token=preview`,
    });
    const { data, error } = await resend.emails.send({
      from: fromEmail!,
      to: payload.testEmail,
      subject: s,
      html,
    });
    if (error) {
      console.error(`[send-broadcast] test send failed: ${error.message}`);
      return json({ success: false, error: error.message }, 400);
    }
    console.log(`[send-broadcast] test email sent to ${payload.testEmail} (${data?.id})`);
    return json({ success: true, test: true, id: data?.id });
  }

  // ---- Broadcast send ------------------------------------------------------
  const recipients = payload.recipients ?? [];
  const broadcastId = payload.broadcastId;

  // Real broadcasts ship per-recipient unsubscribe links — require the signing
  // secret here (test sends above don't reach this point).
  if (!jwtSecret) {
    if (broadcastId) {
      await supabase.from('email_broadcast').update({ status: 'failed' }).eq('id', broadcastId);
    }
    return json(
      {
        success: false,
        error: 'SUPABASE_JWT_SECRET is not configured (required for unsubscribe links)',
      },
      500
    );
  }
  const secret = jwtSecret;
  const startTime = Date.now();

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let deferred = 0;
  let stopDispatching = false;
  const logRows: Array<{
    broadcast_id: string;
    user_id: string;
    email: string;
    resend_id: string | null;
    status: 'sent' | 'failed';
  }> = [];

  await runWithConcurrency(recipients, SEND_CONCURRENCY, async recipient => {
    if (stopDispatching) {
      deferred++;
      return;
    }
    if (Date.now() - startTime > MAX_RUN_MS) {
      stopDispatching = true;
      deferred++;
      return;
    }
    if (isFakeSeedEmail(recipient.email)) {
      skipped++;
      return;
    }

    try {
      const unsubscribeUrl = await buildUnsubscribeUrl(recipient.userId, secret);
      const { subject: s, html } = renderBroadcastEmail({
        subject,
        body,
        ctaText,
        ctaUrl,
        firstName: recipient.firstName,
        locale: recipient.locale ?? 'en-US',
        unsubscribeUrl,
      });

      const { data, error } = await resend.emails.send({
        from: fromEmail!,
        to: recipient.email,
        subject: s,
        html,
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      });

      if (error) {
        failed++;
        if (broadcastId) {
          logRows.push({
            broadcast_id: broadcastId,
            user_id: recipient.userId,
            email: recipient.email,
            resend_id: null,
            status: 'failed',
          });
        }
        console.error(`[send-broadcast] Resend error for ${recipient.email}: ${error.message}`);
        return;
      }

      sent++;
      if (broadcastId) {
        logRows.push({
          broadcast_id: broadcastId,
          user_id: recipient.userId,
          email: recipient.email,
          resend_id: data?.id ?? null,
          status: 'sent',
        });
      }
    } catch (err) {
      failed++;
      if (broadcastId) {
        logRows.push({
          broadcast_id: broadcastId,
          user_id: recipient.userId,
          email: recipient.email,
          resend_id: null,
          status: 'failed',
        });
      }
      console.error(
        `[send-broadcast] Error for ${recipient.email}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });

  // Persist per-recipient log + aggregate counts.
  if (broadcastId) {
    for (let i = 0; i < logRows.length; i += 500) {
      const { error: insertError } = await supabase
        .from('email_broadcast_recipient')
        .insert(logRows.slice(i, i + 500));
      if (insertError) {
        console.error(`[send-broadcast] recipient log insert failed: ${insertError.message}`);
      }
    }

    const status = failed === 0 && !stopDispatching ? 'sent' : sent > 0 ? 'partial' : 'failed';
    const { error: updateError } = await supabase
      .from('email_broadcast')
      .update({
        sent_count: sent,
        failed_count: failed,
        status,
        completed_at: new Date().toISOString(),
      })
      .eq('id', broadcastId);
    if (updateError) {
      console.error(`[send-broadcast] broadcast update failed: ${updateError.message}`);
    }
  }

  const durationMs = Date.now() - startTime;
  console.log(
    `[send-broadcast] Done: ${sent} sent, ${failed} failed, ${skipped} skipped (seed), ${deferred} deferred, ${durationMs}ms`
  );

  return json({
    success: true,
    sent,
    failed,
    skipped,
    deferred,
    total: recipients.length,
    durationMs,
  });
});
