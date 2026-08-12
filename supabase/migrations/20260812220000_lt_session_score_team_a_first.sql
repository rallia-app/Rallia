-- Leagues twin of 20260812210000: session_matches.score is team_A-first.
--
-- Three of the four sites already agreed. SessionRecordScoreSheet serializes
-- side 1 as team A, SessionDetail prints the string raw between the team A and
-- team B names (the winner is bolded separately from winner_team), and
-- recalc_season_ranking parses it with lt_parse_score and hands a_sets/a_games
-- to team A's members and b_sets/b_games to team B's. Only the match bridge
-- disagreed: it copied the linked match's team1-team2 verbatim, and a match's
-- team numbering has nothing to do with the pairing's a/b. So a game whose
-- team A happened to be the match's team 2 landed reversed, which reads as the
-- wrong side winning on screen AND feeds inverted sets and games into season
-- points and the standings tie-breakers (recalc_season_ranking orders on
-- sets_won - sets_lost then games_won - games_lost).
--
-- No data repair: session_matches has 0 linked rows on prod and on staging, so
-- this trigger path has never actually written a score yet. Forward fix only.

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
    v_a_team      smallint;
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

    -- Which side of the MATCH this pairing's team A played on. The match's team
    -- numbering is independent of the pairing's a/b, so copying team1-team2
    -- verbatim put the score on the wrong side whenever team A was team 2.
    SELECT min(mp.team_number) INTO v_a_team
      FROM match_participant mp
     WHERE mp.match_id = v_mr.match_id
       AND mp.player_id = ANY (v_sm.team_a_user_ids);

    SELECT string_agg(
               CASE WHEN v_a_team = 2
                    THEN s.team2_score || '-' || s.team1_score
                    ELSE s.team1_score || '-' || s.team2_score END,
               ' ' ORDER BY s.set_number)
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

COMMENT ON COLUMN public.session_matches.score IS
    'Per-set games, team A first ("6-4 3-6 6-2" means team A took the first set 6-4). Readers orient on the side, never on the winner.';
