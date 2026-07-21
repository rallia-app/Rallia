-- Back-port 20260721130100 to the season side of the ledger.
--
-- That migration protected payment history from a tournament hard delete, but
-- the season chain was left fully open. leagues_delete (20260510170001) lets an
-- organizer DELETE their own league, authenticated still holds the default
-- DELETE grant, and every hop down to the ledger is ON DELETE CASCADE:
--
--   leagues -> seasons (20260510165900) -> season_members (20260629160000)
--           -> lt_registration_payment (20260716200100, both season FKs)
--
-- Verified locally: a season with one succeeded payment carrying a Stripe
-- intent and charge id goes from 1 ledger row to 0 on a single DELETE of the
-- league. That erases the intent/charge ids, refund state and fee/tax snapshot
-- Stripe reconciliation needs, and drops the season out of both
-- lt_cancel_refund_candidates and lt_release_candidates, so enrolled players
-- are never refunded and nothing is left to reconcile against.
--
-- As with tournaments the delete currently trips on an unrelated permission
-- error deeper in the cascade (network_type), so it is latent by accident
-- rather than by design. That is not a control, and the Data API grants change
-- in Oct 2026. Close it deliberately, with the same two independent controls:
-- revoke the grant AND narrow the policy, since either alone can be undone by a
-- grant sweep or a policy edit.
--
-- Nothing in the codebase deletes a league; the lifecycle is pause/resume/close
-- (20260716190000).

-- ---------------------------------------------------------------- 1. delete
REVOKE DELETE ON public.leagues FROM anon, authenticated;

DROP POLICY IF EXISTS leagues_delete ON public.leagues;
CREATE POLICY leagues_delete ON public.leagues FOR DELETE
USING (public.is_admin());

-- ------------------------------------------------------------------ 2. FKs
-- RESTRICT means a season with payment history cannot be deleted until the
-- ledger is dealt with explicitly, which is the point.
ALTER TABLE public.lt_registration_payment
    DROP CONSTRAINT IF EXISTS lt_reg_payment_season_fkey;
ALTER TABLE public.lt_registration_payment
    ADD CONSTRAINT lt_reg_payment_season_fkey
    FOREIGN KEY (season_id)
    REFERENCES public.seasons(id) ON DELETE RESTRICT;

ALTER TABLE public.lt_registration_payment
    DROP CONSTRAINT IF EXISTS lt_reg_payment_season_user_fkey;
ALTER TABLE public.lt_registration_payment
    ADD CONSTRAINT lt_reg_payment_season_user_fkey
    FOREIGN KEY (season_user_id)
    REFERENCES public.season_members(id) ON DELETE RESTRICT;
