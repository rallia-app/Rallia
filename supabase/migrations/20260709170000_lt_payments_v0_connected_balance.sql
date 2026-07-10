-- ============================================
-- Tournament payments v0 — settle to the organizer's connected balance
-- ============================================
-- Compliance goal: Rallia must never hold funds. Every paid registration now
-- settles into the ORGANIZER's connected Stripe balance (destination charge +
-- on_behalf_of), is held there via the account's manual payout schedule, and is
-- released as a PAYOUT after the event. Stripe holds the money, not Rallia.
--
-- This migration is the SQL half:
--   * stripe_payout_id — release is now a payout from the organizer's balance,
--     not a platform→organizer transfer (released_transfer_id kept, unused).
--   * lt_release_candidates rebuilt — in v0 every succeeded payment settles to
--     the organizer, so ALL of them (for a completed event past the buffer) are
--     release candidates, not just the old hold_until_event_end mode.
--
-- The charge / settlement / refund edge functions change in lockstep. The
-- cancel-refund candidate query is unchanged — the refund uses reverse_transfer
-- to claw the entry back, so it no longer needs the manual-reversal fields.
--
-- ⚠️ Requires organizer connected accounts to carry the card_payments capability
-- and a MANUAL payout schedule (onboarding change, gated on Stripe confirmation).
-- Do NOT deploy the companion edge functions until that lands, or paid
-- registration breaks (on_behalf_of errors on a transfers-only account).
-- ============================================

ALTER TABLE lt_registration_payment
    ADD COLUMN IF NOT EXISTS stripe_payout_id text;

-- v0: release = payout from the organizer's balance. Gate on end_date + 24h so
-- the refund/dispute window has passed. Return shape unchanged (stripe_charge_id
-- retained for compatibility; the payout doesn't use it).
CREATE OR REPLACE FUNCTION public.lt_release_candidates()
RETURNS TABLE (
    payment_id                  uuid,
    stripe_charge_id            text,
    organizer_id                uuid,
    organizer_amount_cents      integer,
    currency                    varchar,
    organizer_stripe_account_id text,
    organizer_onboarded         boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p.id, p.stripe_charge_id, p.organizer_id, p.organizer_amount_cents, p.currency,
           psa.stripe_account_id, COALESCE(psa.onboarding_completed, false)
      FROM lt_registration_payment p
      JOIN tournament_registrations r ON r.id = p.tournament_registration_id
      JOIN tournaments t ON t.id = r.tournament_id
      LEFT JOIN player_stripe_account psa ON psa.player_id = p.organizer_id
     WHERE p.status = 'succeeded'
       AND p.stripe_payout_id IS NULL
       AND p.organizer_amount_cents > 0
       AND t.status = 'completed'
       AND t.end_date < now() - interval '24 hours';
$$;

COMMENT ON FUNCTION public.lt_release_candidates()
    IS 'Cron: succeeded payments for COMPLETED events (end_date + 24h) not yet paid out — ready for a payout from the organizer''s connected balance.';
