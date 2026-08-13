-- ============================================
-- Match Organizer — why a slot has no confirmed court
-- ============================================
-- Covers 20260812270000_match_organizer_court_state.
--
-- The card used to say "Souvent libre" for every slot without a confirmed court,
-- which merged two opposite truths: a date the facility feed has not published
-- yet (a court may still open) and an hour the feed covers where every court is
-- already taken. Source A only selects rows where is_available, so the fully
-- booked hour fell through to source B and inherited the reassuring label.
--
-- Fixture: two players free at exactly 19:00 every day, so each (facility, date)
-- has exactly one candidate hour and nothing can outrank the row under test.
--
--   F1 tomorrow  19:00  one OPEN court                  -> 'confirmed'
--   F1 +2 days   19:00  rows exist, none available      -> 'booked'
--   F1 +5 days   19:00  past F1's published horizon     -> 'not_published_yet'
--   F2 any date  19:00  facility publishes nothing      -> 'untracked'
--
-- Plus: a slot we can SEE is taken must rank below one we merely do not know
-- about, and `tier` must keep its old two values for anything still reading it.
--
-- Run: psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/match_organizer_court_state_test.sql
--
-- One transaction, ROLLBACK at the end.
-- ============================================

BEGIN;

DO $$
DECLARE
    v_sport   uuid;
    v_org     uuid;
    v_p       uuid[];
    v_f1      uuid;
    v_f2      uuid;
    v_d1      date;
    v_d2      date;
    v_d3      date;
    v_hour    int := 19;
    v_state   text;
    v_tiers   text[];
    v_booked  double precision;
    v_unpub   double precision;
    v_n       int;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT id INTO v_org   FROM organization LIMIT 1;

    SELECT array_agg(player_id) INTO v_p FROM (
      SELECT ps.player_id FROM player_sport ps
       WHERE ps.sport_id = v_sport AND ps.is_active = true
       ORDER BY ps.player_id LIMIT 2) t;
    ASSERT array_length(v_p, 1) = 2, 'need two tennis players';

    -- Location-less players, so ONLY favorited facilities become candidates and
    -- the seeded facility set cannot leak into the result.
    UPDATE player SET latitude = NULL, longitude = NULL WHERE id = ANY(v_p);

    -- Free at exactly one hour a day: one candidate hour per (facility, date).
    DELETE FROM player_availability WHERE player_id = ANY(v_p);
    INSERT INTO player_availability (player_id, day, hour_of_day, is_active)
    SELECT p, d, v_hour, true
      FROM unnest(v_p) p,
           unnest(ARRAY['monday','tuesday','wednesday','thursday','friday',
                        'saturday','sunday']::day_enum[]) d;

    INSERT INTO facility (organization_id, name, slug, latitude, longitude, location, timezone)
    VALUES (v_org, '[TEST-CS] Tracked', 'test-cs-tracked-' || gen_random_uuid(),
            45.53, -73.61,
            extensions.ST_SetSRID(extensions.ST_MakePoint(-73.61, 45.53), 4326),
            'America/Toronto')
    RETURNING id INTO v_f1;

    INSERT INTO facility (organization_id, name, slug, latitude, longitude, location, timezone)
    VALUES (v_org, '[TEST-CS] Untracked', 'test-cs-untracked-' || gen_random_uuid(),
            45.54, -73.62,
            extensions.ST_SetSRID(extensions.ST_MakePoint(-73.62, 45.54), 4326),
            'America/Toronto')
    RETURNING id INTO v_f2;

    DELETE FROM player_favorite_facility WHERE player_id = ANY(v_p) AND sport_id = v_sport;
    INSERT INTO player_favorite_facility (player_id, facility_id, sport_id)
    SELECT p, f, v_sport FROM unnest(v_p) p, unnest(ARRAY[v_f1, v_f2]) f;

    v_d1 := (now() AT TIME ZONE 'America/Toronto')::date + 1;
    v_d2 := (now() AT TIME ZONE 'America/Toronto')::date + 2;
    v_d3 := (now() AT TIME ZONE 'America/Toronto')::date + 5;

    -- F1 tomorrow: one genuinely open court.
    INSERT INTO facility_availability_snapshot
        (facility_id, external_court_id, sport_id, slot_start, slot_end, is_available, source, court_name)
    VALUES (v_f1, 'court-1', v_sport,
            ((v_d1::text || ' 19:00:00')::timestamp AT TIME ZONE 'America/Toronto'),
            ((v_d1::text || ' 20:00:00')::timestamp AT TIME ZONE 'America/Toronto'),
            true, 'test', 'Court 1');

    -- F1 in two days: the feed covers 19:00 and every court is taken. This is the
    -- case that used to read as "usually free".
    INSERT INTO facility_availability_snapshot
        (facility_id, external_court_id, sport_id, slot_start, slot_end, is_available, source, court_name)
    SELECT v_f1, c, v_sport,
           ((v_d2::text || ' 19:00:00')::timestamp AT TIME ZONE 'America/Toronto'),
           ((v_d2::text || ' 20:00:00')::timestamp AT TIME ZONE 'America/Toronto'),
           false, 'test', c
      FROM unnest(ARRAY['court-1', 'court-2']) c;

    -- Nothing beyond v_d2 for F1, so v_d2 19:00 IS its published horizon.
    -- F2 gets no rows at all.

    CREATE TEMP TABLE cs_opts ON COMMIT DROP AS
      SELECT * FROM public.match_organizer_options(v_p, v_sport, 14, 200);

    SELECT count(*) INTO v_n FROM cs_opts;
    ASSERT v_n > 0, 'the engine must return something for this fixture';
    ASSERT NOT EXISTS (SELECT 1 FROM cs_opts WHERE facility_id NOT IN (v_f1, v_f2)),
        'only the two favorited facilities may appear';

    -- 1. a real open court
    SELECT court_state INTO v_state FROM cs_opts
     WHERE facility_id = v_f1 AND slot_start::date = v_d1;
    ASSERT v_state = 'confirmed',
        format('an open court must read confirmed, got %s', COALESCE(v_state, 'NULL'));
    ASSERT (SELECT court_confirmed AND tier = 'bookable' FROM cs_opts
             WHERE facility_id = v_f1 AND slot_start::date = v_d1),
        'a confirmed slot keeps court_confirmed and the bookable tier';

    -- 2. the feed covers this hour and everything is taken
    SELECT court_state INTO v_state FROM cs_opts
     WHERE facility_id = v_f1 AND slot_start::date = v_d2;
    ASSERT v_state = 'booked',
        format('a fully booked hour must read booked, not a free-sounding label, got %s',
               COALESCE(v_state, 'NULL'));
    ASSERT (SELECT NOT court_confirmed FROM cs_opts
             WHERE facility_id = v_f1 AND slot_start::date = v_d2),
        'a booked slot has no confirmed court';

    -- 3. past this facility's horizon: availability may still be published
    SELECT court_state INTO v_state FROM cs_opts
     WHERE facility_id = v_f1 AND slot_start::date = v_d3;
    ASSERT v_state = 'not_published_yet',
        format('a slot past the feed horizon must read not_published_yet, got %s',
               COALESCE(v_state, 'NULL'));

    -- 4. a facility the feed never covers is never "too early", just unknown
    SELECT court_state INTO v_state FROM cs_opts
     WHERE facility_id = v_f2 AND slot_start::date = v_d1;
    ASSERT v_state = 'untracked',
        format('an uncovered facility must read untracked, got %s', COALESCE(v_state, 'NULL'));
    ASSERT NOT EXISTS (SELECT 1 FROM cs_opts
                        WHERE facility_id = v_f2 AND court_state = 'not_published_yet'),
        'a facility with no feed at all must never claim availability is coming';

    -- 5. a slot we can see is taken ranks below one we simply do not know about
    SELECT score INTO v_booked FROM cs_opts
     WHERE facility_id = v_f1 AND slot_start::date = v_d2;
    SELECT score INTO v_unpub FROM cs_opts
     WHERE facility_id = v_f1 AND slot_start::date = v_d3;
    ASSERT v_booked < v_unpub,
        format('booked (%s) must rank below not_published_yet (%s)', v_booked, v_unpub);

    -- 6. tier stays a two-value field for anything still reading it
    SELECT array_agg(DISTINCT tier) INTO v_tiers FROM cs_opts;
    ASSERT v_tiers <@ ARRAY['bookable', 'usually_free'],
        format('tier must stay bookable/usually_free, got %s', v_tiers::text);

    -- 7. the defect this migration fixes, stated outright: `tier` gives the
    -- booked hour and the unpublished date the SAME value, which is why one
    -- label served both and why the card could call a full facility free.
    -- court_state is what tells them apart.
    ASSERT (SELECT tier FROM cs_opts WHERE facility_id = v_f1 AND slot_start::date = v_d2)
         = (SELECT tier FROM cs_opts WHERE facility_id = v_f1 AND slot_start::date = v_d3),
        'the two cases are expected to share a tier — that is the whole problem';
    ASSERT (SELECT court_state FROM cs_opts WHERE facility_id = v_f1 AND slot_start::date = v_d2)
        <> (SELECT court_state FROM cs_opts WHERE facility_id = v_f1 AND slot_start::date = v_d3),
        'court_state must separate what tier cannot';

    -- 8. a feed that has stopped updating also has a short horizon, and must not
    -- be read as "availability is coming". It degrades to 'untracked'.
    UPDATE facility_availability_snapshot
       SET refreshed_at = now() - interval '3 days'
     WHERE facility_id = v_f1;

    CREATE TEMP TABLE cs_stale ON COMMIT DROP AS
      SELECT * FROM public.match_organizer_options(v_p, v_sport, 14, 200);

    SELECT court_state INTO v_state FROM cs_stale
     WHERE facility_id = v_f1 AND slot_start::date = v_d3;
    ASSERT v_state = 'untracked',
        format('a stale feed must not promise availability is coming, got %s',
               COALESCE(v_state, 'NULL'));
    ASSERT (SELECT court_state FROM cs_stale
             WHERE facility_id = v_f1 AND slot_start::date = v_d2) = 'booked',
        'a stale feed does not change what we can still see is taken';

    RAISE NOTICE 'PASS: court_state separates confirmed / booked / not_published_yet / untracked, and a stale feed degrades';
END $$;

ROLLBACK;
