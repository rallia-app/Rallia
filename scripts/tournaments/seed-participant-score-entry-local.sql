-- ============================================================================
-- [PSE] Participant score entry — local test fixtures
-- ============================================================================
-- Seeds the states the 2026-08-30 work needs a human to look at: a pairing the
-- two players can settle themselves (no game was ever created for it), reached
-- either from the bracket ("Enter the score manually" in the link sheet) or
-- straight from the pairing chat (the "Enter the score" banner).
--
-- The tester is a PLAIN PARTICIPANT in every fixture, never the organizer:
-- is_admin() and is_tournament_organizer() both bypass the participant guards,
-- so an organizer-owned fixture would prove nothing. Each tournament is run by
-- a seeded player who holds staff only for the create call.
--
-- Fixtures (all tennis, all in_progress):
--   [PSE] 1 · Simple    singles 4p   — one open pairing + its round chat
--   [PSE] 2 · Double    doubles 4t   — pair names render as "A & B"
--   [PSE] 3 · Poule     pool 8p      — 3 pool pairings, ONE already scored by
--                                      the organizer (the negative control:
--                                      that chat must show no banner)
--
-- Usage (local only):
--   SEED_PSE_EMAIL=you@example.com npm run db:seed:pse
--   -- or --
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -v seed_email=you@example.com \
--        -f scripts/tournaments/seed-participant-score-entry-local.sql
--
-- Re-runnable: drops every prior [PSE] tournament first (conversations cascade).
-- ============================================================================

\set ON_ERROR_STOP on
\if :{?seed_email}
\else
  \set seed_email 'lefrancmathis@gmail.com'
\endif

BEGIN;

-- Event creation is staff-only (20260812150000). Staff is granted around the
-- create call and dropped straight after, so the organizer stays an ordinary
-- player and the authz paths under test stay honest.
CREATE OR REPLACE FUNCTION pg_temp.staff_on(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO admin (id, role) VALUES (p, 'support') ON CONFLICT (id) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION pg_temp.staff_off(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM admin WHERE id = p;
$$;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user::text)::text, true);
END $$;

-- psql only interpolates in plain statements, never inside a function body, so
-- the chosen email is parked in a temp row the helpers can read.
CREATE TEMP TABLE pse_cfg ON COMMIT PRESERVE ROWS AS SELECT :'seed_email'::text AS email;

-- The tester, and a bench of seeded players to fill the draws around them.
CREATE OR REPLACE FUNCTION pg_temp.tester() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT p.id FROM profile p JOIN pse_cfg c ON c.email = p.email;
$$;

CREATE OR REPLACE FUNCTION pg_temp.bench(p_n int) RETURNS uuid[]
LANGUAGE sql STABLE AS $$
  SELECT array_agg(id ORDER BY id) FROM (
    SELECT p.id
      FROM player_sport ps
      JOIN player p ON p.id = ps.player_id
      JOIN profile pr ON pr.id = p.id
     WHERE ps.sport_id = (SELECT id FROM sport WHERE name = 'tennis')
       AND ps.is_active
       AND NOT public.is_admin(p.id)
       AND p.id <> pg_temp.tester()
       AND COALESCE(pr.first_name, '') <> ''
       -- The a1000000-* block is the generated fixture cast (real-looking
       -- Quebecois names). Ordinary local logins are excluded on purpose: a
       -- draw full of "Test 124" reads badly, and the tester's own alternate
       -- accounts have no business being dragged into a fixture.
       AND p.id::text LIKE 'a1000000-%'
     ORDER BY p.id
     LIMIT p_n) s;
$$;

DO $$
BEGIN
  IF pg_temp.tester() IS NULL THEN
    RAISE EXCEPTION 'No profile for %. Pass -v seed_email=<your local email>.',
      (SELECT email FROM pse_cfg);
  END IF;
  IF public.is_admin(pg_temp.tester()) THEN
    RAISE WARNING 'Heads up: % is staff locally, so is_admin() bypasses the participant guards and you would exercise the ORGANIZER path instead.',
      (SELECT email FROM pse_cfg);
  END IF;
END $$;

-- Clean slate: conversations and matches cascade off the tournament.
DELETE FROM tournaments WHERE name LIKE '[PSE]%';

-- ---------------------------------------------------------------------------
-- Shared builder: create + open + register + close + generate, returning the
-- tournament and the tester's own round-1 (or pool) pairing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.mk_tournament(
    p_name          text,
    p_entry         entry_format,
    p_bracket       bracket_type,
    p_slots         smallint,
    p_others        uuid[],          -- one entry per opposing slot
    p_tester_partner uuid DEFAULT NULL,
    p_partners      uuid[] DEFAULT NULL,
    p_pool_size     smallint DEFAULT NULL,
    p_qualifiers    smallint DEFAULT NULL,
    OUT o_tid       uuid,
    OUT o_org       uuid
)
LANGUAGE plpgsql AS $$
DECLARE
    v_sport uuid;
    v_t     tournaments;
    v_i     int;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    -- The organizer is a bench player the tester is NOT, so the tester stays a
    -- plain participant on every pairing.
    o_org := p_others[array_length(p_others, 1)];

    PERFORM pg_temp.as_user(o_org);
    PERFORM pg_temp.staff_on(o_org);
    SELECT * INTO v_t FROM tournament_create(
        p_name              => p_name,
        p_sport_id          => v_sport,
        p_max_participants  => p_slots,
        p_start_date        => now() - interval '1 day',
        p_end_date          => now() + interval '6 days',
        p_description       => 'Fixture for participant score entry. You are a player, not the organizer.',
        p_visibility        => 'public',
        p_registration_mode => 'open',
        p_bracket_type      => p_bracket,
        p_entry_format      => p_entry,
        p_city              => 'Montréal',
        p_venue_name        => 'Parc Jarry',
        p_pool_size         => p_pool_size,
        p_qualifiers_per_pool => p_qualifiers);
    PERFORM pg_temp.staff_off(o_org);
    o_tid := v_t.id;

    SELECT * INTO v_t FROM tournament_open_registration(o_tid, v_t.version);

    -- The tester enters first so they land high in the draw.
    PERFORM pg_temp.as_user(pg_temp.tester());
    PERFORM tournament_register(o_tid, p_tester_partner);

    -- Then the opposition. The last bench entry is the organizer, who does not
    -- play: it registers only when the draw needs that slot filled.
    FOR v_i IN 1 .. array_length(p_others, 1) - 1 LOOP
        PERFORM pg_temp.as_user(p_others[v_i]);
        PERFORM tournament_register(o_tid, CASE WHEN p_partners IS NULL THEN NULL ELSE p_partners[v_i] END);
    END LOOP;

    PERFORM pg_temp.as_user(o_org);
    SELECT * INTO v_t FROM tournament_close_registration(o_tid, v_t.version);
    -- A pool draw is generated by its own RPC; tournament_generate_bracket
    -- refuses one outright (POOL_STAGE_REQUIRED) since the knockout half is
    -- only cut over once the pools have been played.
    IF p_bracket = 'pool_knockout' THEN
        PERFORM tournament_generate_pools(o_tid, v_t.version);
    ELSE
        PERFORM tournament_generate_bracket(o_tid, v_t.version);
    END IF;

    SELECT * INTO v_t FROM tournaments WHERE id = o_tid;
    ASSERT v_t.status = 'in_progress',
        format('%s should be in_progress, got %s', p_name, v_t.status);
END $$;

-- Every pairing the tester is on, in draw order.
CREATE OR REPLACE FUNCTION pg_temp.my_matches(p_tid uuid) RETURNS SETOF tournament_matches
LANGUAGE sql STABLE AS $$
  SELECT tm.*
    FROM tournament_matches tm
   WHERE tm.tournament_id = p_tid
     AND NOT tm.player1_is_bye AND NOT tm.player2_is_bye
     AND tm.player1_registration_id IS NOT NULL
     AND tm.player2_registration_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM tournament_registrations tr
        WHERE tr.id IN (tm.player1_registration_id, tm.player2_registration_id)
          AND pg_temp.tester() IN (tr.user_id, tr.partner_user_id))
   ORDER BY tm.round_number, tm.match_position;
$$;

-- ---------------------------------------------------------------------------
-- [PSE] 1 · Simple — the headline case
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_tid uuid; v_org uuid; v_b uuid[]; v_m tournament_matches; v_conv uuid;
BEGIN
    v_b := pg_temp.bench(4);
    SELECT o_tid, o_org INTO v_tid, v_org
      FROM pg_temp.mk_tournament('[PSE] 1 · Simple', 'singles', 'single_elimination',
                                 4::smallint, v_b);

    SELECT * INTO v_m FROM pg_temp.my_matches(v_tid) LIMIT 1;
    ASSERT v_m.id IS NOT NULL, 'the tester must have a pairing in [PSE] 1';

    -- Pre-create the pairing chat so the banner is one tap from the inbox.
    PERFORM pg_temp.as_user(pg_temp.tester());
    v_conv := get_or_create_tournament_round_chat(v_m.id);

    RAISE NOTICE '[PSE] 1 · Simple      tournament=%  match=%  chat=%', v_tid, v_m.id, v_conv;
END $$;

-- ---------------------------------------------------------------------------
-- [PSE] 2 · Double — pair names ("A & B") on both sides of the sheet
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_tid uuid; v_org uuid; v_all uuid[]; v_others uuid[]; v_partners uuid[];
    v_m tournament_matches; v_conv uuid;
BEGIN
    -- 4 teams: the tester + partner, 3 opposing pairs, and an organizer who
    -- does not play. 1 + 3*2 + 1 = 8 bench players needed.
    v_all := pg_temp.bench(8);
    v_others  := ARRAY[v_all[2], v_all[4], v_all[6], v_all[8]];  -- captains + organizer
    v_partners := ARRAY[v_all[3], v_all[5], v_all[7]];           -- their partners

    SELECT o_tid, o_org INTO v_tid, v_org
      FROM pg_temp.mk_tournament('[PSE] 2 · Double', 'doubles', 'single_elimination',
                                 4::smallint, v_others,
                                 p_tester_partner => v_all[1],
                                 p_partners => v_partners);

    SELECT * INTO v_m FROM pg_temp.my_matches(v_tid) LIMIT 1;
    ASSERT v_m.id IS NOT NULL, 'the tester must have a pairing in [PSE] 2';

    PERFORM pg_temp.as_user(pg_temp.tester());
    v_conv := get_or_create_tournament_round_chat(v_m.id);

    RAISE NOTICE '[PSE] 2 · Double      tournament=%  match=%  chat=%', v_tid, v_m.id, v_conv;
END $$;

-- ---------------------------------------------------------------------------
-- [PSE] 3 · Poule — several pairings at once, one already settled
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_tid uuid; v_org uuid; v_b uuid[];
    v_open tournament_matches; v_scored tournament_matches;
    v_conv_open uuid; v_conv_scored uuid; v_n int;
BEGIN
    v_b := pg_temp.bench(8);
    SELECT o_tid, o_org INTO v_tid, v_org
      FROM pg_temp.mk_tournament('[PSE] 3 · Poule', 'singles', 'pool_knockout',
                                 8::smallint, v_b,
                                 p_pool_size => 4::smallint,
                                 p_qualifiers => 2::smallint);

    SELECT count(*) INTO v_n FROM pg_temp.my_matches(v_tid);
    ASSERT v_n >= 2, format('expected the tester in >= 2 pool pairings, got %s', v_n);

    -- The organizer settles the FIRST one: that chat is the negative control,
    -- it must show no banner (reason ALREADY_SCORED).
    SELECT * INTO v_scored FROM pg_temp.my_matches(v_tid) LIMIT 1;
    PERFORM pg_temp.as_user(pg_temp.tester());
    v_conv_scored := get_or_create_tournament_round_chat(v_scored.id);

    PERFORM pg_temp.as_user(v_org);
    PERFORM tournament_override_score(v_scored.id, v_scored.player1_registration_id, '6-2 6-1');

    -- ...and the next one stays open, with its chat ready.
    SELECT * INTO v_open FROM pg_temp.my_matches(v_tid) OFFSET 1 LIMIT 1;
    PERFORM pg_temp.as_user(pg_temp.tester());
    v_conv_open := get_or_create_tournament_round_chat(v_open.id);

    RAISE NOTICE '[PSE] 3 · Poule       tournament=%  pairings=%', v_tid, v_n;
    RAISE NOTICE '[PSE] 3   open   match=%  chat=%  (banner EXPECTED)', v_open.id, v_conv_open;
    RAISE NOTICE '[PSE] 3   scored match=%  chat=%  (banner must NOT show)', v_scored.id, v_conv_scored;
END $$;

COMMIT;
