-- season_withdraw takes a paid enrolment for free and closes the refund door.
--
-- The 20260629160100 definition is still live: it checks season status and
-- member status and nothing else, has no knowledge of entry_fee_cents, and
-- never looks at the ledger. Its own comment calls this "the Phase 4 refund
-- hook point"; the hook was never added when paid seasons shipped.
--
-- Scenario: a player pays $80, then calls season_withdraw directly (the app
-- correctly routes paid seasons to season_request_refund, so this is a raw RPC
-- call, but the function is granted to authenticated). The row goes to
-- withdrawn. season_request_refund (20260716200400) then requires status IN
-- ('enrolled','pending'), so every later refund attempt raises
-- OPTIMISTIC_LOCK_CONFLICT: the refund path is permanently closed. Meanwhile
-- the ledger row stays succeeded with stripe_payout_id IS NULL, and
-- lt_release_candidates filters on payment status only, never member status,
-- so at season close the full entry is released to the organizer. The player
-- ends with no spot and no money.
--
-- Refuse the free path and point at the refund path, which already does the
-- withdrawal itself. Only 'succeeded' blocks: payment_pending rows are the
-- reaper's job, and a refunded row has already left 'enrolled'.

CREATE OR REPLACE FUNCTION public.season_withdraw(p_season_id uuid)
RETURNS season_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_season    seasons;
    v_existing  season_members;
    v_row       season_members;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_season FROM seasons WHERE id = p_season_id;
    IF v_season.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_FOUND';
    END IF;

    IF v_season.status <> 'open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_OPEN';
    END IF;

    SELECT * INTO v_existing
      FROM season_members
     WHERE season_id = p_season_id AND user_id = v_caller_id
     FOR UPDATE;
    IF v_existing.id IS NULL OR v_existing.status NOT IN ('enrolled', 'pending') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ENROLLED';
    END IF;

    -- Live money on this enrolment: season_request_refund is the only exit.
    IF EXISTS (
        SELECT 1 FROM lt_registration_payment
         WHERE season_user_id = v_existing.id
           AND status = 'succeeded'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REFUND_REQUIRED';
    END IF;

    UPDATE season_members
       SET status       = 'withdrawn',
           withdrawn_at = now(),
           version      = version + 1,
           updated_at   = now()
     WHERE id = v_existing.id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('membership', v_row.id, 'withdraw', v_caller_id,
            jsonb_build_object('season_id', p_season_id, 'league_id', v_season.league_id,
                               'prev_status', v_existing.status));

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.season_withdraw(uuid) TO authenticated;
