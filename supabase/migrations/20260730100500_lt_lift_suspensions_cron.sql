-- ============================================================================
-- Leagues — a timed suspension never expired
-- ============================================================================
-- league_suspend_member (20260628180000) takes p_until and stores it in
-- suspended_until, and leagues.md § Suspension promises "the cron
-- lt-lift-suspensions (hourly) flips expired suspensions back to active and
-- notifies the member".
--
-- That cron was never built. suspended_until is written by league_suspend_member
-- and cleared by league_reinstate_member, and nothing else in the database
-- reads it — a "two week" suspension is indefinite until an organizer
-- remembers to lift it by hand. Meanwhile a suspended member is excluded from
-- is_active_league_member, so they cannot confirm sessions and are dropped from
-- the free-season roster: the effect of forgetting is that a player quietly
-- stops being in the league.
--
-- Indefinite suspensions (suspended_until IS NULL) stay indefinite, which is
-- the documented meaning of leaving it blank.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lt_lift_expired_suspensions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row   record;
    v_count integer := 0;
BEGIN
    FOR v_row IN
        SELECT m.id, m.league_id, m.user_id, l.name AS league_name,
               l.organizer_id
          FROM league_members m
          JOIN leagues l ON l.id = m.league_id
         WHERE m.status = 'suspended'
           AND m.suspended_until IS NOT NULL
           AND m.suspended_until <= now()
         FOR UPDATE OF m SKIP LOCKED
    LOOP
        UPDATE league_members
           SET status           = 'active',
               suspended_at     = NULL,
               suspended_until  = NULL,
               suspended_reason = NULL,
               version          = version + 1,
               updated_at       = now()
         WHERE id = v_row.id AND status = 'suspended';

        PERFORM insert_notification(
            v_row.user_id,
            'league_member_approved',
            v_row.league_id,
            CASE WHEN public.lt_user_is_fr(v_row.user_id)
                 THEN 'Suspension terminée' ELSE 'Suspension lifted' END,
            CASE WHEN public.lt_user_is_fr(v_row.user_id)
                 THEN 'Tu peux rejouer dans ' || coalesce(v_row.league_name, 'ta ligue') || '.'
                 ELSE 'You can play in ' || coalesce(v_row.league_name, 'your league') || ' again.'
            END,
            jsonb_build_object('entityKind', 'league', 'leagueId', v_row.league_id,
                               'suspensionLifted', true),
            'normal'
        );

        -- actor_id is NOT NULL and a cron has no caller; attribute it to the
        -- organizer who set the suspension, as lt_close_due_session_confirmations
        -- does for its own automatic transition.
        INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
        VALUES ('membership', v_row.id, 'suspension_expired', v_row.organizer_id,
                jsonb_build_object('league_id', v_row.league_id, 'user_id', v_row.user_id,
                                   'automatic', true));

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.lt_lift_expired_suspensions() IS
'Hourly: returns members whose suspended_until has passed to active and notifies
them. Indefinite suspensions (NULL suspended_until) are left alone.';

-- Hourly, on the :40 mark to stay clear of the other L&T jobs.
SELECT cron.unschedule('lt-lift-suspensions')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lt-lift-suspensions');

SELECT cron.schedule(
    'lt-lift-suspensions',
    '40 * * * *',
    $$ SELECT public.lt_lift_expired_suspensions(); $$
);
