-- ============================================
-- Leagues — recalc_season_ranking correctness fixes
-- ============================================
-- Two data-correctness bugs in recalc_season_ranking (shipped in
-- 20260618140000_lt_session_scoring_ranking.sql), both reachable on live
-- seasons:
--
--   1. Mid-season joiners are dropped from the standings.
--      season_rankings rows are seeded ONLY in season_open, for members active
--      at that instant. recalc only ever UPDATEs existing rows (never INSERTs).
--      But session_publish seeds a presence row for EVERY currently-active
--      member, so a player who joins after the season opened can confirm, be
--      paired, play, and have a score recorded — yet the final
--      `UPDATE ... FROM agg WHERE sr.user_id = a.user_id` matches no row, so
--      their results vanish with no error and they never appear in standings.
--      Fix: (re)seed a row for every currently-active league member at the top
--      of recalc, mirroring season_open's tiebreak_seed. Idempotent.
--
--   2. Cancelled-session matches still count toward standings.
--      The `parsed` CTE joins sessions but filters only on sm.status, never
--      ss.status. So matches played in a session the organizer later cancelled
--      keep contributing points, while the cancelled session is NOT counted in
--      sessions_eligible (which only counts 'completed') — letting
--      sessions_attended exceed sessions_eligible (participation > 100%).
--      Fix: exclude matches whose session is cancelled.
--
-- Pure function-body replacement: no schema/enum/signature change, fully
-- backward-compatible. Everything else is byte-for-byte the original.
-- ============================================

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
    v_eligible   integer;
BEGIN
    -- Serialize concurrent recalcs for this season.
    PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));

    SELECT * INTO v_season FROM seasons WHERE id = p_season_id;
    IF v_season.id IS NULL THEN RETURN; END IF;

    -- (1) Ensure every currently-active league member has a ranking row, so
    -- members who joined after season_open are included. Mirrors season_open's
    -- seed (same tiebreak_seed). New rows land at 0 and are filled by the
    -- aggregation below if the member has any results.
    INSERT INTO season_rankings (season_id, user_id, tiebreak_seed)
    SELECT p_season_id, lm.user_id,
           hashtext(p_season_id::text || lm.user_id::text)::bigint
      FROM league_members lm
     WHERE lm.league_id = v_season.league_id
       AND lm.status = 'active'
    ON CONFLICT (season_id, user_id) DO NOTHING;

    v_pt_win  := COALESCE((v_season.rules->>'pointWin')::int, 10);
    v_pt_loss := COALESCE((v_season.rules->>'pointLoss')::int, 1);
    v_pt_rw   := COALESCE((v_season.rules->>'pointRetirementWinner')::int, v_pt_win);
    v_pt_rl   := COALESCE((v_season.rules->>'pointRetirementLoser')::int, v_pt_loss);
    v_pt_ww   := COALESCE((v_season.rules->>'pointWalkoverWinner')::int, v_pt_win);
    v_pt_wl   := COALESCE((v_season.rules->>'pointWalkoverLoser')::int, 0);

    -- Sessions that ran (used as the participation denominator).
    SELECT count(*) INTO v_eligible
      FROM sessions WHERE season_id = p_season_id AND status = 'completed';

    -- Reset all members' counters (rows seeded at season_open / above).
    UPDATE season_rankings
       SET points = 0, wins = 0, losses = 0, draws = 0, no_shows = 0,
           sets_won = 0, sets_lost = 0, games_won = 0, games_lost = 0,
           matches_played = 0, sessions_attended = 0,
           sessions_eligible = v_eligible,
           last_recalculated_at = now(), updated_at = now()
     WHERE season_id = p_season_id;

    -- Per-player contributions from every terminal, non-drill match.
    -- (2) Matches in a cancelled session are excluded.
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
        -- team A
        SELECT unnest(team_a_user_ids) AS user_id, session_id,
               CASE status
                   WHEN 'completed' THEN CASE WHEN winner_team = 'a' THEN v_pt_win ELSE v_pt_loss END
                   WHEN 'retired'   THEN CASE WHEN winner_team = 'a' THEN v_pt_rw  ELSE v_pt_rl  END
                   WHEN 'walkover'  THEN CASE WHEN winner_team = 'a' THEN v_pt_ww  ELSE v_pt_wl  END
                   ELSE 0 END AS pts,
               (status IN ('completed','retired') AND winner_team = 'a')::int AS win,
               (status IN ('completed','retired') AND winner_team = 'b')::int AS loss,
               1 AS played,
               a_sets AS sw, b_sets AS sl, a_games AS gw, b_games AS gl
          FROM parsed
        UNION ALL
        -- team B
        SELECT unnest(team_b_user_ids) AS user_id, session_id,
               CASE status
                   WHEN 'completed' THEN CASE WHEN winner_team = 'b' THEN v_pt_win ELSE v_pt_loss END
                   WHEN 'retired'   THEN CASE WHEN winner_team = 'b' THEN v_pt_rw  ELSE v_pt_rl  END
                   WHEN 'walkover'  THEN CASE WHEN winner_team = 'b' THEN v_pt_ww  ELSE v_pt_wl  END
                   ELSE 0 END AS pts,
               (status IN ('completed','retired') AND winner_team = 'b')::int AS win,
               (status IN ('completed','retired') AND winner_team = 'a')::int AS loss,
               1 AS played,
               b_sets AS sw, a_sets AS sl, b_games AS gw, a_games AS gl
          FROM parsed
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

    -- Assign rank (points -> set diff -> game diff -> participation -> seed).
    WITH ranked AS (
        SELECT id, row_number() OVER (
            ORDER BY points DESC,
                     (sets_won - sets_lost) DESC,
                     (games_won - games_lost) DESC,
                     CASE WHEN sessions_eligible > 0
                          THEN sessions_attended::numeric / sessions_eligible ELSE 0 END DESC,
                     tiebreak_seed ASC
        ) AS rk
          FROM season_rankings WHERE season_id = p_season_id
    )
    UPDATE season_rankings sr SET rank = ranked.rk
      FROM ranked WHERE sr.id = ranked.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recalc_season_ranking(uuid) FROM anon, authenticated;
