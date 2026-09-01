-- ============================================================================
-- Two fairness defects in the ladder.
-- ============================================================================
-- 1. NOBODY IS ELIMINATED ON PAPERWORK ALONE.
--    Four of the six signal points (timeliness, volume) are earned by filling
--    in the availability grid. Only reactivity reflects actually dealing with
--    the opponent, and it scores 0 on BOTH sides when neither ever proposed
--    anything. With Δgap = 1 in a knockout, that let the ladder eliminate a
--    player 6-0 6-0 for answering the form later and with fewer hours, on a
--    pairing where zero games were ever proposed or booked. Reproduced against
--    the live function 2026-08-31.
--
--    That contradicts what the app tells players the deadline decides ("the
--    person who tried to organize it advances"), so when neither side has any
--    reactivity and nothing was ever booked, the gap rule no longer applies.
--    In a pool the game is cancelled, which is what a pool already does when
--    two engaged sides cannot be separated. A knockout slot has to send someone
--    forward and the machine has no honest basis to choose, so it escalates to
--    the organizer rather than inventing one. Seeding and coin flips were
--    rejected upstream (round-deadlines.md) and still are.
--
-- 2. REPUTATION LANDS ON THE PERSON, NOT THE REGISTRATION.
--    The penalty was written to every user of the losing registration, so in
--    doubles a player who answered the gate promptly took a -15 for their
--    partner's silence. The team losing the game is right, the personal mark
--    is not: a reputation score is about that person's conduct.
--
--    The carve-out is narrow on purpose. Exempting everyone who touched the
--    gate would have removed the mark from exactly the people it is for, since
--    a 'P' side is by definition one that was aware and then did nothing. So
--    the whole side is marked UNLESS its members behaved differently, and only
--    then does the mark follow the silent one.
--
-- Spec: unplayed-match-resolution.md § 4 (signals), § 6 (rungs), § 4.4
-- (reputation bar).
-- ============================================================================

-- ------------------------------------------------- did THIS person do anything
CREATE OR REPLACE FUNCTION public.lt_user_acted(
    p_tournament_match_id uuid,
    p_user                uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tm    tournament_matches;
    v_round smallint;
BEGIN
    SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tournament_match_id;
    IF v_tm.id IS NULL THEN RETURN false; END IF;
    v_round := CASE WHEN v_tm.bracket_side = 'pool' THEN 0 ELSE v_tm.round_number END;

    -- Answered the gate for this phase...
    IF EXISTS (SELECT 1 FROM tournament_phase_availability a
                WHERE a.tournament_id = v_tm.tournament_id
                  AND a.bracket_side  = v_tm.bracket_side
                  AND a.round_number  = v_round
                  AND a.player_id     = p_user) THEN
        RETURN true;
    END IF;

    -- ...or took a scheduling act on this pairing...
    IF EXISTS (SELECT 1 FROM leagues_tournaments_audit a
                WHERE a.scope = 'tournament_match' AND a.entity_id = p_tournament_match_id
                  AND a.action IN ('funnel_booked', 'funnel_booking_accepted',
                                   'funnel_reproposed', 'funnel_pinged', 'declared_forfeit')
                  AND a.actor_id = p_user) THEN
        RETURN true;
    END IF;

    -- ...or showed up to the game that was agreed.
    RETURN EXISTS (SELECT 1 FROM match_participant mp
                    WHERE mp.match_id = v_tm.match_id AND mp.player_id = p_user
                      AND mp.checked_in_at IS NOT NULL);
END;
$$;

COMMENT ON FUNCTION public.lt_user_acted(uuid, uuid) IS
'Whether this individual did anything about this pairing: answered the gate,
took a scheduling act, or checked in. Used to keep a personal reputation mark
off a doubles partner who did their part. Spec: unplayed-match-resolution.md
§ 4.4.';

REVOKE ALL ON FUNCTION public.lt_user_acted(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lt_user_acted(uuid, uuid) TO authenticated;

-- --------------------------------------------- who the mark belongs to
CREATE OR REPLACE FUNCTION public.lt_reputation_targets(
    p_tournament_match_id uuid,
    p_registration        uuid
)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_users  uuid[];
    v_silent uuid[];
BEGIN
    v_users := public.lt_registration_users(p_registration);
    SELECT array_agg(u) INTO v_silent
      FROM unnest(v_users) u
     WHERE NOT public.lt_user_acted(p_tournament_match_id, u);

    -- A side whose members behaved differently is not one conduct: in doubles
    -- a partner who answered the gate should not carry a personal mark for the
    -- one who never did. Where everyone did the same thing, silent or not, the
    -- side is judged as one and the mark falls on all of them, which is what
    -- keeps a lone player who answered and then went quiet accountable.
    IF v_silent IS NOT NULL
       AND array_length(v_silent, 1) > 0
       AND array_length(v_silent, 1) < array_length(v_users, 1) THEN
        RETURN v_silent;
    END IF;
    RETURN v_users;
END;
$$;

COMMENT ON FUNCTION public.lt_reputation_targets(uuid, uuid) IS
'Which members of a losing side carry the personal reputation mark. The whole
side, unless its members behaved differently, in which case only the ones who
did nothing. Spec: unplayed-match-resolution.md § 4.4.';

REVOKE ALL ON FUNCTION public.lt_reputation_targets(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lt_reputation_targets(uuid, uuid) TO authenticated;

-- ------------------------------------------- the organizer has to be told
CREATE OR REPLACE FUNCTION public.lt_notify_tournament_escalated(
    p_tm_id  uuid,
    p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tm   tournament_matches;
    v_t    tournaments;
    v_fr   boolean;
BEGIN
    SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tm_id;
    SELECT * INTO v_t  FROM tournaments WHERE id = v_tm.tournament_id;
    IF v_t.organizer_id IS NULL THEN RETURN; END IF;
    v_fr := public.lt_user_is_fr(v_t.organizer_id);

    PERFORM insert_notifications(jsonb_build_array(jsonb_build_object(
        'user_id', v_t.organizer_id,
        'type', 'tournament_action_required',
        'target_id', v_t.id,
        'title', CASE WHEN v_fr THEN 'Une partie attend ta décision'
                      ELSE 'A game needs your decision' END,
        'body', v_t.name || CASE
            WHEN v_fr THEN ' : les deux joueurs ont donné leurs dispos mais personne n''a proposé de moment, alors l''app ne tranche pas à leur place. Choisis qui passe au tour suivant.'
            ELSE ': both players gave their availability but neither proposed a time, so the app is not deciding this one for them. Pick who advances.' END,
        'payload', jsonb_build_object(
            'tournamentId', v_t.id,
            'tournamentMatchId', v_tm.id,
            'reason', p_reason
        ),
        'priority', 'high'
    )));
END;
$$;

COMMENT ON FUNCTION public.lt_notify_tournament_escalated(uuid, text) IS
'Tells the organizer a pairing was handed back to them rather than decided.
Without it the knockout slot would simply stall, which is worse than a wrong
decision because nobody would know. Spec: unplayed-match-resolution.md § 6.';

REVOKE ALL ON FUNCTION public.lt_notify_tournament_escalated(uuid, text)
    FROM PUBLIC, anon, authenticated;

-- --------------------------------------------- a cancellation nobody caused
-- 'no_attempt' joins the reasons a cancelled game can carry.
CREATE OR REPLACE FUNCTION public.lt_notify_tournament_cancelled(
    p_tm_id uuid,
    p_rule  text DEFAULT NULL
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
    SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tm_id;
    SELECT * INTO v_t  FROM tournaments WHERE id = v_tm.tournament_id;

    SELECT jsonb_agg(jsonb_build_object(
        'user_id', u.uid,
        'type', 'tournament_match_cancelled',
        'target_id', v_t.id,
        'title', CASE WHEN public.lt_user_is_fr(u.uid)
                   THEN 'Partie annulée' ELSE 'Game cancelled' END,
        'body', v_t.name || CASE
          WHEN public.lt_user_is_fr(u.uid) THEN
            CASE p_rule
              WHEN 'unrecorded' THEN ' : vous vous étiez entendus sur un moment mais aucun résultat n''a été inscrit avant l''échéance. La partie est annulée et ne compte pas au classement.'
              WHEN 'mutual_cancel' THEN ' : vous aviez annulé la partie d''un commun accord et elle n''a pas été reprise avant l''échéance. Elle est annulée, sans faute de personne.'
              WHEN 'no_attempt' THEN ' : vous avez donné vos dispos tous les deux, mais personne n''a proposé de moment avant l''échéance. La partie est annulée et ne compte pour ni l''un ni l''autre.'
              ELSE ' : vous avez fait votre part tous les deux et ça n''a pas adonné. La partie est annulée, sans faute de personne, et elle ne compte pas au classement.' END
          ELSE
            CASE p_rule
              WHEN 'unrecorded' THEN ': you had agreed on a time but no result was recorded before the deadline. The game is cancelled and does not count in the standings.'
              WHEN 'mutual_cancel' THEN ': you had cancelled the game by mutual agreement and it was not rescheduled before the deadline. It is cancelled, nobody is at fault.'
              WHEN 'no_attempt' THEN ': you both gave your availability, but neither of you proposed a time before the deadline. The game is cancelled and counts for neither of you.'
              ELSE ': you both did your part and it did not work out. The game is cancelled, nobody is at fault, and it does not count in the standings.' END
        END,
        'payload', jsonb_build_object(
            'tournamentId', v_t.id,
            'tournamentMatchId', v_tm.id,
            'rule', p_rule
        ),
        'priority', 'normal'
    ))
    INTO v_rows
    FROM (
        SELECT unnest(public.lt_registration_users(v_tm.player1_registration_id)) AS uid
        UNION ALL
        SELECT unnest(public.lt_registration_users(v_tm.player2_registration_id))
    ) u;

    IF v_rows IS NOT NULL THEN
        PERFORM insert_notifications(v_rows);
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.lt_notify_tournament_cancelled(uuid, text)
    FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------- the ladder
CREATE OR REPLACE FUNCTION public.lt_resolve_due_tournament_matches(p_dry_run boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_rec      record;
    v_eff      timestamptz;
    v_sig1     jsonb;
    v_sig2     jsonb;
    v_st1      text;
    v_st2      text;
    v_s1       int;
    v_s2       int;
    v_gap      int;
    v_winner   uuid;
    v_loser    uuid;
    v_acted    integer := 0;
    v_apply    boolean;
    v_prefix   text;
    v_rows     jsonb;
    v_uid      uuid;
    v_proto    boolean;
    v_rule     text;
    v_origin   text;
    v_attempt  boolean;
    v_ci1      int;
    v_ci2      int;
    v_cancel   record;
BEGIN
    FOR v_rec IN
        SELECT tm.*, t.name AS t_name, t.organizer_id AS t_org,
               t.match_format AS t_format, t.games_per_set AS t_gps,
               t.points_per_game AS t_ppg,
               COALESCE(t.scheduling_funnel_enabled, false) AS t_funnel
          FROM tournament_matches tm
          JOIN tournaments t ON t.id = tm.tournament_id
         WHERE t.status = 'in_progress'
           AND tm.status IN ('pending', 'in_progress', 'disputed')
           AND tm.player1_registration_id IS NOT NULL
           AND tm.player2_registration_id IS NOT NULL
           AND NOT tm.player1_is_bye AND NOT tm.player2_is_bye
         FOR UPDATE OF tm SKIP LOCKED
    LOOP
        v_eff := public.lt_effective_match_deadline(
            (SELECT m FROM tournament_matches m WHERE m.id = v_rec.id));
        CONTINUE WHEN v_eff IS NULL OR v_eff > now();

        -- Act only where the funnel produced the evidence this reads.
        v_apply  := (NOT p_dry_run) AND v_rec.t_funnel;
        v_prefix := CASE WHEN v_apply THEN '' ELSE 'dryrun_' END;

        -- R0: a contested result is never decided by the machine.
        IF v_rec.status = 'disputed' THEN
            IF NOT EXISTS (
                SELECT 1 FROM leagues_tournaments_audit a
                 WHERE a.scope = 'tournament_match' AND a.entity_id = v_rec.id
                   AND a.action IN ('dispute_escalated', 'dryrun_dispute_escalated')
            ) THEN
                INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
                VALUES ('tournament_match', v_rec.id, v_prefix || 'dispute_escalated', v_rec.t_org,
                        jsonb_build_object('tournament_id', v_rec.tournament_id, 'deadline_at', v_eff));
                v_acted := v_acted + 1;
            END IF;
            CONTINUE;
        END IF;

        v_proto := v_rec.deadline_nudge48_at IS NOT NULL
               AND v_rec.deadline_nudge12_at IS NOT NULL;

        v_sig1 := public.lt_side_signals(v_rec.id, v_rec.player1_registration_id);
        v_sig2 := public.lt_side_signals(v_rec.id, v_rec.player2_registration_id);
        v_s1   := COALESCE((v_sig1->>'s')::int, 0);
        v_s2   := COALESCE((v_sig2->>'s')::int, 0);
        v_st1  := COALESCE(v_sig1->>'state', 'U');
        v_st2  := COALESCE(v_sig2->>'state', 'U');

        -- R3: a game was agreed and no result was declared.
        IF v_rec.match_id IS NOT NULL THEN
            SELECT count(*) FILTER (WHERE mp.player_id = ANY (public.lt_registration_users(v_rec.player1_registration_id))
                                      AND mp.checked_in_at IS NOT NULL),
                   count(*) FILTER (WHERE mp.player_id = ANY (public.lt_registration_users(v_rec.player2_registration_id))
                                      AND mp.checked_in_at IS NOT NULL)
              INTO v_ci1, v_ci2
              FROM match_participant mp WHERE mp.match_id = v_rec.match_id;

            IF v_ci1 > 0 AND v_ci2 = 0 THEN
                v_winner := v_rec.player1_registration_id;
                v_loser  := v_rec.player2_registration_id;
                v_rule   := 'no_show';
            ELSIF v_ci2 > 0 AND v_ci1 = 0 THEN
                v_winner := v_rec.player2_registration_id;
                v_loser  := v_rec.player1_registration_id;
                v_rule   := 'no_show';
            ELSE
                -- Nobody, or both: an agreement is the strongest scheduling act
                -- there is, so both sides are deemed E and fall to the gap rule.
                v_st1 := 'E'; v_st2 := 'E';
                v_s1  := GREATEST(v_s1, 2); v_s2 := GREATEST(v_s2, 2);
                v_rule := 'unrecorded'; v_origin := 'unrecorded';
            END IF;
        ELSE
            -- R3': the linked game was cancelled and the trigger detached it.
            SELECT m.mutually_cancelled, a.actor_id INTO v_cancel
              FROM leagues_tournaments_audit a
              JOIN match m ON m.id = (a.payload_after->>'match_id')::uuid
             WHERE a.scope = 'tournament_match' AND a.entity_id = v_rec.id
               AND a.action = 'detach_cancelled_match'
             ORDER BY a.occurred_at DESC LIMIT 1;

            IF v_cancel IS NOT NULL AND v_cancel.mutually_cancelled IS NOT TRUE THEN
                -- Cancelling after agreeing is a forfeit on the canceller.
                IF v_cancel.actor_id = ANY (public.lt_registration_users(v_rec.player1_registration_id)) THEN
                    v_winner := v_rec.player2_registration_id;
                    v_loser  := v_rec.player1_registration_id;
                ELSE
                    v_winner := v_rec.player1_registration_id;
                    v_loser  := v_rec.player2_registration_id;
                END IF;
                v_rule := 'cancel_forfeit';
            ELSIF v_cancel IS NOT NULL THEN
                v_st1 := 'E'; v_st2 := 'E';
                v_s1  := GREATEST(v_s1, 2); v_s2 := GREATEST(v_s2, 2);
                v_rule := 'mutual_cancel'; v_origin := 'mutual_cancel';
            END IF;
        END IF;

        -- R4 / R5 / R6 on the states, when no conclusive event decided it.
        IF v_rule IS NULL OR v_rule IN ('unrecorded', 'mutual_cancel') THEN
            v_gap := CASE WHEN v_rec.bracket_side = 'pool' THEN 2 ELSE 1 END;

            -- Both answered well, but did either of them actually try to
            -- PLAY? Timeliness and volume are earned by filling in a form;
            -- only reactivity reflects dealing with the opponent, and it is 0
            -- on both sides when neither ever proposed anything. Separating
            -- them on form alone would eliminate someone for filling a grid
            -- less generously, which is not what the player was told the
            -- deadline decides.
            v_attempt := COALESCE((v_sig1->>'reactivity')::int, 0) > 0
                      OR COALESCE((v_sig2->>'reactivity')::int, 0) > 0
                      OR EXISTS (SELECT 1 FROM lt_pairing_booking b
                                  WHERE b.tournament_match_id = v_rec.id);

            IF v_st1 = 'E' AND v_st2 = 'E' THEN
                IF NOT v_attempt THEN
                    v_winner := NULL; v_loser := NULL; v_rule := 'no_attempt';
                ELSIF abs(v_s1 - v_s2) >= v_gap THEN
                    v_winner := CASE WHEN v_s1 > v_s2 THEN v_rec.player1_registration_id
                                     ELSE v_rec.player2_registration_id END;
                    v_loser  := CASE WHEN v_s1 > v_s2 THEN v_rec.player2_registration_id
                                     ELSE v_rec.player1_registration_id END;
                    v_rule   := 'gap_rule';
                ELSE
                    v_winner := NULL; v_loser := NULL; v_rule := 'stalemate';
                END IF;
            ELSIF v_st1 = 'E' THEN
                v_winner := v_rec.player1_registration_id;
                v_loser  := v_rec.player2_registration_id;
                v_rule   := 'one_sided';
            ELSIF v_st2 = 'E' THEN
                v_winner := v_rec.player2_registration_id;
                v_loser  := v_rec.player1_registration_id;
                v_rule   := 'one_sided';
            ELSE
                v_winner := NULL; v_loser := NULL; v_rule := 'no_effort';
            END IF;
        END IF;

        INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
        VALUES ('tournament_match', v_rec.id,
                v_prefix || CASE WHEN v_rule IN ('stalemate', 'no_attempt') THEN 'auto_cancel'
                                 WHEN v_winner IS NULL THEN 'auto_double_forfeit'
                                 ELSE 'auto_walkover' END,
                v_rec.t_org,
                jsonb_build_object('tournament_id', v_rec.tournament_id,
                                   'rule', v_rule,
                                   'winner_registration_id', v_winner,
                                   'signals_p1', v_sig1, 'signals_p2', v_sig2,
                                   'protocol_complete', v_proto,
                                   'funnel', v_rec.t_funnel));

        IF v_apply THEN
            -- Nobody tried to play. In a pool the game simply leaves the
            -- denominator. A knockout slot has to send someone forward, and
            -- the machine has no honest basis to pick, so it hands the call to
            -- the organizer instead of inventing one. Audited once, or every
            -- pass would re-escalate the same pairing.
            IF v_rule = 'no_attempt' AND v_rec.bracket_side <> 'pool' THEN
                IF NOT EXISTS (
                    SELECT 1 FROM leagues_tournaments_audit a
                     WHERE a.scope = 'tournament_match' AND a.entity_id = v_rec.id
                       AND a.action IN ('auto_escalated', 'dryrun_auto_escalated')
                ) THEN
                    INSERT INTO leagues_tournaments_audit
                        (scope, entity_id, action, actor_id, payload_after)
                    VALUES ('tournament_match', v_rec.id, 'auto_escalated', v_rec.t_org,
                            jsonb_build_object('tournament_id', v_rec.tournament_id,
                                               'rule', 'no_attempt',
                                               'signals_p1', v_sig1, 'signals_p2', v_sig2));
                    PERFORM public.lt_notify_tournament_escalated(v_rec.id, 'no_attempt');
                    v_acted := v_acted + 1;
                END IF;
                v_rule := NULL; v_origin := NULL; v_winner := NULL;
                v_loser := NULL; v_cancel := NULL; v_attempt := NULL;
                CONTINUE;
            END IF;

            IF v_rule IN ('stalemate', 'no_attempt') THEN
                -- Neither side is at fault: the game leaves the denominator.
                UPDATE tournament_matches
                   SET status = 'cancelled', winner_registration_id = NULL, score = NULL,
                       version = version + 1, updated_at = now()
                 WHERE id = v_rec.id;
                PERFORM public.lt_notify_tournament_cancelled(
                            v_rec.id, COALESCE(v_origin, v_rule));
            ELSIF v_winner IS NULL THEN
                PERFORM public.lt_advance_double_walkover(v_rec.id);
                PERFORM public.lt_notify_tournament_walkover(v_rec.id, NULL, true, v_rule);
            ELSE
                UPDATE tournament_matches
                   SET status = 'walkover', winner_registration_id = v_winner,
                       score = public.lt_forfeit_score(
                                   v_rec.t_format, v_rec.t_gps, v_rec.t_ppg,
                                   v_winner = v_rec.player1_registration_id),
                       played_at = now(), version = version + 1, updated_at = now()
                 WHERE id = v_rec.id;
                PERFORM public.lt_advance_tournament_winner(v_rec.id, v_winner);
                PERFORM public.lt_notify_tournament_walkover(v_rec.id, v_winner, false, v_rule);
            END IF;

            -- Personal consequences need proof they knew, and the prompts.
            IF v_proto THEN
                IF v_rule = 'no_show' AND v_loser IS NOT NULL THEN
                    FOREACH v_uid IN ARRAY public.lt_reputation_targets(v_rec.id, v_loser) LOOP
                        INSERT INTO reputation_event
                            (player_id, event_type, base_impact, metadata, event_occurred_at)
                        VALUES (v_uid, 'match_no_show',
                                COALESCE((SELECT default_impact FROM reputation_config
                                           WHERE event_type = 'match_no_show' AND is_active), -50),
                                jsonb_build_object('tournamentId', v_rec.tournament_id,
                                                   'tournamentMatchId', v_rec.id), now());
                    END LOOP;
                ELSIF v_rule IN ('one_sided', 'no_effort') THEN
                    -- Only a side that was aware and did nothing: never a U.
                    IF v_rule = 'one_sided' AND (
                         CASE WHEN v_loser = v_rec.player1_registration_id THEN v_st1 ELSE v_st2 END) = 'P' THEN
                        FOREACH v_uid IN ARRAY public.lt_reputation_targets(v_rec.id, v_loser) LOOP
                            INSERT INTO reputation_event
                                (player_id, event_type, base_impact, metadata, event_occurred_at)
                            VALUES (v_uid, 'tournament_unresponsive', -15,
                                    jsonb_build_object('tournamentId', v_rec.tournament_id,
                                                       'tournamentMatchId', v_rec.id), now());
                        END LOOP;
                    ELSIF v_rule = 'no_effort' THEN
                        IF v_st1 = 'P' THEN
                            FOREACH v_uid IN ARRAY public.lt_reputation_targets(v_rec.id, v_rec.player1_registration_id) LOOP
                                INSERT INTO reputation_event
                                    (player_id, event_type, base_impact, metadata, event_occurred_at)
                                VALUES (v_uid, 'tournament_unresponsive', -15,
                                        jsonb_build_object('tournamentId', v_rec.tournament_id,
                                                           'tournamentMatchId', v_rec.id), now());
                            END LOOP;
                        END IF;
                        IF v_st2 = 'P' THEN
                            FOREACH v_uid IN ARRAY public.lt_reputation_targets(v_rec.id, v_rec.player2_registration_id) LOOP
                                INSERT INTO reputation_event
                                    (player_id, event_type, base_impact, metadata, event_occurred_at)
                                VALUES (v_uid, 'tournament_unresponsive', -15,
                                        jsonb_build_object('tournamentId', v_rec.tournament_id,
                                                           'tournamentMatchId', v_rec.id), now());
                            END LOOP;
                        END IF;
                    END IF;
                END IF;
            END IF;
        END IF;

        v_rule := NULL; v_origin := NULL; v_winner := NULL;
        v_loser := NULL; v_cancel := NULL; v_attempt := NULL;
        v_acted := v_acted + 1;
    END LOOP;

    RETURN v_acted;
END;
$function$

;

REVOKE ALL ON FUNCTION public.lt_resolve_due_tournament_matches(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lt_resolve_due_tournament_matches(boolean) TO service_role;
