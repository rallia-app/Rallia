/**
 * stripe-match-webhook
 *
 * Receives Stripe webhook events for match reimbursement payments. Two flows:
 *
 *   1. payment_intent.succeeded
 *      - A player just paid. Mark match_participant.has_paid = true.
 *      - If the host has completed Stripe Connect onboarding:
 *          → stripe.transfers.create() to release funds to host
 *          → insert pending_host_transfer row with status='released'
 *          → notify host: reimbursement received
 *      - Otherwise:
 *          → insert pending_host_transfer row with status='awaiting_onboarding'
 *          → notify host: payouts_setup_required ("$X ready, finish setup")
 *
 *   2. account.updated  (player's connected account)
 *      - When charges_enabled flips to true, the host has finished onboarding.
 *      - Update player_stripe_account.onboarding_completed = true.
 *      - Sweep all pending_host_transfer rows for this host with
 *        status='awaiting_onboarding' and release them via stripe.transfers.
 *      - Notify host: payouts_released ("$X on the way to your bank").
 *
 * Configure in Stripe Dashboard:
 *   Endpoint URL: https://<project>.supabase.co/functions/v1/stripe-match-webhook
 *   Events:
 *     - payment_intent.succeeded
 *     - account.updated
 *
 * Env vars required:
 *   STRIPE_SECRET_KEY
 *   STRIPE_MATCH_WEBHOOK_SECRET   (whsec_... from Stripe Dashboard)
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// Using permissive generics here avoids Deno's strict-resolution issue where
// table-method shapes collapse to `never` when ReturnType<typeof createClient>
// is propagated through helper signatures. Runtime correctness is verified
// by the SQL smoke tests against the migrated schema.
// deno-lint-ignore no-explicit-any
type Admin = SupabaseClient<any, any, any>;

const PENDING_EXPIRY_DAYS = 90;

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

Deno.serve(async req => {
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')!;
  const webhookSecret = Deno.env.get('STRIPE_MATCH_WEBHOOK_SECRET')!;
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });

  // Raw body required for Stripe signature verification
  const body = await req.text();
  const sig = req.headers.get('stripe-signature') ?? '';

  let event: Stripe.Event;
  try {
    // Deno's edge runtime uses Web Crypto (SubtleCrypto), which is async-only.
    // Must use constructEventAsync — the sync variant throws in this runtime.
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
  } catch (err) {
    console.error('[stripe-match-webhook] Invalid signature:', err);
    return new Response('Webhook signature verification failed', { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(admin, stripe, event.data.object);
        break;
      case 'account.updated':
        await handleAccountUpdated(admin, stripe, event.data.object);
        break;
      case 'account.application.deauthorized':
        // Stripe sets event.account to the connected account id (event.data.object
        // is the Application here, not an Account). Pass the id directly.
        if (event.account) {
          await handleAccountDeauthorized(admin, event.account);
        }
        break;
      case 'charge.refunded':
        await handleChargeRefunded(admin, stripe, event.data.object);
        break;
      case 'transfer.reversed':
        await handleTransferReversed(admin, event.data.object);
        break;
      case 'charge.dispute.created':
        await handleChargeDisputeCreated(admin, event.data.object);
        break;
      default:
        // Unhandled event types — log and 200 so Stripe stops retrying.
        console.log('[stripe-match-webhook] unhandled event type:', event.type);
    }
  } catch (err) {
    console.error('[stripe-match-webhook] handler failed:', err);
    // Return 500 so Stripe retries
    return new Response('handler failed', { status: 500 });
  }

  // Always 200 for successfully-processed events (including events we ignore)
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

// =============================================================================
// payment_intent.succeeded
// =============================================================================
async function handlePaymentIntentSucceeded(
  admin: Admin,
  stripe: Stripe,
  pi: Stripe.PaymentIntent
): Promise<void> {
  // Only handle our flow — ignore other PaymentIntents (donations, bookings, etc.)
  if (pi.metadata?.rallia_flow !== 'match_reimbursement') {
    return;
  }

  const { matchId, playerId, hostPlayerId, participantId } = pi.metadata;
  if (!matchId || !playerId || !hostPlayerId || !participantId) {
    console.error('[stripe-match-webhook] missing metadata', pi.id);
    return;
  }

  const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id;
  if (!chargeId) {
    console.error('[stripe-match-webhook] no latest_charge on PI', pi.id);
    return;
  }

  // ---------------------------------- Idempotency: skip if already processed
  // pending_host_transfer.match_participant_id is UNIQUE; if a row exists
  // we've already handled this PI succeeded event in a prior delivery.
  const { data: existing } = await admin
    .from('pending_host_transfer')
    .select('id, status')
    .eq('match_participant_id', participantId)
    .maybeSingle();
  if (existing) return;

  // ---------------------------------- Mark participant as paid
  // Conditional update so re-deliveries don't double-flip; doesn't error if
  // already paid by some other path (e.g. mark_manual happened concurrently).
  await admin
    .from('match_participant')
    .update({ has_paid: true })
    .eq('id', participantId)
    .eq('has_paid', false);

  // ---------------------------------- Look up host onboarding status
  const { data: hostStripe } = await admin
    .from('player_stripe_account')
    .select('stripe_account_id, onboarding_completed')
    .eq('player_id', hostPlayerId)
    .maybeSingle();

  const expiresAt = addDays(new Date(), PENDING_EXPIRY_DAYS).toISOString();

  if (hostStripe?.onboarding_completed && hostStripe.stripe_account_id) {
    // Host is ready — release funds immediately
    let transferId: string;
    try {
      const transfer = await stripe.transfers.create(
        {
          amount: pi.amount,
          currency: pi.currency,
          destination: hostStripe.stripe_account_id,
          source_transaction: chargeId,
          metadata: { matchId, fromPlayerId: playerId, participantId },
        },
        { idempotencyKey: `transfer-${chargeId}` }
      );
      transferId = transfer.id;
    } catch (e) {
      // Transfer failed (e.g. account got restricted between check and call).
      // Park as awaiting_onboarding and let account.updated retry it.
      console.error('[stripe-match-webhook] transfer failed, parking:', e);
      await admin.from('pending_host_transfer').insert({
        match_participant_id: participantId,
        host_player_id: hostPlayerId,
        stripe_charge_id: chargeId,
        stripe_payment_intent_id: pi.id,
        amount_cents: pi.amount,
        currency: pi.currency.toUpperCase(),
        status: 'awaiting_onboarding',
        expires_at: expiresAt,
      });
      await notifyPayoutsSetupRequired(admin, hostPlayerId, matchId, pi.amount);
      return;
    }

    await admin.from('pending_host_transfer').insert({
      match_participant_id: participantId,
      host_player_id: hostPlayerId,
      stripe_charge_id: chargeId,
      stripe_payment_intent_id: pi.id,
      amount_cents: pi.amount,
      currency: pi.currency.toUpperCase(),
      status: 'released',
      released_at: new Date().toISOString(),
      released_transfer_id: transferId,
      expires_at: expiresAt,
    });

    await notifyReimbursementReceived(admin, hostPlayerId, matchId, playerId, pi.amount);
    await maybeNotifyAllReceived(admin, hostPlayerId, matchId);
  } else {
    // Host not onboarded yet — park funds in Rallia balance
    await admin.from('pending_host_transfer').insert({
      match_participant_id: participantId,
      host_player_id: hostPlayerId,
      stripe_charge_id: chargeId,
      stripe_payment_intent_id: pi.id,
      amount_cents: pi.amount,
      currency: pi.currency.toUpperCase(),
      status: 'awaiting_onboarding',
      expires_at: expiresAt,
    });

    await notifyPayoutsSetupRequired(admin, hostPlayerId, matchId, pi.amount);
  }
}

// =============================================================================
// account.updated — release any pending transfers when host finishes onboarding
// =============================================================================
async function handleAccountUpdated(
  admin: Admin,
  stripe: Stripe,
  account: Stripe.Account
): Promise<void> {
  // Only player accounts; ignore organization_stripe_account events.
  // The org-side webhook lives at apps/web/app/api/stripe/webhooks/route.ts.
  const { data: psa } = await admin
    .from('player_stripe_account')
    .select('player_id, onboarding_completed')
    .eq('stripe_account_id', account.id)
    .maybeSingle();
  if (!psa) return;

  const chargesEnabled = account.charges_enabled === true;
  const transfersActive = account.capabilities?.transfers === 'active' || chargesEnabled;
  const isReady = chargesEnabled && transfersActive;

  // Update onboarding flag (mirror current state)
  if (psa.onboarding_completed !== isReady) {
    await admin
      .from('player_stripe_account')
      .update({
        onboarding_completed: isReady,
        updated_at: new Date().toISOString(),
      })
      .eq('player_id', psa.player_id);
  }

  if (!isReady) return;

  // Sweep pending transfers for this host
  const { data: pending } = await admin
    .from('pending_host_transfer')
    .select('id, match_participant_id, stripe_charge_id, amount_cents, currency')
    .eq('host_player_id', psa.player_id)
    .eq('status', 'awaiting_onboarding');

  if (!pending || pending.length === 0) return;

  let totalReleasedCents = 0;
  for (const row of pending) {
    try {
      const transfer = await stripe.transfers.create(
        {
          amount: row.amount_cents,
          currency: row.currency.toLowerCase(),
          destination: account.id,
          source_transaction: row.stripe_charge_id,
          metadata: { participantId: row.match_participant_id, releasedBy: 'account.updated' },
        },
        { idempotencyKey: `release-${row.id}` }
      );

      await admin
        .from('pending_host_transfer')
        .update({
          status: 'released',
          released_at: new Date().toISOString(),
          released_transfer_id: transfer.id,
        })
        .eq('id', row.id);

      totalReleasedCents += row.amount_cents;
    } catch (e) {
      // Leave the row as awaiting_onboarding; the daily reconciler will retry.
      console.error('[stripe-match-webhook] release failed for row', row.id, e);
    }
  }

  if (totalReleasedCents > 0) {
    await notifyPayoutsReleased(admin, psa.player_id, totalReleasedCents);
  }
}

// =============================================================================
// Notifications
// =============================================================================
async function notifyPayoutsSetupRequired(
  admin: Admin,
  hostPlayerId: string,
  matchId: string,
  amountCents: number
): Promise<void> {
  await admin.rpc('insert_notification', {
    p_user_id: hostPlayerId,
    p_type: 'payouts_setup_required',
    p_target_id: matchId,
    p_title: null,
    p_body: null,
    p_payload: { matchId, amountCents },
    p_priority: 'high',
    p_scheduled_at: null,
    p_expires_at: null,
    p_organization_id: null,
  });
}

async function notifyPayoutsReleased(
  admin: Admin,
  hostPlayerId: string,
  amountCents: number
): Promise<void> {
  await admin.rpc('insert_notification', {
    p_user_id: hostPlayerId,
    p_type: 'payouts_released',
    p_target_id: null,
    p_title: null,
    p_body: null,
    p_payload: { amountCents },
    p_priority: 'normal',
    p_scheduled_at: null,
    p_expires_at: null,
    p_organization_id: null,
  });
}

async function notifyReimbursementReceived(
  admin: Admin,
  hostPlayerId: string,
  matchId: string,
  fromPlayerId: string,
  amountCents: number
): Promise<void> {
  await admin.rpc('insert_notification', {
    p_user_id: hostPlayerId,
    p_type: 'reimbursement_received',
    p_target_id: matchId,
    p_title: null,
    p_body: null,
    p_payload: { matchId, fromPlayerId, amountCents },
    p_priority: 'normal',
    p_scheduled_at: null,
    p_expires_at: null,
    p_organization_id: null,
  });
}

async function maybeNotifyAllReceived(
  admin: Admin,
  hostPlayerId: string,
  matchId: string
): Promise<void> {
  // Send "all received" once when the last unpaid joined non-host flips to paid.
  const { count: stillOwed } = await admin
    .from('match_participant')
    .select('id', { count: 'exact', head: true })
    .eq('match_id', matchId)
    .eq('status', 'joined')
    .eq('is_host', false)
    .eq('has_paid', false);

  if ((stillOwed ?? 1) === 0) {
    await admin.rpc('insert_notification', {
      p_user_id: hostPlayerId,
      p_type: 'reimbursement_all_received',
      p_target_id: matchId,
      p_title: null,
      p_body: null,
      p_payload: { matchId },
      p_priority: 'normal',
      p_scheduled_at: null,
      p_expires_at: null,
      p_organization_id: null,
    });
  }
}

// =============================================================================
// account.application.deauthorized
//   Host disconnected their Stripe Connect account. Flip onboarding_completed
//   to false so subsequent payments park as awaiting_onboarding instead of
//   trying to transfer to a dead account.
//
//   We do NOT delete the player_stripe_account row — the account id is
//   preserved so that already-released transfers can still be referenced for
//   audit, and so the same player can reconnect later by going through
//   onboarding again (which will create a fresh account id).
// =============================================================================
async function handleAccountDeauthorized(admin: Admin, accountId: string): Promise<void> {
  const { data: psa } = await admin
    .from('player_stripe_account')
    .select('player_id, onboarding_completed')
    .eq('stripe_account_id', accountId)
    .maybeSingle();
  if (!psa) return; // Org account or unrelated — let the org webhook handle it.

  if (psa.onboarding_completed) {
    await admin
      .from('player_stripe_account')
      .update({
        onboarding_completed: false,
        updated_at: new Date().toISOString(),
      })
      .eq('player_id', psa.player_id);
  }

  console.log('[stripe-match-webhook] host deauthorized', psa.player_id);
}

// =============================================================================
// charge.refunded
//   A charge was refunded — either via Rallia ops, Stripe Dashboard, or
//   programmatically (e.g. from match-payment-mark-manual). Reconcile the
//   linked pending_host_transfer:
//
//   - If the row was 'released' (transfer already created): reverse the
//     transfer so the host doesn't keep money for a refunded charge.
//     Mark the row as 'refunded' for audit. Revert match_participant.has_paid
//     to false so the host can re-request if appropriate.
//
//   - If the row was 'awaiting_onboarding': it was already refunded by
//     match-payment-mark-manual or the cron expirer; just normalize state.
//
//   - If no row exists: charge was created by some other flow (booking,
//     donation, …) — ignore.
// =============================================================================
async function handleChargeRefunded(
  admin: Admin,
  stripe: Stripe,
  charge: Stripe.Charge
): Promise<void> {
  // Only handle our flow
  if (charge.metadata?.rallia_flow !== 'match_reimbursement') {
    // The PI metadata flag may not propagate to the charge; fall back to the
    // pending_host_transfer lookup as the source of truth.
    const { data: row } = await admin
      .from('pending_host_transfer')
      .select(
        'id, status, released_transfer_id, match_participant_id, host_player_id, amount_cents'
      )
      .eq('stripe_charge_id', charge.id)
      .maybeSingle();
    if (!row) return; // Not ours.
    await reconcileRefundedRow(admin, stripe, row, charge);
    return;
  }

  const { data: row } = await admin
    .from('pending_host_transfer')
    .select('id, status, released_transfer_id, match_participant_id, host_player_id, amount_cents')
    .eq('stripe_charge_id', charge.id)
    .maybeSingle();
  if (!row) {
    console.log('[stripe-match-webhook] charge.refunded but no pending row', charge.id);
    return;
  }
  await reconcileRefundedRow(admin, stripe, row, charge);
}

async function reconcileRefundedRow(
  admin: Admin,
  stripe: Stripe,
  row: {
    id: string;
    status: string;
    released_transfer_id: string | null;
    match_participant_id: string;
    host_player_id: string;
    amount_cents: number;
  },
  charge: Stripe.Charge
): Promise<void> {
  // If we already refunded this row, no-op (idempotency for duplicate webhook deliveries).
  if (row.status === 'refunded') return;

  // For released rows, reverse the transfer so the host's balance isn't kept
  // against a refunded charge. The transfer-reversal webhook event will fire
  // and is handled by handleTransferReversed (idempotent via row.status check).
  if (row.status === 'released' && row.released_transfer_id) {
    try {
      await stripe.transfers.createReversal(
        row.released_transfer_id,
        {
          // Full reversal — `amount` defaults to the remaining balance
          metadata: {
            reason: 'charge_refunded',
            participantId: row.match_participant_id,
            chargeId: charge.id,
          },
        },
        { idempotencyKey: `reverse-${row.released_transfer_id}` }
      );
    } catch (e) {
      console.error('[stripe-match-webhook] transfer reversal failed', row.released_transfer_id, e);
      // Don't throw — Stripe Dashboard ops can resolve manually. Marking the
      // row as refunded below still lets us reflect the player-side refund.
    }
  }

  // Mark the row as refunded
  await admin
    .from('pending_host_transfer')
    .update({
      status: 'refunded',
      refunded_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .neq('status', 'refunded');

  // Revert participant payment state so the UI doesn't lie
  await admin
    .from('match_participant')
    .update({ has_paid: false })
    .eq('id', row.match_participant_id);

  // Notify the host (the player initiated this; they don't need a duplicate
  // notification from us — Stripe will email them the refund receipt)
  await admin.rpc('insert_notification', {
    p_user_id: row.host_player_id,
    p_type: 'payouts_expired_refunded',
    p_target_id: null,
    p_title: null,
    p_body: null,
    p_payload: { amountCents: row.amount_cents, asPlayer: false, reason: 'refunded' },
    p_priority: 'high',
    p_scheduled_at: null,
    p_expires_at: null,
    p_organization_id: null,
  });
}

// =============================================================================
// transfer.reversed
//   A transfer to a host was reversed. Usually fires as a follow-up to
//   charge.refunded above (where we initiated the reversal). It can also fire
//   independently if Stripe restricts the connected account.
//
//   Mark the row 'refunded' if it isn't already. The actual money state in
//   Stripe is the source of truth; we just keep our ledger consistent.
// =============================================================================
async function handleTransferReversed(admin: Admin, transfer: Stripe.Transfer): Promise<void> {
  const { data: row } = await admin
    .from('pending_host_transfer')
    .select('id, status, host_player_id, amount_cents, match_participant_id')
    .eq('released_transfer_id', transfer.id)
    .maybeSingle();
  if (!row) return; // Org-side transfer or unrelated.

  if (row.status === 'refunded') return; // already handled by charge.refunded path

  await admin
    .from('pending_host_transfer')
    .update({
      status: 'refunded',
      refunded_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .neq('status', 'refunded');

  // Revert participant state
  await admin
    .from('match_participant')
    .update({ has_paid: false })
    .eq('id', row.match_participant_id);

  console.log('[stripe-match-webhook] transfer reversed', transfer.id, row.id);
}

// =============================================================================
// charge.dispute.created
//   A player initiated a chargeback. Rallia ops handle disputes manually
//   (mediation, evidence submission via Stripe Dashboard). We just log the
//   event and notify the host. We do NOT auto-reverse — that happens only
//   if/when the dispute is lost (charge.refunded fires at that point).
// =============================================================================
async function handleChargeDisputeCreated(admin: Admin, dispute: Stripe.Dispute): Promise<void> {
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
  if (!chargeId) return;

  const { data: row } = await admin
    .from('pending_host_transfer')
    .select('id, host_player_id, match_participant_id, amount_cents, status')
    .eq('stripe_charge_id', chargeId)
    .maybeSingle();
  if (!row) return; // Not our flow

  console.warn(
    '[stripe-match-webhook] DISPUTE OPENED',
    'dispute=',
    dispute.id,
    'charge=',
    chargeId,
    'amount=',
    dispute.amount,
    'reason=',
    dispute.reason,
    'status=',
    dispute.status,
    'pendingRow=',
    row.id,
    'hostPlayer=',
    row.host_player_id
  );

  // High-priority notify the host so they know to expect possible reversal
  await admin.rpc('insert_notification', {
    p_user_id: row.host_player_id,
    p_type: 'payouts_expired_refunded',
    p_target_id: null,
    p_title: null,
    p_body: null,
    p_payload: {
      amountCents: dispute.amount,
      asPlayer: false,
      reason: 'dispute_opened',
    },
    p_priority: 'high',
    p_scheduled_at: null,
    p_expires_at: null,
    p_organization_id: null,
  });
}
