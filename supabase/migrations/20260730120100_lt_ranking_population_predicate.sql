-- ============================================================================
-- Leagues — a player whose result landed after their exit vanished for good
-- ============================================================================
-- 20260730100200 prunes off-roster season_rankings rows that hold no results,
-- guarding on the STORED counters (matches_played = 0 AND sessions_attended
-- = 0). Those counters are themselves recalc outputs, so the guard reads the
-- PREVIOUS recalc's view — and the prune runs before the recompute in the same
-- function. Reproduced locally: a player plays a night, withdraws next morning,
-- the organizer enters the score after that. At score time the recalc prunes
-- their row first (counters still zero — the result was never tallied) and the
-- recompute cannot bring it back, because the seed INSERT only covers roster
-- members and the stats UPDATE only touches existing rows. Net: a completed,
-- counted match whose winner has no line in the table, violating the exact
-- spec clause 100200 cites ("all ranking rows from completed sessions are
-- preserved").
--
-- A live-results prune guard alone is not enough: in the window above the
-- player GENUINELY holds no results yet (their match is still pending), so any
-- recalc firing in that window deletes the row legitimately — the gap is that
-- nothing ever re-seeds it once the result lands.
--
-- Fix: one predicate, both sides. season_ranking_population(season) = the
-- roster ∪ everyone holding results (a terminal non-drill match in a
-- non-cancelled session, or a confirmed presence in a completed session — the
-- same inputs the contrib CTE scores). The seed INSERT adds every member of
-- that set; the prune DELETE removes every row outside it. The invariant
-- "season_rankings = roster ∪ result-holders" then holds by construction, and
-- a late-landing result resurrects the row on the next recalc — with the same
-- tiebreak_seed, since the seed is a deterministic hash.
--
-- Deliberately NOT folded into season_ranking_roster: that function also
-- drives session_publish's presence seeding and notifications (20260730100400),
-- where including departed result-holders would re-invite withdrawn players to
-- future sessions.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.season_ranking_population(p_season_id uuid)
RETURNS TABLE (user_id uuid)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    -- On the roster today...
    SELECT r.user_id FROM public.season_ranking_roster(p_season_id) r
    UNION
    -- ...or holding a scored result (mirrors the contrib CTE's match leg).
    SELECT u
      FROM session_matches sm
      JOIN sessions ss ON ss.id = sm.session_id
      CROSS JOIN LATERAL unnest(sm.team_a_user_ids || sm.team_b_user_ids) AS u
     WHERE ss.season_id = p_season_id
       AND ss.status <> 'cancelled'
       AND sm.is_drill = false
       AND sm.status IN ('completed', 'retired', 'walkover')
    UNION
    -- ...or holding attendance, matched or byed (mirrors the bye leg).
    SELECT sp.user_id
      FROM session_presence sp
      JOIN sessions ss ON ss.id = sp.session_id
     WHERE ss.season_id = p_season_id
       AND ss.status = 'completed'
       AND sp.status = 'confirmed';
$$;

COMMENT ON FUNCTION public.season_ranking_population(uuid) IS
'Who holds a season_rankings row: the current roster plus anyone with results
(a terminal non-drill match, or confirmed attendance at a completed session).
Used by recalc_season_ranking for both seeding and pruning so the two can never
disagree. Not the invite list — that is season_ranking_roster.';


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
                   ELSE 0 END AS pts,
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
                   ELSE 0 END AS pts,
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
'Recomputes a season standings table over season_ranking_population (roster ∪
result-holders; seed and prune share the predicate). Byes award pointBye and
count as attendance. Ranks by points, then head-to-head for exact two-way ties,
then set diff, game diff, participation, deterministic seed.';
