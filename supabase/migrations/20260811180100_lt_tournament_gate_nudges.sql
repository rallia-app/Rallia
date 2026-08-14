-- ============================================================================
-- Organizer gate nudges.
--
-- The tournament lifecycle has five transitions and only two of them run
-- themselves: registration closes on a cron, and the tournament completes when
-- the final is played. The two in the middle wait on one person:
--
--   registration_closed  -> the draw (tournament_generate_pools / _bracket)
--   pools all settled    -> the knockout (tournament_generate_knockout)
--
-- Nothing prompts them. The existing deadline nudges fire on unplayed games
-- approaching a deadline, so the moment a pool phase is complete they go quiet
-- precisely when the organizer needs poking, and a tournament can sit at either
-- gate indefinitely with players waiting and no signal to anyone.
--
-- This is the reminder half only, deliberately. Auto-acting on these gates
-- means tournament_generate_* firing unattended on a path that has not been
-- run end to end by a human yet, and it would quietly expire the organizer's
-- corrective powers: tournament_set_seeds requires registration_closed with no
-- matches, and tournament_forfeit_registration requires no knockout rows. A
-- nudge solves forgetting, which is the common case, while leaving both
-- windows open. The auto-act belongs after the format has run for real, with
-- grace periods picked from how long organizers actually take.
--
-- Gate 1 covers single elimination too, not just pools: it stalls the same way,
-- and single elimination is the format actually in production.
--
-- Re-nudges every 48 h while a gate stays open, and gives up 14 days past the
-- event's end date so an abandoned tournament stops nagging. Silent when the
-- draw would fail anyway for want of entrants (under 6 for pools, under 2 for a
-- bracket): telling someone to press a button that raises
-- INSUFFICIENT_PARTICIPANTS is worse than saying nothing.
-- ============================================================================

ALTER TABLE tournaments
    ADD COLUMN IF NOT EXISTS draw_nudged_at     timestamptz,
    ADD COLUMN IF NOT EXISTS knockout_nudged_at timestamptz;

COMMENT ON COLUMN tournaments.draw_nudged_at IS
    'Last time the organizer was nudged that registration is closed and nothing is drawn yet.';
COMMENT ON COLUMN tournaments.knockout_nudged_at IS
    'Last time the organizer was nudged that the pool phase is complete and the knockout is not launched.';

-- ============================================
-- lt_nudge_tournament_gates
-- ============================================

CREATE OR REPLACE FUNCTION public.lt_nudge_tournament_gates()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rec   record;
    v_rows  jsonb;
    v_sent  integer := 0;
    v_pool  boolean;
BEGIN
    -- ---------------------------------------------------------------
    -- Gate 1: registration is closed and nothing has been drawn.
    -- ---------------------------------------------------------------
    FOR v_rec IN
        SELECT t.id, t.name, t.organizer_id,
               (t.bracket_type = 'pool_knockout') AS is_pool,
               (SELECT count(*) FROM tournament_registrations r
                 WHERE r.tournament_id = t.id AND r.status = 'registered') AS entered
          FROM tournaments t
         WHERE t.status = 'registration_closed'
           AND now() < t.end_date + interval '14 days'
           AND (t.draw_nudged_at IS NULL
                OR t.draw_nudged_at < now() - interval '48 hours')
           AND NOT EXISTS (
                 SELECT 1 FROM tournament_matches m WHERE m.tournament_id = t.id)
    LOOP
        v_pool := v_rec.is_pool;
        CONTINUE WHEN v_rec.entered < CASE WHEN v_pool THEN 6 ELSE 2 END;

        SELECT jsonb_agg(jsonb_build_object(
            'user_id', u.uid,
            'type', 'tournament_action_required',
            'target_id', v_rec.id,
            'title', CASE WHEN public.lt_user_is_fr(u.uid)
                       THEN CASE WHEN v_pool THEN 'Poules à lancer' ELSE 'Tableau à tirer' END
                       ELSE CASE WHEN v_pool THEN 'Pools ready to start' ELSE 'Bracket ready to draw' END
                     END,
            'body', CASE WHEN public.lt_user_is_fr(u.uid)
                      THEN v_rec.name || ' : inscriptions fermées (' || v_rec.entered || ').'
                           || CASE WHEN v_pool
                                THEN ' Ajuste les têtes de série si tu veux, puis lance les poules.'
                                ELSE ' Tu peux tirer le tableau.' END
                      ELSE v_rec.name || ': registration closed (' || v_rec.entered || ' in).'
                           || CASE WHEN v_pool
                                THEN ' Adjust the seeds if you want, then start the pools.'
                                ELSE ' You can draw the bracket now.' END
                    END,
            'payload', jsonb_build_object(
                'tournamentId', v_rec.id,
                'tournamentName', v_rec.name,
                'gate', CASE WHEN v_pool THEN 'pools' ELSE 'bracket' END,
                'entered', v_rec.entered
            ),
            'priority', 'high'
        ))
          INTO v_rows
          FROM (
            SELECT v_rec.organizer_id AS uid
            UNION
            SELECT c.user_id FROM tournament_co_organizers c WHERE c.tournament_id = v_rec.id
          ) u
         WHERE u.uid IS NOT NULL;

        IF v_rows IS NOT NULL THEN
            PERFORM insert_notifications(v_rows);
            -- Deliberately not touching version: the organizer may have this
            -- tournament open, and bumping it would hand them an
            -- OPTIMISTIC_LOCK_CONFLICT the moment they act on the nudge.
            UPDATE tournaments SET draw_nudged_at = now() WHERE id = v_rec.id;
            v_sent := v_sent + 1;
        END IF;
    END LOOP;

    -- ---------------------------------------------------------------
    -- Gate 2: every pool game settled, knockout not launched.
    -- ---------------------------------------------------------------
    FOR v_rec IN
        SELECT t.id, t.name, t.organizer_id
          FROM tournaments t
         WHERE t.status = 'in_progress'
           AND t.bracket_type = 'pool_knockout'
           AND now() < t.end_date + interval '14 days'
           AND (t.knockout_nudged_at IS NULL
                OR t.knockout_nudged_at < now() - interval '48 hours')
           AND EXISTS (
                 SELECT 1 FROM tournament_matches m
                  WHERE m.tournament_id = t.id AND m.bracket_side = 'pool')
           AND NOT EXISTS (
                 SELECT 1 FROM tournament_matches m
                  WHERE m.tournament_id = t.id AND m.bracket_side = 'main')
           -- Same terminal set tournament_generate_knockout gates on, so this
           -- stays quiet while a pool game is still disputed.
           AND NOT EXISTS (
                 SELECT 1 FROM tournament_matches m
                  WHERE m.tournament_id = t.id AND m.bracket_side = 'pool'
                    AND m.status NOT IN ('completed', 'retired', 'walkover', 'cancelled'))
    LOOP
        SELECT jsonb_agg(jsonb_build_object(
            'user_id', u.uid,
            'type', 'tournament_action_required',
            'target_id', v_rec.id,
            'title', CASE WHEN public.lt_user_is_fr(u.uid)
                       THEN 'Éliminatoires à lancer' ELSE 'Knockout ready to launch' END,
            'body', CASE WHEN public.lt_user_is_fr(u.uid)
                      THEN v_rec.name || ' : toutes les parties de poules sont réglées. '
                           || 'Lance la phase éliminatoire pour démarrer le tableau.'
                      ELSE v_rec.name || ': every pool game is settled. '
                           || 'Launch the knockout to start the bracket.'
                    END,
            'payload', jsonb_build_object(
                'tournamentId', v_rec.id,
                'tournamentName', v_rec.name,
                'gate', 'knockout'
            ),
            'priority', 'high'
        ))
          INTO v_rows
          FROM (
            SELECT v_rec.organizer_id AS uid
            UNION
            SELECT c.user_id FROM tournament_co_organizers c WHERE c.tournament_id = v_rec.id
          ) u
         WHERE u.uid IS NOT NULL;

        IF v_rows IS NOT NULL THEN
            PERFORM insert_notifications(v_rows);
            UPDATE tournaments SET knockout_nudged_at = now() WHERE id = v_rec.id;
            v_sent := v_sent + 1;
        END IF;
    END LOOP;

    RETURN v_sent;
END;
$$;

COMMENT ON FUNCTION public.lt_nudge_tournament_gates() IS
    'Cron-invoked: reminds organizers and co-organizers of tournaments parked at a '
    'gate only they can open (draw after registration closes, knockout after the '
    'pools finish). Re-nudges every 48h, stops 14 days past end_date. Spec: '
    'specs/17-leagues-tournaments/formats/poules-puis-eliminatoires.md §2 (les relances).';

-- ============================================
-- Schedule
-- ============================================

SELECT cron.unschedule('lt-tournament-gate-nudges') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'lt-tournament-gate-nudges'
);

-- Hourly at :20 is plenty for a 48h cadence, and :20 is free of the other lt-*
-- jobs (:00, :10, :15, :30, :40).
SELECT cron.schedule('lt-tournament-gate-nudges', '20 * * * *',
                     $cron$ SELECT public.lt_nudge_tournament_gates(); $cron$);
