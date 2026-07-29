-- ============================================================================
-- Leagues — the reputation gate read a column that is zero for every player
-- ============================================================================
-- league_join's reputation gate (20260615120000, carried verbatim through
-- 20260725130000 and 20260725140000) compared against player.reputation_score.
-- That column was added by the schema-sync migration 20260206000000 with
-- DEFAULT 0.00 NOT NULL and has never been written by anything. It reads 0.00
-- for all 141 staging and all 725 prod players.
--
-- The live store is player_reputation.reputation_score: DEFAULT 100, decayed by
-- the reputation event pipeline, and already the source for every other
-- consumer (search_players_*, the suggestion RPCs, the auto-invite ordering).
-- It is also what the profile badge renders, which is how this surfaced: a
-- tester holding a Platinum badge (100) was described as sitting at 0.
--
-- Consequence: any league with min_reputation set rejected EVERY player with
-- REPUTATION_GATE_NOT_MET, Platinum included. One staging league is already
-- gated this way. No prod league sets min_reputation yet, so nobody is locked
-- out today, but the first organizer to set one would have been.
--
-- Missing player_reputation row coalesces to 100, not 0: reputation is a
-- start-clean-and-lose-points model, so "no events yet" must read as a clean
-- record. Coalescing to 0 would rebuild the same lockout for new players.
--
-- Body is 20260725140000's definition verbatim; only the gate's source changes.
-- player.reputation_score is left in place (dropping it is a separate cleanup
-- with a types regeneration attached).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.league_join(p_league_id uuid)
RETURNS league_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id      uuid := auth.uid();
    v_league         leagues;
    v_initial_status league_member_status;
    v_active_count   integer;
    v_existing       league_members;
    v_row            league_members;
    v_reputation     numeric;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_league FROM leagues WHERE id = p_league_id;
    IF v_league.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_FOUND';
    END IF;

    IF v_league.organizer_id = v_caller_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_MEMBER';
    END IF;

    IF v_league.status <> 'active' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_ACTIVE';
    END IF;

    PERFORM public.assert_caller_plays_sport(v_league.sport_id);

    SELECT * INTO v_existing
      FROM league_members
     WHERE league_id = p_league_id AND user_id = v_caller_id
     FOR UPDATE;

    -- An organizer invite: accepting it is what Join means for the invitee.
    -- Ahead of ALREADY_MEMBER (which used to swallow this whole branch) and
    -- ahead of the rating and capacity gates, on purpose.
    IF v_existing.id IS NOT NULL
       AND v_existing.status = 'pending'
       AND v_existing.invited_by IS NOT NULL THEN
        UPDATE league_members
           SET status      = 'active',
               approved_at = now(),
               version     = version + 1,
               updated_at  = now()
         WHERE id = v_existing.id
        RETURNING * INTO v_row;

        INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
        VALUES (
            'membership', v_row.id, 'accept_invite', v_caller_id,
            jsonb_build_object('league_id', p_league_id, 'status', v_row.status)
        );
        RETURN v_row;
    END IF;

    -- 'pending' still lands here when invited_by IS NULL: a self-request
    -- awaiting approval, for which ALREADY_MEMBER is the right answer.
    IF v_existing.id IS NOT NULL AND v_existing.status IN ('active', 'pending', 'suspended') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_MEMBER';
    END IF;

    -- No invite to accept, so an invite-only league cannot be self-joined.
    IF v_league.join_mode = 'invite_only' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_INVITED';
    END IF;

    -- Rating gate. No-ops when both bounds are NULL, so it is called
    -- unconditionally. assert_caller_plays_sport above already required an
    -- active player_sport row, which is why the helper needs no is_active
    -- filter of its own.
    PERFORM public.lt_assert_rating_band(
        v_caller_id, v_league.sport_id, v_league.min_rating, v_league.max_rating
    );

    -- Reputation gate. Reads player_reputation (the live store); no row means
    -- no events yet, which is a clean record, not a zero.
    IF v_league.min_reputation IS NOT NULL THEN
        SELECT COALESCE(
                 (SELECT pr.reputation_score
                    FROM player_reputation pr
                   WHERE pr.player_id = v_caller_id),
                 100
               )
          INTO v_reputation;

        IF v_reputation < v_league.min_reputation THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REPUTATION_GATE_NOT_MET';
        END IF;
    END IF;

    SELECT count(*) INTO v_active_count
      FROM league_members
     WHERE league_id = p_league_id AND status = 'active';

    IF v_league.member_capacity IS NOT NULL
       AND v_active_count >= v_league.member_capacity
       AND NOT COALESCE(v_league.waitlist_enabled, false) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_FULL';
    END IF;

    IF v_league.join_mode = 'open' THEN
        v_initial_status := 'active';
    ELSE
        v_initial_status := 'pending';
    END IF;

    IF v_existing.id IS NOT NULL AND v_existing.status = 'inactive' THEN
        UPDATE league_members
           SET status      = v_initial_status,
               approved_at = CASE WHEN v_initial_status = 'active' THEN now() ELSE NULL END,
               left_at     = NULL,
               version     = version + 1,
               updated_at  = now()
         WHERE id = v_existing.id
        RETURNING * INTO v_row;
    ELSE
        INSERT INTO league_members (league_id, user_id, role, status, approved_at)
        VALUES (
            p_league_id, v_caller_id, 'member', v_initial_status,
            CASE WHEN v_initial_status = 'active' THEN now() ELSE NULL END
        )
        RETURNING * INTO v_row;
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'membership', v_row.id, 'join', v_caller_id,
        jsonb_build_object('league_id', p_league_id, 'status', v_row.status)
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_join(uuid) TO authenticated;

COMMENT ON COLUMN public.player.reputation_score IS
    'DEAD COLUMN. Never written since it was added in 20260206000000; reads 0.00 '
    'for every player. The live reputation store is player_reputation.reputation_score. '
    'Do not read this in new code.';
