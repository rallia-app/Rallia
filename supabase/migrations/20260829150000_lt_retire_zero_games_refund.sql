-- ============================================================================
-- Retire the zero-games automatic refund.
-- ============================================================================
-- Jean's rule, 2026-08-23 (unplayed-match-resolution.md § 10): no automatic
-- refund once the pools or the draw have opened. The seat was sold and the
-- event started; an exceptional case is settled by hand, outside the machine.
-- Refunds stay automatic only on the paths that run before that moment:
-- pre-draw removal, cancelled event, eviction. All three are untouched here.
--
-- The one post-open automatic refund lived in lt_resolve_due_tournament_matches
-- (20260811100000): a paid double-walkover side that never completed a single
-- game was disqualified on purpose to BUY the entry refund through the
-- removed-player settle leg. Under the § 5 forfeit scores that side now
-- collects defeats, not cancellations, and 20260811200000 already had to
-- invent forfeited_at to keep this path from colliding with the mid-pool
-- forfeit. Removing the branch is the whole change:
--
--   * The registration stays 'registered', keeps its double-forfeit defeat,
--     and its entry settles to the organizer at completion through
--     lt_release_candidates like any played entry (r.status <> 'disqualified').
--     Nothing sits 'succeeded' forever.
--   * lt_cancel_refund_candidates' removed-player leg is UNCHANGED: with this
--     branch gone, every writer of 'disqualified' without forfeited_at is
--     pre-draw (tournament_remove_registration and the eviction paths are
--     guarded to registration_open / registration_closed), so the leg now
--     means exactly "pre-draw removal". tournament_request_refund and
--     tournament_withdraw are registration_open only.
--
-- The resolver is parked in dry-run (20260820120000), so no live behaviour
-- changes today; this keeps the branch from firing when resolution v2 goes
-- live. Body re-issued from 20260811100000, verified byte-identical before
-- editing; the only edits are the removed branch and its two now-dead
-- references (v_reg, t_fee).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lt_resolve_due_tournament_matches(p_dry_run boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rec       record;
    v_eff       timestamptz;
    v_grace     timestamptz;
    v_e1        jsonb;
    v_e2        jsonb;
    v_has1      boolean;
    v_has2      boolean;
    v_winner    uuid;
    v_loser     uuid;
    v_acted     integer := 0;
    v_prefix    text := CASE WHEN p_dry_run THEN 'dryrun_' ELSE '' END;
    v_rows      jsonb;
    v_uid       uuid;
BEGIN
    FOR v_rec IN
        SELECT tm.*, t.name AS t_name, t.end_date AS t_end, t.organizer_id AS t_org
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

        -- Disputes are never auto-resolved: escalate once, wait.
        IF v_rec.status = 'disputed' THEN
            IF NOT EXISTS (
                SELECT 1 FROM leagues_tournaments_audit a
                 WHERE a.scope = 'tournament_match' AND a.entity_id = v_rec.id
                   AND a.action IN ('dispute_escalated', 'dryrun_dispute_escalated')
            ) THEN
                INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
                VALUES ('tournament_match', v_rec.id, v_prefix || 'dispute_escalated', v_rec.t_org,
                        jsonb_build_object('tournament_id', v_rec.tournament_id, 'deadline_at', v_eff));
                IF NOT p_dry_run THEN
                    SELECT jsonb_agg(jsonb_build_object(
                        'user_id', o.organizer_id,
                        'type', 'tournament_dispute_escalated',
                        'target_id', v_rec.tournament_id,
                        'title', CASE WHEN public.lt_user_is_fr(o.organizer_id)
                                   THEN 'Litige à trancher' ELSE 'Dispute needs a ruling' END,
                        'body', CASE WHEN public.lt_user_is_fr(o.organizer_id)
                                  THEN v_rec.t_name || ' : une partie contestée a dépassé son échéance et attend ta décision.'
                                  ELSE v_rec.t_name || ': a disputed game passed its deadline and awaits your ruling.'
                                END,
                        'payload', jsonb_build_object(
                            'tournamentId', v_rec.tournament_id,
                            'tournamentMatchId', v_rec.id),
                        'priority', 'high'
                    )) INTO v_rows
                    FROM (SELECT t.organizer_id FROM tournaments t WHERE t.id = v_rec.tournament_id) o;
                    IF v_rows IS NOT NULL THEN
                        PERFORM insert_notifications(v_rows);
                    END IF;
                END IF;
                v_acted := v_acted + 1;
            END IF;
            CONTINUE;
        END IF;

        -- Step 0: an attached game is mutual agreement → one automatic grace.
        IF v_rec.match_id IS NOT NULL THEN
            IF NOT EXISTS (
                SELECT 1 FROM leagues_tournaments_audit a
                 WHERE a.scope = 'tournament_match' AND a.entity_id = v_rec.id
                   AND a.action IN ('auto_grace', 'dryrun_auto_grace')
            ) THEN
                SELECT GREATEST(
                           (m.match_date + COALESCE(m.start_time, time '20:00'))::timestamptz
                               + interval '72 hours',
                           now() + interval '24 hours')
                  INTO v_grace
                  FROM match m WHERE m.id = v_rec.match_id;
                IF v_grace IS NOT NULL THEN
                    IF NOT p_dry_run THEN
                        UPDATE tournament_matches
                           SET deadline_override_at = v_grace,
                               version = version + 1, updated_at = now()
                         WHERE id = v_rec.id;
                    END IF;
                    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
                    VALUES ('tournament_match', v_rec.id, v_prefix || 'auto_grace', v_rec.t_org,
                            jsonb_build_object('tournament_id', v_rec.tournament_id,
                                               'grace_until', v_grace));
                    v_acted := v_acted + 1;
                END IF;
            END IF;
            -- Grace already granted and expired with a game still attached:
            -- leave it to the score/auto-confirm path and the organizer.
            CONTINUE;
        END IF;

        -- Step 1: effort split.
        v_e1 := public.lt_side_effort(v_rec.id, public.lt_registration_users(v_rec.player1_registration_id));
        v_e2 := public.lt_side_effort(v_rec.id, public.lt_registration_users(v_rec.player2_registration_id));
        v_has1 := (v_e1->>'voted')::boolean OR (v_e1->>'posted_card')::boolean OR (v_e1->>'messaged')::boolean;
        v_has2 := (v_e2->>'voted')::boolean OR (v_e2->>'posted_card')::boolean OR (v_e2->>'messaged')::boolean;

        IF v_has1 AND v_has2 THEN
            IF EXISTS (
                SELECT 1 FROM leagues_tournaments_audit a
                 WHERE a.scope = 'tournament_match' AND a.entity_id = v_rec.id
                   AND a.action IN ('auto_extension', 'dryrun_auto_extension')
            ) THEN
                v_winner := NULL;  -- extension spent → double walkover below
            ELSE
                IF NOT p_dry_run THEN
                    UPDATE tournament_matches
                       SET deadline_override_at = LEAST(now() + interval '72 hours',
                                                        GREATEST(v_rec.t_end, now() + interval '48 hours')),
                           version = version + 1, updated_at = now()
                     WHERE id = v_rec.id;
                    SELECT jsonb_agg(jsonb_build_object(
                        'user_id', u.uid,
                        'type', 'tournament_deadline_extended',
                        'target_id', v_rec.tournament_id,
                        'title', CASE WHEN public.lt_user_is_fr(u.uid)
                                   THEN 'Prolongation automatique' ELSE 'Automatic extension' END,
                        'body', CASE WHEN public.lt_user_is_fr(u.uid)
                                  THEN v_rec.t_name || ' : vous cherchez tous les deux un moment. Dernière prolongation, ensuite la partie est annulée pour les deux.'
                                  ELSE v_rec.t_name || ': you are both trying to find a time. One last extension, then the game is voided for both.'
                                END,
                        'payload', jsonb_build_object(
                            'tournamentId', v_rec.tournament_id,
                            'tournamentMatchId', v_rec.id),
                        'priority', 'high'
                    )) INTO v_rows
                    FROM (SELECT unnest(public.lt_registration_users(v_rec.player1_registration_id)
                                     || public.lt_registration_users(v_rec.player2_registration_id)) AS uid) u;
                    IF v_rows IS NOT NULL THEN
                        PERFORM insert_notifications(v_rows);
                    END IF;
                END IF;
                INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
                VALUES ('tournament_match', v_rec.id, v_prefix || 'auto_extension', v_rec.t_org,
                        jsonb_build_object('tournament_id', v_rec.tournament_id,
                                           'effort_p1', v_e1, 'effort_p2', v_e2));
                v_acted := v_acted + 1;
                CONTINUE;
            END IF;
        END IF;

        IF v_has1 <> v_has2 THEN
            -- One-sided effort → walkover for the effortful side.
            IF v_has1 THEN
                v_winner := v_rec.player1_registration_id;
                v_loser  := v_rec.player2_registration_id;
            ELSE
                v_winner := v_rec.player2_registration_id;
                v_loser  := v_rec.player1_registration_id;
            END IF;

            INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
            VALUES ('tournament_match', v_rec.id, v_prefix || 'auto_walkover', v_rec.t_org,
                    jsonb_build_object('tournament_id', v_rec.tournament_id,
                                       'winner_registration_id', v_winner,
                                       'effort_p1', v_e1, 'effort_p2', v_e2));
            IF NOT p_dry_run THEN
                UPDATE tournament_matches
                   SET status = 'walkover', winner_registration_id = v_winner,
                       score = 'W/O', played_at = now(),
                       version = version + 1, updated_at = now()
                 WHERE id = v_rec.id;
                PERFORM public.lt_advance_tournament_winner(v_rec.id, v_winner);
                FOREACH v_uid IN ARRAY public.lt_registration_users(v_loser) LOOP
                    INSERT INTO reputation_event
                        (player_id, event_type, base_impact, metadata, event_occurred_at)
                    VALUES (v_uid, 'tournament_unresponsive', -15,
                            jsonb_build_object('tournamentId', v_rec.tournament_id,
                                               'tournamentMatchId', v_rec.id), now());
                END LOOP;
                PERFORM public.lt_notify_tournament_walkover(v_rec.id, v_winner, false);
            END IF;
            v_acted := v_acted + 1;
        ELSE
            -- Neither side (or extension spent) → double walkover.
            INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
            VALUES ('tournament_match', v_rec.id, v_prefix || 'auto_double_walkover', v_rec.t_org,
                    jsonb_build_object('tournament_id', v_rec.tournament_id,
                                       'effort_p1', v_e1, 'effort_p2', v_e2));
            IF NOT p_dry_run THEN
                PERFORM public.lt_advance_double_walkover(v_rec.id);
                FOREACH v_uid IN ARRAY (public.lt_registration_users(v_rec.player1_registration_id)
                                     || public.lt_registration_users(v_rec.player2_registration_id)) LOOP
                    INSERT INTO reputation_event
                        (player_id, event_type, base_impact, metadata, event_occurred_at)
                    VALUES (v_uid, 'tournament_unresponsive', -15,
                            jsonb_build_object('tournamentId', v_rec.tournament_id,
                                               'tournamentMatchId', v_rec.id), now());
                END LOOP;
                PERFORM public.lt_notify_tournament_walkover(v_rec.id, NULL, true);
            END IF;
            v_acted := v_acted + 1;
        END IF;
    END LOOP;

    RETURN v_acted;
END;
$$;
