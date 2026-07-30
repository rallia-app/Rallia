-- ============================================================================
-- Leagues — leaving or being removed from a FREE season did nothing
-- ============================================================================
-- season_ranking_roster (20260716200200) has two legs. The paid leg reads
-- season_members ("you are ranked because you paid"). The free leg ignores
-- season_members entirely and reads active league_members ("legacy"), so on a
-- free season neither exit path has any effect on the standings:
--
--   * season_withdraw flips the row to 'withdrawn' and returns success — the
--     player stays on the roster, keeps a ranking row, and keeps their rank.
--   * season_remove_member flips it to 'disqualified'. Its own comment claims
--     "a free entry just drops off the roster"; it does not. The removed member
--     is correctly blocked from confirming future sessions (the
--     ENROLLMENT_REMOVED guard in session_confirm_presence, 20260722110000),
--     so the removal half-lands: they can't play, but they still occupy a row
--     in the table and can still place above members who did play.
--
-- Verified locally: after season_withdraw and after season_remove_member on a
-- free season, season_ranking_roster still returned the user.
--
-- Fix: the free leg keeps its "active league member" default — that is what
-- makes a free season zero-friction, and it must stay — but an explicit exit
-- now wins over it. A season_members row at 'withdrawn' or 'disqualified'
-- removes the player from the roster; every other state (no row at all,
-- 'enrolled', 'pending', 'payment_pending') leaves the default untouched.
--
-- recalc_season_ranking only ever seeds and updates rows for roster members and
-- never deletes, so a player who leaves keeps whatever row they already had —
-- and on a free season that row was never removable, because the roster kept
-- re-adding them. Prune off-roster rows at recalc time, but ONLY when they hold
-- no results (matches_played = 0 AND sessions_attended = 0).
--
-- The results test is what keeps this compatible with leagues.md § Mid-season
-- impact: "All ranking rows from completed sessions are preserved" for a member
-- who goes inactive mid-season. Someone who played keeps their line in the
-- table; someone who signed up and left before playing stops occupying one.
-- Their opponents' records live on session_matches either way and are untouched.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.season_ranking_roster(p_season_id uuid)
RETURNS TABLE (user_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
    -- Paid: you are ranked because you paid.
    SELECT sm.user_id
      FROM season_members sm
      JOIN seasons s ON s.id = sm.season_id
     WHERE sm.season_id = p_season_id
       AND s.entry_fee_cents > 0
       AND sm.status = 'enrolled'
    UNION
    -- Free: you are ranked because you are an active league member, unless you
    -- withdrew or the organizer removed you from this season.
    SELECT lm.user_id
      FROM league_members lm
      JOIN seasons s ON s.id = p_season_id
     WHERE lm.league_id = s.league_id
       AND s.entry_fee_cents = 0
       AND lm.status = 'active'
       AND NOT EXISTS (
             SELECT 1 FROM season_members sm
              WHERE sm.season_id = p_season_id
                AND sm.user_id   = lm.user_id
                AND sm.status IN ('withdrawn', 'disqualified')
       );
$$;

GRANT EXECUTE ON FUNCTION public.season_ranking_roster(uuid) TO authenticated;

COMMENT ON FUNCTION public.season_ranking_roster(uuid) IS
'Who belongs in a season''s standings. Paid: enrolled (i.e. paid) members. Free:
active league members, minus anyone who withdrew from or was removed from this
season.';


-- ============================================================================
-- Drop ranking rows for players no longer on the roster, at recalc time.
-- ============================================================================
-- Wrapper around the 20260730100100 body: prune first, then recompute. Kept as
-- a separate statement rather than folded into the CTE chain so the pruning
-- rule is legible on its own.

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

    -- Anyone off the roster who never played stops occupying a line in the
    -- table. Rows that hold results stay (leagues.md § Mid-season impact).
    DELETE FROM season_rankings sr
     WHERE sr.season_id = p_season_id
       AND sr.matches_played = 0
       AND sr.sessions_attended = 0
       AND NOT EXISTS (
             SELECT 1 FROM public.season_ranking_roster(p_season_id) r
              WHERE r.user_id = sr.user_id
       );

    INSERT INTO season_rankings (season_id, user_id, tiebreak_seed)
    SELECT p_season_id, r.user_id,
           hashtext(p_season_id::text || r.user_id::text)::bigint
      FROM public.season_ranking_roster(p_season_id) r
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
