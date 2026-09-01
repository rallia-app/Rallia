-- ============================================================================
-- Restoring a pairing after an automated decision.
-- ============================================================================
-- unplayed-match-resolution.md § 9, the last thing the ladder was missing: a
-- way back. A decision taken at the deadline was final, so a result declared
-- afterwards had nowhere to go, and the organizer could only override, which
-- writes a new outcome rather than admitting the machine was wrong.
--
-- The window, per § 9: in a pool until the phase is consumed (the knockout is
-- generated), in a draw until the side that advanced has a result in its next
-- pairing. Past that the bracket has moved on and only an override, with its
-- own downstream guard, can touch it.
--
-- A restore reverses the outcome AND its consequences: the reputation events
-- the decision wrote are deleted, not offset, because they record a judgement
-- that turned out to be wrong. Each one is audited as a misfire, which is the
-- number worth watching once this is live.
--
-- The double forfeit restores itself. It is the only outcome that convicts
-- both sides at once, so both want it corrected and neither would be trusted
-- to ask alone; a real score declared inside the window undoes it with no
-- organizer action, guarded by the contest window on the declaration. Every
-- other outcome keeps the organizer tap, because someone benefits from it and
-- should not be able to erase it unilaterally.
-- ============================================================================

-- ------------------------------------------------------------- the window
CREATE OR REPLACE FUNCTION public.lt_restore_window_open(p_tournament_match_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT CASE
        WHEN tm.bracket_side = 'pool' THEN NOT EXISTS (
            SELECT 1 FROM tournament_matches m
             WHERE m.tournament_id = tm.tournament_id AND m.bracket_side = 'main'
        )
        WHEN tm.next_match_id IS NULL THEN true
        ELSE NOT EXISTS (
            SELECT 1 FROM tournament_matches n
             WHERE n.id = tm.next_match_id
               AND (n.status IN ('completed', 'retired', 'walkover')
                    OR n.winner_registration_id IS NOT NULL)
        )
    END
      FROM tournament_matches tm
     WHERE tm.id = p_tournament_match_id;
$$;

COMMENT ON FUNCTION public.lt_restore_window_open(uuid) IS
'True while an automated decision on this pairing can still be undone: in a
pool until the knockout is generated, in a draw until the advanced side has a
result in its next pairing. Spec: unplayed-match-resolution.md § 9.';

REVOKE ALL ON FUNCTION public.lt_restore_window_open(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lt_restore_window_open(uuid) TO authenticated;

-- ------------------------------------------------------------- the restore
CREATE OR REPLACE FUNCTION public.lt_restore_tournament_match(
    p_tournament_match_id uuid,
    p_automatic           boolean DEFAULT false
)
RETURNS tournament_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_tm     tournament_matches;
    v_row    tournament_matches;
    v_rule   text;
BEGIN
    SELECT * INTO v_tm FROM tournament_matches
     WHERE id = p_tournament_match_id FOR UPDATE;
    IF v_tm.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_MATCH_NOT_FOUND';
    END IF;

    -- The automatic path runs inside the result propagation, which has no JWT
    -- of its own and has already established that the correction is wanted.
    IF NOT p_automatic THEN
        IF v_caller IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
        END IF;
        IF NOT (public.is_tournament_organizer(v_tm.tournament_id) OR public.is_admin()) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
        END IF;
    END IF;

    SELECT a.payload_after ->> 'rule' INTO v_rule
      FROM leagues_tournaments_audit a
     WHERE a.scope = 'tournament_match' AND a.entity_id = p_tournament_match_id
       AND a.action IN ('auto_walkover', 'auto_double_forfeit', 'auto_double_walkover', 'auto_cancel')
     ORDER BY a.occurred_at DESC LIMIT 1;
    IF v_rule IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOTHING_TO_RESTORE';
    END IF;

    IF NOT public.lt_restore_window_open(p_tournament_match_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RESTORE_WINDOW_CLOSED';
    END IF;

    -- Undo the advance before the pairing itself, so a fed slot never keeps a
    -- side the decision put there.
    IF v_tm.next_match_id IS NOT NULL THEN
        UPDATE tournament_matches
           SET player1_registration_id =
                 CASE WHEN player1_registration_id = v_tm.winner_registration_id
                      THEN NULL ELSE player1_registration_id END,
               player2_registration_id =
                 CASE WHEN player2_registration_id = v_tm.winner_registration_id
                      THEN NULL ELSE player2_registration_id END,
               player1_is_bye = CASE WHEN player1_is_bye THEN false ELSE player1_is_bye END,
               player2_is_bye = CASE WHEN player2_is_bye THEN false ELSE player2_is_bye END,
               version = version + 1, updated_at = now()
         WHERE id = v_tm.next_match_id;
    END IF;

    UPDATE tournament_matches
       SET status = 'pending', winner_registration_id = NULL, score = NULL,
           played_at = NULL, version = version + 1, updated_at = now()
     WHERE id = p_tournament_match_id
    RETURNING * INTO v_row;

    -- The events recorded a judgement that turned out to be wrong, so they are
    -- removed rather than offset.
    DELETE FROM reputation_event
     WHERE (metadata ->> 'tournamentMatchId')::uuid = p_tournament_match_id
       AND event_type IN ('tournament_unresponsive', 'match_no_show');

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('tournament_match', p_tournament_match_id, 'restore',
            COALESCE(v_caller, (SELECT organizer_id FROM tournaments WHERE id = v_tm.tournament_id)),
            jsonb_build_object('tournament_id', v_tm.tournament_id,
                               'undone_rule', v_rule,
                               'automatic', p_automatic,
                               'misfire', true));

    RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.lt_restore_tournament_match(uuid, boolean) IS
'Undoes an automated deadline decision inside the restore window: the pairing
returns to pending, the advance it caused is unwound, and the reputation events
it wrote are deleted. Audited as a misfire. Organizer-only, except the
automatic path used when a real score lands on a double forfeit. Spec:
unplayed-match-resolution.md § 9.';

REVOKE ALL ON FUNCTION public.lt_restore_tournament_match(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lt_restore_tournament_match(uuid, boolean) TO authenticated;

-- ------------------------- the propagation auto-restores a double forfeit
CREATE OR REPLACE FUNCTION public.lt_propagate_match_result_to_bracket(p_match_result_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_mr           match_result;
    v_tm           tournament_matches;
    v_winner_user  uuid;
    v_winner_reg   uuid;
    v_p1_team      smallint;
    v_score_text   text;
BEGIN
    SELECT * INTO v_mr FROM match_result WHERE id = p_match_result_id;
    IF v_mr.id IS NULL OR v_mr.is_verified IS NOT TRUE THEN
        RETURN;
    END IF;

    SELECT * INTO v_tm FROM tournament_matches WHERE match_id = v_mr.match_id;
    IF v_tm.id IS NULL THEN
        RETURN;
    END IF;
    -- A double forfeit is the only outcome that convicts both sides at once,
    -- so both want it corrected and neither needs the organizer to ask: a real
    -- score declared inside the restore window undoes it by itself
    -- (unplayed-match-resolution.md § 5, § 9). The contest window is what
    -- guards the declaration. Every other outcome keeps the organizer tap.
    IF v_tm.status = 'walkover'
       AND v_tm.winner_registration_id IS NULL
       AND public.lt_restore_window_open(v_tm.id)
       AND EXISTS (
           SELECT 1 FROM leagues_tournaments_audit a
            WHERE a.scope = 'tournament_match' AND a.entity_id = v_tm.id
              AND a.action IN ('auto_double_forfeit', 'auto_double_walkover')
       ) THEN
        PERFORM public.lt_restore_tournament_match(v_tm.id, true);
        SELECT * INTO v_tm FROM tournament_matches WHERE id = v_tm.id;
    END IF;

    IF v_tm.status IN ('completed', 'walkover', 'retired', 'cancelled') THEN
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

    SELECT r.id INTO v_winner_reg
      FROM tournament_registrations r
     WHERE r.id IN (v_tm.player1_registration_id, v_tm.player2_registration_id)
       AND (r.user_id = v_winner_user OR r.partner_user_id = v_winner_user);
    IF v_winner_reg IS NULL THEN
        RETURN;
    END IF;

    -- Which side of the MATCH the bracket's player1 played on. The two
    -- orderings are independent, so copying team1-team2 verbatim rendered a win
    -- as a loss whenever player1 happened to sit on team 2.
    SELECT min(mp.team_number) INTO v_p1_team
      FROM match_participant mp
      JOIN tournament_registrations r ON r.id = v_tm.player1_registration_id
     WHERE mp.match_id = v_mr.match_id
       AND mp.player_id IN (r.user_id, r.partner_user_id);

    SELECT string_agg(
               CASE WHEN v_p1_team = 2
                    THEN s.team2_score || '-' || s.team1_score
                    ELSE s.team1_score || '-' || s.team2_score END,
               ' ' ORDER BY s.set_number)
      INTO v_score_text
      FROM match_set s
     WHERE s.match_result_id = v_mr.id;

    UPDATE tournament_matches
       SET winner_registration_id = v_winner_reg,
           score                  = v_score_text,
           status                 = 'completed',
           played_at              = now(),
           version                = version + 1,
           updated_at             = now()
     WHERE id = v_tm.id;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament_match', v_tm.id, 'submit_score',
        coalesce(v_mr.confirmed_by, v_mr.submitted_by),
        jsonb_build_object(
            'tournament_id', v_tm.tournament_id,
            'round', v_tm.round_number,
            'position', v_tm.match_position,
            'winner_registration_id', v_winner_reg,
            'score', v_score_text,
            'match_result_id', v_mr.id
        )
    );

    PERFORM public.lt_advance_tournament_winner(v_tm.id, v_winner_reg);
END;
$$;
