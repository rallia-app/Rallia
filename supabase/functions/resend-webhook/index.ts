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

import { captureEvent } from '../_shared/posthog.ts';

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

/** Which kind of send a resend_id belongs to (drives the per-recipient log
 *  table and the opt-out category written on complaint). */
type SendSource = 'digest' | 'broadcast';

/** Notification type to opt the user out of when they complain, per source. */
const OPT_OUT_TYPE: Record<SendSource, 'morning_digest' | 'admin_broadcast'> = {
  digest: 'morning_digest',
  broadcast: 'admin_broadcast',
};

/**
 * Map a resend_id back to its user + source. Checks the digest log first, then
 * the broadcast recipient log, so events from both email systems tie back to
 * the right user and table.
 */
async function resolveSend(
  supabase: SupabaseClient,
  resendId: string
): Promise<{ userId: string | null; source: SendSource | null }> {
  const digest = await supabase
    .from('digest_send_log')
    .select('user_id')
    .eq('resend_id', resendId)
    .maybeSingle();
  if (digest.error) {
    console.warn(`[resend-webhook] digest_send_log lookup failed: ${digest.error.message}`);
  } else if (digest.data) {
    return { userId: digest.data.user_id, source: 'digest' };
  }

  const broadcast = await supabase
    .from('email_broadcast_recipient')
    .select('user_id')
    .eq('resend_id', resendId)
    .maybeSingle();
  if (broadcast.error) {
    console.warn(
      `[resend-webhook] email_broadcast_recipient lookup failed: ${broadcast.error.message}`
    );
  } else if (broadcast.data) {
    return { userId: broadcast.data.user_id ?? null, source: 'broadcast' };
  }

  return { userId: null, source: null };
}

/** Reflect a bounce/complaint on the originating per-recipient log row. */
async function updateSendStatus(
  supabase: SupabaseClient,
  source: SendSource,
  resendId: string,
  status: 'bounced' | 'complained'
): Promise<void> {
  const table = source === 'digest' ? 'digest_send_log' : 'email_broadcast_recipient';
  await supabase.from(table).update({ status }).eq('resend_id', resendId);
}

async function markBounced(
  supabase: SupabaseClient,
  userId: string | null,
  resendId: string,
  source: SendSource | null
): Promise<void> {
  await Promise.all([
    userId
      ? supabase.from('profile').update({ email_status: 'bouncing' }).eq('id', userId)
      : Promise.resolve(),
    source ? updateSendStatus(supabase, source, resendId, 'bounced') : Promise.resolve(),
  ]);
}

async function markComplained(
  supabase: SupabaseClient,
  userId: string | null,
  resendId: string,
  source: SendSource | null
): Promise<void> {
  const ops: PromiseLike<unknown>[] = [];
  if (userId) {
    ops.push(supabase.from('profile').update({ email_status: 'complained' }).eq('id', userId));
  }
  if (source) {
    ops.push(updateSendStatus(supabase, source, resendId, 'complained'));
  }
  // Permanent opt-out for the category they complained about: write the
  // preference row so even if email_status is later reset, the user stays
  // unsubscribed.
  if (userId && source) {
    ops.push(
      supabase.from('notification_preference').upsert(
        {
          user_id: userId,
          notification_type: OPT_OUT_TYPE[source],
          channel: 'email',
          enabled: false,
        },
        { onConflict: 'user_id,notification_type,channel' }
      )
    );
  }
  await Promise.all(ops);
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

  const { userId, source } = await resolveSend(supabase, resendId);

  // Apply side-effects before logging so a partial failure leaves the most
  // important state (email_status) updated.
  try {
    if (event.type === 'email.bounced') {
      await markBounced(supabase, userId, resendId, source);
      console.log(`[resend-webhook] bounced: user=${userId} source=${source} resend=${resendId}`);
    } else if (event.type === 'email.complained') {
      await markComplained(supabase, userId, resendId, source);
      console.log(
        `[resend-webhook] complained: user=${userId} source=${source} resend=${resendId}`
      );
    }

    await logEvent(supabase, userId, resendId, event.type, event.created_at, event);

    // Mirror the lifecycle to PostHog so the email funnel
    // (sent → delivered → opened → clicked) is visible in dashboards.
    // Skipped if userId is null (we couldn't map the email back to a user).
    if (userId) {
      const eventNameMap: Record<string, string> = {
        'email.delivered': 'email_delivered',
        'email.opened': 'email_opened',
        'email.clicked': 'email_clicked',
        'email.bounced': 'email_bounced',
        'email.complained': 'email_complained',
      };
      const phEvent = eventNameMap[event.type];
      if (phEvent) {
        void captureEvent({
          distinctId: userId,
          event: phEvent,
          properties: {
            resend_id: resendId,
            // Resend's link-click events include the clicked URL in data.click.link
            // (when present). For other event types this is undefined and dropped.
            link: (event.data as { click?: { link?: string } })?.click?.link,
            subject: event.data.subject,
            from: event.data.from,
          },
        });
      }
    }
  } catch (err) {
    console.error('[resend-webhook] handler error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
