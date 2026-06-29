-- ============================================
-- Tournaments — co-organizer RPCs test
-- ============================================
-- Covers tournament_add_co_organizer / get_tournament_co_organizers /
-- tournament_remove_co_organizer + the rights/chat side effects.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_co_organizer_test.sql
--
-- Runs in one transaction and ROLLBACKs at the end.
-- ============================================

BEGIN;

DO $$
DECLARE
    v_sport uuid;
    v_players uuid[];
    v_org uuid;
    v_co uuid;
    v_other uuid;
    v_t tournaments;
    v_tid uuid;
    v_conv uuid;
    v_n int;
    v_err text;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_players
      FROM (SELECT player_id FROM player_sport
             WHERE sport_id = v_sport AND is_active = true
             ORDER BY player_id LIMIT 3) s;
    v_org := v_players[1];
    v_co := v_players[2];
    v_other := v_players[3];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Co-org Cup', p_sport_id => v_sport, p_max_participants => 8::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open');
    v_tid := v_t.id;
    SELECT id INTO v_conv FROM conversation WHERE tournament_id = v_tid;

    -- add co-organizer
    PERFORM tournament_add_co_organizer(v_tid, v_co);
    SELECT count(*) INTO v_n FROM get_tournament_co_organizers(v_tid);
    ASSERT v_n = 1, 'expected 1 co-organizer, got ' || v_n;
    RAISE NOTICE 'PASS 1: add + get co-organizer';

    -- co-organizer now passes the organizer gate
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_co::text)::text, true);
    ASSERT public.is_tournament_organizer(v_tid), 'co-organizer should be an organizer';
    RAISE NOTICE 'PASS 2: co-organizer has organizer rights';

    -- co-organizer was pulled into the tournament chat
    ASSERT EXISTS (SELECT 1 FROM conversation_participant
                    WHERE conversation_id = v_conv AND player_id = v_co),
        'co-organizer should be in the tournament chat';
    RAISE NOTICE 'PASS 3: co-organizer added to tournament chat';

    -- a non-primary-organizer cannot manage the roster
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other::text)::text, true);
    BEGIN
        PERFORM tournament_add_co_organizer(v_tid, v_other);
        ASSERT false, 'non-organizer add should fail';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        ASSERT v_err = 'NOT_ORGANIZER', 'unexpected: ' || v_err;
    END;
    -- even the co-organizer cannot add another co-organizer (owner-only)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_co::text)::text, true);
    BEGIN
        PERFORM tournament_add_co_organizer(v_tid, v_other);
        ASSERT false, 'co-organizer add should fail (owner-only)';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        ASSERT v_err = 'NOT_ORGANIZER', 'unexpected: ' || v_err;
    END;
    RAISE NOTICE 'PASS 4: only the primary organizer manages the roster';

    -- remove co-organizer: rights + chat membership revoked
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    PERFORM tournament_remove_co_organizer(v_tid, v_co);
    SELECT count(*) INTO v_n FROM get_tournament_co_organizers(v_tid);
    ASSERT v_n = 0, 'expected 0 co-organizers after remove, got ' || v_n;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_co::text)::text, true);
    ASSERT NOT public.is_tournament_organizer(v_tid), 'removed co-organizer should lose rights';
    ASSERT NOT EXISTS (SELECT 1 FROM conversation_participant
                        WHERE conversation_id = v_conv AND player_id = v_co),
        'removed co-organizer should leave the chat';
    RAISE NOTICE 'PASS 5: remove revokes rights + chat membership';

    -- cannot add the primary organizer as a co-organizer
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    BEGIN
        PERFORM tournament_add_co_organizer(v_tid, v_org);
        ASSERT false, 'adding the primary organizer should fail';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        ASSERT v_err = 'ALREADY_PRIMARY_ORGANIZER', 'unexpected: ' || v_err;
    END;
    RAISE NOTICE 'PASS 6: primary organizer cannot be added as co-organizer';
END $$;

ROLLBACK;
