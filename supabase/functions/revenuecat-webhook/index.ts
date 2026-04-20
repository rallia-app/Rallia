import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RC_WEBHOOK_SECRET = Deno.env.get('RC_WEBHOOK_SECRET')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type SubscriptionStatus = 'none' | 'active' | 'cancelling' | 'expired' | 'billing_issue' | 'paused';

interface RevenueCatEvent {
  type: string;
  app_user_id: string;
  original_app_user_id?: string;
  product_id?: string;
  store?: string;
  original_transaction_id?: string;
  period_type?: string;
  purchased_at_ms?: number;
  expiration_at_ms?: number;
  grace_period_expiration_at_ms?: number;
  cancel_reason?: string;
  transferred_from?: string[];
  transferred_to?: string[];
  entitlement_ids?: string[];
}

interface WebhookPayload {
  event: RevenueCatEvent;
}

function eventToStatus(eventType: string): SubscriptionStatus | null {
  switch (eventType) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'UNCANCELLATION':
    case 'PRODUCT_CHANGE':
      return 'active';
    case 'CANCELLATION':
      return 'cancelling';
    case 'BILLING_ISSUE':
      return 'billing_issue';
    case 'EXPIRATION':
    case 'REFUND':
      return 'expired';
    case 'SUBSCRIBER_ALIAS':
      return null; // Log only
    default:
      return null;
  }
}

Deno.serve(async (req: Request) => {
  // Only accept POST
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Verify shared secret
  const authHeader = req.headers.get('Authorization');
  const expectedAuth = `Bearer ${RC_WEBHOOK_SECRET}`;
  if (!authHeader || authHeader !== expectedAuth) {
    console.error('Unauthorized webhook request');
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const event = payload.event;
  if (!event || !event.type || !event.app_user_id) {
    return new Response('Missing event data', { status: 400 });
  }

  console.log(`RevenueCat webhook: ${event.type} for user ${event.app_user_id}`);

  // SUBSCRIBER_ALIAS: just log, no DB update
  if (event.type === 'SUBSCRIBER_ALIAS') {
    return new Response('OK', { status: 200 });
  }

  // TRANSFER: update customer ID reference
  if (event.type === 'TRANSFER') {
    const newUserId = event.transferred_to?.[0];
    if (newUserId) {
      await supabase
        .from('player_subscription')
        .update({ revenuecat_customer_id: newUserId, updated_at: new Date().toISOString() })
        .eq('player_id', event.app_user_id);
    }
    return new Response('OK', { status: 200 });
  }

  const newStatus = eventToStatus(event.type);
  if (newStatus === null) {
    console.log(`Ignoring unknown event type: ${event.type}`);
    return new Response('OK', { status: 200 });
  }

  // Check if the player exists before upserting
  const { data: player } = await supabase
    .from('player')
    .select('id')
    .eq('id', event.app_user_id)
    .maybeSingle();

  if (!player) {
    console.log(`Player ${event.app_user_id} not found, skipping subscription upsert`);
    return new Response('OK', { status: 200 });
  }

  const updateData: Record<string, unknown> = {
    player_id: event.app_user_id,
    revenuecat_customer_id: event.app_user_id,
    status: newStatus,
    last_revenuecat_event: event.type,
    store: event.store ?? null,
    product_identifier: event.product_id ?? null,
    original_transaction_id: event.original_transaction_id ?? null,
    updated_at: new Date().toISOString(),
  };

  // Set period dates
  if (event.purchased_at_ms) {
    updateData.current_period_start = new Date(event.purchased_at_ms).toISOString();
  }
  if (event.expiration_at_ms) {
    updateData.current_period_end = new Date(event.expiration_at_ms).toISOString();
  }

  // Billing issue: set grace period
  if (event.type === 'BILLING_ISSUE') {
    updateData.in_grace_period = true;
    if (event.grace_period_expiration_at_ms) {
      updateData.grace_period_expires_at = new Date(
        event.grace_period_expiration_at_ms
      ).toISOString();
    }
  }

  // Renewal: clear grace period
  if (event.type === 'RENEWAL') {
    updateData.in_grace_period = false;
    updateData.grace_period_expires_at = null;
    updateData.cancellation_date = null;
  }

  // Cancellation: record date
  if (event.type === 'CANCELLATION') {
    updateData.cancellation_date = new Date().toISOString();
  }

  // Uncancellation / re-subscribe: clear cancellation
  if (event.type === 'UNCANCELLATION' || event.type === 'INITIAL_PURCHASE') {
    updateData.cancellation_date = null;
    updateData.in_grace_period = false;
    updateData.grace_period_expires_at = null;
  }

  // Expiration / Refund: clear all active fields
  if (event.type === 'EXPIRATION' || event.type === 'REFUND') {
    updateData.in_grace_period = false;
    updateData.grace_period_expires_at = null;
  }

  try {
    const { error } = await supabase.from('player_subscription').upsert(updateData, {
      onConflict: 'player_id',
    });

    if (error) {
      console.error('Error upserting player_subscription:', error);
      // Return 200 anyway — RC will retry on non-2xx, causing duplicates
      return new Response('OK (db error logged)', { status: 200 });
    }
  } catch (err) {
    console.error('Unexpected error in webhook handler:', err);
    return new Response('OK (error logged)', { status: 200 });
  }

  return new Response('OK', { status: 200 });
});
