-- ============================================
-- Chat — one event room and one room per pool, per tournament
-- ============================================
-- Covers 20260826220000, which splits conversation_tournament_id_unique so a
-- pool room can exist beside the event-wide room. The assertions are the ones
-- that would have caught the two data-corruption paths:
--
--   * the event room still resolves uniquely once a pool room shares its
--     tournament_id, and lt_get_or_create_tournament_chat still returns IT
--   * the ON CONFLICT predicate still matches an index. Those clauses name the
--     dropped index by its predicate and fail at RUNTIME, not at creation, so
--     nothing but an actual insert proves it
--   * renaming the tournament renames the event room and leaves the pool room
--     alone (sync_tournament_chat_title would otherwise rename every pool)
--   * a new registrant joins the event room and NOT the pool room
--     (sync_tournament_chat_registration would otherwise add players to pools
--     they do not belong to)
--   * a second room for the same pool is refused
--
-- The registration probe needs a FREE tournament: a paid one refuses a direct
-- insert with PAYMENT_REQUIRED from tg_tournament_registration_requires_payment.
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/conversation_pool_room_uniqueness_test.sql
--
-- One transaction, ROLLBACK at the end.
-- ============================================

BEGIN;

DO $$
DECLARE
    v_t        tournaments;
    v_event    uuid;
    v_pool     uuid;
    v_again    uuid;
    v_title    text;
    v_pool_ttl text;
    v_new      uuid;
    v_in_ev    integer;
    v_in_pl    integer;
BEGIN
    SELECT t.* INTO v_t FROM tournaments t
     WHERE COALESCE(t.entry_fee_cents, 0) = 0
       AND EXISTS (SELECT 1 FROM conversation c WHERE c.tournament_id = t.id)
     ORDER BY t.created_at DESC LIMIT 1;
    IF v_t.id IS NULL THEN RAISE EXCEPTION 'fixture: no free tournament with a chat'; END IF;

    SELECT id INTO v_event FROM conversation
     WHERE tournament_id = v_t.id AND tournament_pool_number IS NULL;
    ASSERT v_event IS NOT NULL, 'the event room should exist before we start';

    -- 1. a pool room can exist beside it
    INSERT INTO conversation (conversation_type, tournament_id, tournament_pool_number, created_by, title)
    VALUES ('tournament', v_t.id, 1, v_t.organizer_id, 'Poule 1')
    RETURNING id INTO v_pool;

    -- 2. the event room still resolves, and to the same row
    SELECT id INTO v_again FROM conversation
     WHERE tournament_id = v_t.id AND tournament_pool_number IS NULL;
    ASSERT v_again = v_event, 'the event room must still resolve uniquely';

    -- 3. get_or_create returns the event room, never a pool room
    v_again := public.lt_get_or_create_tournament_chat(v_t.id);
    ASSERT v_again = v_event,
        'get_or_create returned ' || v_again::text || ' instead of the event room';

    -- 4. the ON CONFLICT predicate still matches an index: this only fails at
    --    runtime, so an insert is the only proof
    INSERT INTO conversation (conversation_type, tournament_id, created_by, title)
    VALUES ('tournament', v_t.id, v_t.organizer_id, 'dupe attempt')
    ON CONFLICT (tournament_id) WHERE tournament_id IS NOT NULL AND tournament_pool_number IS NULL
    DO NOTHING;
    ASSERT (SELECT count(*) FROM conversation
             WHERE tournament_id = v_t.id AND tournament_pool_number IS NULL) = 1,
        'a second event room slipped past ON CONFLICT';

    -- 5. two rooms for one pool are refused
    BEGIN
        INSERT INTO conversation (conversation_type, tournament_id, tournament_pool_number, created_by, title)
        VALUES ('tournament', v_t.id, 1, v_t.organizer_id, 'Poule 1 bis');
        RAISE EXCEPTION 'a duplicate pool room should have been refused';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;

    -- 6. renaming the tournament leaves the pool room's title alone
    UPDATE tournaments SET name = name || ' (test)' WHERE id = v_t.id;
    SELECT title INTO v_title FROM conversation WHERE id = v_event;
    SELECT title INTO v_pool_ttl FROM conversation WHERE id = v_pool;
    ASSERT v_title LIKE '%(test)', 'the event room should follow the tournament name';
    ASSERT v_pool_ttl = 'Poule 1',
        'the pool room kept the wrong title: ' || v_pool_ttl;

    -- 7. a new registrant joins the event room only
    SELECT u.id INTO v_new FROM auth.users u
     WHERE NOT EXISTS (SELECT 1 FROM tournament_registrations r
                        WHERE r.tournament_id = v_t.id AND r.user_id = u.id)
       AND NOT EXISTS (SELECT 1 FROM conversation_participant cp
                        WHERE cp.conversation_id IN (v_event, v_pool) AND cp.player_id = u.id)
     LIMIT 1;
    IF v_new IS NULL THEN RAISE EXCEPTION 'fixture: no unregistered user available'; END IF;

    INSERT INTO tournament_registrations (tournament_id, user_id, status)
    VALUES (v_t.id, v_new, 'registered');

    SELECT count(*) INTO v_in_ev FROM conversation_participant
     WHERE conversation_id = v_event AND player_id = v_new;
    SELECT count(*) INTO v_in_pl FROM conversation_participant
     WHERE conversation_id = v_pool AND player_id = v_new;
    ASSERT v_in_ev = 1, 'the registrant should have joined the event room, got ' || v_in_ev;
    ASSERT v_in_pl = 0, 'the registrant must NOT join the pool room, got ' || v_in_pl;

    RAISE NOTICE 'conversation_pool_room_uniqueness_test: all assertions passed';
END $$;

ROLLBACK;
