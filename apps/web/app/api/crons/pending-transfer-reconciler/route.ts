/**
 * GET /api/crons/pending-transfer-reconciler
 *
 * Daily reconciler for pending_host_transfer rows. Two responsibilities:
 *
 *   1. Release stuck rows
 *      Webhooks can be missed (network blip, Stripe retries exhausted, etc.).
 *      Find any 'awaiting_onboarding' rows whose host has since onboarded
 *      and release them via stripe.transfers.create.
 *
 *   2. Refund expired rows
 *      If the host never onboarded within 90 days of the player paying,
 *      refund the player and notify both parties. The row is marked 'expired'
 *      after the refund is created.
 *
 * Triggered by Vercel Cron — see vercel.json.
 * Authenticated via CRON_SECRET (Vercel signs the request automatically).
 */

import { getStripeClient } from '@/lib/stripe';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const PENDING_EXPIRY_DAYS = 90;

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase configuration for cron');
  }
  return createClient(supabaseUrl, supabaseServiceKey);
}

export async function GET(req: Request) {
  // Auth: Vercel sends Authorization: Bearer ${CRON_SECRET} on cron invocations.
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const admin = getAdminClient();
  const stripe = getStripeClient();

  const summary = {
    released: 0,
    releasedCents: 0,
    refunded: 0,
    refundedCents: 0,
    failures: 0,
  };

  try {
    // ============================================================
    // 1. Release stuck rows (webhook missed; host now onboarded)
    // ============================================================
    const { data: stuck } = await admin
      .from('pending_host_transfer')
      .select('id, match_participant_id, host_player_id, stripe_charge_id, amount_cents, currency')
      .eq('status', 'awaiting_onboarding')
      .lte('expires_at', new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()); // sanity guard

    for (const row of stuck ?? []) {
      // Look up host's current account state
      const { data: psa } = await admin
        .from('player_stripe_account')
        .select('stripe_account_id, onboarding_completed')
        .eq('player_id', row.host_player_id)
        .maybeSingle();

      if (!psa?.onboarding_completed || !psa.stripe_account_id) continue;

      try {
        const transfer = await stripe.transfers.create(
          {
            amount: row.amount_cents,
            currency: row.currency.toLowerCase(),
            destination: psa.stripe_account_id,
            source_transaction: row.stripe_charge_id,
            metadata: {
              participantId: row.match_participant_id,
              releasedBy: 'cron_reconciler',
            },
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
          .eq('id', row.id)
          .eq('status', 'awaiting_onboarding'); // guard against concurrent webhook

        summary.released += 1;
        summary.releasedCents += row.amount_cents;

        // Notify host that their funds are on the way
        await admin.rpc('insert_notification', {
          p_user_id: row.host_player_id,
          p_type: 'payouts_released',
          p_target_id: null,
          p_title: null,
          p_body: null,
          p_payload: { amountCents: row.amount_cents },
          p_priority: 'normal',
          p_scheduled_at: null,
          p_expires_at: null,
          p_organization_id: null,
        });
      } catch (e) {
        console.error('[reconciler] release failed', row.id, e);
        summary.failures += 1;
      }
    }

    // ============================================================
    // 2. Refund expired rows (host never onboarded within 90 days)
    // ============================================================
    const { data: expired } = await admin
      .from('pending_host_transfer')
      .select(
        'id, match_participant_id, host_player_id, stripe_charge_id, stripe_payment_intent_id, amount_cents'
      )
      .eq('status', 'awaiting_onboarding')
      .lt('expires_at', new Date().toISOString());

    for (const row of expired ?? []) {
      try {
        const refund = await stripe.refunds.create(
          {
            charge: row.stripe_charge_id,
            metadata: { reason: 'pending_expired', participantId: row.match_participant_id },
          },
          { idempotencyKey: `refund-expired-${row.id}` }
        );

        await admin
          .from('pending_host_transfer')
          .update({
            status: 'refunded',
            refunded_at: new Date().toISOString(),
            refunded_refund_id: refund.id,
          })
          .eq('id', row.id)
          .eq('status', 'awaiting_onboarding'); // guard

        // Restore the unpaid state on the participant so the host can re-request
        // (or so the player isn't shown as "paid" when they got refunded)
        await admin
          .from('match_participant')
          .update({ has_paid: false, payment_intent_id: null })
          .eq('id', row.match_participant_id);

        summary.refunded += 1;
        summary.refundedCents += row.amount_cents;

        // Notify the host
        await admin.rpc('insert_notification', {
          p_user_id: row.host_player_id,
          p_type: 'payouts_expired_refunded',
          p_target_id: null,
          p_title: null,
          p_body: null,
          p_payload: { amountCents: row.amount_cents },
          p_priority: 'high',
          p_scheduled_at: null,
          p_expires_at: null,
          p_organization_id: null,
        });

        // Notify the player (look up via match_participant.player_id)
        const { data: mp } = await admin
          .from('match_participant')
          .select('player_id')
          .eq('id', row.match_participant_id)
          .maybeSingle();
        if (mp) {
          await admin.rpc('insert_notification', {
            p_user_id: mp.player_id,
            p_type: 'payouts_expired_refunded',
            p_target_id: null,
            p_title: null,
            p_body: null,
            p_payload: { amountCents: row.amount_cents, asPlayer: true },
            p_priority: 'normal',
            p_scheduled_at: null,
            p_expires_at: null,
            p_organization_id: null,
          });
        }
      } catch (e) {
        console.error('[reconciler] refund failed', row.id, e);
        summary.failures += 1;
      }
    }
  } catch (e) {
    console.error('[reconciler] fatal', e);
    return NextResponse.json({ ok: false, error: 'reconciler_failed', summary }, { status: 500 });
  }

  return NextResponse.json({ ok: true, summary, ranAt: new Date().toISOString() });
}

// 5-minute budget — refunds + transfers in a loop can take a while in practice
export const maxDuration = 300;
// Force Node.js runtime — Stripe SDK isn't compatible with the Edge runtime
export const runtime = 'nodejs';
// Don't cache cron output
export const dynamic = 'force-dynamic';
