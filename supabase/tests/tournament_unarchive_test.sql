-- ============================================
-- Tournaments — archiving is reversible (DB-level)
-- ============================================
-- Covers 20260731140000_lt_tournament_unarchive.
--
-- tournament_archive moved a completed or cancelled tournament to 'archived'
-- and there was no inverse, so an organizer who archived one had no way back.
-- Reported as "une fois archive je ne le vois plus nulle part et je ne peux pas
-- le remettre".
--
--   * an archived cancelled tournament restores to cancelled, not completed
--   * an archived completed tournament restores to completed
--   * a live tournament cannot be unarchived
--   * a stranger cannot unarchive
--   * archive records the status it left behind
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_unarchive_test.sql
--
-- One transaction, ROLLBACK at the end.
-- ============================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user::text)::text, true);
END $$;

DO $$
DECLARE
    v_sport uuid; v_p uuid[]; v_org uuid; v_other uuid;
    v_t tournaments; v_m tournament_matches; v_i int; v_err text;
    v_from text; v_to text;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_p FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id)
         ORDER BY player_id LIMIT 46) s;
    ASSERT array_length(v_p, 1) = 46, 'need 46 active non-admin tennis players';
    -- Tail of the pool: tournament_create allows a non-admin 5 per 24h and the
    -- rest of the suite organizes from the head.
    v_org   := v_p[26];
    v_other := v_p[27];

    -- ---------------- a CANCELLED tournament, archived then restored -------
    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Unarchive — cancelled', p_sport_id => v_sport,
        p_max_participants => 4::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open');
    SELECT * INTO v_t FROM tournament_cancel(v_t.id, 'test teardown', v_t.version);
    ASSERT v_t.status = 'cancelled', 'fixture must be cancelled before archiving';

    SELECT * INTO v_t FROM tournament_archive(v_t.id, v_t.version);
    ASSERT v_t.status = 'archived', 'archive must move it to archived';
    ASSERT v_t.archived_at IS NOT NULL, 'archive must stamp archived_at';

    SELECT payload_after->>'archived_from' INTO v_from
      FROM leagues_tournaments_audit
     WHERE entity_id = v_t.id AND action = 'archive';
    ASSERT v_from = 'cancelled',
        format('archive must record where it came from, got %s', v_from);

    -- A stranger cannot bring it back.
    PERFORM pg_temp.as_user(v_other);
    BEGIN
        PERFORM tournament_unarchive(v_t.id, v_t.version);
        v_err := 'no error';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    ASSERT v_err = 'NOT_ORGANIZER',
        format('a stranger must not unarchive, got %s', v_err);

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_t FROM tournament_unarchive(v_t.id, v_t.version);
    ASSERT v_t.status = 'cancelled',
        format('a cancelled tournament must restore to cancelled, got %s', v_t.status);
    ASSERT v_t.archived_at IS NULL, 'restoring must clear archived_at';

    SELECT payload_after->>'restored_to' INTO v_to
      FROM leagues_tournaments_audit
     WHERE entity_id = v_t.id AND action = 'unarchive';
    ASSERT v_to = 'cancelled', format('the trail must record the destination, got %s', v_to);

    -- Not archived any more, so the inverse refuses.
    BEGIN
        PERFORM tournament_unarchive(v_t.id, v_t.version);
        v_err := 'no error';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    ASSERT v_err = 'TOURNAMENT_NOT_ARCHIVED',
        format('only an archived tournament is restorable, got %s', v_err);

    -- ---------------- a COMPLETED tournament restores to completed ---------
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Unarchive — completed', p_sport_id => v_sport,
        p_max_participants => 4::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open');
    SELECT * INTO v_t FROM tournament_open_registration(v_t.id, v_t.version);
    FOR v_i IN 28..31 LOOP
        PERFORM pg_temp.as_user(v_p[v_i]);
        PERFORM tournament_register(v_t.id);
    END LOOP;
    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_t FROM tournament_close_registration(v_t.id, v_t.version);
    PERFORM tournament_generate_bracket(v_t.id, v_t.version);
    -- Round 1 first: the final's slots stay empty until its feeders resolve.
    FOR v_m IN SELECT * FROM tournament_matches
                WHERE tournament_id = v_t.id AND round_number = 1 ORDER BY match_position LOOP
        PERFORM tournament_override_score(v_m.id, v_m.player1_registration_id, '6-1 6-1');
    END LOOP;
    SELECT * INTO v_m FROM tournament_matches
     WHERE tournament_id = v_t.id AND next_match_id IS NULL AND bracket_side = 'main' LIMIT 1;
    PERFORM tournament_override_score(v_m.id, v_m.player1_registration_id, '6-1 6-1');

    SELECT * INTO v_t FROM tournaments WHERE id = v_t.id;
    ASSERT v_t.status = 'completed', format('playing the final must complete it, got %s', v_t.status);

    SELECT * INTO v_t FROM tournament_archive(v_t.id, v_t.version);
    SELECT * INTO v_t FROM tournament_unarchive(v_t.id, v_t.version);
    ASSERT v_t.status = 'completed',
        format('a completed tournament must restore to completed, got %s', v_t.status);

    RAISE NOTICE 'PASS: archiving is reversible and restores the original status';
END $$;

ROLLBACK;
