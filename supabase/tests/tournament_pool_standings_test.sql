-- ============================================
-- Tournaments — pool_knockout F2: standings + settlement
-- ============================================
-- One 8-player pool_knockout tournament (2 pools of 4), scores entered via
-- tournament_override_score (winner-first text, the no-linked-match path).
-- Asserts:
--   * pool 1 (clean sweep shape): straight win-count ordering;
--   * pool 1 h2h: two players tied on wins are ordered by their meeting even
--     when the loser's ratios are better;
--   * pool 2 (circular): a three-way tie with identical set/game ratios
--     falls through to seed position; last place unambiguous;
--   * forfeit: mid-pool disqualification converts unsettled matches to
--     walkovers, opponents get the win with no sets, the forfeited player
--     ranks last and ineligible;
--   * standings guard NOT_POOL_TOURNAMENT on a single-elim id.
--
-- Run: psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_pool_standings_test.sql
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

CREATE OR REPLACE FUNCTION pg_temp.tennis_sport() RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM sport WHERE name = 'tennis';
$$;

-- Settle a pool match between two users via organizer override, winner-first.
CREATE OR REPLACE FUNCTION pg_temp.settle(p_t uuid, p_winner uuid, p_loser uuid, p_score text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_tm  tournament_matches;
    v_win uuid;
BEGIN
    SELECT tm.* INTO v_tm
      FROM tournament_matches tm
      JOIN tournament_registrations r1 ON r1.id = tm.player1_registration_id
      JOIN tournament_registrations r2 ON r2.id = tm.player2_registration_id
     WHERE tm.tournament_id = p_t AND tm.bracket_side = 'pool'
       AND ((r1.user_id, r2.user_id) = (p_winner, p_loser)
         OR (r1.user_id, r2.user_id) = (p_loser, p_winner));
    IF v_tm.id IS NULL THEN
        RAISE EXCEPTION 'no pool match between % and %', p_winner, p_loser;
    END IF;
    SELECT id INTO v_win FROM tournament_registrations
     WHERE tournament_id = p_t AND user_id = p_winner;
    PERFORM public.tournament_override_score(v_tm.id, v_win, p_score);
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.rank_of(p_t uuid, p_user uuid) RETURNS integer LANGUAGE sql AS $$
  SELECT pool_rank FROM public.tournament_pool_standings(p_t) WHERE user_id = p_user;
$$;

DO $$
DECLARE
    v_players   uuid[];
    v_organizer uuid;
    v_t         tournaments;
    v_ver       integer;
    v_seeds     uuid[];
    p1 uuid[]; p2 uuid[];
    v_reg       tournament_registrations;
    v_cnt       integer;
    v_pool2     integer;
BEGIN
    v_players   := pg_temp.tennis_players(9);
    v_organizer := v_players[9];

    PERFORM pg_temp.as_user(v_organizer);
    SELECT * INTO v_t FROM public.tournament_create(
        '[TEST-PK] Standings', pg_temp.tennis_sport(), 8::smallint,
        now() + interval '7 days', now() + interval '21 days',
        p_bracket_type => 'pool_knockout');
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_open_registration(v_t.id, v_ver);
    FOR i IN 1..8 LOOP
        PERFORM pg_temp.as_user(v_players[i]);
        PERFORM public.tournament_register(v_t.id, NULL);
    END LOOP;
    PERFORM pg_temp.as_user(v_organizer);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_close_registration(v_t.id, v_ver);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_generate_pools(v_t.id, v_ver);

    -- Effective seed order (in-transaction registered_at ties → id order).
    v_seeds := ARRAY(
        SELECT tr.user_id FROM tournament_registrations tr
         WHERE tr.tournament_id = v_t.id
         ORDER BY tr.seed_rank ASC NULLS LAST, tr.registered_at ASC, tr.id ASC);

    p1 := ARRAY(
        SELECT ps.user_id FROM public.tournament_pool_standings(v_t.id) ps
         WHERE ps.pool_number = 1 ORDER BY array_position(v_seeds, ps.user_id));
    p2 := ARRAY(
        SELECT ps.user_id FROM public.tournament_pool_standings(v_t.id) ps
         WHERE ps.pool_number = 2 ORDER BY array_position(v_seeds, ps.user_id));
    IF array_length(p1, 1) <> 4 OR array_length(p2, 1) <> 4 THEN
        RAISE EXCEPTION 'expected 2 pools of 4';
    END IF;

    -- ---------------------------------------------------------------- pool 1
    -- a=p1[1] (best seed) .. d=p1[4]. Results:
    --   a beats b 6-4 6-4 ; a beats c 6-4 6-4 ; d beats a 6-0 6-0
    --   b beats c 6-0 6-0 ; b beats d 6-0 6-0 ; c beats d 6-1 6-1
    -- a and b are both 2-1. b's ratios are far better, but a beat b, so h2h
    -- puts a first. c is 1-2, d is 1-2; d beat... d beat a, c beat d → h2h
    -- c over d.
    PERFORM pg_temp.settle(v_t.id, p1[1], p1[2], '6-4 6-4');
    PERFORM pg_temp.settle(v_t.id, p1[1], p1[3], '6-4 6-4');
    PERFORM pg_temp.settle(v_t.id, p1[4], p1[1], '6-0 6-0');
    PERFORM pg_temp.settle(v_t.id, p1[2], p1[3], '6-0 6-0');
    PERFORM pg_temp.settle(v_t.id, p1[2], p1[4], '6-0 6-0');
    PERFORM pg_temp.settle(v_t.id, p1[3], p1[4], '6-1 6-1');

    IF pg_temp.rank_of(v_t.id, p1[1]) <> 1 THEN
        RAISE EXCEPTION 'pool1: h2h should rank a first (got rank %)', pg_temp.rank_of(v_t.id, p1[1]);
    END IF;
    IF pg_temp.rank_of(v_t.id, p1[2]) <> 2 THEN
        RAISE EXCEPTION 'pool1: b should be second';
    END IF;
    IF pg_temp.rank_of(v_t.id, p1[3]) <> 3 OR pg_temp.rank_of(v_t.id, p1[4]) <> 4 THEN
        RAISE EXCEPTION 'pool1: c/d order wrong (% / %)',
            pg_temp.rank_of(v_t.id, p1[3]), pg_temp.rank_of(v_t.id, p1[4]);
    END IF;

    -- ---------------------------------------------------------------- pool 2
    -- Circular top three with identical ratios → seed position decides.
    --   e beats f 6-0 6-0 ; f beats g 6-0 6-0 ; g beats e 6-0 6-0
    --   e,f,g each beat h 6-2 6-2 → all three are 2-1 with identical
    --   set (4/6) and game ratios; h is 0-3.
    PERFORM pg_temp.settle(v_t.id, p2[1], p2[2], '6-0 6-0');
    PERFORM pg_temp.settle(v_t.id, p2[2], p2[3], '6-0 6-0');
    PERFORM pg_temp.settle(v_t.id, p2[3], p2[1], '6-0 6-0');
    PERFORM pg_temp.settle(v_t.id, p2[1], p2[4], '6-2 6-2');
    PERFORM pg_temp.settle(v_t.id, p2[2], p2[4], '6-2 6-2');
    PERFORM pg_temp.settle(v_t.id, p2[3], p2[4], '6-2 6-2');

    IF pg_temp.rank_of(v_t.id, p2[1]) <> 1
       OR pg_temp.rank_of(v_t.id, p2[2]) <> 2
       OR pg_temp.rank_of(v_t.id, p2[3]) <> 3 THEN
        RAISE EXCEPTION 'pool2: seed fallback order wrong (% % %)',
            pg_temp.rank_of(v_t.id, p2[1]), pg_temp.rank_of(v_t.id, p2[2]), pg_temp.rank_of(v_t.id, p2[3]);
    END IF;
    IF pg_temp.rank_of(v_t.id, p2[4]) <> 4 THEN
        RAISE EXCEPTION 'pool2: h should be last';
    END IF;

    RAISE NOTICE 'PASS: win ordering, h2h precedence, seed fallback';
END;
$$;

-- Forfeit scenario needs its own tournament so pool matches are unsettled.
DO $$
DECLARE
    v_players   uuid[];
    v_organizer uuid;
    v_t         tournaments;
    v_ver       integer;
    v_seeds     uuid[];
    p1 uuid[];
    v_reg       tournament_registrations;
    v_cnt       integer;
BEGIN
    v_players   := pg_temp.tennis_players(9);
    v_organizer := v_players[8];

    PERFORM pg_temp.as_user(v_organizer);
    SELECT * INTO v_t FROM public.tournament_create(
        '[TEST-PK] Forfait', pg_temp.tennis_sport(), 8::smallint,
        now() + interval '7 days', now() + interval '21 days',
        p_bracket_type => 'pool_knockout');
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_open_registration(v_t.id, v_ver);
    FOR i IN 1..6 LOOP
        PERFORM pg_temp.as_user(v_players[i]);
        PERFORM public.tournament_register(v_t.id, NULL);
    END LOOP;
    PERFORM pg_temp.as_user(v_organizer);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_close_registration(v_t.id, v_ver);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_generate_pools(v_t.id, v_ver);

    v_seeds := ARRAY(
        SELECT tr.user_id FROM tournament_registrations tr
         WHERE tr.tournament_id = v_t.id
         ORDER BY tr.seed_rank ASC NULLS LAST, tr.registered_at ASC, tr.id ASC);
    p1 := ARRAY(
        SELECT ps.user_id FROM public.tournament_pool_standings(v_t.id) ps
         WHERE ps.pool_number = 1 ORDER BY array_position(v_seeds, ps.user_id));

    -- One real result, then the loser forfeits the tournament.
    PERFORM pg_temp.settle(v_t.id, p1[2], p1[1], '6-3 6-3');

    SELECT tr.* INTO v_reg FROM tournament_registrations tr
     WHERE tr.tournament_id = v_t.id AND tr.user_id = p1[1];
    PERFORM public.tournament_forfeit_registration(v_reg.id, v_reg.version, 'blessure');

    -- All their unsettled pool matches are walkovers for the opponent.
    SELECT count(*) INTO v_cnt FROM tournament_matches tm
     WHERE tm.tournament_id = v_t.id AND tm.bracket_side = 'pool'
       AND v_reg.id IN (tm.player1_registration_id, tm.player2_registration_id)
       AND tm.status NOT IN ('walkover', 'completed');
    IF v_cnt <> 0 THEN
        RAISE EXCEPTION '% unsettled matches left after forfeit', v_cnt;
    END IF;
    IF EXISTS (
        SELECT 1 FROM tournament_matches tm
         WHERE tm.tournament_id = v_t.id AND tm.status = 'walkover'
           AND tm.winner_registration_id = v_reg.id
    ) THEN
        RAISE EXCEPTION 'forfeited player won a walkover';
    END IF;

    -- Standings: forfeited player last in pool, ineligible; walkover wins
    -- carry no sets for the winners.
    IF NOT EXISTS (
        SELECT 1 FROM public.tournament_pool_standings(v_t.id) ps
         WHERE ps.user_id = p1[1] AND ps.withdrawn AND NOT ps.eligible
           AND ps.pool_rank = (SELECT max(pool_rank) FROM public.tournament_pool_standings(v_t.id) x
                                WHERE x.pool_number = ps.pool_number)
    ) THEN
        RAISE EXCEPTION 'forfeited player not ranked last/ineligible';
    END IF;
    -- 6 players → pools of 3. p1[2] already beat p1[1] for real (2 sets);
    -- p1[3] never played them, so the forfeit hands p1[3] a walkover win
    -- that carries no sets.
    IF EXISTS (
        SELECT 1 FROM public.tournament_pool_standings(v_t.id) ps
         WHERE ps.user_id = p1[2] AND (ps.wins <> 1 OR ps.sets_won <> 2)
    ) THEN
        RAISE EXCEPTION 'real win miscounted for direct opponent';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.tournament_pool_standings(v_t.id) ps
         WHERE ps.user_id = p1[3] AND (ps.wins <> 1 OR ps.sets_won <> 0 OR ps.settled <> 1)
    ) THEN
        RAISE EXCEPTION 'walkover win miscounted for third member';
    END IF;

    -- forfeited_at marks this exit apart from a pre-draw removal; the refund
    -- legs key on it, so a forfeit that only wrote 'disqualified' would silently
    -- start refunding entries again.
    IF NOT EXISTS (
        SELECT 1 FROM tournament_registrations
         WHERE id = v_reg.id AND status = 'disqualified' AND forfeited_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'forfeit did not stamp forfeited_at';
    END IF;

    -- The opponent who inherits a walkover is told. p1[3] had not played the
    -- leaver, so their game was converted and they get the notice.
    IF NOT EXISTS (
        SELECT 1 FROM notification
         WHERE type = 'tournament_match_walkover'
           AND target_id = v_t.id AND user_id = p1[3]
    ) THEN
        RAISE EXCEPTION 'walkover opponent was not notified';
    END IF;
    -- p1[2] already beat them for real, so nothing changed for that game and
    -- there is nothing to announce.
    IF EXISTS (
        SELECT 1 FROM notification
         WHERE type = 'tournament_match_walkover'
           AND target_id = v_t.id AND user_id = p1[2]
    ) THEN
        RAISE EXCEPTION 'settled opponent was notified of a walkover';
    END IF;
    -- The leaver hears it from the registration status trigger, not from us.
    IF NOT EXISTS (
        SELECT 1 FROM notification
         WHERE type = 'tournament_registration_removed'
           AND target_id = v_t.id AND user_id = p1[1]
    ) THEN
        RAISE EXCEPTION 'forfeited player was not notified';
    END IF;
    IF EXISTS (
        SELECT 1 FROM notification
         WHERE type = 'tournament_match_walkover'
           AND target_id = v_t.id AND user_id = p1[1]
    ) THEN
        RAISE EXCEPTION 'forfeited player got a walkover notice';
    END IF;

    -- Guard: standings on a single-elim tournament.
    BEGIN
        PERFORM public.tournament_pool_standings(
            (SELECT id FROM tournaments WHERE bracket_type = 'single_elimination' LIMIT 1));
        RAISE EXCEPTION 'expected NOT_POOL_TOURNAMENT';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'NOT_POOL_TOURNAMENT' THEN RAISE; END IF;
    END;

    RAISE NOTICE 'tournament_pool_standings_test: ALL PASS';
END;
$$;

ROLLBACK;
