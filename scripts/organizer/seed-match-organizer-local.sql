-- ============================================================================
-- Local seed: fully exercise the chat Match Organizer as lefrancmathis2@gmail.com
-- ============================================================================
-- Builds every state the organizer card can be in, for ONE tester working alone.
--
--   [MO] Partie a deux          direct chat, opponent already posted a card and
--                               voted, so voting once reaches mutual agreement
--   [MO] Tournoi suggestions    tournament round chat, card auto-posted by the
--                               bracket-publish trigger, opponent pre-voted
--   [MO] Tournoi sans plage     zero-overlap card: no shared hours at all, so
--                               the only way forward is "Proposer un autre
--                               moment" (the degradation floor)
--   [MO] Tournoi terrains       one card showing ALL FOUR court chips at once:
--                               terrain libre / terrains reserves / dispo a
--                               venir / terrain a confirmer
--   [MO] Ligue                  league session pairing chat (the league side has
--                               no auto-post yet, so the card is posted by hand
--                               from the banner)
--
-- Testing alone: after you thumbs-up an option, run
--     SELECT public.mo_opponent_agrees('<message-id>');
-- and every other participant votes whatever you voted, so the row flips to
-- "Creer la partie". Get the message id from the chat, or:
--     SELECT id, conversation_id FROM message
--      WHERE message_type = 'match_organizer' ORDER BY created_at DESC LIMIT 5;
--
-- Run:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f scripts/organizer/seed-match-organizer-local.sql
--
-- Re-runnable: it deletes its own [MO] fixtures first.
-- Cleanup: scripts/organizer/cleanup-match-organizer-local.sql
-- ============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 0. Wipe the previous run
-- ---------------------------------------------------------------------------
\i scripts/organizer/cleanup-match-organizer-local.sql


DO $seed$
DECLARE
    v_me       uuid;
    v_sport    uuid;
    v_org      uuid := 'a1000000-0000-0000-0000-000000000093';  -- Robert Lafleur, organizer only
    v_rich     uuid := 'a1000000-0000-0000-0000-000000000098';  -- Helene Vallee, broad overlap
    v_none     uuid := 'a1000000-0000-0000-0000-000000000097';  -- Andre Thibault, no overlap
    v_chips    uuid := 'a1000000-0000-0000-0000-000000000096';  -- Suzanne Raymond, one shared hour
    v_fill1    uuid := 'a1000000-0000-0000-0000-000000000100';
    v_fill2    uuid := 'a1000000-0000-0000-0000-000000000095';
    v_favs     uuid[];
    v_fac_ok   uuid;   -- gets a real open court
    v_fac_full uuid;   -- covered by the feed and fully taken
    v_conv     uuid;
    v_msg      uuid;
    v_tue1     date;
    v_tue2     date;
    v_t        tournaments;
    v_ver      int;
    v_regs     uuid[];
    v_tm       uuid;
    v_l        leagues;
    v_sea      seasons;
    v_sess     sessions;
    v_opts     jsonb;
    v_n        int;
BEGIN
    SELECT id INTO v_me FROM auth.users WHERE email = 'lefrancmathis2@gmail.com';
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'lefrancmathis2@gmail.com not found in this database';
    END IF;
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';

    -- Her three tennis favorites drive the whole speculative tier: source B only
    -- ever suggests favorited facilities, so these ARE the candidate places.
    SELECT array_agg(facility_id ORDER BY facility_id) INTO v_favs
      FROM player_favorite_facility
     WHERE player_id = v_me AND sport_id = v_sport;
    IF COALESCE(array_length(v_favs, 1), 0) < 3 THEN
        RAISE EXCEPTION 'expected at least 3 tennis favorites on the account, found %',
              COALESCE(array_length(v_favs, 1), 0);
    END IF;
    v_fac_ok   := v_favs[1];
    v_fac_full := v_favs[2];

    -- =======================================================================
    -- 1. Shape the opponents
    -- =======================================================================
    -- Everyone plays tennis and favorites the same courts she does, so the
    -- engine has somewhere to suggest.
    INSERT INTO player_sport (player_id, sport_id, is_active)
    SELECT p, v_sport, true FROM unnest(ARRAY[v_rich, v_none, v_chips, v_org, v_fill1, v_fill2]) p
    ON CONFLICT (player_id, sport_id) DO UPDATE SET is_active = true;

    -- Deliberately NOT all three: the opponents share her first two courts and
    -- skip the third, so the "shared favourite" chip differentiates rows instead
    -- of appearing on every one of them.
    INSERT INTO player_favorite_facility (player_id, facility_id, sport_id)
    SELECT p, f, v_sport
      FROM unnest(ARRAY[v_rich, v_none, v_chips]) p, unnest(v_favs[1:2]) f
    ON CONFLICT DO NOTHING;

    DELETE FROM player_favorite_facility
     WHERE player_id = ANY(ARRAY[v_rich, v_none, v_chips])
       AND sport_id = v_sport AND facility_id = v_favs[3];

    DELETE FROM player_availability WHERE player_id = ANY(ARRAY[v_rich, v_none, v_chips]);

    -- Helene mirrors her week exactly -> lots of mutually free hours.
    INSERT INTO player_availability (player_id, day, hour_of_day, is_active)
    SELECT v_rich, pa.day, pa.hour_of_day, true
      FROM player_availability pa WHERE pa.player_id = v_me AND pa.is_active;

    -- Andre plays only early mornings on days she never plays -> ZERO overlap.
    INSERT INTO player_availability (player_id, day, hour_of_day, is_active)
    SELECT v_none, d, h, true
      FROM unnest(ARRAY['monday','thursday','saturday']::day_enum[]) d,
           unnest(ARRAY[7, 8, 9]) h;

    -- Suzanne shares exactly ONE hour with her (Tuesday 15h). That keeps the
    -- card down to 3 facilities x 2 Tuesdays, so every court state stays
    -- visible instead of being ranked off the bottom of the list.
    INSERT INTO player_availability (player_id, day, hour_of_day, is_active)
    VALUES (v_chips, 'tuesday', 15, true);

    -- =======================================================================
    -- 2. A court feed, so the chips differ
    -- =======================================================================
    v_tue1 := (now() AT TIME ZONE 'America/Toronto')::date
              + ((9 - extract(isodow FROM (now() AT TIME ZONE 'America/Toronto')::date))::int % 7);
    IF v_tue1 <= (now() AT TIME ZONE 'America/Toronto')::date THEN
        v_tue1 := v_tue1 + 7;
    END IF;
    v_tue2 := v_tue1 + 7;

    DELETE FROM facility_availability_snapshot WHERE source = 'mo-seed';

    -- One facility has a genuinely open court that Tuesday -> "1 terrain libre".
    INSERT INTO facility_availability_snapshot
      (facility_id, external_court_id, sport_id, slot_start, slot_end, is_available, source, court_name, price_cents)
    VALUES (v_fac_ok, 'mo-ok-1', v_sport,
            ((v_tue1::text || ' 15:00:00')::timestamp AT TIME ZONE 'America/Toronto'),
            ((v_tue1::text || ' 16:00:00')::timestamp AT TIME ZONE 'America/Toronto'),
            true, 'mo-seed', 'Terrain 1', 1400);

    -- Another is covered at that exact hour and every court is taken, which is
    -- the case that used to read as "souvent libre" -> "Terrains reserves".
    INSERT INTO facility_availability_snapshot
      (facility_id, external_court_id, sport_id, slot_start, slot_end, is_available, source, court_name)
    SELECT v_fac_full, 'mo-full-' || c, v_sport,
           ((v_tue1::text || ' 15:00:00')::timestamp AT TIME ZONE 'America/Toronto'),
           ((v_tue1::text || ' 16:00:00')::timestamp AT TIME ZONE 'America/Toronto'),
           false, 'mo-seed', 'Court ' || c
      FROM unnest(ARRAY['A', 'B']) c;

    -- Neither publishes anything past that Tuesday, so the following Tuesday is
    -- "Dispo a venir", and the third favorite has no feed at all -> "Terrain a
    -- confirmer".

    -- =======================================================================
    -- 3. [MO] Partie a deux — direct chat, opponent has posted and voted
    -- =======================================================================
    INSERT INTO conversation (conversation_type, title, created_by)
    VALUES ('direct', NULL, v_rich)
    RETURNING id INTO v_conv;

    INSERT INTO conversation_participant (conversation_id, player_id)
    VALUES (v_conv, v_me), (v_conv, v_rich);

    SELECT jsonb_agg(jsonb_build_object(
             'slot_start', o.slot_start, 'day_label', o.day_label,
             'hour_of_day', o.hour_of_day, 'facility_id', o.facility_id,
             'facility_name', o.facility_name, 'court_name', o.court_name,
             'court_count', COALESCE(o.court_count, 0), 'price_cents', o.price_cents,
             'court_confirmed', o.court_confirmed, 'court_state', o.court_state,
             'tier', CASE WHEN o.tier = 'bookable' THEN 'bookable' ELSE 'usually_free' END,
             'distance_km', o.distance_km, 'free_count', o.free_count,
             'option_key', o.option_key)
           ORDER BY o.court_confirmed DESC, o.slot_start)
      INTO v_opts
      FROM public.match_organizer_options(ARRAY[v_me, v_rich], v_sport, 14, 6) o;

    INSERT INTO message (conversation_id, sender_id, content, status, message_type, metadata)
    VALUES (v_conv, v_rich, 'Suggestions d''heures pour jouer', 'sent', 'match_organizer',
            jsonb_build_object(
              'kind', 'match_organizer', 'sport_id', v_sport, 'sport_name', 'Tennis',
              'format', 'singles', 'participant_ids', to_jsonb(ARRAY[v_me, v_rich]),
              'organizer_id', v_rich, 'posted_by', 'player',
              'options', COALESCE(v_opts, '[]'::jsonb),
              'created_match_id', NULL, 'confirmed_option_index', NULL))
    RETURNING id INTO v_msg;

    -- She only has to agree with one of them.
    INSERT INTO match_time_vote (message_id, player_id, option_index)
    SELECT v_msg, v_rich, i FROM generate_series(0, LEAST(2, jsonb_array_length(COALESCE(v_opts,'[]'::jsonb))) - 1) i
    ON CONFLICT DO NOTHING;

    RAISE NOTICE '[MO] Partie a deux -> conversation %, card %', v_conv, v_msg;

    -- =======================================================================
    -- 4. Three tournaments. Robert organizes; she is only ever a player.
    -- =======================================================================
    INSERT INTO admin (id, role) VALUES (v_org, 'support') ON CONFLICT (id) DO NOTHING;

    FOR v_n IN 1..3 LOOP
        PERFORM set_config('request.jwt.claims',
                 json_build_object('sub', v_org::text)::text, true);
        SELECT * INTO v_t FROM public.tournament_create(
            CASE v_n WHEN 1 THEN '[MO] Tournoi suggestions'
                     WHEN 2 THEN '[MO] Tournoi sans plage'
                     ELSE '[MO] Tournoi terrains' END,
            v_sport, 4::smallint, now() + interval '1 day', now() + interval '25 days');

        SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
        PERFORM public.tournament_open_registration(v_t.id, v_ver);

        -- Seed order decides the bracket, so she meets the intended opponent in
        -- round 1: seed 1 plays seed 4.
        v_regs := ARRAY[]::uuid[];
        FOREACH v_conv IN ARRAY ARRAY[
            v_me,
            v_fill1,
            v_fill2,
            CASE v_n WHEN 1 THEN v_rich WHEN 2 THEN v_none ELSE v_chips END
        ] LOOP
            PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_conv::text)::text, true);
            PERFORM public.tournament_register(v_t.id, NULL);
            v_regs := v_regs || (SELECT id FROM tournament_registrations
                                  WHERE tournament_id = v_t.id AND user_id = v_conv);
        END LOOP;

        PERFORM set_config('request.jwt.claims',
                 json_build_object('sub', v_org::text)::text, true);
        SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
        PERFORM public.tournament_close_registration(v_t.id, v_ver);
        SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
        PERFORM public.tournament_set_seeds(v_t.id, v_regs, v_ver);
        SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
        -- Publishing is what auto-creates the round chats and posts the cards.
        PERFORM public.tournament_generate_bracket(v_t.id, v_ver);

        SELECT tm.id INTO v_tm
          FROM tournament_matches tm
          JOIN tournament_registrations r
            ON r.id IN (tm.player1_registration_id, tm.player2_registration_id)
         WHERE tm.tournament_id = v_t.id AND tm.round_number = 1 AND r.user_id = v_me
         LIMIT 1;

        SELECT m.id INTO v_msg
          FROM message m JOIN conversation c ON c.id = m.conversation_id
         WHERE c.tournament_match_id = v_tm AND m.message_type = 'match_organizer'
         LIMIT 1;

        -- Pre-vote the opponent on the suggestions card so agreeing is one tap.
        IF v_n = 1 AND v_msg IS NOT NULL THEN
            INSERT INTO match_time_vote (message_id, player_id, option_index)
            SELECT v_msg, v_rich, i FROM generate_series(0, 1) i
            ON CONFLICT DO NOTHING;
        END IF;

        RAISE NOTICE '%  -> tournament_match %, card %', v_t.name, v_tm, COALESCE(v_msg::text, 'NONE');
    END LOOP;

    -- =======================================================================
    -- 5. [MO] Ligue — a session pairing chat
    -- =======================================================================
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_l FROM public.league_create(
        p_name => '[MO] Ligue', p_sport_id => v_sport,
        p_visibility => 'public', p_join_mode => 'open');

    DELETE FROM admin WHERE id = v_org;   -- back to an ordinary player

    FOREACH v_conv IN ARRAY ARRAY[v_me, v_rich] LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_conv::text)::text, true);
        PERFORM public.league_join(v_l.id);
    END LOOP;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_sea FROM public.season_create(v_l.id, 'Saison test', current_date, current_date + 60);
    SELECT * INTO v_sea FROM public.season_open(v_sea.id, v_sea.version);
    SELECT * INTO v_sess FROM public.session_create(v_sea.id, 'Semaine 1', now() + interval '3 days');
    SELECT * INTO v_sess FROM public.session_publish(v_sess.id, NULL, v_sess.version);

    FOREACH v_conv IN ARRAY ARRAY[v_me, v_rich] LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_conv::text)::text, true);
        PERFORM public.session_confirm_presence(v_sess.id, 'confirmed');
    END LOOP;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_sess FROM public.session_generate_sheet(v_sess.id, v_sess.version);

    RAISE NOTICE '[MO] Ligue -> session %, open it from the session sheet', v_sess.id;

    PERFORM set_config('request.jwt.claims', NULL, true);
END
$seed$;


-- ---------------------------------------------------------------------------
-- Solo-testing helper: make every other participant agree with whatever you
-- voted, so any card can reach "Creer la partie" without a second device.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mo_opponent_agrees(p_message_id uuid)
RETURNS int
LANGUAGE plpgsql
AS $fn$
DECLARE
    v_parts uuid[];
    v_added int;
BEGIN
    SELECT array_agg(value::uuid) INTO v_parts
      FROM message m, jsonb_array_elements_text(m.metadata->'participant_ids')
     WHERE m.id = p_message_id;

    IF v_parts IS NULL THEN
        RAISE EXCEPTION 'no match_organizer card with id %', p_message_id;
    END IF;

    WITH voted AS (
        SELECT DISTINCT option_index FROM match_time_vote WHERE message_id = p_message_id
    ), ins AS (
        INSERT INTO match_time_vote (message_id, player_id, option_index)
        SELECT p_message_id, p, v.option_index
          FROM voted v, unnest(v_parts) p
        ON CONFLICT DO NOTHING
        RETURNING 1
    )
    SELECT count(*) INTO v_added FROM ins;

    RETURN v_added;
END;
$fn$;

COMMENT ON FUNCTION public.mo_opponent_agrees(uuid) IS
    'LOCAL DEV ONLY (scripts/organizer/seed-match-organizer-local.sql). Votes every card participant onto every option that already has a vote, so one tester can reach mutual agreement alone.';


-- ---------------------------------------------------------------------------
-- What was built
-- ---------------------------------------------------------------------------
SELECT t.name AS fixture,
       c.id   AS conversation_id,
       m.id   AS card_message_id,
       jsonb_array_length(COALESCE(m.metadata->'options', '[]'::jsonb)) AS options,
       COALESCE(m.metadata->>'no_overlap', 'false') AS no_overlap,
       (SELECT count(*) FROM match_time_vote v WHERE v.message_id = m.id) AS votes_already_cast
  FROM tournaments t
  JOIN tournament_matches tm ON tm.tournament_id = t.id
  JOIN conversation c ON c.tournament_match_id = tm.id
  LEFT JOIN message m ON m.conversation_id = c.id AND m.message_type = 'match_organizer'
  JOIN tournament_registrations r
    ON r.id IN (tm.player1_registration_id, tm.player2_registration_id)
  JOIN auth.users u ON u.id = r.user_id AND u.email = 'lefrancmathis2@gmail.com'
 WHERE t.name LIKE '[MO]%'
UNION ALL
SELECT '[MO] Partie a deux', c.id, m.id,
       jsonb_array_length(COALESCE(m.metadata->'options', '[]'::jsonb)),
       'false',
       (SELECT count(*) FROM match_time_vote v WHERE v.message_id = m.id)
  FROM conversation c
  JOIN message m ON m.conversation_id = c.id AND m.message_type = 'match_organizer'
 WHERE c.conversation_type = 'direct'
   AND EXISTS (SELECT 1 FROM conversation_participant cp
                JOIN auth.users u ON u.id = cp.player_id
               WHERE cp.conversation_id = c.id AND u.email = 'lefrancmathis2@gmail.com')
   AND c.created_by = 'a1000000-0000-0000-0000-000000000098'
 ORDER BY 1;
