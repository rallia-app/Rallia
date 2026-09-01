-- ============================================================================
-- Two gestures the funnel promised: declaring a forfeit, and nudging a silent
-- opponent.
-- ============================================================================
-- scheduling-funnel.md § 3 ("je declare forfait", "un rappel a envoyer a un
-- adversaire qui n'a pas encore donne ses dispos") and § 11 decision 5.
--
-- FORFEIT is R1 of the ladder, run on demand instead of at the deadline: one
-- side declares, the other takes the walkover immediately. Two things separate
-- it from the resolver's walkover, and both are the point:
--
--   * The declaring side takes the FORFEIT event, not the unresponsive one.
--     Saying "I cannot make it" is the honest act the funnel wants to be easy;
--     it must never cost what silence costs. The weight is read from
--     reputation_config rather than hardcoded, so it tracks the product's own
--     scale (match_cancelled_late, the withdrew weight: you had a commitment
--     and pulled out of it).
--   * It carries the format's forfeit score like any other walkover
--     (20260829160000), so the loser's ratios move exactly as a defeat.
--
-- A linked game is cancelled first, which releases the pairing through the
-- detach trigger, so the walkover is never written over a stale link.
--
-- PING is deliberately thin: it tells one opponent who has not answered the
-- gate that their pairing is waiting. One per opponent per 48 h, counted from
-- the audit, because the whole value of a nudge is that it is rare. The audit
-- row is also what a later evidence model reads as initiative for the sender
-- (§ 11 decision 5: it counts for the sender, nothing for the receiver).
-- ============================================================================

-- ------------------------------------------------------------- the forfeit
CREATE OR REPLACE FUNCTION public.lt_funnel_declare_forfeit(p_tournament_match_id uuid)
RETURNS tournament_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller   uuid := auth.uid();
    v_tm       tournament_matches;
    v_t        tournaments;
    v_players  uuid[];
    v_mine     uuid;
    v_winner   uuid;
    v_impact   numeric;
    v_uid      uuid;
    v_row      tournament_matches;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tournament_match_id FOR UPDATE;
    IF v_tm.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_MATCH_NOT_FOUND';
    END IF;

    IF v_tm.status NOT IN ('pending', 'in_progress') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_ALREADY_SETTLED';
    END IF;

    IF v_tm.player1_registration_id IS NULL OR v_tm.player2_registration_id IS NULL
       OR v_tm.player1_is_bye OR v_tm.player2_is_bye THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_SLOTS_INCOMPLETE';
    END IF;

    SELECT * INTO v_t FROM tournaments WHERE id = v_tm.tournament_id;
    IF v_t.status <> 'in_progress' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_IN_PROGRESS';
    END IF;

    -- Which side is the caller on? That side concedes; the other one wins.
    SELECT r.id INTO v_mine
      FROM tournament_registrations r
     WHERE r.id IN (v_tm.player1_registration_id, v_tm.player2_registration_id)
       AND (r.user_id = v_caller OR r.partner_user_id = v_caller)
     LIMIT 1;
    IF v_mine IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_A_PARTICIPANT';
    END IF;

    v_winner := CASE WHEN v_mine = v_tm.player1_registration_id
                     THEN v_tm.player2_registration_id
                     ELSE v_tm.player1_registration_id END;

    -- A game that was agreed is cancelled first: the detach trigger clears the
    -- pairing's match_id, so the walkover is not written over a stale link.
    IF v_tm.match_id IS NOT NULL THEN
        UPDATE match SET cancelled_at = now(), updated_at = now()
         WHERE id = v_tm.match_id AND cancelled_at IS NULL;
    END IF;
    DELETE FROM lt_pairing_booking WHERE tournament_match_id = p_tournament_match_id;

    UPDATE tournament_matches
       SET status                 = 'walkover',
           winner_registration_id = v_winner,
           score                  = public.lt_forfeit_score(
                                        v_t.match_format, v_t.games_per_set, v_t.points_per_game,
                                        v_winner = player1_registration_id),
           match_id               = NULL,
           played_at              = now(),
           version                = version + 1,
           updated_at             = now()
     WHERE id = p_tournament_match_id
    RETURNING * INTO v_row;

    PERFORM public.lt_advance_tournament_winner(v_row.id, v_winner);

    -- The forfeit event, never the unresponsive one: declaring is the honest
    -- act, and it must not cost what silence costs.
    SELECT default_impact INTO v_impact
      FROM reputation_config
     WHERE event_type = 'match_cancelled_late' AND is_active;

    FOREACH v_uid IN ARRAY public.lt_registration_users(v_mine) LOOP
        INSERT INTO reputation_event
            (player_id, event_type, base_impact, metadata, event_occurred_at)
        VALUES (v_uid, 'match_cancelled_late', COALESCE(v_impact, -35),
                jsonb_build_object('tournamentId', v_tm.tournament_id,
                                   'tournamentMatchId', v_tm.id,
                                   'reason', 'declared_forfeit'), now());
    END LOOP;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('tournament_match', v_row.id, 'declared_forfeit', v_caller,
            jsonb_build_object('tournament_id', v_tm.tournament_id,
                               'conceded_by_registration_id', v_mine,
                               'winner_registration_id', v_winner,
                               'score', v_row.score));

    PERFORM public.lt_notify_tournament_walkover(v_row.id, v_winner, false);

    RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.lt_funnel_declare_forfeit(uuid) IS
'A player concedes one pairing: R1 of the ladder run on demand. The opponent
takes the walkover at once with the format''s forfeit score, any agreed game is
cancelled first, and the declaring side takes the FORFEIT reputation event
(match_cancelled_late, the withdrew weight) rather than the unresponsive one,
because saying so is the honest act. Spec: scheduling-funnel.md § 3,
unplayed-match-resolution.md R1.';

REVOKE ALL ON FUNCTION public.lt_funnel_declare_forfeit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lt_funnel_declare_forfeit(uuid) TO authenticated;

-- ---------------------------------------------------------------- the ping
CREATE OR REPLACE FUNCTION public.lt_funnel_ping_opponent(p_tournament_match_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    c_cooldown constant interval := interval '48 hours';

    v_caller  uuid := auth.uid();
    v_tm      tournament_matches;
    v_t       tournaments;
    v_round   smallint;
    v_players uuid[];
    v_targets uuid[];
    v_reg     uuid;
    v_rows    jsonb;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tournament_match_id;
    IF v_tm.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_MATCH_NOT_FOUND';
    END IF;

    SELECT * INTO v_t FROM tournaments WHERE id = v_tm.tournament_id;
    IF NOT COALESCE(v_t.scheduling_funnel_enabled, false) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'FUNNEL_NOT_ENABLED';
    END IF;

    v_round := CASE WHEN v_tm.bracket_side = 'pool' THEN 0 ELSE v_tm.round_number END;

    SELECT array_agg(DISTINCT u.uid) INTO v_players
      FROM tournament_registrations r
      CROSS JOIN LATERAL unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) AS u(uid)
     WHERE r.id IN (v_tm.player1_registration_id, v_tm.player2_registration_id);

    IF NOT (v_caller = ANY (v_players)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_A_PARTICIPANT';
    END IF;

    -- Only somebody who has not answered the gate is worth nudging; anyone who
    -- has is already reachable in the pairing room.
    SELECT array_agg(u) INTO v_targets
      FROM unnest(v_players) u
     WHERE u <> v_caller
       AND NOT EXISTS (
           SELECT 1 FROM tournament_phase_availability a
            WHERE a.tournament_id = v_tm.tournament_id
              AND a.bracket_side  = v_tm.bracket_side
              AND a.round_number  = v_round
              AND a.player_id     = u
       );

    IF v_targets IS NULL OR array_length(v_targets, 1) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOBODY_TO_PING';
    END IF;

    -- A nudge is only worth anything while it is rare.
    IF EXISTS (
        SELECT 1 FROM leagues_tournaments_audit a
         WHERE a.scope = 'tournament_match'
           AND a.entity_id = p_tournament_match_id
           AND a.action = 'funnel_pinged'
           AND a.actor_id = v_caller
           AND a.occurred_at > now() - c_cooldown
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PING_TOO_SOON';
    END IF;

    SELECT r.id INTO v_reg
      FROM tournament_registrations r
     WHERE r.id IN (v_tm.player1_registration_id, v_tm.player2_registration_id)
       AND (r.user_id = v_caller OR r.partner_user_id = v_caller)
     LIMIT 1;

    SELECT jsonb_agg(jsonb_build_object(
        'user_id',   u,
        'type',      'tournament_action_required',
        'target_id', v_tm.tournament_id,
        'title',     CASE WHEN public.lt_user_is_fr(u)
                       THEN 'Ton adversaire t''attend' ELSE 'Your opponent is waiting' END,
        'body',      CASE WHEN public.lt_user_is_fr(u)
                       THEN v_t.name || ' : ' || COALESCE(public.lt_registration_display_name(v_reg), 'Ton adversaire')
                            || ' attend tes dispos pour planifier votre partie.'
                       ELSE v_t.name || ': ' || COALESCE(public.lt_registration_display_name(v_reg), 'Your opponent')
                            || ' is waiting on your availability to plan your game.'
                     END,
        'payload',   jsonb_build_object('tournamentId', v_tm.tournament_id,
                                        'tournamentMatchId', v_tm.id),
        'priority',  'high'
    )) INTO v_rows
    FROM unnest(v_targets) u;

    PERFORM insert_notifications(v_rows);

    -- Initiative for the sender, nothing for the receiver (§ 11 decision 5).
    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('tournament_match', p_tournament_match_id, 'funnel_pinged', v_caller,
            jsonb_build_object('tournament_id', v_tm.tournament_id,
                               'pinged', to_jsonb(v_targets)));

    RETURN array_length(v_targets, 1);
END;
$$;

COMMENT ON FUNCTION public.lt_funnel_ping_opponent(uuid) IS
'Nudge the side of a pairing that has not answered the phase gate. One per
opponent per 48 h (PING_TOO_SOON), refused when everyone has answered
(NOBODY_TO_PING). The audit row doubles as the sender''s initiative signal.
Spec: scheduling-funnel.md § 3 and § 11 decision 5.';

REVOKE ALL ON FUNCTION public.lt_funnel_ping_opponent(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lt_funnel_ping_opponent(uuid) TO authenticated;
