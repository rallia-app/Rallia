-- Stop the reaper from charging people for slots it already released.
--
-- Latent hardening, NOT the fix for the Serie 2 charged-but-unseated incident.
-- That was a shared-slot bug in lt-payment-webhook, fixed separately: a
-- terminal event for a superseded attempt released the slot the player's live
-- attempt was holding. None of those four payers were reaped.
--
-- The problem here is real but had not yet fired in production.
-- lt_expire_stale_registration_payments() released a reserved slot purely
-- because the ledger row was still 'pending' past its 15-minute TTL. But
-- 'pending' is equally the state of "player paid, webhook hasn't landed yet" —
-- the reaper could not tell an abandoned checkout from a live payment. Worse,
-- it only ever cancelled its OWN row: it never told Stripe, so the
-- PaymentIntent stayed confirmable after the slot was gone. The player then
-- paid, and lt-payment-webhook (correctly) refused to seat someone whose ledger
-- row was already terminal, leaving it to log ORPHANED PAYMENT.
--
-- Net effect: card debited, entry settled into the organizer's connected
-- balance, no seat, and no self-serve refund (tournament_request_refund
-- requires a 'succeeded' ledger row).
--
-- The reap now lives in the lt-reap-stale-registration-payments edge function,
-- which retrieves each PaymentIntent, cancels it AT STRIPE before releasing the
-- slot, leaves in-flight ones alone, and finalizes any that already succeeded
-- (self-healing a dropped webhook delivery).
--
-- This migration:
--   (1) Makes the SQL function safe by construction: it may only release rows
--       that never reached a PaymentIntent, where no charge is possible. Any
--       row carrying an intent is left to the Stripe-aware reaper. Kept rather
--       than dropped so any straggling caller degrades to safe, not broken.
--   (2) Repoints the cron at the edge function.
--
-- DEPLOY ORDER: deploy lt-reap-stale-registration-payments BEFORE applying this
-- migration. Applying first is still safe (the cron 404s and abandoned slots
-- simply stay reserved a few minutes longer) but nothing is reaped until the
-- function is live.

-- ---------------------------------------------------------------------------
-- (1) Fail-safe SQL reaper: intent-less rows only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lt_expire_stale_registration_payments()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_count integer := 0;
    v_pay   record;
BEGIN
    FOR v_pay IN
        SELECT id, tournament_registration_id, season_user_id
          FROM lt_registration_payment
         WHERE status = 'pending'
           AND expires_at IS NOT NULL
           AND expires_at < now()
           -- The guard. A row with an intent may have been paid seconds ago;
           -- only Stripe knows, and this function cannot ask. Releasing it here
           -- would charge a player for a slot that is already gone.
           AND stripe_payment_intent_id IS NULL
    LOOP
        UPDATE lt_registration_payment
           SET status = 'cancelled', updated_at = now()
         WHERE id = v_pay.id AND status = 'pending';

        UPDATE tournament_registrations
           SET status = 'withdrawn', withdrawn_at = now(), version = version + 1, updated_at = now()
         WHERE id = v_pay.tournament_registration_id
           AND status = 'payment_pending';

        UPDATE season_members
           SET status = 'withdrawn', withdrawn_at = now(), version = version + 1, updated_at = now()
         WHERE id = v_pay.season_user_id
           AND status = 'payment_pending';

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.lt_expire_stale_registration_payments() FROM anon, authenticated;

COMMENT ON FUNCTION public.lt_expire_stale_registration_payments()
    IS 'Legacy reap, now limited to reservations that never reached a PaymentIntent. Rows carrying an intent are reaped by the lt-reap-stale-registration-payments edge function, which checks Stripe and cancels the intent before releasing the slot.';

-- ---------------------------------------------------------------------------
-- (2) Repoint the cron at the Stripe-aware reaper.
--     apikey header pattern per 20260713140000_gate_lt_settle_cron_apikey.sql.
-- ---------------------------------------------------------------------------
SELECT cron.unschedule('lt-expire-stale-registration-payments') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'lt-expire-stale-registration-payments'
);

SELECT cron.unschedule('lt-reap-stale-registration-payments') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'lt-reap-stale-registration-payments'
);

SELECT cron.schedule(
  'lt-reap-stale-registration-payments',
  '*/5 * * * *',
  $cmd$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1) || '/functions/v1/lt-reap-stale-registration-payments',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := jsonb_build_object('triggered_at', now()::text),
    timeout_milliseconds := 300000
  );
  $cmd$
);
