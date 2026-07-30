-- ============================================================================
-- Leagues — a bye cost the byed player their attendance, and H2H never applied
-- ============================================================================
-- Two ranking defects, both in recalc_season_ranking (20260716200200).
--
-- 1. A BYE scored as an absence. sessions_attended counts DISTINCT session_id
--    over the player's matches, so a member who confirmed, showed up, and was
--    benched by an odd roster records attended = 0 for that night while
--    sessions_eligible still counts it. They lose the participation tie-break
--    against everyone who happened to draw a pairing, and bank no points.
--    leagues.default_rules has carried 'pointBye' (1) since 20260615120000 and
--    nothing has ever read it; leagues.md is explicit that a BYE "counts as
--    participation in leagues".
--
--    Byes have no row (session_matches CHECK requires both teams at
--    cardinality 1 or 2), so they are derived the same way the sheet generator
--    now derives them: a 'confirmed' presence in a completed, non-cancelled
--    session with no non-drill match in that session.
--
-- 2. headToHead was ignored. It sits second in the default tieBreakerOrder
--    ('totalPoints','headToHead','setDifference',...) and in the MVP scope
--    ("tie-breakers 1-4"), but the rank window went straight from points to set
--    difference. Two players level on points were separated by set difference
--    even when one had beaten the other.
--
--    Applied the conventional way — only to an exact two-way tie on points,
--    which is the case H2H actually resolves. Three-or-more-way ties fall
--    through to set difference as before, because a pairwise relation gives no
--    total order there (A beat B, B beat C, C beat A). The H2H term orders by
--    (their wins over the other player) DESC and is a no-op when they never
--    met or split their meetings.
--
-- Everything else — the points table, walkover/retirement handling, the
-- cancelled-session exclusion, the advisory lock, the roster seeding — is
-- carried over unchanged from 20260716200200.
-- ============================================================================

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
    -- Serialize concurrent recalcs for this season.
    PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));

    SELECT * INTO v_season FROM seasons WHERE id = p_season_id;
    IF v_season.id IS NULL THEN RETURN; END IF;

    -- Ensure everyone on the season's roster has a ranking row, so members who
    -- joined after season_open (free) or paid after it (paid) are included.
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

    -- Per-player contributions from every terminal, non-drill match, plus one
    -- row per BYE so a benched-but-present member keeps their attendance.
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
        UNION ALL
        -- BYE: confirmed for a completed session, paired into nothing. Awards
        -- pointBye and counts as attendance; not a win, a loss, or a match
        -- played, so it never moves the W/L record or the set/game diffs.
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

    -- Assign rank: points -> H2H (two-way ties only) -> set diff -> game diff
    -- -> participation -> seed.
    WITH me AS (
        SELECT id, user_id, points, sets_won, sets_lost, games_won, games_lost,
               sessions_attended, sessions_eligible, tiebreak_seed,
               count(*) OVER (PARTITION BY points) AS tied_on_points
          FROM season_rankings
         WHERE season_id = p_season_id
    ),
    -- Decided singles/doubles results between two players of this season.
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
    -- For an exact two-way tie on points, the H2H edge over the other player.
    -- Zero (no-op) for larger tie groups, for players who never met, and for a
    -- split series.
    h2h AS (
        SELECT m.id,
               CASE WHEN m.tied_on_points = 2 THEN (
                    SELECT coalesce(
                             count(*) FILTER (WHERE d.winner_id = m.user_id), 0)
                           - coalesce(
                             count(*) FILTER (WHERE d.loser_id  = m.user_id), 0)
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
'Recomputes a season standings table. Byes (confirmed presence with no match in
a completed session) award pointBye and count as attendance. Ranks by points,
then head-to-head for exact two-way ties, then set diff, game diff,
participation, deterministic seed.';
