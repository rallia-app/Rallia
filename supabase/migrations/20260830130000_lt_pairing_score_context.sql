-- ============================================================================
-- L&T — one read for the chat's "enter the score" entry point
-- ============================================================================
-- 20260830120000 let a pairing's participants record their own result when no
-- game was created. The natural place to reach that is the pairing chat (the
-- tournament round chat / league pairing chat), but the chat screen only holds
-- the conversation's tournament_match_id / session_match_id — the record-score
-- sheets need the full pairing context (sides, names, format, final/decider
-- flags, version). Assembling that client-side means four or five queries per
-- chat open.
--
-- lt_pairing_score_context returns it in one call, plus a can_self_score
-- verdict computed with the SAME guards the write RPCs enforce (live event,
-- unscored row, no linked game, standard pairing). The client shows the entry
-- point only when the verdict is true, so the banner can never offer a submit
-- the server would refuse.
--
-- Caller must be a participant of the pairing (doubles partners included), the
-- event organizer, or an admin; anyone else — and any unknown id — gets NULL
-- rather than an error, so the chat screen can probe without ceremony.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lt_pairing_score_context(
    p_tournament_match_id uuid DEFAULT NULL,
    p_session_match_id    uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_tm     tournament_matches;
    v_t      tournaments;
    v_sm     session_matches;
    v_sess   sessions;
    v_season seasons;
    v_league leagues;
    v_sport  text;
    v_p1     text;
    v_p2     text;
    v_ok     boolean;
    v_reason text;
BEGIN
    IF v_caller IS NULL THEN
        RETURN NULL;
    END IF;

    -- ------------------------------------------------------------ tournament
    IF p_tournament_match_id IS NOT NULL THEN
        SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tournament_match_id;
        IF v_tm.id IS NULL THEN
            RETURN NULL;
        END IF;

        IF NOT (
            EXISTS (
                SELECT 1 FROM tournament_registrations tr
                 WHERE tr.id IN (v_tm.player1_registration_id, v_tm.player2_registration_id)
                   AND v_caller IN (tr.user_id, tr.partner_user_id)
            )
            OR public.is_tournament_organizer(v_tm.tournament_id)
            OR public.is_admin()
        ) THEN
            RETURN NULL;
        END IF;

        SELECT * INTO v_t FROM tournaments WHERE id = v_tm.tournament_id;
        SELECT s.name INTO v_sport FROM sport s WHERE s.id = v_t.sport_id;

        -- Same ladder as the participant branch of tournament_override_score.
        IF v_tm.player1_is_bye OR v_tm.player2_is_bye
           OR v_tm.player1_registration_id IS NULL
           OR v_tm.player2_registration_id IS NULL THEN
            v_ok := false; v_reason := 'SLOTS_INCOMPLETE';
        ELSIF v_t.status <> 'in_progress' THEN
            v_ok := false; v_reason := 'TOURNAMENT_NOT_IN_PROGRESS';
        ELSIF v_tm.status NOT IN ('pending', 'in_progress')
              OR v_tm.winner_registration_id IS NOT NULL THEN
            v_ok := false; v_reason := 'ALREADY_SCORED';
        ELSIF v_tm.match_id IS NOT NULL THEN
            v_ok := false; v_reason := 'MATCH_ALREADY_LINKED';
        ELSE
            v_ok := true; v_reason := NULL;
        END IF;

        -- Side labels: first names, doubles partners joined with ' & '.
        SELECT string_agg(COALESCE(NULLIF(trim(pr.first_name), ''), '?'), ' & ' ORDER BY u.ord)
          INTO v_p1
          FROM tournament_registrations tr
         CROSS JOIN LATERAL unnest(ARRAY[tr.user_id, tr.partner_user_id])
                    WITH ORDINALITY AS u(id, ord)
          JOIN profile pr ON pr.id = u.id
         WHERE tr.id = v_tm.player1_registration_id;
        SELECT string_agg(COALESCE(NULLIF(trim(pr.first_name), ''), '?'), ' & ' ORDER BY u.ord)
          INTO v_p2
          FROM tournament_registrations tr
         CROSS JOIN LATERAL unnest(ARRAY[tr.user_id, tr.partner_user_id])
                    WITH ORDINALITY AS u(id, ord)
          JOIN profile pr ON pr.id = u.id
         WHERE tr.id = v_tm.player2_registration_id;

        RETURN jsonb_build_object(
            'kind', 'tournament',
            'can_self_score', v_ok,
            'reason', v_reason,
            'tournament_match_id', v_tm.id,
            'tournament_id', v_t.id,
            'player1_registration_id', v_tm.player1_registration_id,
            'player2_registration_id', v_tm.player2_registration_id,
            'player1_name', COALESCE(v_p1, '?'),
            'player2_name', COALESCE(v_p2, '?'),
            'sport_name', v_sport,
            'match_format', v_t.match_format,
            'points_per_game', v_t.points_per_game,
            'is_final', (
                v_tm.bracket_side = 'main'
                AND v_tm.round_number = (
                    SELECT max(round_number) FROM tournament_matches
                     WHERE tournament_id = v_t.id AND bracket_side = 'main'
                )
            ),
            'is_pool_match', (v_tm.pool_number IS NOT NULL)
        );
    END IF;

    -- --------------------------------------------------------------- session
    IF p_session_match_id IS NOT NULL THEN
        SELECT * INTO v_sm FROM session_matches WHERE id = p_session_match_id;
        IF v_sm.id IS NULL THEN
            RETURN NULL;
        END IF;

        SELECT * INTO v_sess   FROM sessions WHERE id = v_sm.session_id;
        SELECT * INTO v_season FROM seasons  WHERE id = v_sess.season_id;
        SELECT * INTO v_league FROM leagues  WHERE id = v_season.league_id;

        IF NOT (
            v_caller = ANY (v_sm.team_a_user_ids || v_sm.team_b_user_ids)
            OR public.is_league_organizer(v_league.id)
            OR public.is_admin()
        ) THEN
            RETURN NULL;
        END IF;

        SELECT s.name INTO v_sport FROM sport s WHERE s.id = v_league.sport_id;

        -- Same ladder as the participant branch of session_record_score.
        IF v_sm.is_drill OR v_sm.is_three_player THEN
            v_ok := false; v_reason := 'MATCH_NOT_SELF_SCOREABLE';
        ELSIF v_sess.status NOT IN ('published', 'in_progress') THEN
            v_ok := false; v_reason := 'SESSION_NOT_ACTIVE';
        ELSIF v_sm.status NOT IN ('pending', 'in_progress')
              OR v_sm.winner_team IS NOT NULL THEN
            v_ok := false; v_reason := 'ALREADY_SCORED';
        ELSIF v_sm.match_id IS NOT NULL THEN
            v_ok := false; v_reason := 'MATCH_ALREADY_LINKED';
        ELSE
            v_ok := true; v_reason := NULL;
        END IF;

        SELECT string_agg(COALESCE(NULLIF(trim(pr.first_name), ''), '?'), ' & ' ORDER BY u.ord)
          INTO v_p1
          FROM unnest(v_sm.team_a_user_ids) WITH ORDINALITY AS u(id, ord)
          JOIN profile pr ON pr.id = u.id;
        SELECT string_agg(COALESCE(NULLIF(trim(pr.first_name), ''), '?'), ' & ' ORDER BY u.ord)
          INTO v_p2
          FROM unnest(v_sm.team_b_user_ids) WITH ORDINALITY AS u(id, ord)
          JOIN profile pr ON pr.id = u.id;

        RETURN jsonb_build_object(
            'kind', 'session',
            'can_self_score', v_ok,
            'reason', v_reason,
            'session_match_id', v_sm.id,
            'session_id', v_sess.id,
            'season_id', v_season.id,
            'version_was', v_sm.version,
            'team_a_name', COALESCE(v_p1, '?'),
            'team_b_name', COALESCE(v_p2, '?'),
            'sport_name', v_sport,
            'match_format', v_sess.match_format,
            'points_per_game', v_sess.points_per_game,
            'is_decider', NOT EXISTS (
                SELECT 1 FROM session_matches
                 WHERE session_id = v_sess.id AND id <> v_sm.id
                   AND status IN ('pending', 'in_progress')
            )
        );
    END IF;

    RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lt_pairing_score_context(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.lt_pairing_score_context(uuid, uuid) IS
    'Everything the record-score sheet needs for one pairing (sides, names, format, final/decider flags, session version) plus a can_self_score verdict mirroring the participant guards of tournament_override_score / session_record_score. Pairing participants, the event organizer, and admins only; anyone else gets NULL. Read-only; used by the pairing-chat score entry point.';
