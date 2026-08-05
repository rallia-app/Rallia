-- ============================================
-- Leagues — members are told when a session or season is cancelled (DB-level)
-- ============================================
-- Covers 20260730180000 + 20260730180100.
--
-- session_cancel and season_cancel stored a reason and notified nobody, so a
-- member found out only by reopening the screen. Reported from staging as
-- "j'ai vu la saison annulee mais aucun avis aux membres".
--
--   * cancelling a session notifies confirmed and undecided members
--   * a member who already DECLINED is not told
--   * the organizer who cancelled is not told
--   * the reason travels in the body and the payload
--   * cancelling a season notifies the roster
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/lt_cancel_notifications_test.sql
--
-- One transaction, ROLLBACK at the end.
-- ============================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user::text)::text, true);
END $$;

-- --------------------------------------------------------------------------
-- 1. session cancellation reaches the right people, with the reason
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_p uuid[]; v_org uuid;
    v_l leagues; v_sea seasons; v_sess sessions;
    v_i int; v_n int; v_body text;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_p FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id)
         ORDER BY player_id LIMIT 4) s;
    ASSERT array_length(v_p, 1) = 4, 'need 4 active non-admin tennis players';
    v_org := v_p[1];

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_l FROM league_create(
        p_name => 'Cancel notice — session', p_sport_id => v_sport,
        p_visibility => 'public', p_join_mode => 'open');
    FOR v_i IN 2..4 LOOP
        PERFORM pg_temp.as_user(v_p[v_i]);
        PERFORM league_join(v_l.id);
    END LOOP;

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_sea FROM season_create(v_l.id, 'S', current_date, current_date + 90);
    SELECT * INTO v_sea FROM season_open(v_sea.id, v_sea.version);
    SELECT * INTO v_sess FROM session_create(v_sea.id, 'N1', now() + interval '3 days');
    SELECT * INTO v_sess FROM session_publish(v_sess.id, NULL, v_sess.version);

    -- p2 confirms, p3 declines, p4 leaves its presence row untouched (pending).
    PERFORM pg_temp.as_user(v_p[2]);
    PERFORM session_confirm_presence(v_sess.id, 'confirmed');
    PERFORM pg_temp.as_user(v_p[3]);
    PERFORM session_confirm_presence(v_sess.id, 'declined');

    -- Clear the publish notifications so the assertions below see only cancels.
    DELETE FROM notification WHERE type = 'session_published';

    PERFORM pg_temp.as_user(v_org);
    PERFORM session_cancel(v_sess.id, 'Pluie annoncée', v_sess.version);

    SELECT count(*) INTO v_n FROM notification
     WHERE type = 'session_cancelled' AND target_id = v_sess.id;
    ASSERT v_n = 2, format('expected 2 session_cancelled notices, got %s', v_n);

    ASSERT EXISTS (SELECT 1 FROM notification
                    WHERE type='session_cancelled' AND target_id=v_sess.id AND user_id=v_p[2]),
        'the confirmed member must be told';
    ASSERT EXISTS (SELECT 1 FROM notification
                    WHERE type='session_cancelled' AND target_id=v_sess.id AND user_id=v_p[4]),
        'the undecided member must be told';
    ASSERT NOT EXISTS (SELECT 1 FROM notification
                        WHERE type='session_cancelled' AND target_id=v_sess.id AND user_id=v_p[3]),
        'a member who already declined must not be told';
    ASSERT NOT EXISTS (SELECT 1 FROM notification
                        WHERE type='session_cancelled' AND target_id=v_sess.id AND user_id=v_org),
        'the organizer who cancelled must not notify themselves';

    SELECT body INTO v_body FROM notification
     WHERE type='session_cancelled' AND target_id=v_sess.id AND user_id=v_p[2];
    ASSERT v_body LIKE '%Pluie annoncée%', format('the reason must reach the body, got: %s', v_body);

    ASSERT EXISTS (SELECT 1 FROM notification
                    WHERE type='session_cancelled' AND target_id=v_sess.id
                      AND payload->>'reason' = 'Pluie annoncée'),
        'the reason must reach the payload';
    ASSERT EXISTS (SELECT 1 FROM notification
                    WHERE type='session_cancelled' AND target_id=v_sess.id
                      AND priority = 'urgent'),
        'a cancellation is urgent';

    RAISE NOTICE 'PASS 1: session cancellation notifies the right members with the reason';
END $$;

-- --------------------------------------------------------------------------
-- 2. season cancellation reaches the roster
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_p uuid[]; v_org uuid;
    v_l leagues; v_sea seasons; v_sess sessions;
    v_i int; v_n int; v_roster int;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_p FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id)
         ORDER BY player_id LIMIT 4) s;
    v_org := v_p[1];

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_l FROM league_create(
        p_name => 'Cancel notice — season', p_sport_id => v_sport,
        p_visibility => 'public', p_join_mode => 'open');
    FOR v_i IN 2..4 LOOP
        PERFORM pg_temp.as_user(v_p[v_i]);
        PERFORM league_join(v_l.id);
    END LOOP;

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_sea FROM season_create(v_l.id, 'S', current_date, current_date + 90);
    SELECT * INTO v_sea FROM season_open(v_sea.id, v_sea.version);

    -- A published session seeds season_rankings, which is the roster the
    -- season_closed / season_cancelled notices address.
    SELECT * INTO v_sess FROM session_create(v_sea.id, 'N1', now() + interval '3 days');
    SELECT * INTO v_sess FROM session_publish(v_sess.id, NULL, v_sess.version);
    FOR v_i IN 2..4 LOOP
        PERFORM pg_temp.as_user(v_p[v_i]);
        PERFORM session_confirm_presence(v_sess.id, 'confirmed');
    END LOOP;
    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_sess FROM session_generate_sheet(v_sess.id, v_sess.version);

    SELECT count(*) INTO v_roster FROM season_rankings
     WHERE season_id = v_sea.id AND user_id IS DISTINCT FROM v_org;

    SELECT * INTO v_sea FROM seasons WHERE id = v_sea.id;
    PERFORM season_cancel(v_sea.id, 'Pas assez d''inscriptions', v_sea.version);

    SELECT count(*) INTO v_n FROM notification
     WHERE type = 'season_cancelled' AND target_id = v_sea.id;
    ASSERT v_n = v_roster,
        format('expected %s season_cancelled notices, got %s', v_roster, v_n);
    ASSERT v_n > 0, 'the roster must be non-empty for this test to mean anything';

    ASSERT NOT EXISTS (SELECT 1 FROM notification
                        WHERE type='season_cancelled' AND target_id=v_sea.id AND user_id=v_org),
        'the organizer who cancelled must not notify themselves';
    ASSERT EXISTS (SELECT 1 FROM notification
                    WHERE type='season_cancelled' AND target_id=v_sea.id
                      AND body LIKE '%Pas assez d''inscriptions%'),
        'the reason must reach the body';

    RAISE NOTICE 'PASS 2: season cancellation notifies the roster with the reason';
END $$;

ROLLBACK;
