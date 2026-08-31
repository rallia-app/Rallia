-- ============================================================================
-- The resolution ladder reads the evidence model, and comes out of dry-run.
-- ============================================================================
-- unplayed-match-resolution.md § 6. The old body split "effort" on chat
-- messages and votes, which is why it was parked in dry-run (20260820120000):
-- the Série 1 census found 40 % of pairings with zero in-app signals, a third
-- of which were really played, and it would have double-walkovered them.
--
-- R0  contested result                     stop, escalate to the organizer
-- R1  a side declared a forfeit            walkover to the other side
-- R3  a linked game with no result         check-in split, else both deemed E
-- R3' the linked game was cancelled        unilateral: walkover; else deemed E
-- R4  both sides E                         gap rule, else cancelled
-- R5  exactly one side E                   walkover to it
-- R6  no side E                            double forfeit
--
-- Δgap is 2 in a pool and 1 in a bracket: a pool can afford to cancel, so it
-- only picks a winner on an unambiguous gap, while in a draw the alternative
-- is eliminating two sides that both tried.
--
-- THE SAFETY PROPERTY, and the reason this can leave dry-run at all: the
-- ladder only ACTS on events running the scheduling funnel. An event without
-- the funnel has no gate answers, so every side would score U and the whole
-- draw would double-forfeit: exactly the disaster the parking prevented. Those
-- events still get their decisions written to the audit with the dryrun_
-- prefix, so the old behaviour is observable without being applied. p_dry_run
-- = true forces audit-only for everything, funnel included.
--
-- Penalties follow § 4.4: a reputation event needs the side to have LOST the
-- decision, to be P (aware and inactive, never U), and the T-48/T-12 prompts
-- to have both been delivered. A pairing whose protocol did not complete still
-- resolves, but into non-penalising outcomes only.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lt_resolve_due_tournament_matches(p_dry_run boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
                v_rule := 'unrecorded';
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
                v_rule := 'mutual_cancel';
            END IF;
        END IF;

        -- R4 / R5 / R6 on the states, when no conclusive event decided it.
        IF v_rule IS NULL OR v_rule IN ('unrecorded', 'mutual_cancel') THEN
            v_gap := CASE WHEN v_rec.bracket_side = 'pool' THEN 2 ELSE 1 END;

            IF v_st1 = 'E' AND v_st2 = 'E' THEN
                IF abs(v_s1 - v_s2) >= v_gap THEN
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
                v_prefix || CASE WHEN v_rule = 'stalemate' THEN 'auto_cancel'
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
            IF v_rule = 'stalemate' THEN
                -- Neither side is at fault: the game leaves the denominator.
                UPDATE tournament_matches
                   SET status = 'cancelled', winner_registration_id = NULL, score = NULL,
                       version = version + 1, updated_at = now()
                 WHERE id = v_rec.id;
            ELSIF v_winner IS NULL THEN
                PERFORM public.lt_advance_double_walkover(v_rec.id);
            ELSE
                UPDATE tournament_matches
                   SET status = 'walkover', winner_registration_id = v_winner,
                       score = public.lt_forfeit_score(
                                   v_rec.t_format, v_rec.t_gps, v_rec.t_ppg,
                                   v_winner = v_rec.player1_registration_id),
                       played_at = now(), version = version + 1, updated_at = now()
                 WHERE id = v_rec.id;
                PERFORM public.lt_advance_tournament_winner(v_rec.id, v_winner);
                PERFORM public.lt_notify_tournament_walkover(v_rec.id, v_winner, false);
            END IF;

            -- Personal consequences need proof they knew, and the prompts.
            IF v_proto THEN
                IF v_rule = 'no_show' AND v_loser IS NOT NULL THEN
                    FOREACH v_uid IN ARRAY public.lt_registration_users(v_loser) LOOP
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
                        FOREACH v_uid IN ARRAY public.lt_registration_users(v_loser) LOOP
                            INSERT INTO reputation_event
                                (player_id, event_type, base_impact, metadata, event_occurred_at)
                            VALUES (v_uid, 'tournament_unresponsive', -15,
                                    jsonb_build_object('tournamentId', v_rec.tournament_id,
                                                       'tournamentMatchId', v_rec.id), now());
                        END LOOP;
                    ELSIF v_rule = 'no_effort' THEN
                        IF v_st1 = 'P' THEN
                            FOREACH v_uid IN ARRAY public.lt_registration_users(v_rec.player1_registration_id) LOOP
                                INSERT INTO reputation_event
                                    (player_id, event_type, base_impact, metadata, event_occurred_at)
                                VALUES (v_uid, 'tournament_unresponsive', -15,
                                        jsonb_build_object('tournamentId', v_rec.tournament_id,
                                                           'tournamentMatchId', v_rec.id), now());
                            END LOOP;
                        END IF;
                        IF v_st2 = 'P' THEN
                            FOREACH v_uid IN ARRAY public.lt_registration_users(v_rec.player2_registration_id) LOOP
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

        v_rule := NULL; v_winner := NULL; v_loser := NULL; v_cancel := NULL;
        v_acted := v_acted + 1;
    END LOOP;

    RETURN v_acted;
END;
$$;

COMMENT ON FUNCTION public.lt_resolve_due_tournament_matches(boolean) IS
'The deadline ladder, R0..R6 of unplayed-match-resolution.md § 6, reading
lt_side_signals rather than chat. ACTS only on scheduling-funnel events, since
an event without gate answers would score every side U and double-forfeit the
draw; every other event is audited with the dryrun_ prefix. Walkovers carry the
format forfeit score; a stalemate between two engaged sides is cancelled;
reputation follows § 4.4 (loser, P not U, both prompts delivered).';

REVOKE ALL ON FUNCTION public.lt_resolve_due_tournament_matches(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lt_resolve_due_tournament_matches(boolean) TO service_role;
