-- ============================================
-- Scheduling funnel — the pool room and its composer lock
-- ============================================
-- Covers 20260826230000.
--
--   The room
--     * created for a pool, idempotent, exactly one welcome post
--     * members are the pool's players plus the organizer, and nobody else
--
--   The composer lock (the forcing function)
--     * a member who has not answered the gate is locked out of the composer
--     * an ORDINARY conversation is never locked. If this predicate were
--       wrong, every chat in the app would break, so it is asserted directly
--     * the organizer is never locked
--     * answering the gate unlocks it
--     * with scheduling_funnel_enabled false nothing locks at all
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/lt_pool_room_test.sql
--
-- One transaction, ROLLBACK at the end.
-- ============================================

BEGIN;

DO $$
DECLARE
    v_t        tournaments;
    v_pool     smallint;
    v_conv     uuid;
    v_again    uuid;
    v_player   uuid;
    v_normal   uuid;
    v_welcome  integer;
    v_expected integer;
    v_members  integer;
BEGIN
    SELECT t.* INTO v_t FROM tournaments t
     WHERE EXISTS (SELECT 1 FROM tournament_matches tm
                    WHERE tm.tournament_id = t.id AND tm.pool_number IS NOT NULL)
     ORDER BY t.created_at DESC LIMIT 1;
    IF v_t.id IS NULL THEN RAISE EXCEPTION 'fixture: no tournament with pools'; END IF;

    SELECT min(pool_number) INTO v_pool FROM tournament_matches
     WHERE tournament_id = v_t.id AND pool_number IS NOT NULL;

    -- 1. the room is created
    v_conv := public.lt_ensure_pool_room(v_t.id, v_pool);
    ASSERT v_conv IS NOT NULL, 'the pool room should have been created';

    -- 2. idempotent, and the welcome lands once
    v_again := public.lt_ensure_pool_room(v_t.id, v_pool);
    ASSERT v_again = v_conv, 'a second call must return the same room';
    SELECT count(*) INTO v_welcome FROM message
     WHERE conversation_id = v_conv AND message_type = 'pool_room_welcome';
    ASSERT v_welcome = 1, 'expected exactly one welcome post, got ' || v_welcome;

    -- 3. members are the pool plus the organizer
    SELECT count(DISTINCT u) INTO v_expected FROM tournament_matches tm
      JOIN tournament_registrations r
        ON r.id IN (tm.player1_registration_id, tm.player2_registration_id)
     CROSS JOIN LATERAL unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) AS u
     WHERE tm.tournament_id = v_t.id AND tm.pool_number = v_pool;
    SELECT count(*) INTO v_members FROM conversation_participant WHERE conversation_id = v_conv;
    ASSERT v_members >= v_expected, 'expected at least ' || v_expected || ' members, got ' || v_members;
    ASSERT EXISTS (SELECT 1 FROM conversation_participant
                    WHERE conversation_id = v_conv AND player_id = v_t.organizer_id),
        'the organizer should be a member';

    -- 4. and nobody from outside the pool
    ASSERT NOT EXISTS (
        SELECT 1 FROM conversation_participant cp
         WHERE cp.conversation_id = v_conv
           AND cp.player_id <> v_t.organizer_id
           AND NOT EXISTS (
             SELECT 1 FROM tournament_matches tm2
               JOIN tournament_registrations r2
                 ON r2.id IN (tm2.player1_registration_id, tm2.player2_registration_id)
              WHERE tm2.tournament_id = v_t.id AND tm2.pool_number = v_pool
                AND (r2.user_id = cp.player_id OR r2.partner_user_id = cp.player_id))),
        'somebody outside the pool is in the room';

    -- ---------------------------------------------------------------- lock
    SELECT DISTINCT u INTO v_player FROM tournament_matches tm
      JOIN tournament_registrations r
        ON r.id IN (tm.player1_registration_id, tm.player2_registration_id)
     CROSS JOIN LATERAL unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) AS u
     WHERE tm.tournament_id = v_t.id AND tm.pool_number = v_pool AND u <> v_t.organizer_id
     LIMIT 1;
    IF v_player IS NULL THEN RAISE EXCEPTION 'fixture: no non-organizer pool player'; END IF;

    SELECT cp.conversation_id INTO v_normal FROM conversation_participant cp
      JOIN conversation c ON c.id = cp.conversation_id
     WHERE cp.player_id = v_player AND c.tournament_pool_number IS NULL
       AND NOT public.is_announcement_conversation(c.id) LIMIT 1;
    IF v_normal IS NULL THEN RAISE EXCEPTION 'fixture: player has no ordinary conversation'; END IF;

    UPDATE tournaments SET scheduling_funnel_enabled = true WHERE id = v_t.id;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_player::text)::text, true);

    ASSERT public.lt_pool_room_composer_locked(v_conv) = true,
        'a player who has not answered should be locked out of the composer';

    -- The regression that would break every chat in the app
    ASSERT public.lt_pool_room_composer_locked(v_normal) = false,
        'an ordinary conversation must never be locked';

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_t.organizer_id::text)::text, true);
    ASSERT public.lt_pool_room_composer_locked(v_conv) = false,
        'the organizer must never be locked out of their own pool';

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_player::text)::text, true);
    INSERT INTO tournament_phase_availability
        (tournament_id, bracket_side, round_number, player_id, outcome, hours_in_window, grid_snapshot)
    VALUES (v_t.id, 'pool', 0, v_player, 'confirmed', 6, '[]'::jsonb)
    ON CONFLICT DO NOTHING;
    ASSERT public.lt_pool_room_composer_locked(v_conv) = false,
        'answering the gate should unlock the composer';

    DELETE FROM tournament_phase_availability WHERE tournament_id = v_t.id;
    UPDATE tournaments SET scheduling_funnel_enabled = false WHERE id = v_t.id;
    ASSERT public.lt_pool_room_composer_locked(v_conv) = false,
        'with the funnel off nothing locks';

    RAISE NOTICE 'lt_pool_room_test: all assertions passed';
END $$;

ROLLBACK;
