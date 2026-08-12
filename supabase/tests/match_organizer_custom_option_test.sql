-- ============================================
-- Match Organizer: the custom option (degradation floor)
-- ============================================
-- Covers 20260812260000_match_organizer_custom_option.
--
-- The organizer card is the only path from a pairing to a created game, so a
-- pair with no shared availability and no known facility must still be able to
-- reach one. Any participant may propose their own slot; it becomes a normal
-- votable option and everything downstream is unchanged.
--
--   * proposing appends tier='custom', clears no_overlap, votes the proposer
--     and posts a visible (NOT silent) system note
--   * proposing the same slot twice dedupes onto one option, and the opponent
--     doing it is what makes the option mutual
--   * an outsider -> NOT_A_PARTICIPANT; a past slot -> SLOT_IN_PAST
--   * a mutual custom option creates a PRIVATE game carrying the free-text
--     place, attached to the bracket pre-play, reusing the round chat
--   * a settled card refuses further proposals -> CARD_ALREADY_SETTLED
--   * REGENERATION PINS the custom option and its vote (without this the
--     ambient refresh deletes the only option a zero-overlap pair agreed on)
--
-- Run: psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/match_organizer_custom_option_test.sql
--
-- One transaction, ROLLBACK at the end.
-- ============================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p::text)::text, true)::void;
$$;

CREATE OR REPLACE FUNCTION pg_temp.tennis_players(n integer) RETURNS uuid[] LANGUAGE sql AS $$
  SELECT array_agg(player_id) FROM (
    SELECT ps.player_id
      FROM player_sport ps JOIN sport s ON s.id = ps.sport_id
     WHERE s.name = 'tennis' AND ps.is_active = true AND NOT public.is_admin(ps.player_id)
     ORDER BY ps.player_id LIMIT n) t;
$$;

-- Event creation went staff-only in 20260812150000; granted around the create
-- call only and dropped straight after, because tennis_players() filters admins
-- out and a lingering row would shift every fixture a later block picks.
CREATE OR REPLACE FUNCTION pg_temp.staff_on(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO admin (id, role) VALUES (p, 'support') ON CONFLICT (id) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION pg_temp.staff_off(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM admin WHERE id = p;
$$;

-- A free single-elim draw of 4 with a published bracket. The organizer plays in
-- none of it, so it doubles as the outsider for the authorization check.
CREATE OR REPLACE FUNCTION pg_temp.mk_t(p_org uuid, p_players uuid[], p_name text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_t   tournaments;
    v_ver integer;
BEGIN
    PERFORM pg_temp.staff_on(p_org);
    PERFORM pg_temp.as_user(p_org);
    SELECT * INTO v_t FROM public.tournament_create(
        p_name, (SELECT id FROM sport WHERE name = 'tennis'), 4::smallint,
        now() + interval '1 day', now() + interval '20 days');
    PERFORM pg_temp.staff_off(p_org);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_open_registration(v_t.id, v_ver);
    FOR i IN 1..4 LOOP
        PERFORM pg_temp.as_user(p_players[i]);
        PERFORM public.tournament_register(v_t.id, NULL);
    END LOOP;
    PERFORM pg_temp.as_user(p_org);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_close_registration(v_t.id, v_ver);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_generate_bracket(v_t.id, v_ver);
    RETURN v_t.id;
END $$;

-- Publishing the bracket already auto-posts the system card (and there can only
-- be one per chat), so the fixture REUSES it and pins it into the worst case
-- this test is about: no mutually free slot, so options is empty. Forcing the
-- state also keeps the assertions absolute instead of depending on whatever the
-- suggestion engine happens to return from seed data.
CREATE OR REPLACE FUNCTION pg_temp.mk_zero_overlap_card(p_tm uuid, p_actor uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_tm    tournament_matches;
    v_conv  uuid;
    v_parts uuid[];
    v_sport uuid;
    v_msg   uuid;
BEGIN
    SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tm;
    SELECT sport_id INTO v_sport FROM tournaments WHERE id = v_tm.tournament_id;

    PERFORM pg_temp.as_user(p_actor);
    v_conv := public.get_or_create_tournament_round_chat(p_tm);

    SELECT array_agg(DISTINCT u.uid) INTO v_parts
      FROM (
        SELECT unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) AS uid
          FROM tournament_registrations r
         WHERE r.id IN (v_tm.player1_registration_id, v_tm.player2_registration_id)
      ) u;

    SELECT id INTO v_msg
      FROM message
     WHERE conversation_id = v_conv
       AND message_type = 'match_organizer'
       AND metadata->>'posted_by' = 'system'
       AND deleted_at IS NULL
     LIMIT 1;

    -- The trigger swallows poster failures with a WARNING, so fall back to
    -- inserting the card rather than letting the whole test depend on it.
    IF v_msg IS NULL THEN
        INSERT INTO message (conversation_id, sender_id, content, status, message_type, metadata)
        VALUES (
            v_conv,
            COALESCE((SELECT id FROM player
                       WHERE id = 'a11a0000-0000-4000-8000-000000000001'::uuid), p_actor),
            'Aucune plage commune', 'sent', 'match_organizer',
            jsonb_build_object(
                'kind',                'match_organizer',
                'sport_id',            v_sport,
                'sport_name',          'Tennis',
                'format',              'singles',
                'organizer_id',        NULL,
                'posted_by',           'system',
                'silent',              true,
                'tournament_match_id', p_tm
            )
        )
        RETURNING id INTO v_msg;
    END IF;

    DELETE FROM match_time_vote WHERE message_id = v_msg;

    UPDATE message
       SET metadata = metadata || jsonb_build_object(
             'participant_ids',        to_jsonb(v_parts),
             'options',                '[]'::jsonb,
             'no_overlap',             true,
             'created_match_id',       NULL,
             'confirmed_option_index', NULL
           )
     WHERE id = v_msg;

    ASSERT array_length(v_parts, 1) = 2, 'a singles pairing must resolve to two users';
    RETURN v_msg;
END $$;

-- First round-1 pairing of a draw, with its two users.
CREATE OR REPLACE FUNCTION pg_temp.first_pairing(
    p_t uuid, OUT o_tm uuid, OUT o_a uuid, OUT o_b uuid
) LANGUAGE plpgsql AS $$
DECLARE v_tm tournament_matches;
BEGIN
    SELECT * INTO v_tm FROM tournament_matches
     WHERE tournament_id = p_t AND round_number = 1 AND match_position = 1;
    o_tm := v_tm.id;
    SELECT user_id INTO o_a FROM tournament_registrations
     WHERE id = v_tm.player1_registration_id;
    SELECT user_id INTO o_b FROM tournament_registrations
     WHERE id = v_tm.player2_registration_id;
END $$;

-- --------------------------------------------------------------------------
-- 1. proposing a slot appends a custom option, votes the proposer, and says so
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_p uuid[]; v_org uuid; v_t uuid; v_tm uuid; v_a uuid; v_b uuid;
    v_msg uuid; v_idx int; v_meta jsonb; v_opt jsonb; v_n int; v_slot timestamptz;
BEGIN
    v_p   := pg_temp.tennis_players(6);
    v_org := v_p[5];
    v_t   := pg_temp.mk_t(v_org, v_p, '[TEST-CO] Floor A');
    SELECT o_tm, o_a, o_b INTO v_tm, v_a, v_b FROM pg_temp.first_pairing(v_t);
    v_msg := pg_temp.mk_zero_overlap_card(v_tm, v_a);

    v_slot := date_trunc('hour', now() + interval '3 days') + interval '19 hours';

    PERFORM pg_temp.as_user(v_a);
    v_idx := public.match_organizer_add_custom_option(
        v_msg, v_slot, NULL, '  Club de mon voisin  ');
    ASSERT v_idx = 0, format('the first option must land at index 0, got %s', v_idx);

    SELECT metadata INTO v_meta FROM message WHERE id = v_msg;
    ASSERT jsonb_array_length(v_meta->'options') = 1,
        format('one option expected, found %s', jsonb_array_length(v_meta->'options'));
    ASSERT NOT (v_meta ? 'no_overlap'),
        'an option now exists, so the card must stop claiming no overlap';

    v_opt := v_meta->'options'->0;
    ASSERT v_opt->>'tier' = 'custom',
        format('tier must be custom, got %s', v_opt->>'tier');
    ASSERT v_opt->>'free_count' IS NULL,
        'the engine never vetted this slot, so free_count must stay NULL';
    ASSERT v_opt->>'court_confirmed' = 'false', 'a proposed slot has no confirmed court';
    ASSERT v_opt->>'place_name' = 'Club de mon voisin',
        format('the place must be trimmed and kept, got %s', v_opt->>'place_name');
    ASSERT v_opt->>'facility_name' = 'Club de mon voisin',
        'with no facility the place is what the card shows';
    ASSERT (v_opt->>'proposed_by')::uuid = v_a, 'the proposer must be recorded';
    ASSERT v_opt->>'option_key' IS NOT NULL, 'a custom option still needs a stable key';

    -- Proposing is agreeing.
    SELECT count(*) INTO v_n FROM match_time_vote
     WHERE message_id = v_msg AND player_id = v_a AND option_index = 0;
    ASSERT v_n = 1, format('the proposer must be voted onto their own slot, found %s', v_n);

    -- And the thread says why the card changed. Deliberately not silent: unlike
    -- an ambient refresh, a human proposing a time should reach the opponent.
    SELECT count(*) INTO v_n FROM message
     WHERE conversation_id = (SELECT conversation_id FROM message WHERE id = v_msg)
       AND metadata->>'system_note' = 'custom_option_added';
    ASSERT v_n = 1, format('one system note expected, found %s', v_n);
    ASSERT NOT EXISTS (
        SELECT 1 FROM message
         WHERE conversation_id = (SELECT conversation_id FROM message WHERE id = v_msg)
           AND metadata->>'system_note' = 'custom_option_added'
           AND (metadata->>'silent')::boolean IS TRUE),
        'the proposal note must NOT be silent';

    RAISE NOTICE 'PASS 1: a proposed slot becomes a votable custom option';
END $$;

-- --------------------------------------------------------------------------
-- 2. the same slot twice dedupes, and the opponent proposing it makes it mutual
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_p uuid[]; v_org uuid; v_t uuid; v_tm uuid; v_a uuid; v_b uuid;
    v_msg uuid; v_i1 int; v_i2 int; v_i3 int; v_meta jsonb; v_n int;
    v_slot timestamptz;
BEGIN
    v_p   := pg_temp.tennis_players(6);
    v_org := v_p[5];
    v_t   := pg_temp.mk_t(v_org, v_p, '[TEST-CO] Floor B');
    SELECT o_tm, o_a, o_b INTO v_tm, v_a, v_b FROM pg_temp.first_pairing(v_t);
    v_msg := pg_temp.mk_zero_overlap_card(v_tm, v_a);

    v_slot := date_trunc('hour', now() + interval '4 days') + interval '18 hours';

    PERFORM pg_temp.as_user(v_a);
    v_i1 := public.match_organizer_add_custom_option(v_msg, v_slot, NULL, 'Parc du coin');
    -- Same player, same slot: idempotent, no second option, no duplicate vote.
    v_i2 := public.match_organizer_add_custom_option(v_msg, v_slot, NULL, 'Parc du coin');
    ASSERT v_i1 = v_i2, format('a repeat proposal must return the same index (%s vs %s)', v_i1, v_i2);

    SELECT metadata INTO v_meta FROM message WHERE id = v_msg;
    ASSERT jsonb_array_length(v_meta->'options') = 1,
        format('the slot must not be listed twice, found %s options',
               jsonb_array_length(v_meta->'options'));

    -- The opponent proposing the same slot is how agreement forms.
    PERFORM pg_temp.as_user(v_b);
    v_i3 := public.match_organizer_add_custom_option(v_msg, v_slot, NULL, 'Parc du coin');
    ASSERT v_i3 = v_i1, 'the opponent must land on the same option';

    SELECT count(*) INTO v_n FROM match_time_vote
     WHERE message_id = v_msg AND option_index = v_i1;
    ASSERT v_n = 2, format('both players must be voted onto the slot, found %s', v_n);

    RAISE NOTICE 'PASS 2: repeat proposals dedupe and build mutual agreement';
END $$;

-- --------------------------------------------------------------------------
-- 3. guards: outsiders and slots in the past
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_p uuid[]; v_org uuid; v_t uuid; v_tm uuid; v_a uuid; v_b uuid;
    v_msg uuid; v_ok boolean; v_meta jsonb;
BEGIN
    v_p   := pg_temp.tennis_players(6);
    v_org := v_p[5];
    v_t   := pg_temp.mk_t(v_org, v_p, '[TEST-CO] Floor C');
    SELECT o_tm, o_a, o_b INTO v_tm, v_a, v_b FROM pg_temp.first_pairing(v_t);
    v_msg := pg_temp.mk_zero_overlap_card(v_tm, v_a);

    -- The organizer is not in this pairing.
    v_ok := false;
    PERFORM pg_temp.as_user(v_org);
    BEGIN
        PERFORM public.match_organizer_add_custom_option(
            v_msg, now() + interval '2 days', NULL, 'Chez moi');
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'NOT_A_PARTICIPANT'); END;
    ASSERT v_ok, 'a non-participant must raise NOT_A_PARTICIPANT';

    v_ok := false;
    PERFORM pg_temp.as_user(v_a);
    BEGIN
        PERFORM public.match_organizer_add_custom_option(
            v_msg, now() - interval '1 hour', NULL, 'Hier');
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'SLOT_IN_PAST'); END;
    ASSERT v_ok, 'a slot in the past must raise SLOT_IN_PAST';

    SELECT metadata INTO v_meta FROM message WHERE id = v_msg;
    ASSERT jsonb_array_length(COALESCE(v_meta->'options', '[]'::jsonb)) = 0,
        'a refused proposal must leave the card untouched';

    RAISE NOTICE 'PASS 3: outsiders and past slots are refused';
END $$;

-- --------------------------------------------------------------------------
-- 4. a mutual custom option creates the private, bracket-linked game and
--    carries the free-text place onto it; the card then closes
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_p uuid[]; v_org uuid; v_t uuid; v_tm uuid; v_a uuid; v_b uuid;
    v_msg uuid; v_idx int; v_match uuid; v_row match; v_tmrow tournament_matches;
    v_conv uuid; v_n int; v_ok boolean := false; v_slot timestamptz;
BEGIN
    v_p   := pg_temp.tennis_players(6);
    v_org := v_p[6];
    v_t   := pg_temp.mk_t(v_org, v_p, '[TEST-CO] Floor D');
    SELECT o_tm, o_a, o_b INTO v_tm, v_a, v_b FROM pg_temp.first_pairing(v_t);
    v_msg := pg_temp.mk_zero_overlap_card(v_tm, v_a);
    SELECT conversation_id INTO v_conv FROM message WHERE id = v_msg;

    v_slot := date_trunc('hour', now() + interval '5 days') + interval '20 hours';

    PERFORM pg_temp.as_user(v_a);
    v_idx := public.match_organizer_add_custom_option(v_msg, v_slot, NULL, 'Terrain municipal');
    PERFORM pg_temp.as_user(v_b);
    PERFORM public.match_organizer_add_custom_option(v_msg, v_slot, NULL, 'Terrain municipal');

    -- Either participant turns the agreed option into the game.
    PERFORM pg_temp.as_user(v_b);
    v_match := public.create_casual_match(
        p_sport_id          => (SELECT sport_id FROM tournaments WHERE id = v_t),
        p_slot_start        => v_slot,
        p_player_ids        => ARRAY[v_a, v_b],
        p_format            => 'singles',
        p_source_message_id => v_msg,
        p_option_index      => v_idx,
        p_location_name     => 'Terrain municipal');

    SELECT * INTO v_row FROM match WHERE id = v_match;
    ASSERT v_row.visibility = 'private', 'a game organized in a pairing chat stays private';
    ASSERT v_row.visible_in_groups = false AND v_row.visible_in_communities = false,
        'a private pairing game must not leak into groups or communities';
    ASSERT v_row.facility_id IS NULL, 'no facility was chosen';
    ASSERT v_row.location_type = 'custom',
        format('a free-text place must land as custom, got %s', v_row.location_type);
    ASSERT v_row.location_name = 'Terrain municipal',
        format('the place must reach the game, got %s', v_row.location_name);

    SELECT * INTO v_tmrow FROM tournament_matches WHERE id = v_tm;
    ASSERT v_tmrow.match_id = v_match,
        'the game must be attached to the bracket slot before it is played';
    ASSERT v_tmrow.status = 'pending', 'attaching pre-play must not settle the slot';

    SELECT count(*) INTO v_n FROM conversation WHERE match_id = v_match;
    ASSERT v_n = 1, format('the round chat must be reused, found %s chats', v_n);
    ASSERT (SELECT match_id FROM conversation WHERE id = v_conv) = v_match,
        'the round chat must become THE match chat';

    SELECT count(*) INTO v_n FROM match_participant
     WHERE match_id = v_match AND status = 'joined';
    ASSERT v_n = 2, format('both players must be on the game, found %s', v_n);

    ASSERT (SELECT (metadata->>'created_match_id')::uuid FROM message WHERE id = v_msg) = v_match,
        'the card must flip to its created state';

    -- A settled card takes no further proposals.
    PERFORM pg_temp.as_user(v_a);
    BEGIN
        PERFORM public.match_organizer_add_custom_option(
            v_msg, v_slot + interval '1 day', NULL, 'Trop tard');
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'CARD_ALREADY_SETTLED'); END;
    ASSERT v_ok, 'a card that produced a game must raise CARD_ALREADY_SETTLED';

    RAISE NOTICE 'PASS 4: a mutual custom option makes the private, linked game';
END $$;

-- --------------------------------------------------------------------------
-- 5. regeneration must never drop a human proposal
--    (the engine cannot reproduce a custom option, so an unpinned refresh
--     silently deletes the only slot a zero-overlap pair agreed on)
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_p uuid[]; v_org uuid; v_t uuid; v_tm uuid; v_a uuid; v_b uuid;
    v_msg uuid; v_idx int; v_key text; v_meta jsonb; v_new_idx int; v_n int;
    v_slot timestamptz;
BEGIN
    v_p   := pg_temp.tennis_players(6);
    v_org := v_p[6];
    v_t   := pg_temp.mk_t(v_org, v_p, '[TEST-CO] Floor E');
    SELECT o_tm, o_a, o_b INTO v_tm, v_a, v_b FROM pg_temp.first_pairing(v_t);
    v_msg := pg_temp.mk_zero_overlap_card(v_tm, v_a);

    v_slot := date_trunc('hour', now() + interval '6 days') + interval '17 hours';

    PERFORM pg_temp.as_user(v_a);
    v_idx := public.match_organizer_add_custom_option(v_msg, v_slot, NULL, 'Mur du parc');
    PERFORM pg_temp.as_user(v_b);
    PERFORM public.match_organizer_add_custom_option(v_msg, v_slot, NULL, 'Mur du parc');

    SELECT o->>'option_key' INTO v_key
      FROM jsonb_array_elements((SELECT metadata->'options' FROM message WHERE id = v_msg)) o
     WHERE o->>'tier' = 'custom';
    ASSERT v_key IS NOT NULL, 'the fixture must have a custom option';

    -- The ambient refresh a chat open would trigger.
    PERFORM pg_temp.as_user(v_a);
    PERFORM public.lt_regenerate_system_organizer_card(v_tm, v_a);

    SELECT metadata INTO v_meta FROM message WHERE id = v_msg;

    SELECT count(*) INTO v_n
      FROM jsonb_array_elements(v_meta->'options') o
     WHERE o->>'option_key' = v_key;
    ASSERT v_n = 1,
        format('the custom option must survive regeneration exactly once, found %s', v_n);

    SELECT (ord - 1) INTO v_new_idx
      FROM jsonb_array_elements(v_meta->'options') WITH ORDINALITY AS x(o, ord)
     WHERE o->>'option_key' = v_key;

    ASSERT (SELECT o->>'tier' FROM jsonb_array_elements(v_meta->'options') o
             WHERE o->>'option_key' = v_key) = 'custom',
        'a pinned custom option stays custom';
    ASSERT (SELECT o->>'stale' FROM jsonb_array_elements(v_meta->'options') o
             WHERE o->>'option_key' = v_key) IS NULL,
        'a human proposal is not stale, only a vanished ENGINE option is';
    ASSERT NOT (v_meta ? 'no_overlap'),
        'a card holding a custom option must not read as no-overlap';

    -- Both votes must have followed the option to its new index.
    SELECT count(*) INTO v_n FROM match_time_vote
     WHERE message_id = v_msg AND option_index = v_new_idx;
    ASSERT v_n = 2,
        format('both votes must re-anchor onto the pinned option, found %s at index %s',
               v_n, v_new_idx);

    -- Harsher case: both players un-vote (the UI lets you toggle off), leaving a
    -- proposal nobody has agreed to YET. Pinning must not depend on votes, or a
    -- refresh deletes the proposal out from under the pair.
    DELETE FROM match_time_vote WHERE message_id = v_msg;
    PERFORM public.lt_regenerate_system_organizer_card(v_tm, v_a);

    SELECT count(*) INTO v_n
      FROM jsonb_array_elements((SELECT metadata->'options' FROM message WHERE id = v_msg)) o
     WHERE o->>'option_key' = v_key;
    ASSERT v_n = 1,
        'an unvoted custom option must survive too, it is still a human proposal';

    RAISE NOTICE 'PASS 5: regeneration pins the custom option, voted or not';
END $$;

ROLLBACK;
