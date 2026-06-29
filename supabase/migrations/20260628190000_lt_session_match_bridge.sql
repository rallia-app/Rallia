-- ============================================================================
-- Leagues — V9 session match bridge (mirror of the tournament bridge)
-- ============================================================================
-- Spec: specs/17-leagues-tournaments/score-entry.md §Architecture (match bridge),
--       integrations.md §09 ("L&T rows link match_id -> public.match for scoring").
--
-- The shipped league V8/V9 built a parallel scoring stack (session_record_score
-- writing straight to session_matches / session_match_scores). The spec — and
-- the live tournament implementation — instead route player scoring through the
-- canonical match flow so leagues reuse score-confirmation, feedback, and rating.
--
-- Tournaments settled on a USER-DRIVEN ATTACH model (20260510170010): players
-- create a normal casual match, play + verify it, then link it to a bracket slot
-- via tournament_attach_match; a refactored helper drives propagation from both
-- the match_result trigger and the attach RPC. This migration mirrors that for
-- league sessions:
--
--   - session_matches.match_id            (the bridge column)
--   - lt_propagate_match_result_to_session(match_result_id)
--                                          sibling to lt_propagate_match_result_to_bracket
--   - lt_match_result_propagation_tg       extended to also drive the session helper
--                                          (tournament path untouched)
--   - session_attach_match(sm_id, match_id) the league twin of tournament_attach_match
--
-- Slice 1 of 3: pure additive plumbing. No auto-create, no UI change. The
-- organizer-override path (session_record_score) is left intact; the SessionDetail
-- UI still uses it until slice 2 reroutes player scoring to the canonical flow.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Bridge column
-- ----------------------------------------------------------------------------
ALTER TABLE public.session_matches
    ADD COLUMN IF NOT EXISTS match_id uuid UNIQUE REFERENCES public.match(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.session_matches.match_id IS
    'Standalone casual match row players score through the existing match flow. NULL until a verified match is attached to this session pairing (mirror of tournament_matches.match_id).';


-- ----------------------------------------------------------------------------
-- 2. Propagation: copy a verified match result onto the linked session_matches
--    row, complete the session if done, and recompute season ranking.
-- ----------------------------------------------------------------------------
-- Mirrors lt_propagate_match_result_to_bracket. The winning match team (1|2) is
-- mapped to the session pairing side (a|b) by which session team the winning
-- player belongs to — robust no matter how match_participant.team_number was
-- assigned for an attached, player-created match.

CREATE OR REPLACE FUNCTION public.lt_propagate_match_result_to_session(p_match_result_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_mr          match_result;
    v_sm          session_matches;
    v_winner_user uuid;
    v_winner_team pairing_team;
    v_score_text  text;
    v_season_id   uuid;
BEGIN
    SELECT * INTO v_mr FROM match_result WHERE id = p_match_result_id;
    IF v_mr.id IS NULL OR v_mr.is_verified IS NOT TRUE THEN
        RETURN;
    END IF;

    SELECT * INTO v_sm FROM session_matches WHERE match_id = v_mr.match_id;
    IF v_sm.id IS NULL THEN
        RETURN;
    END IF;
    -- Already settled (defensive / idempotent).
    IF v_sm.status IN ('completed', 'retired', 'walkover', 'cancelled') THEN
        RETURN;
    END IF;

    -- A NULL winning_team (abandoned/void) can't be mapped to a session side.
    IF v_mr.winning_team IS NULL THEN
        RETURN;
    END IF;

    SELECT mp.player_id INTO v_winner_user
      FROM match_participant mp
     WHERE mp.match_id    = v_mr.match_id
       AND mp.team_number = v_mr.winning_team
     LIMIT 1;
    IF v_winner_user IS NULL THEN
        RETURN;
    END IF;

    IF v_winner_user = ANY (v_sm.team_a_user_ids) THEN
        v_winner_team := 'a';
    ELSIF v_winner_user = ANY (v_sm.team_b_user_ids) THEN
        v_winner_team := 'b';
    ELSE
        RETURN;  -- winner is not part of this session pairing (defensive)
    END IF;

    SELECT string_agg(s.team1_score || '-' || s.team2_score, ' ' ORDER BY s.set_number)
      INTO v_score_text
      FROM match_set s
     WHERE s.match_result_id = v_mr.id;

    UPDATE session_matches
       SET winner_team = v_winner_team,
           score       = v_score_text,
           status      = 'completed',
           played_at   = now(),
           version     = version + 1,
           updated_at  = now()
     WHERE id = v_sm.id;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'session_match', v_sm.id, 'submit_score',
        coalesce(v_mr.confirmed_by, v_mr.submitted_by),
        jsonb_build_object(
            'session_id', v_sm.session_id,
            'winner_team', v_winner_team,
            'score', v_score_text,
            'match_result_id', v_mr.id
        )
    );

    -- Session completes once no playable matches remain (mirror session_record_score).
    IF NOT EXISTS (
        SELECT 1 FROM session_matches
         WHERE session_id = v_sm.session_id AND status IN ('pending', 'in_progress')
    ) AND EXISTS (
        SELECT 1 FROM session_matches
         WHERE session_id = v_sm.session_id AND status <> 'cancelled'
    ) THEN
        UPDATE sessions
           SET status = 'completed', completed_at = now(), version = version + 1, updated_at = now()
         WHERE id = v_sm.session_id AND status <> 'completed';
    END IF;

    SELECT season_id INTO v_season_id FROM sessions WHERE id = v_sm.session_id;
    PERFORM public.recalc_season_ranking(v_season_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lt_propagate_match_result_to_session(uuid) FROM anon, authenticated;


-- ----------------------------------------------------------------------------
-- 3. Extend the match_result trigger to also drive session propagation.
--    The tournament call is unchanged; we add the session call alongside it.
--    Both helpers no-op when the match isn't linked to their entity.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lt_match_result_propagation_tg()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.is_verified IS NOT TRUE THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.is_verified IS TRUE THEN
        RETURN NEW;
    END IF;

    PERFORM public.lt_propagate_match_result_to_bracket(NEW.id);
    PERFORM public.lt_propagate_match_result_to_session(NEW.id);
    RETURN NEW;
END;
$$;


-- ----------------------------------------------------------------------------
-- 4. session_attach_match: link a verified casual match to a session pairing.
--    League twin of tournament_attach_match (20260510170010).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.session_attach_match(
    p_session_match_id uuid,
    p_match_id         uuid
)
RETURNS session_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id   uuid := auth.uid();
    v_sm          session_matches;
    v_session     sessions;
    v_league_id   uuid;
    v_sport_id    uuid;
    v_match       match;
    v_mr          match_result;
    v_players     uuid[];
    v_match_users uuid[];
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_sm FROM session_matches WHERE id = p_session_match_id FOR UPDATE;
    IF v_sm.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_MATCH_NOT_FOUND';
    END IF;
    IF v_sm.match_id IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_LINKED';
    END IF;
    IF v_sm.status <> 'pending' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_NOT_PENDING';
    END IF;
    IF v_sm.is_drill OR v_sm.is_three_player THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_LINKABLE';
    END IF;

    SELECT * INTO v_session FROM sessions WHERE id = v_sm.session_id;
    IF v_session.status NOT IN ('published', 'in_progress') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_NOT_ACTIVE';
    END IF;

    SELECT se.league_id, l.sport_id INTO v_league_id, v_sport_id
      FROM seasons se JOIN leagues l ON l.id = se.league_id
     WHERE se.id = v_session.season_id;

    -- Caller must be one of this pairing's players, or the organizer/admin.
    v_players := v_sm.team_a_user_ids || v_sm.team_b_user_ids;
    IF NOT (v_caller_id = ANY (v_players)
            OR public.is_league_organizer(v_league_id)
            OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ALLOWED';
    END IF;

    SELECT * INTO v_match FROM match WHERE id = p_match_id;
    IF v_match.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_NOT_FOUND';
    END IF;
    IF v_match.sport_id <> v_sport_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SPORT_MISMATCH';
    END IF;
    IF EXISTS (SELECT 1 FROM session_matches WHERE match_id = p_match_id)
       OR EXISTS (SELECT 1 FROM tournament_matches WHERE match_id = p_match_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_ALREADY_LINKED';
    END IF;

    -- The match's joined participants must be exactly this pairing's players.
    SELECT array_agg(player_id ORDER BY player_id) INTO v_match_users
      FROM match_participant
     WHERE match_id = p_match_id AND status = 'joined';
    IF v_match_users IS NULL
       OR array_length(v_match_users, 1) IS DISTINCT FROM array_length(v_players, 1) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTICIPANTS_MISMATCH';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_players) p WHERE NOT (p = ANY (v_match_users))) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTICIPANTS_MISMATCH';
    END IF;

    -- The match must have a verified result.
    SELECT * INTO v_mr
      FROM match_result
     WHERE match_id = p_match_id AND is_verified = true
     LIMIT 1;
    IF v_mr.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_NOT_VERIFIED';
    END IF;

    UPDATE session_matches
       SET match_id = p_match_id, updated_at = now()
     WHERE id = p_session_match_id;

    PERFORM public.lt_propagate_match_result_to_session(v_mr.id);

    SELECT * INTO v_sm FROM session_matches WHERE id = p_session_match_id;
    RETURN v_sm;
END;
$$;

GRANT EXECUTE ON FUNCTION public.session_attach_match(uuid, uuid) TO authenticated;

COMMIT;
