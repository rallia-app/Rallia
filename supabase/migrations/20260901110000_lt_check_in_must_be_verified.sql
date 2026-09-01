-- ============================================================================
-- A self-declared check-in is not evidence of presence.
-- ============================================================================
-- 20260901070000 widened check_in_to_match so a game with no coordinates could
-- be checked into, and recorded the claim as check_in_verified = false.
-- Nothing ever read that column. R3 counted a bare checked_in_at, so a claim
-- made from anywhere carried the same weight as one confirmed against a court:
-- one side present and the other absent awards a walkover and -50 reputation.
--
-- On a game with no coordinates that claim costs nothing to make and cannot be
-- contradicted. create_casual_match never writes custom_latitude, so a game
-- booked at a typed place lands as 'custom' with no point to verify against.
-- That is the funnel's mainstream branch, not an edge case, and on it whoever
-- taps first from their couch takes the win while the opponent takes the hit.
--
-- A missing rung is better than a forgeable one. Missing is symmetric and both
-- sides fall to the gap rule; forgeable is asymmetric and pays whoever acts in
-- bad faith. So R3 counts only a verified check-in. Games agreed without a
-- place go back to the gap rule, which is the degradation 20260901070000 set
-- out to fix and the price of not awarding walkovers on an unfalsifiable
-- claim.
--
-- Check-in itself is untouched. It still records on those games, and streaks,
-- the match-quality funnel and the canonical played-game view still count it.
-- Only the rung that punishes stops trusting it.
--
-- The same claim is not an effort either, so lt_side_signals stops counting an
-- unverified check-in as a scheduling act: it turned a side that had done
-- nothing at all into the top engagement state.
--
-- The gate also needs the column under it to be honest, so the check-in guard
-- now covers check_in_verified as well as checked_in_at: RLS lets a player
-- update their own participation row, and the guard watched only the arrival.
-- ============================================================================

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
            -- Only a check-in verified against coordinates is evidence of presence.
            SELECT count(*) FILTER (WHERE mp.player_id = ANY (public.lt_registration_users(v_rec.player1_registration_id))
                                      AND mp.checked_in_at IS NOT NULL AND mp.check_in_verified),
                   count(*) FILTER (WHERE mp.player_id = ANY (public.lt_registration_users(v_rec.player2_registration_id))
                                      AND mp.checked_in_at IS NOT NULL AND mp.check_in_verified)
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

-- --------------------------------------- and the same claim is not an effort
-- R3 is not the only door. lt_side_signals counts checked_in_at as a
-- scheduling act, and an act is what makes a side aware and scores its
-- reactivity. So a side that answered nothing, voted on nothing and booked
-- nothing went from U/0 to E/2 on one self-declared check-in: the top
-- engagement state, which is exactly what escapes the no-effort double
-- forfeit and wins the gap rule. Gating R3 alone would have moved the
-- forgery one rung down rather than removing it.
--
-- A verified check-in is still an act, because being at the court is real
-- engagement. An unverified one is only a claim, and a claim is not an effort.
CREATE OR REPLACE FUNCTION public.lt_side_signals(
    p_tournament_match_id uuid,
    p_registration_id     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tm          tournament_matches;
    v_t           tournaments;
    v_round       smallint;
    v_phase_start timestamptz;
    v_min_hours   int;
    v_users       uuid[];
    v_opp_users   uuid[];
    v_opp_reg     uuid;
    v_msg         uuid;

    v_answered_at timestamptz;
    v_hours       int;
    v_timeliness  int := 0;
    v_volume      int := 0;
    v_reactivity  int := 0;
    v_s           int;
    v_aware       boolean := false;
    v_capped      boolean := false;

    v_actions     timestamptz[];
    v_pending     timestamptz[];
    v_p           timestamptz;
    v_answered_n  int := 0;
    v_fast_n      int := 0;
BEGIN
    SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tournament_match_id;
    IF v_tm.id IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_t FROM tournaments WHERE id = v_tm.tournament_id;
    v_round := CASE WHEN v_tm.bracket_side = 'pool' THEN 0 ELSE v_tm.round_number END;

    -- The phase opened when its rows were created: publication for a pool,
    -- the round becoming determinate for a bracket round.
    SELECT min(created_at) INTO v_phase_start
      FROM tournament_matches
     WHERE tournament_id = v_tm.tournament_id
       AND bracket_side  = v_tm.bracket_side
       AND CASE WHEN bracket_side = 'pool' THEN 0 ELSE round_number END = v_round;

    v_min_hours := COALESCE(v_t.min_availability_hours, 6);
    v_users     := public.lt_registration_users(p_registration_id);

    v_opp_reg := CASE WHEN p_registration_id = v_tm.player1_registration_id
                      THEN v_tm.player2_registration_id
                      ELSE v_tm.player1_registration_id END;
    v_opp_users := COALESCE(public.lt_registration_users(v_opp_reg), '{}'::uuid[]);

    SELECT m.id INTO v_msg
      FROM message m
     WHERE m.message_type = 'match_organizer'
       AND (m.metadata ->> 'tournament_match_id')::uuid = p_tournament_match_id
       AND m.deleted_at IS NULL
     ORDER BY m.created_at DESC LIMIT 1;

    -- ---------------------------------------------------------- timeliness
    -- The side answers when its slowest member has answered: a doubles pair
    -- that is half-declared has not told the machine when it can play.
    SELECT max(a.responded_at) INTO v_answered_at
      FROM tournament_phase_availability a
     WHERE a.tournament_id = v_tm.tournament_id
       AND a.bracket_side  = v_tm.bracket_side
       AND a.round_number  = v_round
       AND a.player_id     = ANY (v_users)
    HAVING count(*) = COALESCE(array_length(v_users, 1), 0);

    IF v_answered_at IS NOT NULL THEN
        v_aware := true;
        v_timeliness := CASE
            WHEN v_phase_start IS NOT NULL
             AND v_answered_at <= v_phase_start + interval '48 hours' THEN 2
            ELSE 1 END;

        SELECT min(a.hours_in_window) INTO v_hours
          FROM tournament_phase_availability a
         WHERE a.tournament_id = v_tm.tournament_id
           AND a.bracket_side  = v_tm.bracket_side
           AND a.round_number  = v_round
           AND a.player_id     = ANY (v_users);
        v_volume := CASE WHEN COALESCE(v_hours, 0) >= v_min_hours THEN 2
                         WHEN COALESCE(v_hours, 0) > 0 THEN 1
                         ELSE 0 END;
    END IF;

    -- ----------------------------------------------------------- reactivity
    -- Every scheduling act this side took on this pairing.
    SELECT array_agg(ts ORDER BY ts) INTO v_actions FROM (
        SELECT v.created_at AS ts
          FROM match_time_vote v
         WHERE v.message_id = v_msg AND v.player_id = ANY (v_users)
        UNION ALL
        SELECT a.occurred_at
          FROM leagues_tournaments_audit a
         WHERE a.scope = 'tournament_match' AND a.entity_id = p_tournament_match_id
           AND a.action IN ('funnel_booked', 'funnel_booking_accepted',
                            'funnel_reproposed', 'funnel_pinged', 'declared_forfeit')
           AND a.actor_id = ANY (v_users)
        UNION ALL
        SELECT mp.checked_in_at
          FROM match_participant mp
         WHERE mp.match_id = v_tm.match_id AND mp.player_id = ANY (v_users)
           AND mp.checked_in_at IS NOT NULL AND mp.check_in_verified
    ) acts;

    -- Every opponent act that was waiting on an answer from this side.
    SELECT array_agg(ts ORDER BY ts) INTO v_pending FROM (
        SELECT v.created_at AS ts
          FROM match_time_vote v
         WHERE v.message_id = v_msg AND v.player_id = ANY (v_opp_users)
        UNION ALL
        SELECT a.occurred_at
          FROM leagues_tournaments_audit a
         WHERE a.scope = 'tournament_match' AND a.entity_id = p_tournament_match_id
           AND a.action IN ('funnel_booked', 'funnel_reproposed')
           AND a.actor_id = ANY (v_opp_users)
    ) pend;

    IF v_actions IS NOT NULL AND array_length(v_actions, 1) > 0 THEN
        v_aware := true;
    END IF;

    IF v_pending IS NULL OR array_length(v_pending, 1) IS NULL THEN
        -- Nothing was ever waiting on this side; acting at all is full marks,
        -- and there is nothing to be unresponsive to.
        v_reactivity := CASE WHEN v_actions IS NOT NULL THEN 2 ELSE 0 END;
    ELSE
        FOREACH v_p IN ARRAY v_pending LOOP
            IF EXISTS (SELECT 1 FROM unnest(COALESCE(v_actions, '{}'::timestamptz[])) x
                        WHERE x > v_p) THEN
                v_answered_n := v_answered_n + 1;
                IF EXISTS (SELECT 1 FROM unnest(v_actions) x
                            WHERE x > v_p AND x <= v_p + interval '24 hours') THEN
                    v_fast_n := v_fast_n + 1;
                END IF;
            END IF;
        END LOOP;

        IF v_answered_n = 0 THEN
            v_reactivity := 0;
            v_capped := true;   -- § 4.3: a grid plus silence is not engagement
        ELSIF v_fast_n = array_length(v_pending, 1) THEN
            v_reactivity := 2;
        ELSE
            v_reactivity := 1;
        END IF;
    END IF;

    v_s := v_timeliness + v_volume + v_reactivity;
    IF v_capped THEN
        v_s := LEAST(v_s, 1);
    END IF;

    RETURN jsonb_build_object(
        'timeliness', v_timeliness,
        'volume',     v_volume,
        'reactivity', v_reactivity,
        'capped',     v_capped,
        's',          v_s,
        'aware',      v_aware,
        'state',      CASE WHEN v_s >= 2 THEN 'E'
                           WHEN v_aware  THEN 'P'
                           ELSE 'U' END
    );
END;
$$;

COMMENT ON FUNCTION public.lt_side_signals(uuid, uuid) IS
'The engagement score S (0..6) and side state (E/P/U) for one side of a pairing,
from in-phase scheduling records only: the gate answer, its hours, and the
booking/vote/check-in trail, where only a verified check-in counts as an act.
Chat is never read (unplayed-match-resolution.md § 4.5). Applies the reactivity
cap: pending proposals with no answer caps S at 1. Spec: § 4.3.';

REVOKE ALL ON FUNCTION public.lt_side_signals(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lt_side_signals(uuid, uuid) TO authenticated;

-- ------------------------------------ the verdict is guarded like the arrival
-- A gate is only worth as much as the column it reads. The check-in guard
-- fired on checked_in_at alone, and match_participant_update_self lets a
-- player update their own participation row with no column restriction, so
-- check_in_verified could simply be flipped to true after a self-declared
-- check-in and the rung above would trust it again. Guard both.
CREATE OR REPLACE FUNCTION public.match_participant_check_in_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF (NEW.checked_in_at IS DISTINCT FROM OLD.checked_in_at
        OR NEW.check_in_verified IS DISTINCT FROM OLD.check_in_verified)
       AND COALESCE(current_setting('rallia.check_in', true), '') <> 'on' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CHECK_IN_VIA_RPC_ONLY';
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.match_participant_check_in_guard() IS
'Presence, and whether it was verified, are what the ladder trusts for a
walkover and a -50, so both may only be written by check_in_to_match. RLS lets
a player update their own participation row, which would otherwise include
both stamping their own arrival and declaring it confirmed.';

DROP TRIGGER IF EXISTS match_participant_check_in_guard ON match_participant;
CREATE TRIGGER match_participant_check_in_guard
    BEFORE UPDATE OF checked_in_at, check_in_verified ON match_participant
    FOR EACH ROW EXECUTE FUNCTION public.match_participant_check_in_guard();

COMMENT ON FUNCTION public.check_in_to_match(uuid, double precision, double precision) IS
'Records presence at a game. Enforces the 500 m radius when the game has
coordinates, and accepts a self-declared check-in when it has none. Only a
verified check-in is evidence for the no-show rung; an unverified one still
counts for streaks, the match-quality funnel and the played-game view. Spec:
unplayed-match-resolution.md § 6, R3.';

-- ------------------------------------------- the reminder matches the button
-- The check-in reminder never filtered on location_type, so a player could be
-- pushed to check into a 'tbd' game and find no button waiting: the client
-- offers check-in for 'facility' and 'custom' only. Mirror it.
CREATE OR REPLACE FUNCTION get_participants_for_check_in_reminder(
  p_window_start TIMESTAMPTZ,
  p_window_end TIMESTAMPTZ
)
RETURNS TABLE (
  participant_id UUID,
  player_id UUID,
  match_id UUID,
  match_date DATE,
  start_time TIME,
  sport_name TEXT,
  format TEXT,
  timezone TEXT,
  location_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    mp.id AS participant_id,
    mp.player_id,
    m.id AS match_id,
    m.match_date,
    m.start_time,
    s.name::TEXT AS sport_name,
    m.format::TEXT,
    m.timezone::TEXT,
    COALESCE(f.name, m.location_name)::TEXT AS location_name
  FROM match_participant mp
  INNER JOIN match m ON m.id = mp.match_id
  INNER JOIN sport s ON s.id = m.sport_id
  LEFT JOIN facility f ON f.id = m.facility_id
  WHERE mp.status = 'joined'
    AND mp.match_check_in_reminder_sent_at IS NULL
    AND m.cancelled_at IS NULL
    AND m.location_type IN ('facility', 'custom')
    AND (SELECT COUNT(*) FROM match_participant mp2
         WHERE mp2.match_id = m.id AND mp2.status = 'joined')
        >= CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
    AND (m.match_date + m.start_time) AT TIME ZONE m.timezone
      BETWEEN p_window_start AND p_window_end;
END;
$$;
