import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RC_WEBHOOK_SECRET = Deno.env.get('RC_WEBHOOK_SECRET')!;
const RC_REST_API_KEY = Deno.env.get('RC_REST_API_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Must match PRO_ENTITLEMENT_ID in apps/mobile/src/lib/revenuecat.ts
const ENTITLEMENT_ID = 'Rallia Pro';

const RC_PROJECT_ID = 'proj02ddbd04';
const RC_API_BASE = 'https://api.revenuecat.com/v2';

type SubscriptionStatus = 'none' | 'active' | 'cancelling' | 'expired' | 'billing_issue' | 'paused';

interface RevenueCatEvent {
  id: string;
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

// v2 API response shapes (https://www.revenuecat.com/reference/api-v2)
interface RcActiveEntitlement {
  object: 'customer.active_entitlement';
  entitlement_id: string;
  lookup_key: string;
  expires_at: number | null; // ms timestamp
  created_at: number;
}

type RcSubStatus =
  | 'trialing'
  | 'active'
  | 'expired'
  | 'in_grace_period'
  | 'in_billing_retry'
  | 'paused'
  | 'unknown'
  | 'incomplete';

type RcAutoRenewal = 'will_renew' | 'will_not_renew' | 'will_change_product' | 'will_pause';

// v2 subscription response shape — confirmed against an actual Test Store sub.
// `product_id` is RC's internal id (e.g. "prodb81b2559cb"), not the store SKU.
interface RcSubscription {
  object: 'subscription';
  id: string;
  status: RcSubStatus;
  store: string;
  store_subscription_identifier: string | null;
  product_id: string;
  starts_at: number;
  current_period_starts_at: number | null;
  current_period_ends_at: number | null;
  ends_at: number | null;
  gives_access: boolean;
  auto_renewal_status: RcAutoRenewal;
  presented_offering_id: string | null;
  environment: 'sandbox' | 'production';
}

interface RcListResponse<T> {
  object: 'list';
  items: T[];
  next_page: string | null;
  url: string;
}

interface DerivedState {
  status: SubscriptionStatus;
  product_identifier: string | null;
  store: string | null;
  original_transaction_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  in_grace_period: boolean;
  grace_period_expires_at: string | null;
  cancellation_date: string | null;
}

interface RcCustomerState {
  activeEntitlements: RcActiveEntitlement[];
  subscriptions: RcSubscription[];
}

// Fetches both active entitlements + subscriptions in parallel. A 404 from
// either endpoint means the customer doesn't exist in RC yet — return empty
// arrays and let deriveState resolve to status 'none'.
async function fetchCustomerState(appUserId: string): Promise<RcCustomerState | null> {
  const id = encodeURIComponent(appUserId);
  const headers = { Authorization: `Bearer ${RC_REST_API_KEY}` };

  const [entRes, subRes] = await Promise.all([
    fetch(`${RC_API_BASE}/projects/${RC_PROJECT_ID}/customers/${id}/active_entitlements`, {
      headers,
    }),
    fetch(`${RC_API_BASE}/projects/${RC_PROJECT_ID}/customers/${id}/subscriptions`, { headers }),
  ]);

  // 404 = customer doesn't exist in RC; treat as empty (no entitlements, no subs)
  if (entRes.status === 404 && subRes.status === 404) {
    return { activeEntitlements: [], subscriptions: [] };
  }

  if (!entRes.ok && entRes.status !== 404) {
    console.error(`RC active_entitlements ${entRes.status}`, await entRes.text());
    return null;
  }
  if (!subRes.ok && subRes.status !== 404) {
    console.error(`RC subscriptions ${subRes.status}`, await subRes.text());
    return null;
  }

  const entJson =
    entRes.status === 404
      ? { items: [] as RcActiveEntitlement[] }
      : ((await entRes.json()) as RcListResponse<RcActiveEntitlement>);
  const subJson =
    subRes.status === 404
      ? { items: [] as RcSubscription[] }
      : ((await subRes.json()) as RcListResponse<RcSubscription>);

  return {
    activeEntitlements: entJson.items,
    subscriptions: subJson.items,
  };
}

function isoOrNull(ms: number | null | undefined): string | null {
  return ms ? new Date(ms).toISOString() : null;
}

function deriveState(state: RcCustomerState): DerivedState {
  const empty: DerivedState = {
    status: 'none',
    product_identifier: null,
    store: null,
    original_transaction_id: null,
    current_period_start: null,
    current_period_end: null,
    in_grace_period: false,
    grace_period_expires_at: null,
    cancellation_date: null,
  };

  const activeEnt = state.activeEntitlements.find(e => e.lookup_key === ENTITLEMENT_ID);

  // Pick the most recent subscription by start time for status detail.
  // When entitlement is active, prefer the access-granting one.
  const sortedSubs = [...state.subscriptions].sort((a, b) => b.starts_at - a.starts_at);
  const accessSub = sortedSubs.find(s => s.gives_access);
  const lastSub = accessSub ?? sortedSubs[0] ?? null;

  if (!activeEnt && !lastSub) return empty;

  if (!activeEnt) {
    // Had a sub at some point but no longer entitled — status from the last sub.
    return {
      status: mapStatus(lastSub),
      product_identifier: lastSub.product_id,
      store: lastSub.store,
      original_transaction_id: lastSub.store_subscription_identifier,
      current_period_start: isoOrNull(lastSub.current_period_starts_at),
      current_period_end: isoOrNull(lastSub.current_period_ends_at),
      in_grace_period: false,
      grace_period_expires_at: null,
      cancellation_date: null,
    };
  }

  // Currently entitled.
  const sub = lastSub;
  const isInGrace = sub?.status === 'in_grace_period' || sub?.status === 'in_billing_retry';
  return {
    status: sub ? mapStatus(sub) : 'active',
    product_identifier: sub?.product_id ?? null,
    store: sub?.store ?? null,
    original_transaction_id: sub?.store_subscription_identifier ?? null,
    current_period_start: isoOrNull(sub?.current_period_starts_at ?? null),
    current_period_end: isoOrNull(activeEnt.expires_at ?? sub?.current_period_ends_at ?? null),
    in_grace_period: isInGrace,
    grace_period_expires_at: isInGrace ? isoOrNull(sub?.current_period_ends_at ?? null) : null,
    cancellation_date: null,
  };
}

function mapStatus(sub: RcSubscription): SubscriptionStatus {
  switch (sub.status) {
    case 'trialing':
    case 'active':
      return sub.auto_renewal_status === 'will_not_renew' ? 'cancelling' : 'active';
    case 'in_grace_period':
    case 'in_billing_retry':
      return 'billing_issue';
    case 'paused':
      return 'paused';
    case 'expired':
    case 'incomplete':
    case 'unknown':
    default:
      return 'expired';
  }
}

async function handleTransfer(event: RevenueCatEvent): Promise<Response> {
  const newUserId = event.transferred_to?.[0];
  const oldUserId = event.app_user_id;
  if (!newUserId) return new Response('OK', { status: 200 });

  // Avoid UNIQUE(player_id) conflict: if destination already has a row,
  // it's authoritative — drop the source row instead of re-pointing.
  const { data: existingDest, error: lookupError } = await supabase
    .from('player_subscription')
    .select('player_id')
    .eq('player_id', newUserId)
    .maybeSingle();

  if (lookupError) {
    console.error('TRANSFER destination lookup failed', lookupError);
    return new Response('transfer failed', { status: 500 });
  }

  if (existingDest) {
    const { error } = await supabase
      .from('player_subscription')
      .delete()
      .eq('player_id', oldUserId);
    if (error) {
      console.error('TRANSFER source delete failed', error);
      return new Response('transfer failed', { status: 500 });
    }
    return new Response('OK', { status: 200 });
  }

  const { error } = await supabase
    .from('player_subscription')
    .update({
      player_id: newUserId,
      revenuecat_customer_id: newUserId,
      updated_at: new Date().toISOString(),
    })
    .eq('player_id', oldUserId);
  if (error) {
    console.error('TRANSFER update failed', error);
    return new Response('transfer failed', { status: 500 });
  }
  return new Response('OK', { status: 200 });
}

async function processEvent(event: RevenueCatEvent): Promise<Response> {
  // Log-only events
  if (event.type === 'SUBSCRIBER_ALIAS') {
    return new Response('OK', { status: 200 });
  }

  if (event.type === 'TRANSFER') {
    return await handleTransfer(event);
  }

  // Verify the player exists locally; if not, ack so RC stops retrying
  const { data: player, error: playerLookupError } = await supabase
    .from('player')
    .select('id')
    .eq('id', event.app_user_id)
    .maybeSingle();
  if (playerLookupError) {
    console.error('Player lookup failed', playerLookupError);
    return new Response('player lookup failed', { status: 500 });
  }
  if (!player) {
    console.log(`Player ${event.app_user_id} not found, skipping subscription upsert`);
    return new Response('OK', { status: 200 });
  }

  // Source of truth: fetch canonical state from RC v2 REST API.
  // This makes us robust to PRODUCT_CHANGE, partial REFUND, grace-period
  // transitions, and any future event types RC may add.
  const customerState = await fetchCustomerState(event.app_user_id);
  if (!customerState) {
    return new Response('customer state fetch failed', { status: 500 });
  }

  const derived = deriveState(customerState);

  const { error: upsertError } = await supabase.from('player_subscription').upsert(
    {
      player_id: event.app_user_id,
      revenuecat_customer_id: event.app_user_id,
      status: derived.status,
      last_revenuecat_event: event.type,
      store: derived.store,
      product_identifier: derived.product_identifier,
      original_transaction_id: derived.original_transaction_id,
      current_period_start: derived.current_period_start,
      current_period_end: derived.current_period_end,
      in_grace_period: derived.in_grace_period,
      grace_period_expires_at: derived.grace_period_expires_at,
      cancellation_date: derived.cancellation_date,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'player_id' }
  );

  if (upsertError) {
    console.error('Error upserting player_subscription:', upsertError);
    return new Response('upsert failed', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

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
  if (!event || !event.id || !event.type || !event.app_user_id) {
    return new Response('Missing event data', { status: 400 });
  }

  console.log(`RevenueCat webhook: ${event.type} for user ${event.app_user_id} (id=${event.id})`);

  // Idempotency: claim the event by inserting into the log first.
  // On unique-violation (23505) the event was already processed → 200.
  const { error: claimError } = await supabase.from('revenuecat_event_log').insert({
    event_id: event.id,
    event_type: event.type,
    app_user_id: event.app_user_id,
    payload: event,
  });
  if (claimError?.code === '23505') {
    return new Response('OK (duplicate)', { status: 200 });
  }
  if (claimError) {
    console.error('Failed to log event', claimError);
    return new Response('event log failed', { status: 500 });
  }

  let response: Response;
  try {
    response = await processEvent(event);
  } catch (err) {
    console.error('Unexpected error in processEvent', err);
    response = new Response('processing failed', { status: 500 });
  }

  // Release the claim on retryable failures so the next RC retry can re-process.
  if (response.status >= 500) {
    const { error: releaseError } = await supabase
      .from('revenuecat_event_log')
      .delete()
      .eq('event_id', event.id);
    if (releaseError) {
      console.error('Failed to release event claim', releaseError);
    }
  }

  return response;
});
