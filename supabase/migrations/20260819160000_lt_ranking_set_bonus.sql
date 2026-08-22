-- ============================================================================
-- Leagues — the organizer picks the formula: a base, plus set and game bonuses
-- ============================================================================
-- From Jean's league test review, section 5, his "point majeur" : « À la
-- création de la ligue, l'organisateur doit choisir sa formule de comptage »,
-- with a base on win/loss/bye and optional bonuses for sets and games won.
--
-- Half of that shipped in 20260807320000: pointPerGameWon adds points per game
-- won on top of the result. The set half was missing entirely, so a league that
-- counts sets could not be expressed at all. pointPerSetWon closes it, with the
-- same shape and the same default of 0, so every season that exists keeps
-- scoring exactly as it does today.
--
-- Three functions, each copied from its latest definition:
--   * lt_league_default_rules (20260615120000) seeds both bonuses at 0, so the
--     wizard reads a real value instead of inferring one from a missing key.
--   * lt_assert_league_rules (20260807400000) validates pointPerSetWon, and
--     refuses a NEGATIVE bonus on either key: "bonus per thing won" that
--     subtracts is not a formula anyone means to configure, and it would let a
--     league punish winning games. The nine outcome keys keep their ±100 range
--     (pointNoShow is legitimately negative).
--   * recalc_season_ranking (20260807320000) adds the set term beside the game
--     term.
--
-- Not touched: `enableBonuses`, seeded false since the first migration and read
-- by nothing. It belongs to the unbuilt v1.1 discrete bonuses (straight sets,
-- shutout, fair play) in specs/17-leagues-tournaments/ranking.md. These two
-- bonuses are proportional and need no flag: 0 is off.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- lt_league_default_rules — same body as 20260615120000, plus the two bonuses
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lt_league_default_rules(p_sport_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
    v_sport_name text;
    v_match_format text;
BEGIN
    SELECT name INTO v_sport_name FROM sport WHERE id = p_sport_id;
    IF v_sport_name IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SPORT_MISMATCH';
    END IF;

    v_match_format := CASE v_sport_name
        WHEN 'pickleball' THEN 'pickleball_to_11'
        ELSE 'two_of_three'
    END;

    RETURN jsonb_build_object(
        'matchFormat', v_match_format,
        'gamesPerSet', 6,
        'finalSetTiebreak', 'super_tb_10pt',
        'formatsAllowed', jsonb_build_array('singles'),
        'pointWin', 10,
        'pointLoss', 1,
        'pointNoShow', -5,
        'pointBye', 1,
        'pointDraw', 5,
        'pointRetirementWinner', 10,
        'pointRetirementLoser', 1,
        'pointWalkoverWinner', 10,
        'pointWalkoverLoser', 0,
        -- Proportional bonuses, off by default. The result is the whole story
        -- until an organizer says otherwise.
        'pointPerSetWon', 0,
        'pointPerGameWon', 0,
        'enableBonuses', false,
        'tieBreakerOrder', jsonb_build_array(
            'totalPoints', 'headToHead', 'setDifference',
            'gameDifference', 'participationPercent', 'deterministicRandom'
        ),
        'formatWeights', jsonb_build_object(
            'singles', 1.0, 'doubles', 1.0, 'mixed_doubles', 1.0
        ),
        'defaultRatingForUnknown', 0
    );
END;
$$;

COMMENT ON FUNCTION public.lt_league_default_rules(uuid) IS
'Sport-shaped seed for leagues.default_rules. Both proportional bonuses
(pointPerSetWon, pointPerGameWon) seed at 0: result-only scoring.';

-- ---------------------------------------------------------------------------
-- lt_assert_league_rules — same body as 20260807400000, plus the set bonus
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lt_assert_league_rules(p_rules jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
    v_key text;
BEGIN
    IF p_rules IS NULL OR jsonb_typeof(p_rules) <> 'object' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES';
    END IF;

    -- Point values feed a sum, so a string or a null would break the recalc at
    -- score time rather than here. Negative is legal: pointNoShow defaults to -5.
    FOREACH v_key IN ARRAY ARRAY[
        'pointWin', 'pointLoss', 'pointDraw', 'pointBye', 'pointNoShow',
        'pointRetirementWinner', 'pointRetirementLoser',
        'pointWalkoverWinner', 'pointWalkoverLoser',
        'pointPerSetWon', 'pointPerGameWon'
    ] LOOP
        IF p_rules ? v_key THEN
            IF jsonb_typeof(p_rules -> v_key) <> 'number' THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:' || v_key;
            END IF;
            IF (p_rules ->> v_key)::numeric NOT BETWEEN -100 AND 100 THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:' || v_key;
            END IF;
        END IF;
    END LOOP;

    -- The bonuses multiply a count of things WON. A negative one would mean
    -- taking a set costs you points, which no organizer configures on purpose
    -- and which the wizard cannot express.
    FOREACH v_key IN ARRAY ARRAY['pointPerSetWon', 'pointPerGameWon'] LOOP
        IF p_rules ? v_key AND (p_rules ->> v_key)::numeric < 0 THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:' || v_key;
        END IF;
    END LOOP;

    -- The forfeit invariant. Checked pairwise so a partial object (rules are
    -- merged before validation, so in practice every key is present) can still
    -- be validated for what it carries.
    FOREACH v_key IN ARRAY ARRAY['pointWalkoverWinner', 'pointRetirementWinner'] LOOP
        IF p_rules ? v_key AND p_rules ? 'pointWin'
           AND (p_rules ->> v_key)::numeric > (p_rules ->> 'pointWin')::numeric THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:' || v_key;
        END IF;
    END LOOP;
    FOREACH v_key IN ARRAY ARRAY['pointWalkoverLoser', 'pointRetirementLoser'] LOOP
        IF p_rules ? v_key AND p_rules ? 'pointLoss'
           AND (p_rules ->> v_key)::numeric > (p_rules ->> 'pointLoss')::numeric THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:' || v_key;
        END IF;
    END LOOP;

    IF p_rules ? 'matchFormat'
       AND NOT EXISTS (
           SELECT 1
             FROM unnest(enum_range(NULL::match_format)) AS e(v)
            WHERE e.v::text = p_rules ->> 'matchFormat'
       ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:matchFormat';
    END IF;

    IF p_rules ? 'gamesPerSet'
       AND (jsonb_typeof(p_rules -> 'gamesPerSet') <> 'number'
            OR (p_rules ->> 'gamesPerSet')::integer NOT IN (4, 6, 8)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:gamesPerSet';
    END IF;

    IF p_rules ? 'pointsPerGame'
       AND (jsonb_typeof(p_rules -> 'pointsPerGame') <> 'number'
            OR (p_rules ->> 'pointsPerGame')::integer NOT IN (11, 15, 21)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:pointsPerGame';
    END IF;

    -- Games each player plays per session. sessions.rounds is CHECKed 1..6, so a
    -- season default outside that range could never be applied.
    IF p_rules ? 'gamesPerPlayer'
       AND (jsonb_typeof(p_rules -> 'gamesPerPlayer') <> 'number'
            OR (p_rules ->> 'gamesPerPlayer')::integer NOT BETWEEN 1 AND 6) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:gamesPerPlayer';
    END IF;
END;
$$;

COMMENT ON FUNCTION public.lt_assert_league_rules(jsonb) IS
'Validates a league/season rules jsonb: point values numeric and within ±100,
pointPerSetWon/pointPerGameWon non-negative, no walkover/retirement outcome
paying more than its played counterpart, matchFormat a real enum label,
gamesPerSet 4/6/8, pointsPerGame 11/15/21, gamesPerPlayer 1..6.
Raises INVALID_RULES[:key].';

-- ---------------------------------------------------------------------------
-- recalc_season_ranking — same body as 20260807320000, plus the set term
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalc_season_ranking(p_season_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_season     seasons;
    v_pt_win     integer;
    v_pt_loss    integer;
    v_pt_rw      integer;
    v_pt_rl      integer;
    v_pt_ww      integer;
    v_pt_wl      integer;
    v_pt_bye     integer;
    v_pt_sw      integer;
    v_pt_gw      integer;
    v_eligible   integer;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));

    SELECT * INTO v_season FROM seasons WHERE id = p_season_id;
    IF v_season.id IS NULL THEN RETURN; END IF;

    -- A closed season's standings are final (season_close snapshots them into
    -- final_standings); never reshape them from a later membership change.
    IF v_season.status IN ('closed', 'cancelled') THEN RETURN; END IF;

    -- Population invariant: rows = roster ∪ result-holders. Prune and seed use
    -- the same live predicate, so a row can only disappear while its player
    -- holds no results — and comes back (same deterministic seed) if a result
    -- lands later.
    DELETE FROM season_rankings sr
     WHERE sr.season_id = p_season_id
       AND NOT EXISTS (
             SELECT 1 FROM public.season_ranking_population(p_season_id) p
              WHERE p.user_id = sr.user_id
       );

    INSERT INTO season_rankings (season_id, user_id, tiebreak_seed)
    SELECT p_season_id, p.user_id,
           hashtext(p_season_id::text || p.user_id::text)::bigint
      FROM public.season_ranking_population(p_season_id) p
    ON CONFLICT (season_id, user_id) DO NOTHING;

    v_pt_win  := COALESCE((v_season.rules->>'pointWin')::int, 10);
    v_pt_loss := COALESCE((v_season.rules->>'pointLoss')::int, 1);
    v_pt_rw   := COALESCE((v_season.rules->>'pointRetirementWinner')::int, v_pt_win);
    v_pt_rl   := COALESCE((v_season.rules->>'pointRetirementLoser')::int, v_pt_loss);
    v_pt_ww   := COALESCE((v_season.rules->>'pointWalkoverWinner')::int, v_pt_win);
    v_pt_wl   := COALESCE((v_season.rules->>'pointWalkoverLoser')::int, 0);
    v_pt_bye  := COALESCE((v_season.rules->>'pointBye')::int, 1);
    -- Proportional bonuses, on top of the result. 0 (the default) keeps the
    -- result-only scoring every existing season was built on.
    v_pt_sw   := COALESCE((v_season.rules->>'pointPerSetWon')::int, 0);
    v_pt_gw   := COALESCE((v_season.rules->>'pointPerGameWon')::int, 0);

    SELECT count(*) INTO v_eligible
      FROM sessions WHERE season_id = p_season_id AND status = 'completed';

    UPDATE season_rankings
       SET points = 0, wins = 0, losses = 0, draws = 0, no_shows = 0,
           sets_won = 0, sets_lost = 0, games_won = 0, games_lost = 0,
           matches_played = 0, sessions_attended = 0,
           sessions_eligible = v_eligible,
           last_recalculated_at = now(), updated_at = now()
     WHERE season_id = p_season_id;

    WITH parsed AS (
        SELECT sm.session_id, sm.status, sm.winner_team,
               sm.team_a_user_ids, sm.team_b_user_ids,
               ps.a_sets, ps.b_sets, ps.a_games, ps.b_games
          FROM session_matches sm
          JOIN sessions ss ON ss.id = sm.session_id
          CROSS JOIN LATERAL public.lt_parse_score(sm.score) ps
         WHERE ss.season_id = p_season_id
           AND ss.status <> 'cancelled'
           AND sm.is_drill = false
           AND sm.status IN ('completed', 'retired', 'walkover')
    ),
    contrib AS (
        SELECT unnest(team_a_user_ids) AS user_id, session_id,
               CASE status
                   WHEN 'completed' THEN CASE WHEN winner_team = 'a' THEN v_pt_win ELSE v_pt_loss END
                   WHEN 'retired'   THEN CASE WHEN winner_team = 'a' THEN v_pt_rw  ELSE v_pt_rl  END
                   WHEN 'walkover'  THEN CASE WHEN winner_team = 'a' THEN v_pt_ww  ELSE v_pt_wl  END
                   ELSE 0 END
               + v_pt_sw * a_sets + v_pt_gw * a_games AS pts,
               (status IN ('completed','retired') AND winner_team = 'a')::int AS win,
               (status IN ('completed','retired') AND winner_team = 'b')::int AS loss,
               1 AS played,
               a_sets AS sw, b_sets AS sl, a_games AS gw, b_games AS gl
          FROM parsed
        UNION ALL
        SELECT unnest(team_b_user_ids) AS user_id, session_id,
               CASE status
                   WHEN 'completed' THEN CASE WHEN winner_team = 'b' THEN v_pt_win ELSE v_pt_loss END
                   WHEN 'retired'   THEN CASE WHEN winner_team = 'b' THEN v_pt_rw  ELSE v_pt_rl  END
                   WHEN 'walkover'  THEN CASE WHEN winner_team = 'b' THEN v_pt_ww  ELSE v_pt_wl  END
                   ELSE 0 END
               + v_pt_sw * b_sets + v_pt_gw * b_games AS pts,
               (status IN ('completed','retired') AND winner_team = 'b')::int AS win,
               (status IN ('completed','retired') AND winner_team = 'a')::int AS loss,
               1 AS played,
               b_sets AS sw, a_sets AS sl, b_games AS gw, a_games AS gl
          FROM parsed
        UNION ALL
        SELECT sp.user_id, sp.session_id,
               v_pt_bye AS pts,
               0 AS win, 0 AS loss, 0 AS played,
               0 AS sw, 0 AS sl, 0 AS gw, 0 AS gl
          FROM session_presence sp
          JOIN sessions ss ON ss.id = sp.session_id
         WHERE ss.season_id = p_season_id
           AND ss.status    = 'completed'
           AND sp.status    = 'confirmed'
           AND NOT EXISTS (
                 SELECT 1 FROM session_matches sm
                  WHERE sm.session_id = ss.id
                    AND sm.is_drill = false
                    AND (sp.user_id = ANY (sm.team_a_user_ids)
                         OR sp.user_id = ANY (sm.team_b_user_ids))
           )
    ),
    agg AS (
        SELECT user_id,
               sum(pts) AS points, sum(win) AS wins, sum(loss) AS losses,
               sum(played) AS matches_played,
               sum(sw) AS sets_won, sum(sl) AS sets_lost,
               sum(gw) AS games_won, sum(gl) AS games_lost,
               count(DISTINCT session_id) AS sessions_attended
          FROM contrib
         GROUP BY user_id
    )
    UPDATE season_rankings sr
       SET points = a.points, wins = a.wins, losses = a.losses,
           matches_played = a.matches_played,
           sets_won = a.sets_won, sets_lost = a.sets_lost,
           games_won = a.games_won, games_lost = a.games_lost,
           sessions_attended = a.sessions_attended,
           updated_at = now()
      FROM agg a
     WHERE sr.season_id = p_season_id AND sr.user_id = a.user_id;

    WITH me AS (
        SELECT id, user_id, points, sets_won, sets_lost, games_won, games_lost,
               sessions_attended, sessions_eligible, tiebreak_seed,
               count(*) OVER (PARTITION BY points) AS tied_on_points
          FROM season_rankings
         WHERE season_id = p_season_id
    ),
    duel AS (
        SELECT w.user_id AS winner_id, l.user_id AS loser_id
          FROM session_matches sm
          JOIN sessions ss ON ss.id = sm.session_id
          CROSS JOIN LATERAL (
              SELECT unnest(CASE WHEN sm.winner_team = 'a'
                                 THEN sm.team_a_user_ids ELSE sm.team_b_user_ids END) AS user_id
          ) w
          CROSS JOIN LATERAL (
              SELECT unnest(CASE WHEN sm.winner_team = 'a'
                                 THEN sm.team_b_user_ids ELSE sm.team_a_user_ids END) AS user_id
          ) l
         WHERE ss.season_id = p_season_id
           AND ss.status <> 'cancelled'
           AND sm.is_drill = false
           AND sm.winner_team IS NOT NULL
           AND sm.status IN ('completed', 'retired', 'walkover')
    ),
    h2h AS (
        SELECT m.id,
               CASE WHEN m.tied_on_points = 2 THEN (
                    SELECT coalesce(count(*) FILTER (WHERE d.winner_id = m.user_id), 0)
                         - coalesce(count(*) FILTER (WHERE d.loser_id  = m.user_id), 0)
                      FROM duel d
                      JOIN me o ON o.points = m.points AND o.user_id <> m.user_id
                     WHERE (d.winner_id = m.user_id AND d.loser_id  = o.user_id)
                        OR (d.loser_id  = m.user_id AND d.winner_id = o.user_id)
               ) ELSE 0 END AS h2h_edge
          FROM me m
    ),
    ranked AS (
        SELECT m.id, row_number() OVER (
            ORDER BY m.points DESC,
                     coalesce(h.h2h_edge, 0) DESC,
                     (m.sets_won - m.sets_lost) DESC,
                     (m.games_won - m.games_lost) DESC,
                     CASE WHEN m.sessions_eligible > 0
                          THEN m.sessions_attended::numeric / m.sessions_eligible ELSE 0 END DESC,
                     m.tiebreak_seed ASC
        ) AS rk
          FROM me m
          LEFT JOIN h2h h ON h.id = m.id
    )
    UPDATE season_rankings sr SET rank = ranked.rk
      FROM ranked WHERE sr.id = ranked.id;
END;
$$;

COMMENT ON FUNCTION public.recalc_season_ranking(uuid) IS
'Recomputes a season''s standings from its session matches. Points come from
the season rules: result points per match, pointBye per bye, plus
pointPerSetWon per set won and pointPerGameWon per game won (both 0 by
default). Closed and cancelled seasons are left frozen.';
