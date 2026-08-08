-- ============================================================================
-- Leagues — swapping a player on the match sheet
-- ============================================================================
-- From the league test review: "L'organisateur doit pouvoir faire quelques
-- ajustements finaux aux paires avant de publier la feuille de matchs", and
-- "L'organisateur doit pouvoir faire des ajustements à la feuille de matchs
-- jusqu'à ce que les scores soient entrés. Ceci permet de gérer les imprévus
-- de la vraie vie (annulation de dernière minute, no-show d'un joueur)."
--
-- The only levers were lock and regenerate, which is all-or-nothing: an
-- organizer who wanted one substitution had to re-pair the entire night and
-- hope the rest came back the same.
--
-- session_swap_player moves one player into another's slot:
--
--   * both paired  -> the two trade places, which is the "these two would
--                     rather play each other's opponents" case;
--   * one unpaired -> the confirmed player sitting on a bye takes the slot of
--                     the one who cancelled, which is the no-show case.
--
-- Refused when either side's match already carries a result, so the sheet stays
-- adjustable exactly as long as the review asked: until the scores are in. A
-- locked row is deliberately still swappable — lock protects a pairing from
-- regenerate, and an explicit swap is not the blind re-pairing it guards
-- against.
--
-- Doubles is in scope: the arrays are edited in place, so a player moves
-- between teams without disturbing their partners.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.session_swap_player(
    p_session_id  uuid,
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

    -- The player being moved out has to be on the sheet.
    SELECT * INTO v_match_out
      FROM session_matches
     WHERE session_id = p_session_id
       AND is_drill = false
       AND (p_user_out = ANY (team_a_user_ids) OR p_user_out = ANY (team_b_user_ids))
     LIMIT 1;

    IF v_match_out.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PLAYER_NOT_ON_SHEET';
    END IF;
    IF v_match_out.status <> 'pending' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_ALREADY_PLAYED';
    END IF;
    IF v_match_out.match_id IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_ALREADY_LINKED';
    END IF;

    -- The player coming in must be confirmed for this session, whether they are
    -- currently paired or sitting on a bye.
    IF NOT EXISTS (
        SELECT 1 FROM session_presence
         WHERE session_id = p_session_id AND user_id = p_user_in AND status = 'confirmed'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PLAYER_NOT_CONFIRMED';
    END IF;

    SELECT * INTO v_match_in
      FROM session_matches
     WHERE session_id = p_session_id
       AND is_drill = false
       AND (p_user_in = ANY (team_a_user_ids) OR p_user_in = ANY (team_b_user_ids))
     LIMIT 1;

    IF v_match_in.id IS NOT NULL THEN
        IF v_match_in.status <> 'pending' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_ALREADY_PLAYED';
        END IF;
        IF v_match_in.match_id IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_ALREADY_LINKED';
        END IF;
        IF v_match_in.id = v_match_out.id THEN
            -- Both already face each other; trading places would be a no-op the
            -- organizer cannot see, so say so rather than pretend it worked.
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SAME_MATCH';
        END IF;
    END IF;

    -- Out -> in, everywhere the leaving player sits.
    UPDATE session_matches
       SET team_a_user_ids = array_replace(team_a_user_ids, p_user_out, p_user_in),
           team_b_user_ids = array_replace(team_b_user_ids, p_user_out, p_user_in),
           version         = version + 1,
           updated_at      = now()
     WHERE id = v_match_out.id;

    -- In -> out on the other row, which is what makes it a swap rather than a
    -- duplication. Skipped when the arriving player was on a bye.
    IF v_match_in.id IS NOT NULL THEN
        UPDATE session_matches
           SET team_a_user_ids = array_replace(team_a_user_ids, p_user_in, p_user_out),
               team_b_user_ids = array_replace(team_b_user_ids, p_user_in, p_user_out),
               version         = version + 1,
               updated_at      = now()
         WHERE id = v_match_in.id;
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
                'match_out', v_match_out.id,
                'match_in', v_match_in.id));

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.session_swap_player(uuid, uuid, uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.session_swap_player(uuid, uuid, uuid, integer) IS
'Organizer swaps two confirmed players on a published session sheet, or moves a
bye player into a slot. Refuses once either match carries a result or a linked
game. Locked rows stay swappable: lock guards against regenerate, not against a
deliberate substitution.';
