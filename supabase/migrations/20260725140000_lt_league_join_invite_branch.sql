-- ============================================================================
-- Leagues & Tournaments — league_join's invite branch was unreachable
-- ============================================================================
-- Since 20260615120000 the guards ran in this order:
--
--     IF v_existing.status IN ('active','pending','suspended') -> ALREADY_MEMBER
--     IF join_mode = 'invite_only' THEN
--         IF v_existing.status <> 'pending' -> NOT_INVITED
--         <accept the invite>
--
-- An invitee's row is 'pending', so the first guard always fired and the accept
-- below it could never run: the branch's only reachable outcome was
-- NOT_INVITED. A player tapping Join on a league they were invited to got
-- "ALREADY_MEMBER", which is both wrong and unhelpful.
--
-- Nobody was blocked, because LeagueDetail routes a row with invited_by set to
-- league_accept_invite instead (see the CTA around LeagueDetail.tsx:2296), and
-- that RPC works. This makes the second door behave like the first.
--
-- The fix hoists the accept above ALREADY_MEMBER and keys it on the same
-- discriminator league_accept_invite uses -- status = 'pending' AND invited_by
-- IS NOT NULL -- rather than on join_mode. That matters because
-- league_invite_members places invites on ANY league, not just invite_only
-- ones: an organizer can invite into an open or approval league, and those
-- invitees deserve the same behaviour.
--
-- Guard order after this change:
--
--   pending + invited_by  -> accept, whatever the join_mode
--   active / suspended    -> ALREADY_MEMBER
--   pending, no invite    -> ALREADY_MEMBER (a self-request awaiting approval)
--   invite_only, no row   -> NOT_INVITED
--
-- Deliberately placed BEFORE the rating and capacity gates, matching
-- league_accept_invite and the invite policy set in 20260725130000: an
-- organizer who invites a player by name has already decided they belong, so an
-- invite overrides min_rating/max_rating and a full roster alike.
--
-- Two smaller changes ride along:
--   * The SELECT that loads v_existing takes FOR UPDATE. It now feeds a state
--     transition, and league_accept_invite already locks. It also closes a
--     pre-existing race on the 'inactive' rejoin path further down.
--   * The accept writes audit action 'accept_invite', not 'join', so the two
--     accept paths are one line of history instead of two. No rows exist under
--     the old value -- the branch never ran.
--
-- Body below is 20260725130000's definition verbatim, with only the guard
-- block reworked.
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

    -- Reputation gate
    IF v_league.min_reputation IS NOT NULL THEN
        IF (SELECT reputation_score FROM player WHERE id = v_caller_id)
           < v_league.min_reputation THEN
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
