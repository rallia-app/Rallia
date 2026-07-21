-- Stop both ends of the tournament lifecycle from orphaning live money.
--
-- 1. HARD DELETE. tournaments_delete (20260510170001) lets an organizer DELETE
--    their own tournament, and authenticated still holds the default DELETE
--    grant. The cascade runs tournaments -> tournament_registrations ->
--    lt_registration_payment, so one call erases every payment_intent id,
--    charge id, refund state and fee/tax snapshot Stripe reconciliation needs,
--    and silently removes succeeded rows from both settlement candidate sets.
--
--    Today the delete happens to fail on an unrelated permission error deeper
--    in the cascade, so this is a latent hole rather than a live one. It is
--    latent by accident, not by design, and the Data API grants are changing
--    (Oct 2026), so close it deliberately. Nothing in the codebase deletes a
--    tournament: the product lifecycle is cancel -> archive.
--
--    Two independent controls, because either alone can be undone by a grant
--    sweep or a policy edit: revoke the grant, and narrow the policy to admin.
--
-- 2. ARCHIVE RACE. tournament_archive (20260510170011) moves cancelled or
--    completed -> archived with no settlement check, while both candidate
--    queries match on the exact status ('cancelled' for refunds, 'completed'
--    for payouts). Archiving before the hourly cron drops the tournament out of
--    both sets permanently. Reproduced: a cancelled paid tournament with one
--    succeeded payment goes from 1 refund candidate to 0 the moment it is
--    archived, and the player never gets their money back.
--
--    Gate on money still in flight (succeeded and not yet paid out) rather than
--    on elapsed time, so the cron decides when settlement is done and archive
--    simply waits for it.

-- ---------------------------------------------------------------- 1. delete
REVOKE DELETE ON public.tournaments FROM anon, authenticated;

DROP POLICY IF EXISTS tournaments_delete ON public.tournaments;
CREATE POLICY tournaments_delete ON public.tournaments FOR DELETE
USING (public.is_admin());

-- The payment ledger is financial history: no cascade may ever remove it.
-- RESTRICT means a tournament with payment history cannot be deleted at all
-- until the ledger is dealt with explicitly, which is the point.
ALTER TABLE public.lt_registration_payment
    DROP CONSTRAINT IF EXISTS lt_registration_payment_tournament_registration_id_fkey;
ALTER TABLE public.lt_registration_payment
    ADD CONSTRAINT lt_registration_payment_tournament_registration_id_fkey
    FOREIGN KEY (tournament_registration_id)
    REFERENCES public.tournament_registrations(id) ON DELETE RESTRICT;

-- --------------------------------------------------------------- 2. archive
CREATE OR REPLACE FUNCTION public.tournament_archive(
    p_tournament_id uuid,
    p_version_was   integer
)
RETURNS tournaments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_row       tournaments;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    -- Money still in flight: a succeeded payment that has been neither refunded
    -- (cancel path) nor paid out (completion path). Archiving now would drop the
    -- tournament out of lt_cancel_refund_candidates / lt_release_candidates,
    -- which both match on the exact pre-archive status.
    IF EXISTS (
        SELECT 1
          FROM lt_registration_payment p
          JOIN tournament_registrations r ON r.id = p.tournament_registration_id
         WHERE r.tournament_id = p_tournament_id
           AND p.status = 'succeeded'
           AND p.stripe_payout_id IS NULL
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SETTLEMENT_PENDING';
    END IF;

    UPDATE tournaments
       SET status       = 'archived',
           archived_at  = now(),
           version      = version + 1,
           updated_at   = now()
     WHERE id = p_tournament_id
       AND version = p_version_was
       AND status IN ('completed', 'cancelled')
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (SELECT 1 FROM tournaments WHERE id = p_tournament_id AND version <> p_version_was) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_ARCHIVABLE';
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament', v_row.id, 'archive', v_caller_id, '{}'::jsonb
    );

    RETURN v_row;
END;
$$;
