-- ============================================================================
-- Pool + knockout ([JDL-PK]) — fixtures 7 to 12
--
-- The original 1-6 set covers the happy path Jean can drive himself: register
-- (1), pools running with his own games to link (2), a deadline countdown (3),
-- organizer launches the draw with byes (4), knockout live (5), completed with
-- Points Rallia (6). This script adds the cases he cannot reach from the app,
-- each of which exercises a distinct branch of the format:
--
--   7  · Poules inégales (14 joueurs)  → 14 entrants make pools of [4,4,3,3];
--        Jean sits in a pool of 3, so he plays 2 games where others play 3 and
--        the standings must compare them on RATIOS, not raw counts (spec §8).
--        One game is attached to a REAL match with a verified score, which is
--        the format's primary score path (§6) and was not represented anywhere
--        in the seeded data before.
--   8  · Forfait et partie annulée     → an opponent in Jean's pool is
--        forfeited by the organizer: his remaining games become walkover wins,
--        the forfeited player drops last and ineligible (§6, §11). Also holds
--        one CANCELLED pool game, the "neither player at fault" outcome (§6).
--   9  · Doubles                        → 8 pairs. The set and game counters
--        collapse a pair to one team side; nothing exercised that before.
--   10 · Un seul qualifié par poule     → qualifiers_per_pool = 1: only pool
--        winners advance, so the qualifier band highlights a single row.
--   11 · Grand tableau (32 joueurs)     → 8 pools, 16 qualifiers, exact
--        16-draw, knockout already generated. This is the size where the
--        runner-up draw used to give up and silently let two players from one
--        pool meet before the final (~38% of draws, fixed in migration
--        20260811160000). Every pool's two qualifiers must sit in opposite
--        halves here.
--   12 · Pickleball                     → the points_per_game scoring path on
--        a pool draw.
--
-- Idempotent: the fixtures are dropped by exact name and rebuilt. Safe to
-- re-run before any protocol pass. It does NOT touch fixtures 1-6, so Jean can
-- be mid-test on those; the trailing re-arm block only refreshes their clocks.
--
-- Built through the real RPCs (create → open → register → close →
-- generate_pools → override_score → generate_knockout) rather than row
-- inserts, so seeding itself proves the code path works. Consequence: it
-- fires real notifications. Registration notices land on each fixture's
-- organizer, which is a @fake-rallia.com account with no push token, so Jean
-- only hears about games he is actually in. That is intended.
--
-- Organizers are spread one fake per fixture: tournament_create rate-limits a
-- non-admin organizer to 5 tournaments per 24 h.
--
-- Run: npm run db:seed:tournaments:pools     (needs STAGING_DB_URL)
--   or paste into the Supabase SQL editor on rallia-staging.
-- Cleanup: the DO block below, or delete the six names in F_NAMES.
-- ============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p::text)::text, true)::void;
$$;

-- Deterministic slice of fake players for a sport, so re-runs reuse the same
-- rosters and the fixtures stay comparable between passes.
CREATE OR REPLACE FUNCTION pg_temp.fakes(p_sport text, p_n integer, p_offset integer)
RETURNS uuid[] LANGUAGE sql AS $$
  SELECT array_agg(id ORDER BY ord) FROM (
    SELECT p.id, row_number() OVER (ORDER BY p.id) AS ord
      FROM profile p
      JOIN player_sport ps ON ps.player_id = p.id
      JOIN sport s ON s.id = ps.sport_id
     WHERE p.email LIKE '%@fake-rallia.com'
       AND s.name = p_sport AND ps.is_active
       AND NOT public.is_admin(p.id)
     ORDER BY p.id
     OFFSET p_offset LIMIT p_n
  ) t;
$$;

-- Settle pool games in seed order (better seed wins). p_limit caps how many
-- get settled so a fixture can be left mid-pools.
CREATE OR REPLACE FUNCTION pg_temp.settle_pools(
    p_t uuid, p_organizer uuid, p_score text, p_limit integer DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
    v_tm    tournament_matches;
    v_seeds uuid[];
    v_u1    uuid;
    v_u2    uuid;
    v_win   uuid;
    v_done  integer := 0;
BEGIN
    v_seeds := ARRAY(
        SELECT tr.id FROM tournament_registrations tr
         WHERE tr.tournament_id = p_t
         ORDER BY tr.seed_rank ASC NULLS LAST, tr.registered_at ASC, tr.id ASC);

    PERFORM pg_temp.as_user(p_organizer);
    FOR v_tm IN
        SELECT * FROM tournament_matches
         WHERE tournament_id = p_t AND bracket_side = 'pool' AND status = 'pending'
         ORDER BY round_number, match_position
    LOOP
        EXIT WHEN p_limit IS NOT NULL AND v_done >= p_limit;
        IF array_position(v_seeds, v_tm.player1_registration_id)
           <= array_position(v_seeds, v_tm.player2_registration_id) THEN
            v_win := v_tm.player1_registration_id;
        ELSE
            v_win := v_tm.player2_registration_id;
        END IF;
        PERFORM public.tournament_override_score(v_tm.id, v_win, p_score);
        v_done := v_done + 1;
    END LOOP;
    RETURN v_done;
END;
$$;

-- Create → open → register everyone → close → generate pools.
CREATE OR REPLACE FUNCTION pg_temp.build(
    p_name       text,
    p_sport      text,
    p_size       smallint,
    p_organizer  uuid,
    p_players    uuid[],
    p_partners   uuid[]  DEFAULT NULL,
    p_qualifiers smallint DEFAULT 2,
    p_format     text    DEFAULT 'singles',
    p_mformat    text    DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_t     tournaments;
    v_ver   integer;
    v_order uuid[];
BEGIN
    PERFORM pg_temp.as_user(p_organizer);
    SELECT * INTO v_t FROM public.tournament_create(
        p_name,
        (SELECT id FROM sport WHERE name = p_sport),
        p_size,
        now() + interval '6 days',
        now() + interval '34 days',
        p_description       => 'Fixture de test — poules puis éliminatoires.',
        p_visibility        => 'public',
        p_registration_mode => 'open',
        p_bracket_type      => 'pool_knockout',
        p_match_format      => p_mformat::match_format,
        p_entry_format      => p_format::entry_format,
        p_city              => 'Grand Montréal',
        p_qualifiers_per_pool => p_qualifiers);

    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_open_registration(v_t.id, v_ver);

    FOR i IN 1..array_length(p_players, 1) LOOP
        PERFORM pg_temp.as_user(p_players[i]);
        PERFORM public.tournament_register(
            v_t.id,
            CASE WHEN p_partners IS NULL THEN NULL ELSE p_partners[i] END);
    END LOOP;

    PERFORM pg_temp.as_user(p_organizer);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_close_registration(v_t.id, v_ver);

    -- Seed explicitly, in p_players order. Everything here runs inside one
    -- transaction, so now() is frozen and every entry shares the same
    -- registered_at; without this the seed order falls through to the
    -- registration uuid and the pool composition would be random on every
    -- run. Seeding makes the whole fixture set reproducible.
    SELECT array_agg(tr.id ORDER BY array_position(p_players, tr.user_id))
      INTO v_order
      FROM tournament_registrations tr
     WHERE tr.tournament_id = v_t.id AND tr.status = 'registered';
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_set_seeds(v_t.id, v_order, v_ver);

    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_generate_pools(v_t.id, v_ver);

    RETURN v_t.id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Cleanup (exact names, so fixtures 1-6 are never touched)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_names text[] := ARRAY[
        '[JDL-PK] 7 · Poules inégales (14 joueurs)',
        '[JDL-PK] 8 · Forfait et partie annulée',
        '[JDL-PK] 9 · Doubles',
        '[JDL-PK] 10 · Un seul qualifié par poule',
        '[JDL-PK] 11 · Grand tableau (32 joueurs)',
        '[JDL-PK] 12 · Pickleball'
    ];
    v_ids uuid[];
BEGIN
    SELECT array_agg(id) INTO v_ids FROM tournaments WHERE name = ANY (v_names);
    IF v_ids IS NULL THEN
        RAISE NOTICE 'cleanup: nothing to remove';
        RETURN;
    END IF;

    -- Refuse to wipe anything that took real money, matching the paid-fixture
    -- scripts' rule. These are free by construction, so this is a tripwire.
    IF EXISTS (
        SELECT 1 FROM lt_registration_payment p
          JOIN tournament_registrations r ON r.id = p.tournament_registration_id
         WHERE r.tournament_id = ANY (v_ids)
    ) THEN
        RAISE EXCEPTION 'a [JDL-PK] 7-12 fixture carries a payment row; aborting';
    END IF;

    DELETE FROM notification n
     WHERE n.payload->>'tournamentId' IN (SELECT id::text FROM unnest(v_ids) AS id);
    DELETE FROM tournament_round_deadlines WHERE tournament_id = ANY (v_ids);
    DELETE FROM tournament_ranking_points  WHERE tournament_id = ANY (v_ids);
    DELETE FROM tournament_matches         WHERE tournament_id = ANY (v_ids);
    DELETE FROM tournament_registrations   WHERE tournament_id = ANY (v_ids);
    DELETE FROM leagues_tournaments_audit
     WHERE scope = 'tournament' AND entity_id = ANY (v_ids);
    DELETE FROM tournaments WHERE id = ANY (v_ids);

    RAISE NOTICE 'cleanup: removed % fixture(s)', array_length(v_ids, 1);
END;
$$;

-- ---------------------------------------------------------------------------
-- The fixtures
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_jean    uuid := (SELECT id FROM profile WHERE email = 'jdl.sonkin@gmail.com');
    v_tn      uuid[];
    v_pk      uuid[];
    v_t       uuid;
    v_ver     integer;
    v_org     uuid;
    v_roster  uuid[];
    v_parts   uuid[];
    v_tm      tournament_matches;
    v_victim  uuid;
    v_match   uuid;
    v_mr      uuid;
    v_u1      uuid;
    v_u2      uuid;
    v_relaxed boolean;
    v_n       integer;
BEGIN
    IF v_jean IS NULL THEN
        RAISE EXCEPTION 'jdl.sonkin@gmail.com not found on this environment';
    END IF;

    -- 101 fake tennis players available; take a wide slice and carve rosters
    -- out of it so no two fixtures share an organizer.
    v_tn := pg_temp.fakes('tennis', 86, 0);
    v_pk := pg_temp.fakes('pickleball', 24, 0);
    IF coalesce(array_length(v_tn, 1), 0) < 86 THEN
        RAISE EXCEPTION 'need 86 fake tennis players, found %',
            coalesce(array_length(v_tn, 1), 0);
    END IF;
    IF coalesce(array_length(v_pk, 1), 0) < 12 THEN
        RAISE EXCEPTION 'need 12 fake pickleball players, found %',
            coalesce(array_length(v_pk, 1), 0);
    END IF;

    -- =====================================================================
    -- 7 · Poules inégales (14 joueurs). 14 entrants → [4,4,3,3].
    -- Jean must land in one of the THREE-player pools: that is the whole
    -- point, he plays 2 games where most others play 3, and the standings
    -- have to compare them on ratios rather than raw counts.
    -- Everyone registers with a NULL seed_rank, so seed order is registration
    -- order, and the serpentine sends seeds 4, 5 and 12 to pool 4 (of size 3).
    -- Registering Jean 5th therefore puts him there. Asserted below, because
    -- if the distribution ever changes this fixture loses its reason to exist.
    -- =====================================================================
    v_org    := v_tn[1];
    v_roster := v_tn[2:5] || v_jean || v_tn[6:14];   -- Jean is the 5th entrant
    v_t := pg_temp.build('[JDL-PK] 7 · Poules inégales (14 joueurs)',
                         'tennis', 16::smallint, v_org, v_roster);

    SELECT count(*) INTO v_n
      FROM public.tournament_pool_standings(v_t) s
     WHERE s.pool_number = (
        SELECT s2.pool_number FROM public.tournament_pool_standings(v_t) s2
         WHERE s2.user_id = v_jean);
    IF v_n <> 3 THEN
        RAISE EXCEPTION '7 · the tester landed in a pool of %, expected 3', v_n;
    END IF;

    -- Settle a bit over half, leaving Jean's pool live so he can act.
    PERFORM pg_temp.settle_pools(v_t, v_org, '6-3 6-4', 9);

    -- One pool game attached to a REAL verified match: the primary score path.
    SELECT tm.* INTO v_tm FROM tournament_matches tm
      JOIN tournament_registrations r1 ON r1.id = tm.player1_registration_id
      JOIN tournament_registrations r2 ON r2.id = tm.player2_registration_id
     WHERE tm.tournament_id = v_t AND tm.bracket_side = 'pool'
       AND tm.status = 'pending'
       AND v_jean NOT IN (r1.user_id, r2.user_id)
     ORDER BY tm.round_number, tm.match_position LIMIT 1;

    IF v_tm.id IS NOT NULL THEN
        SELECT user_id INTO v_u1 FROM tournament_registrations
         WHERE id = v_tm.player1_registration_id;
        SELECT user_id INTO v_u2 FROM tournament_registrations
         WHERE id = v_tm.player2_registration_id;

        INSERT INTO match (sport_id, created_by, match_date, start_time, end_time, format, notes)
        VALUES ((SELECT id FROM sport WHERE name = 'tennis'), v_u1,
                (now() - interval '2 days')::date, '18:00', '19:30', 'singles',
                '[JDL-PK] partie de poule liée')
        RETURNING id INTO v_match;
        INSERT INTO match_participant (match_id, player_id, status)
        VALUES (v_match, v_u1, 'joined'), (v_match, v_u2, 'joined')
        ON CONFLICT (match_id, player_id) DO UPDATE SET status = 'joined';

        PERFORM pg_temp.as_user(v_u1);
        SELECT public.submit_match_result_for_match(
            v_match, v_u1, 1,
            '[{"team1_score": 7, "team2_score": 5}, {"team1_score": 6, "team2_score": 4}]'::jsonb
        ) INTO v_mr;
        UPDATE match_result SET is_verified = true, confirmed_by = v_u2 WHERE id = v_mr;
        PERFORM pg_temp.as_user(v_u1);
        PERFORM public.tournament_attach_match(v_tm.id, v_match);
    END IF;
    RAISE NOTICE '7 · poules inégales: %', v_t;

    -- =====================================================================
    -- 8 · Forfait et partie annulée. Jean plays; the organizer forfeits one
    -- of his pool rivals, so Jean picks up a walkover win and the rival drops
    -- last with a struck-through name. A second game is cancelled outright.
    -- =====================================================================
    v_org    := v_tn[15];
    v_roster := v_tn[16:22] || v_jean;         -- 7 fakes + Jean = 8
    v_t := pg_temp.build('[JDL-PK] 8 · Forfait et partie annulée',
                         'tennis', 8::smallint, v_org, v_roster);

    PERFORM pg_temp.settle_pools(v_t, v_org, '6-2 6-1', 4);

    -- Forfeit a player who still owes Jean a game.
    SELECT r.id INTO v_victim
      FROM tournament_matches tm
      JOIN tournament_registrations r
        ON r.id IN (tm.player1_registration_id, tm.player2_registration_id)
      JOIN tournament_registrations rj
        ON rj.id IN (tm.player1_registration_id, tm.player2_registration_id)
       AND rj.user_id = v_jean
     WHERE tm.tournament_id = v_t AND tm.bracket_side = 'pool'
       AND tm.status = 'pending' AND r.user_id <> v_jean
     LIMIT 1;

    IF v_victim IS NOT NULL THEN
        PERFORM pg_temp.as_user(v_org);
        PERFORM public.tournament_forfeit_registration(
            v_victim,
            (SELECT version FROM tournament_registrations WHERE id = v_victim),
            'Fixture: forfait en cours de poule');
    END IF;

    -- One game neither side is at fault for: cancelled, no score (spec §6).
    UPDATE tournament_matches SET status = 'cancelled', played_at = now(),
           version = version + 1, updated_at = now()
     WHERE id = (SELECT tm.id FROM tournament_matches tm
                  JOIN tournament_registrations r1 ON r1.id = tm.player1_registration_id
                  JOIN tournament_registrations r2 ON r2.id = tm.player2_registration_id
                 WHERE tm.tournament_id = v_t AND tm.bracket_side = 'pool'
                   AND tm.status = 'pending'
                   AND v_jean NOT IN (r1.user_id, r2.user_id)
                 ORDER BY tm.round_number DESC LIMIT 1);
    RAISE NOTICE '8 · forfait + annulée: %', v_t;

    -- =====================================================================
    -- 9 · Doubles. 8 pairs; Jean captains one. max_participants counts
    -- ENTRIES, so 8 means 8 pairs = 16 players.
    -- =====================================================================
    v_org    := v_tn[23];
    v_roster := v_tn[24:30] || v_jean;         -- 8 captains, Jean last
    v_parts  := v_tn[31:38];                   -- 8 partners
    v_t := pg_temp.build('[JDL-PK] 9 · Doubles',
                         'tennis', 8::smallint, v_org, v_roster, v_parts,
                         2::smallint, 'doubles');
    PERFORM pg_temp.settle_pools(v_t, v_org, '6-4 3-6 7-5', 7);
    RAISE NOTICE '9 · doubles: %', v_t;

    -- =====================================================================
    -- 10 · Un seul qualifié par poule. 16 players, 4 pools, qualifiers = 1 →
    -- 4 qualifiers, exact 4-draw. Pools done and the tree already launched so
    -- the "only the winner advances" band is visible next to a live bracket.
    -- =====================================================================
    v_org    := v_tn[39];
    v_roster := v_tn[40:54] || v_jean;         -- 15 fakes + Jean = 16
    v_t := pg_temp.build('[JDL-PK] 10 · Un seul qualifié par poule',
                         'tennis', 16::smallint, v_org, v_roster, NULL, 1::smallint);
    PERFORM pg_temp.settle_pools(v_t, v_org, '6-4 6-2');
    PERFORM pg_temp.as_user(v_org);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t;
    PERFORM public.tournament_generate_knockout(v_t, v_ver);
    RAISE NOTICE '10 · un qualifié par poule: %', v_t;

    -- =====================================================================
    -- 11 · Grand tableau (32 joueurs). 8 pools of 4, 16 qualifiers, exact
    -- 16-draw, knockout generated. The draw fixed in 20260811160000: every
    -- pool's two qualifiers must land in opposite halves.
    -- =====================================================================
    v_org    := v_tn[55];
    v_roster := v_tn[56:86] || v_jean;         -- 31 fakes + Jean = 32
    v_t := pg_temp.build('[JDL-PK] 11 · Grand tableau (32 joueurs)',
                         'tennis', 32::smallint, v_org, v_roster);
    PERFORM pg_temp.settle_pools(v_t, v_org, '6-3 6-3');
    PERFORM pg_temp.as_user(v_org);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t;
    PERFORM public.tournament_generate_knockout(v_t, v_ver);

    SELECT (payload_after->>'half_constraint_relaxed')::boolean INTO v_relaxed
      FROM leagues_tournaments_audit
     WHERE scope = 'tournament' AND entity_id = v_t AND action = 'generate_knockout'
     ORDER BY occurred_at DESC LIMIT 1;
    IF v_relaxed IS DISTINCT FROM false THEN
        RAISE EXCEPTION '32-draw relaxed the same-pool constraint; migration 20260811160000 missing?';
    END IF;
    RAISE NOTICE '11 · grand tableau: %', v_t;

    -- =====================================================================
    -- 12 · Pickleball. Points-per-game scoring on a pool draw.
    -- =====================================================================
    v_org    := v_pk[1];
    v_roster := v_pk[2:8] || v_jean;           -- 7 fakes + Jean = 8
    v_t := pg_temp.build('[JDL-PK] 12 · Pickleball',
                         'pickleball', 8::smallint, v_org, v_roster, NULL,
                         2::smallint, 'singles', 'pickleball_to_11');
    PERFORM pg_temp.settle_pools(v_t, v_org, '11-7 11-9', 5);
    RAISE NOTICE '12 · pickleball: %', v_t;
END;
$$;

-- ---------------------------------------------------------------------------
-- Re-arm the clocks on the whole [JDL-PK] set, fixtures 1-6 included.
--
-- Pool-phase deadlines decay: fixture 3 was seeded at "20 h left" and is a few
-- hours from expiry within a day. Reminders are one-shot too, so a bare
-- deadline bump would not replay the nudge scenario; the stamps are cleared
-- alongside it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_ids uuid[];
    v_n   integer;
BEGIN
    SELECT array_agg(id) INTO v_ids FROM tournaments WHERE name LIKE '[JDL-PK]%';
    IF v_ids IS NULL THEN RETURN; END IF;

    -- Fixture 3 is the countdown: put it back to ~20 h out.
    UPDATE tournament_round_deadlines d
       SET deadline_at = now() + interval '20 hours'
     WHERE d.bracket_side = 'pool'
       AND d.tournament_id IN (SELECT id FROM tournaments WHERE name LIKE '[JDL-PK] 3 %');

    -- Any other pool phase already past its deadline gets a fresh week.
    UPDATE tournament_round_deadlines d
       SET deadline_at = now() + interval '7 days'
     WHERE d.tournament_id = ANY (v_ids)
       AND d.deadline_at < now() + interval '2 hours'
       AND d.tournament_id NOT IN (SELECT id FROM tournaments WHERE name LIKE '[JDL-PK] 3 %');

    UPDATE tournament_matches
       SET deadline_nudge48_at = NULL, deadline_nudge12_at = NULL
     WHERE tournament_id = ANY (v_ids)
       AND status IN ('pending', 'in_progress')
       AND (deadline_nudge48_at IS NOT NULL OR deadline_nudge12_at IS NOT NULL);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE 're-arm: cleared nudge stamps on % unsettled game(s)', v_n;
END;
$$;

-- ---------------------------------------------------------------------------
-- What the tester should see
-- ---------------------------------------------------------------------------

SELECT t.name,
       t.status::text                                   AS statut,
       t.entry_format::text                             AS format,
       t.pool_size || '/' || t.qualifiers_per_pool       AS "poule/qualifiés",
       (SELECT count(DISTINCT pool_number) FROM tournament_matches m
         WHERE m.tournament_id = t.id AND m.bracket_side = 'pool')        AS poules,
       (SELECT count(*) FROM tournament_matches m
         WHERE m.tournament_id = t.id AND m.bracket_side = 'pool'
           AND m.status = 'pending')                                      AS "à jouer",
       (SELECT count(*) FROM tournament_matches m
         WHERE m.tournament_id = t.id AND m.bracket_side = 'pool'
           AND m.status = 'walkover')                                     AS forfaits,
       (SELECT count(*) FROM tournament_matches m
         WHERE m.tournament_id = t.id AND m.bracket_side = 'pool'
           AND m.match_id IS NOT NULL)                                    AS liées,
       (SELECT count(*) FROM tournament_matches m
         WHERE m.tournament_id = t.id AND m.bracket_side = 'main')         AS tableau
  FROM tournaments t
 WHERE t.name LIKE '[JDL-PK]%'
 ORDER BY substring(t.name from '\d+')::int;
