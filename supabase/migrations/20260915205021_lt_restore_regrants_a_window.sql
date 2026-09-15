-- ============================================================================
-- Restoring a pairing after its deadline gives it a window to be played in.
-- ============================================================================
-- Seen on staging 2026-09-15: the organizer restored three walkovers whose
-- phase deadline had passed, and the resolver re-decided all three eleven
-- minutes later with the same rule. The hard stop refuses to move a deadline
-- once it has expired, so restore was a fifteen-minute illusion. A restore is
-- the organizer saying the machine got it wrong; the pairing needs time to be
-- played, or the organizer records the result. 72 h, stamped on the pairing
-- alone as deadline_override_at, audited and announced like an extension.
--
-- Bodies copied from 20260831150000 and 20260831230000 (latest of each).
-- ============================================================================

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
        PERFORM public.lt_notify_tournament_deadline_changed(
            v_row.tournament_id, v_row.bracket_side, ARRAY[v_row.round_number]::smallint[]);
    END IF;

    RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.lt_restore_tournament_match(uuid, boolean) IS
'Undo an automated decision: pairing back to pending, the advance unwound,
the reputation events it wrote deleted, the misfire audited. A manual restore
after the deadline also stamps a 72 h deadline_override_at on the pairing, or
the resolver would decide it again within fifteen minutes. Spec:
unplayed-match-resolution.md § 9.';

CREATE OR REPLACE FUNCTION public.lt_match_restore_state(p_tournament_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tm        tournament_matches;
    v_rule      text;
    v_decided   timestamptz;
    v_is_org    boolean;
    v_window    boolean;
    v_eff       timestamptz;
BEGIN
    SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tournament_match_id;
    IF v_tm.id IS NULL THEN
        RETURN jsonb_build_object('decided', false, 'restorable', false);
    END IF;

    -- The most recent automated decision, and only if nothing has undone it
    -- since: a restore writes its own audit row and must not leave the button
    -- offering to restore an already-restored pairing.
    SELECT a.payload_after ->> 'rule', a.occurred_at INTO v_rule, v_decided
      FROM leagues_tournaments_audit a
     WHERE a.scope = 'tournament_match' AND a.entity_id = p_tournament_match_id
       AND a.action IN ('auto_walkover', 'auto_double_forfeit',
                        'auto_double_walkover', 'auto_cancel')
     ORDER BY a.occurred_at DESC LIMIT 1;

    IF v_rule IS NULL OR EXISTS (
        SELECT 1 FROM leagues_tournaments_audit a
         WHERE a.scope = 'tournament_match' AND a.entity_id = p_tournament_match_id
           AND a.action = 'restore' AND a.occurred_at >= v_decided
    ) THEN
        RETURN jsonb_build_object('decided', false, 'restorable', false);
    END IF;

    v_is_org := public.is_tournament_organizer(v_tm.tournament_id) OR public.is_admin();
    v_window := public.lt_restore_window_open(p_tournament_match_id);
    v_eff    := public.lt_effective_match_deadline(v_tm);

    RETURN jsonb_build_object(
        'decided',         true,
        'rule',            v_rule,
        'window_open',     v_window,
        'is_organizer',    v_is_org,
        'restorable',      v_is_org AND v_window,
        -- What the confirm has to say: a restore now comes with 72 h to play.
        'deadline_passed', v_eff IS NOT NULL AND v_eff <= now()
    );
END;
$$;
