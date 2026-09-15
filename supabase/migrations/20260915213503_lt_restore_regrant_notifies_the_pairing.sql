-- ============================================================================
-- A re-granted pairing tells its two sides, not the whole phase.
-- ============================================================================
-- 20260915205021 reused the phase-wide notifier, which on a pool phase reaches
-- every player still in it. A restore concerns one pairing; the other six
-- have nothing to look at. Body copied from 20260915205021.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lt_notify_pairing_deadline_regranted(
    p_tournament_match_id uuid,
    p_deadline_at         timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tm   tournament_matches;
    v_t    tournaments;
    v_rows jsonb;
BEGIN
    SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tournament_match_id;
    IF v_tm.id IS NULL THEN RETURN; END IF;
    SELECT * INTO v_t FROM tournaments WHERE id = v_tm.tournament_id;

    SELECT jsonb_agg(DISTINCT jsonb_build_object(
        'user_id', u.uid,
        'type', 'tournament_deadline_changed',
        'target_id', v_t.id,
        'title', CASE WHEN public.lt_user_is_fr(u.uid)
                   THEN 'Échéance modifiée' ELSE 'Deadline updated' END,
        'body', CASE WHEN public.lt_user_is_fr(u.uid)
                  THEN v_t.name || ' : l''organisateur a remis ta partie à jouer. Vous avez 72 heures pour la jouer. Ouvre le tournoi pour l''échéance exacte.'
                  ELSE v_t.name || ': the organizer put your game back to unplayed. You have 72 hours to play it. Open the tournament for the exact deadline.'
                END,
        'payload', jsonb_build_object(
            'tournamentId', v_t.id,
            'tournamentName', v_t.name,
            'tournamentMatchId', v_tm.id,
            'bracketSide', v_tm.bracket_side,
            'rounds', to_jsonb(ARRAY[v_tm.round_number]),
            'deadlineAt', p_deadline_at
        ),
        'priority', 'normal'
    ))
    INTO v_rows
    FROM (
        SELECT DISTINCT unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) AS uid
          FROM tournament_registrations r
         WHERE r.id IN (v_tm.player1_registration_id, v_tm.player2_registration_id)
    ) u;

    IF v_rows IS NOT NULL THEN
        PERFORM insert_notifications(v_rows);
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.lt_notify_pairing_deadline_regranted(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lt_notify_pairing_deadline_regranted(uuid, timestamptz) TO service_role;

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
    v_caller   uuid := auth.uid();
    v_tm       tournament_matches;
    v_row      tournament_matches;
    v_rule     text;
    v_eff      timestamptz;
    v_regrant  timestamptz;
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

    -- A manual restore of a pairing whose deadline has passed would be
    -- re-decided by the next resolver run. The automatic path is a late real
    -- score arriving, which resolves the pairing on its own and needs no time.
    v_eff := public.lt_effective_match_deadline(v_tm);
    IF NOT p_automatic AND v_eff IS NOT NULL AND v_eff <= now() THEN
        v_regrant := now() + interval '72 hours';
    END IF;

    UPDATE tournament_matches
       SET status = 'pending', winner_registration_id = NULL, score = NULL,
           played_at = NULL,
           deadline_override_at = COALESCE(v_regrant, deadline_override_at),
           version = version + 1, updated_at = now()
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
                               'misfire', true,
                               'deadline_at', v_regrant));

    IF v_regrant IS NOT NULL THEN
        PERFORM public.lt_notify_pairing_deadline_regranted(v_row.id, v_regrant);
    END IF;

    RETURN v_row;
END;
$$;

