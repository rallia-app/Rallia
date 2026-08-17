-- ============================================================================
-- Leagues — a swap put a player against himself
-- ============================================================================
-- From the league test pass: "Quand j'ai fait le changement il y a un joueur
-- qui s'est retrouvé à jouer avec lui-même."
--
-- session_swap_player (20260807340000) was round-blind. It located each player
-- with a bare `LIMIT 1` over the whole session, so on any sheet with more than
-- one round it picked an arbitrary one of that player's matches, and its only
-- self-play guard compared the two rows it happened to pick. Staging holds the
-- exact reproduction — swap out 069, bring in JDL:
--
--   round 1:  069 vs 056     <- match_out resolved here, 069 -> JDL, correct
--   round 2:  069 vs JDL     <- match_in resolved here, JDL -> 069, giving
--                               `069 vs 069`
--
-- The two rows differ, so the `v_match_in.id = v_match_out.id` guard never
-- fired. One round is the only shape that was ever safe, which is why the
-- original test (a single-round session) passed.
--
-- Three changes:
--   * the caller names the pairing (p_match_id). "Replace X on this row" is
--     what the organizer asked for; deriving the row was always a guess, and
--     on a multi-round sheet a wrong one.
--   * the arriving player is looked up in that row's round only. A player has
--     at most one match per round (lt_run_session_sheet pairs each round from
--     a single rotation), so inside a round the original intent is exact: the
--     two either trade rows, or the arriving player was on a bye that round
--     and simply takes the slot.
--   * a closing assertion refuses any round that ends up with a player booked
--     twice, which covers both a row facing itself and a double-booking, so
--     this class of bug cannot return silently. It is scoped to the round the
--     swap touched: a sheet already corrupted elsewhere must not block an
--     unrelated substitution.
--
-- The signature changes, so the old function is DROPped rather than replaced:
-- CREATE OR REPLACE with an added parameter leaves the 4-argument version in
-- place as a second overload and makes the PostgREST call ambiguous.
-- ============================================================================

DROP FUNCTION IF EXISTS public.session_swap_player(uuid, uuid, uuid, integer);

CREATE OR REPLACE FUNCTION public.session_swap_player(
    p_session_id  uuid,
    p_match_id    uuid,
    p_user_out    uuid,
    p_user_in     uuid,
    p_version_was integer
)
RETURNS sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller    uuid := auth.uid();
    v_session   sessions;
    v_league_id uuid;
    v_match_out session_matches;
    v_match_in  session_matches;
    v_row       sessions;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF p_user_out = p_user_in THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SAME_PLAYER';
    END IF;

    SELECT * INTO v_session FROM sessions WHERE id = p_session_id FOR UPDATE;
    IF v_session.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_NOT_FOUND';
    END IF;

    SELECT se.league_id INTO v_league_id
      FROM seasons se WHERE se.id = v_session.season_id;

    IF NOT (public.is_league_organizer(v_league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    IF v_session.status NOT IN ('published', 'in_progress') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_NOT_ACTIVE';
    END IF;

    IF v_session.version <> p_version_was THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;

    -- The pairing the organizer pointed at, and the player leaving has to be
    -- sitting in it.
    SELECT * INTO v_match_out
      FROM session_matches
     WHERE id = p_match_id
       AND session_id = p_session_id
       AND is_drill = false;

    IF v_match_out.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_NOT_FOUND';
    END IF;
    IF NOT (p_user_out = ANY (v_match_out.team_a_user_ids)
            OR p_user_out = ANY (v_match_out.team_b_user_ids)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PLAYER_NOT_ON_SHEET';
    END IF;
    IF v_match_out.status <> 'pending' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_ALREADY_PLAYED';
    END IF;
    IF v_match_out.match_id IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_ALREADY_LINKED';
    END IF;

    -- Both already in this row: trading places would be a no-op the organizer
    -- cannot see, so say so rather than pretend it worked.
    IF p_user_in = ANY (v_match_out.team_a_user_ids)
       OR p_user_in = ANY (v_match_out.team_b_user_ids) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SAME_MATCH';
    END IF;

    -- The player coming in must be confirmed for this session, whether they are
    -- currently paired or sitting on a bye.
    IF NOT EXISTS (
        SELECT 1 FROM session_presence
         WHERE session_id = p_session_id AND user_id = p_user_in AND status = 'confirmed'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PLAYER_NOT_CONFIRMED';
    END IF;

    -- Their pairing in the SAME round, if any. A miss means they were on a bye
    -- that round and simply take the slot.
    SELECT * INTO v_match_in
      FROM session_matches
     WHERE session_id  = p_session_id
       AND is_drill    = false
       AND round_number = v_match_out.round_number
       AND id <> v_match_out.id
       AND (p_user_in = ANY (team_a_user_ids) OR p_user_in = ANY (team_b_user_ids))
     LIMIT 1;

    IF v_match_in.id IS NOT NULL THEN
        IF v_match_in.status <> 'pending' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_ALREADY_PLAYED';
        END IF;
        IF v_match_in.match_id IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_ALREADY_LINKED';
        END IF;
    END IF;

    -- Out -> in, on the named row only.
    UPDATE session_matches
       SET team_a_user_ids = array_replace(team_a_user_ids, p_user_out, p_user_in),
           team_b_user_ids = array_replace(team_b_user_ids, p_user_out, p_user_in),
           version         = version + 1,
           updated_at      = now()
     WHERE id = v_match_out.id;

    -- In -> out on their row, which is what makes it a swap rather than a
    -- duplication. Skipped when the arriving player was on a bye this round.
    IF v_match_in.id IS NOT NULL THEN
        UPDATE session_matches
           SET team_a_user_ids = array_replace(team_a_user_ids, p_user_in, p_user_out),
               team_b_user_ids = array_replace(team_b_user_ids, p_user_in, p_user_out),
               version         = version + 1,
               updated_at      = now()
         WHERE id = v_match_in.id;
    END IF;

    -- Nobody may come out of this booked twice in the round, which is both the
    -- "playing himself" row and the subtler double-booking across two rows.
    IF EXISTS (
        SELECT 1
          FROM (
            SELECT unnest(team_a_user_ids || team_b_user_ids) AS user_id
              FROM session_matches
             WHERE session_id   = p_session_id
               AND is_drill     = false
               AND round_number = v_match_out.round_number
          ) seats
         GROUP BY seats.user_id
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SWAP_WOULD_DUPLICATE_PLAYER';
    END IF;

    UPDATE sessions
       SET version = version + 1, updated_at = now()
     WHERE id = p_session_id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('session', p_session_id, 'swap_player', v_caller,
            jsonb_build_object(
                'user_out', p_user_out,
                'user_in', p_user_in,
                'round', v_match_out.round_number,
                'match_out', v_match_out.id,
                'match_in', v_match_in.id));

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.session_swap_player(uuid, uuid, uuid, uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.session_swap_player(uuid, uuid, uuid, uuid, integer) IS
'Organizer substitution on one named pairing of a published session sheet. The
arriving player trades rows with the leaver when they are paired in the SAME
round, and simply takes the slot when they were on a bye that round. Refuses
once either row carries a result or a linked game, and refuses outright if the
round would end up with anyone booked twice. Locked rows stay swappable: lock
guards against regenerate, not against a deliberate substitution.';
