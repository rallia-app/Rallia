/**
 * resend-webhook Edge Function
 *
 * Receives Resend's email events (delivered / opened / clicked / bounced /
 * complained), verifies the Svix signature, and persists them. Two effects:
 *
 *   1. Bounces and complaints flip `profile.email_status` to 'bouncing' /
 *      'complained' so the morning digest eligibility RPC excludes the user.
 *      Complaints additionally write a notification_preference opt-out so the
 *      user is excluded permanently even if email_status is later reset.
 *   2. All event types append a row to `digest_event` for telemetry.
 *
 * Resend webhook URL configuration:
 *   https://<project>.supabase.co/functions/v1/resend-webhook
 * Required env: RESEND_WEBHOOK_SECRET (the Svix signing secret from Resend's
 *               webhook config), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Webhook } from 'https://esm.sh/svix@1';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const webhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET');

if (!webhookSecret) throw new Error('RESEND_WEBHOOK_SECRET is required');

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const wh = new Webhook(webhookSecret);

// =============================================================================
// EVENT TYPES (Resend's payload shape)
// =============================================================================

interface ResendEventBase {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    to?: string[];
    from?: string;
    subject?: string;
    [key: string]: unknown;
  };
}

const RELEVANT_EVENTS = new Set([
  'email.delivered',
  'email.opened',
  'email.clicked',
  'email.bounced',
  'email.complained',
]);

// =============================================================================
// HANDLER HELPERS
// =============================================================================

async function getUserIdForResendId(
  supabase: SupabaseClient,
  resendId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('digest_send_log')
    .select('user_id')
    .eq('resend_id', resendId)
    .maybeSingle();
  if (error) {
    console.warn(`[resend-webhook] digest_send_log lookup failed: ${error.message}`);
    return null;
  }
  return data?.user_id ?? null;
}

async function markBounced(
  supabase: SupabaseClient,
  userId: string,
  resendId: string
): Promise<void> {
  await Promise.all([
    supabase.from('profile').update({ email_status: 'bouncing' }).eq('id', userId),
    supabase.from('digest_send_log').update({ status: 'bounced' }).eq('resend_id', resendId),
  ]);
}

async function markComplained(
  supabase: SupabaseClient,
  userId: string,
  resendId: string
): Promise<void> {
  await Promise.all([
    supabase.from('profile').update({ email_status: 'complained' }).eq('id', userId),
    supabase.from('digest_send_log').update({ status: 'complained' }).eq('resend_id', resendId),
    // Permanent opt-out: write the preference row so even if email_status is
    // later reset, the user remains unsubscribed.
    supabase.from('notification_preference').upsert(
      {
        user_id: userId,
        notification_type: 'morning_digest',
        channel: 'email',
        enabled: false,
      },
      { onConflict: 'user_id,notification_type,channel' }
    ),
  ]);
}

async function logEvent(
  supabase: SupabaseClient,
  userId: string | null,
  resendId: string,
  eventType: string,
  occurredAt: string,
  payload: unknown
): Promise<void> {
  const { error } = await supabase.from('digest_event').insert({
    user_id: userId,
    resend_id: resendId,
    event_type: eventType,
    occurred_at: occurredAt,
    payload: payload as Record<string, unknown>,
  });
  if (error) {
    console.warn(`[resend-webhook] digest_event insert failed: ${error.message}`);
  }
}

// =============================================================================
// ENTRY POINT
// =============================================================================

Deno.serve(async req => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rawBody = await req.text();
  const headers = {
    'svix-id': req.headers.get('svix-id') ?? '',
    'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
    'svix-signature': req.headers.get('svix-signature') ?? '',
  };

  // Verify the Svix signature. Throws if invalid.
  let event: ResendEventBase;
  try {
    event = wh.verify(rawBody, headers) as ResendEventBase;
  } catch (err) {
    console.warn(
      `[resend-webhook] signature verification failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!RELEVANT_EVENTS.has(event.type)) {
    // Ack-but-ignore unknown event types (Resend may add more).
    return new Response(JSON.stringify({ ok: true, ignored: event.type }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const resendId = event.data.email_id;
  if (!resendId) {
    return new Response(JSON.stringify({ error: 'Missing email_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = await getUserIdForResendId(supabase, resendId);

  // Apply side-effects before logging so a partial failure leaves the most
  // important state (email_status) updated.
  try {
    if (event.type === 'email.bounced' && userId) {
      await markBounced(supabase, userId, resendId);
      console.log(`[resend-webhook] bounced: user=${userId} resend=${resendId}`);
    } else if (event.type === 'email.complained' && userId) {
      await markComplained(supabase, userId, resendId);
      console.log(`[resend-webhook] complained: user=${userId} resend=${resendId}`);
    }

    await logEvent(supabase, userId, resendId, event.type, event.created_at, event);
  } catch (err) {
    console.error('[resend-webhook] handler error:', err);
    return new Response(
      JSON.stringify({
        error: 'Internal error',
        details: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
