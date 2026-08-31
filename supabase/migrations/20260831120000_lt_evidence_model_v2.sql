-- ============================================================================
-- The evidence model the funnel was built to feed.
-- ============================================================================
-- unplayed-match-resolution.md § 4. Until now lt_side_effort decided who tried
-- by reading chat messages and votes, which is the one thing the spec forbids:
-- "chat text and message counts ... none of it is read by the machine" (§ 4.5).
-- Every screen shipped since the gate exists to produce admissible evidence,
-- and nothing was reading it.
--
-- lt_side_signals scores a side 0..6 from three in-phase signals, each 0/1/2,
-- exactly as § 4.3 defines them:
--
--   timeliness  the gate answered within 48 h of the phase opening
--   volume      admissible hours against the organizer's minimum
--   reactivity  every pending opponent action answered, and at least one act
--
-- and applies the reactivity cap: a side that had proposals waiting and
-- answered none of them is capped at S = 1 whatever its grid looks like.
-- Filing a rich availability and then ignoring every concrete proposal is
-- precisely the unresponsiveness the system exists to sanction.
--
-- The three states follow: E (S >= 2), P (aware but S < 2), U (not aware).
-- Awareness is the bar for personal consequences, never for standings ones:
-- a side the machine cannot prove knew is never penalised (principle 4).
--
-- A doubles side is the union of its members' actions, except volume, which
-- takes the LOWER of the two: a pair is only free when both of them are, which
-- is also how the options engine computes overlap.
-- ============================================================================

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
           AND mp.checked_in_at IS NOT NULL
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
booking/vote/check-in trail. Chat is never read (unplayed-match-resolution.md
§ 4.5). Applies the reactivity cap: pending proposals with no answer caps S at
1. Spec: § 4.3.';

REVOKE ALL ON FUNCTION public.lt_side_signals(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lt_side_signals(uuid, uuid) TO authenticated;
