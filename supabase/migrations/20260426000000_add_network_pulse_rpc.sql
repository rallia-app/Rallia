-- =============================================================================
-- Migration: get_network_pulse RPC
-- Description: Single-call story-driven payload for the Group/Community
--              Leaderboard tab. Returns headline insight, form strip,
--              your_summary (with sport-specific stats), leaderboard,
--              settling_in members, and discover lane data (rivalry,
--              power pair, unplayed pairings, moments, h2h matrix).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_network_pulse(
  p_network_id uuid,
  p_days_back  int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller            uuid := auth.uid();
  v_cutoff            date := (current_date - p_days_back);
  v_prev_cutoff       date := (current_date - (p_days_back * 2));
  v_network_sport_id  uuid;
  v_is_group          boolean;
  v_member_count      int;
  v_result            jsonb;
BEGIN
  -- Authorize: caller must be an active member of the network.
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.network_member
    WHERE network_id = p_network_id AND player_id = v_caller AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT n.sport_id,
         (SELECT name FROM public.network_type WHERE id = n.network_type_id) = 'player_group'
    INTO v_network_sport_id, v_is_group
  FROM public.network n
  WHERE n.id = p_network_id;

  -- ---------------------------------------------------------------------------
  -- Build everything inside a single CTE chain, then jsonb_build_object at end.
  -- ---------------------------------------------------------------------------
  WITH
  -- Active members of this network.
  members AS (
    SELECT player_id
    FROM public.network_member
    WHERE network_id = p_network_id AND status = 'active'
  ),
  -- Set of qualifying match ids in the current window.
  -- Union of:
  --   1. Matches explicitly posted to network via match_network.
  --   2. Auto-attributed matches: any match in window where ≥2 active
  --      network members participated.
  qualifying_matches AS (
    SELECT DISTINCT m.id, m.match_date, m.format
    FROM public.match m
    LEFT JOIN public.match_network mn
      ON mn.match_id = m.id AND mn.network_id = p_network_id
    LEFT JOIN public.match_participant mp
      ON mp.match_id = m.id
    LEFT JOIN members me ON me.player_id = mp.player_id
    WHERE m.match_date >= v_cutoff
      AND (
        mn.id IS NOT NULL  -- explicit posting
        OR me.player_id IS NOT NULL  -- at least one member participated
      )
    GROUP BY m.id, m.match_date, m.format
    -- Either the match was explicitly posted, or it has ≥2 member participants.
    HAVING bool_or(mn.id IS NOT NULL)
        OR count(DISTINCT me.player_id) >= 2
  ),
  -- Same logic applied to the *previous* equally-sized window (for rank delta + diagnostic).
  prev_qualifying_matches AS (
    SELECT DISTINCT m.id, m.match_date
    FROM public.match m
    LEFT JOIN public.match_network mn
      ON mn.match_id = m.id AND mn.network_id = p_network_id
    LEFT JOIN public.match_participant mp
      ON mp.match_id = m.id
    LEFT JOIN members me ON me.player_id = mp.player_id
    WHERE m.match_date >= v_prev_cutoff AND m.match_date < v_cutoff
      AND (mn.id IS NOT NULL OR me.player_id IS NOT NULL)
    GROUP BY m.id, m.match_date
    HAVING bool_or(mn.id IS NOT NULL)
        OR count(DISTINCT me.player_id) >= 2
  ),
  -- Per-participant rows (members only) with verified results, in window.
  participant_outcomes AS (
    SELECT
      mp.player_id,
      mp.team_number,
      qm.id           AS match_id,
      qm.match_date,
      qm.format,
      mr.winning_team,
      (mp.team_number = mr.winning_team) AS won
    FROM qualifying_matches qm
    JOIN public.match_participant mp ON mp.match_id = qm.id
    JOIN public.match_result      mr ON mr.match_id = qm.id
    JOIN members                  me ON me.player_id = mp.player_id
    WHERE mr.winning_team IS NOT NULL
      AND (
        mr.is_verified = TRUE
        OR mr.confirmation_deadline IS NULL
        OR now() > mr.confirmation_deadline
      )
  ),
  -- Same for previous window.
  prev_participant_outcomes AS (
    SELECT
      mp.player_id,
      (mp.team_number = mr.winning_team) AS won
    FROM prev_qualifying_matches qm
    JOIN public.match_participant mp ON mp.match_id = qm.id
    JOIN public.match_result      mr ON mr.match_id = qm.id
    JOIN members                  me ON me.player_id = mp.player_id
    WHERE mr.winning_team IS NOT NULL
      AND (mr.is_verified = TRUE OR mr.confirmation_deadline IS NULL OR now() > mr.confirmation_deadline)
  ),
  -- Per-player aggregates for the window.
  player_agg AS (
    SELECT
      po.player_id,
      count(*)::int                                   AS games_played,
      count(*) FILTER (WHERE po.won)::int            AS wins,
      count(*) FILTER (WHERE NOT po.won)::int        AS losses,
      max(po.match_date)                              AS last_match_date,
      -- last5 outcomes most-recent first
      (
        SELECT array_agg(CASE WHEN po2.won THEN 'W' ELSE 'L' END
                         ORDER BY po2.match_date DESC, po2.match_id DESC)
        FROM (
          SELECT po2.won, po2.match_date, po2.match_id
          FROM participant_outcomes po2
          WHERE po2.player_id = po.player_id
          ORDER BY po2.match_date DESC, po2.match_id DESC
          LIMIT 5
        ) po2
      ) AS last5
    FROM participant_outcomes po
    GROUP BY po.player_id
  ),
  -- Streak: walk from most recent match, stop at first flip. Signed (positive = wins, negative = losses).
  player_streak AS (
    SELECT
      pa.player_id,
      (
        WITH ordered AS (
          SELECT po.won, row_number() OVER (ORDER BY po.match_date DESC, po.match_id DESC) AS rn
          FROM participant_outcomes po
          WHERE po.player_id = pa.player_id
        ),
        first_flip AS (
          -- The earliest rn where outcome differs from the previous (i.e. the first row
          -- whose outcome is no longer the same as row 1's outcome). The streak is
          -- everything before that point.
          SELECT min(rn) AS rn
          FROM ordered
          WHERE won IS DISTINCT FROM (SELECT won FROM ordered WHERE rn = 1)
        ),
        streak_len AS (
          SELECT coalesce((SELECT rn - 1 FROM first_flip),
                          (SELECT count(*) FROM ordered))::int AS n
        )
        SELECT
          CASE
            WHEN (SELECT count(*) FROM ordered) = 0 THEN 0
            WHEN (SELECT won FROM ordered WHERE rn = 1) THEN  (SELECT n FROM streak_len)
            ELSE                                              -(SELECT n FROM streak_len)
          END
      ) AS current_streak
    FROM player_agg pa
  ),
  -- Skill rating per player for the network's sport.
  player_skill AS (
    SELECT DISTINCT ON (prs.player_id)
      prs.player_id,
      rsc.value      AS rating_value,
      rsy.code       AS system_code,
      prs.is_certified
    FROM public.player_rating_score prs
    JOIN public.rating_score  rsc ON rsc.id = prs.rating_score_id
    JOIN public.rating_system rsy ON rsy.id = rsc.rating_system_id
    WHERE rsy.sport_id = v_network_sport_id
      AND prs.player_id IN (SELECT player_id FROM members)
    ORDER BY prs.player_id, prs.assigned_at DESC
  ),
  -- Player profile rows (members of the network).
  player_profile AS (
    SELECT
      m.player_id,
      pr.first_name,
      pr.last_name,
      pr.profile_picture_url
    FROM members m
    JOIN public.profile pr ON pr.id = m.player_id
  ),
  -- Compose per-player JSON with everything; split below.
  player_json AS (
    SELECT
      pp.player_id,
      pp.first_name,
      pp.last_name,
      pp.profile_picture_url,
      coalesce(pa.games_played, 0)              AS games_played,
      coalesce(pa.wins, 0)                       AS wins,
      coalesce(pa.losses, 0)                     AS losses,
      coalesce(ps.current_streak, 0)             AS current_streak,
      pa.last_match_date,
      pa.last5,
      psk.rating_value,
      psk.system_code,
      psk.is_certified,
      jsonb_build_object(
        'player_id',           pp.player_id,
        'first_name',          pp.first_name,
        'last_name',           pp.last_name,
        'profile_picture_url', pp.profile_picture_url,
        'games_played',        coalesce(pa.games_played, 0),
        'wins',                coalesce(pa.wins, 0),
        'losses',              coalesce(pa.losses, 0),
        'win_rate',            CASE WHEN coalesce(pa.games_played,0) >= 5
                                     THEN round((pa.wins::numeric / pa.games_played) * 1000) / 1000
                                     ELSE NULL END,
        'current_streak',      coalesce(ps.current_streak, 0),
        'last_match_date',     pa.last_match_date,
        'last5',               coalesce(pa.last5, '{}'::text[]),
        'skill_rating',        CASE WHEN psk.rating_value IS NOT NULL THEN
                                     jsonb_build_object(
                                       'value',                psk.rating_value,
                                       'system_code',          psk.system_code,
                                       'certification_status', CASE WHEN psk.is_certified
                                                                    THEN 'certified'
                                                                    ELSE 'self_declared' END
                                     ) ELSE NULL END
      ) AS row_json
    FROM player_profile pp
    LEFT JOIN player_agg    pa ON pa.player_id = pp.player_id
    LEFT JOIN player_streak ps ON ps.player_id = pp.player_id
    LEFT JOIN player_skill psk ON psk.player_id = pp.player_id
  ),
  -- Active leaderboard: members with ≥3 verified matches in window.
  leaderboard_rows AS (
    SELECT row_json
    FROM player_json
    WHERE games_played >= 3
    ORDER BY games_played DESC,
             last_match_date DESC NULLS LAST
  ),
  -- Settling in: 1–2 matches OR zero matches.
  settling_rows AS (
    SELECT
      jsonb_build_object(
        'player_id',            player_id,
        'first_name',           first_name,
        'last_name',            last_name,
        'profile_picture_url',  profile_picture_url,
        'games_played',         games_played,
        'skill_rating',         (row_json->'skill_rating')
      ) AS row_json
    FROM player_json
    WHERE games_played < 3
    ORDER BY games_played DESC, last_match_date DESC NULLS LAST
  ),
  -- Form strip: top-5 most active members with their last5.
  form_strip_rows AS (
    SELECT
      jsonb_build_object(
        'player_id',     player_id,
        'first_name',    first_name,
        'last5',         coalesce(last5, '{}'::text[]),
        'current_streak',current_streak
      ) AS row_json
    FROM player_json
    WHERE games_played > 0
    ORDER BY games_played DESC, last_match_date DESC NULLS LAST
    LIMIT 5
  ),
  -- Per-set rows for the window (powers tiebreak, set-tendency, score-dist).
  set_rows AS (
    SELECT
      mp.player_id,
      mp.team_number,
      mr.winning_team,
      ms.set_number,
      ms.team1_score,
      ms.team2_score,
      CASE WHEN mp.team_number = 1 THEN ms.team1_score ELSE ms.team2_score END AS my_score,
      CASE WHEN mp.team_number = 1 THEN ms.team2_score ELSE ms.team1_score END AS opp_score
    FROM qualifying_matches qm
    JOIN public.match_participant mp ON mp.match_id = qm.id
    JOIN public.match_result      mr ON mr.match_id = qm.id
    JOIN public.match_set         ms ON ms.match_result_id = mr.id
    JOIN members me ON me.player_id = mp.player_id
    WHERE mr.winning_team IS NOT NULL
      AND (mr.is_verified = TRUE OR mr.confirmation_deadline IS NULL OR now() > mr.confirmation_deadline)
  ),
  -- Caller-only set rows.
  caller_set_rows AS (
    SELECT * FROM set_rows WHERE player_id = v_caller
  ),
  -- Pairwise H2H counts among members (singles + doubles, in window).
  pair_h2h AS (
    SELECT
      mpa.player_id   AS player_a_id,
      mpb.player_id   AS player_b_id,
      count(*) FILTER (WHERE mpa.team_number = mr.winning_team)::int AS a_wins,
      count(*) FILTER (WHERE mpb.team_number = mr.winning_team)::int AS b_wins,
      count(*)::int AS games
    FROM qualifying_matches qm
    JOIN public.match_participant mpa ON mpa.match_id = qm.id
    JOIN public.match_participant mpb ON mpb.match_id = qm.id
                                      AND mpa.player_id < mpb.player_id
                                      AND mpa.team_number IS DISTINCT FROM mpb.team_number
    JOIN public.match_result      mr  ON mr.match_id = qm.id
    JOIN members ma ON ma.player_id = mpa.player_id
    JOIN members mb ON mb.player_id = mpb.player_id
    WHERE mr.winning_team IS NOT NULL
      AND (mr.is_verified = TRUE OR mr.confirmation_deadline IS NULL OR now() > mr.confirmation_deadline)
    GROUP BY mpa.player_id, mpb.player_id
  ),
  -- Doubles partner pairs (same team_number).
  partner_pairs AS (
    SELECT
      mpa.player_id   AS player_a_id,
      mpb.player_id   AS player_b_id,
      count(*) FILTER (WHERE mpa.team_number = mr.winning_team)::int AS wins,
      count(*) FILTER (WHERE mpa.team_number != mr.winning_team)::int AS losses,
      count(*)::int AS matches
    FROM qualifying_matches qm
    JOIN public.match_participant mpa ON mpa.match_id = qm.id
    JOIN public.match_participant mpb ON mpb.match_id = qm.id
                                      AND mpa.player_id < mpb.player_id
                                      AND mpa.team_number = mpb.team_number
    JOIN public.match_result      mr  ON mr.match_id = qm.id
    JOIN members ma ON ma.player_id = mpa.player_id
    JOIN members mb ON mb.player_id = mpb.player_id
    WHERE qm.format = 'doubles'
      AND mr.winning_team IS NOT NULL
      AND (mr.is_verified = TRUE OR mr.confirmation_deadline IS NULL OR now() > mr.confirmation_deadline)
    GROUP BY mpa.player_id, mpb.player_id
  )
  SELECT jsonb_build_object(
    'meta', jsonb_build_object(
      'network_id',     p_network_id,
      'days_back',      p_days_back,
      'is_group',       coalesce(v_is_group, FALSE),
      'sport_id',       v_network_sport_id,
      'computed_at',    now()
    ),

    -- =========================================================================
    -- HEADLINE INSIGHT: priority-picked from what's available.
    -- Order: comeback > first-time-beat > hot-streak > new-face > activity-spike
    --      > player-of-week > quiet
    -- =========================================================================
    'headline_insight', (
      WITH current_count AS (SELECT count(*)::int AS n FROM qualifying_matches),
           prev_count    AS (SELECT count(*)::int AS n FROM prev_qualifying_matches),
           hot AS (
             SELECT pj.player_id, pj.first_name, pj.wins, pj.games_played
             FROM player_json pj
             WHERE pj.current_streak >= 3
             ORDER BY pj.current_streak DESC LIMIT 1
           ),
           potw AS (
             SELECT pj.player_id, pj.first_name, pj.wins
             FROM player_json pj
             WHERE pj.games_played > 0
             ORDER BY pj.wins DESC, pj.games_played DESC LIMIT 1
           ),
           new_face AS (
             SELECT pj.player_id, pj.first_name
             FROM player_json pj
             WHERE pj.games_played = 0
             LIMIT 1
           )
      SELECT
        CASE
          WHEN (SELECT player_id FROM hot) IS NOT NULL THEN
            jsonb_build_object(
              'type',                'hot_streak',
              'title_key',           'groups.leaderboard.pulse.hotStreak',
              'title_params',        jsonb_build_object(
                                       'name',  (SELECT first_name FROM hot),
                                       'wins',  (SELECT wins FROM hot),
                                       'losses',(SELECT games_played - wins FROM hot)
                                     ),
              'primary_player_id',   (SELECT player_id FROM hot)
            )
          WHEN (SELECT n FROM current_count) > 0
               AND (SELECT n FROM prev_count) > 0
               AND (SELECT n FROM current_count) >
                   (SELECT (n * 1.3)::int FROM prev_count) THEN
            jsonb_build_object(
              'type',                'activity_spike',
              'title_key',           'groups.leaderboard.pulse.activitySpike',
              'title_params',        jsonb_build_object(
                                       'percent', round(((SELECT n FROM current_count)::numeric /
                                                         nullif((SELECT n FROM prev_count), 0) - 1) * 100)
                                     )
            )
          WHEN (SELECT player_id FROM new_face) IS NOT NULL THEN
            jsonb_build_object(
              'type',                'new_face',
              'title_key',           'groups.leaderboard.pulse.newFace',
              'title_params',        jsonb_build_object('name', (SELECT first_name FROM new_face)),
              'primary_player_id',   (SELECT player_id FROM new_face)
            )
          WHEN (SELECT player_id FROM potw) IS NOT NULL THEN
            jsonb_build_object(
              'type',                'player_of_week',
              'title_key',           'groups.leaderboard.pulse.playerOfWeek',
              'title_params',        jsonb_build_object('name', (SELECT first_name FROM potw)),
              'primary_player_id',   (SELECT player_id FROM potw)
            )
          ELSE
            jsonb_build_object('type', 'quiet', 'title_key', 'groups.leaderboard.pulse.quiet')
        END
    ),

    -- =========================================================================
    -- FORM STRIP
    -- =========================================================================
    'form_strip', coalesce((SELECT jsonb_agg(row_json) FROM form_strip_rows), '[]'::jsonb),

    -- =========================================================================
    -- LEADERBOARD + SETTLING IN
    -- =========================================================================
    'leaderboard',  coalesce((SELECT jsonb_agg(row_json) FROM leaderboard_rows), '[]'::jsonb),
    'settling_in',  coalesce((SELECT jsonb_agg(row_json) FROM settling_rows),    '[]'::jsonb),

    -- =========================================================================
    -- YOUR SUMMARY
    -- =========================================================================
    'your_summary', (
      WITH me AS (SELECT * FROM player_json WHERE player_id = v_caller),
           my_rank AS (
             SELECT row_number() OVER (
               ORDER BY (row_json->>'games_played')::int DESC,
                        (row_json->>'last_match_date')::timestamptz DESC NULLS LAST
             ) AS rk,
             (row_json->>'player_id')::uuid AS pid
             FROM leaderboard_rows
           ),
           rank_total AS (SELECT count(*)::int AS n FROM leaderboard_rows),
           prev_rank AS (
             SELECT row_number() OVER (
               ORDER BY pa.games_played DESC NULLS LAST
             ) AS rk,
             pa.player_id AS pid
             FROM (
               SELECT player_id, count(*) AS games_played
               FROM prev_participant_outcomes
               GROUP BY player_id
             ) pa
           ),
           current_rank_row AS (SELECT rk FROM my_rank WHERE pid = v_caller),
           previous_rank_row AS (SELECT rk FROM prev_rank WHERE pid = v_caller),
           prev_wins AS (
             SELECT count(*) FILTER (WHERE won)::int AS w,
                    count(*)::int                    AS gp
             FROM prev_participant_outcomes
             WHERE player_id = v_caller
           ),
           -- Heatmap: per-day match counts in window.
           heatmap AS (
             SELECT po.match_date AS d, count(*)::int AS c
             FROM participant_outcomes po
             WHERE po.player_id = v_caller
             GROUP BY po.match_date
           ),
           -- Set-stat aggregates.
           set_stats AS (
             SELECT
               count(*) FILTER (WHERE set_number = 1)                         AS first_set_total,
               count(*) FILTER (WHERE set_number = 1 AND my_score > opp_score) AS first_set_wins,
               count(*) FILTER (WHERE set_number = 3)                         AS third_set_total,
               count(*) FILTER (WHERE set_number = 3 AND my_score > opp_score) AS third_set_wins,
               count(*)                                                       AS sets_total,
               count(*) FILTER (WHERE my_score > opp_score)                   AS sets_won,
               -- Tiebreak detection: any set with 7-6 or 6-7
               count(*) FILTER (
                 WHERE (my_score = 7 AND opp_score = 6) OR (my_score = 6 AND opp_score = 7)
               ) AS tb_total,
               count(*) FILTER (
                 WHERE my_score = 7 AND opp_score = 6
               ) AS tb_wins
             FROM caller_set_rows
           ),
           -- Score distribution (winning side perspective when caller won).
           score_dist AS (
             SELECT
               (my_score::text || '-' || opp_score::text) AS set_score,
               count(*)::int AS c
             FROM caller_set_rows
             WHERE my_score > opp_score  -- only on winning sets, the "fingerprint of your wins"
             GROUP BY set_score
             ORDER BY c DESC
           ),
           -- Personal records: biggest beat (highest-rated opponent beaten).
           biggest_beat AS (
             SELECT
               opp.first_name,
               opp.last_name,
               psk.rating_value,
               qm.match_date,
               opp.player_id AS opp_id
             FROM participant_outcomes po
             JOIN public.match_participant op ON op.match_id = po.match_id AND op.player_id <> po.player_id
                                              AND op.team_number IS DISTINCT FROM po.team_number
             JOIN player_profile opp ON opp.player_id = op.player_id
             LEFT JOIN player_skill psk ON psk.player_id = op.player_id
             JOIN qualifying_matches qm ON qm.id = po.match_id
             WHERE po.player_id = v_caller AND po.won
             ORDER BY psk.rating_value DESC NULLS LAST, qm.match_date DESC
             LIMIT 1
           ),
           -- Best streak: longest run of W's anywhere in window.
           streak_run AS (
             WITH ord AS (
               SELECT po.match_date, po.match_id, po.won,
                      row_number() OVER (ORDER BY po.match_date, po.match_id) -
                      row_number() OVER (PARTITION BY po.won ORDER BY po.match_date, po.match_id) AS grp
               FROM participant_outcomes po
               WHERE po.player_id = v_caller
             )
             SELECT count(*)::int AS streak_len, min(match_date) AS start_d, max(match_date) AS end_d
             FROM ord
             WHERE won
             GROUP BY grp
             ORDER BY streak_len DESC, end_d DESC
             LIMIT 1
           ),
           -- Matchup extremes: bunny (best win-rate ≥2 games, all wins) and nemesis (all losses).
           pair_caller AS (
             SELECT
               CASE WHEN player_a_id = v_caller THEN player_b_id ELSE player_a_id END AS opp_id,
               CASE WHEN player_a_id = v_caller THEN a_wins ELSE b_wins END           AS my_wins,
               CASE WHEN player_a_id = v_caller THEN b_wins ELSE a_wins END           AS opp_wins,
               games
             FROM pair_h2h
             WHERE v_caller IN (player_a_id, player_b_id)
           ),
           bunny AS (
             SELECT pc.opp_id, pc.my_wins, pc.opp_wins, pp.first_name, pp.last_name
             FROM pair_caller pc
             JOIN player_profile pp ON pp.player_id = pc.opp_id
             WHERE pc.games >= 2 AND pc.opp_wins = 0
             ORDER BY pc.my_wins DESC LIMIT 1
           ),
           nemesis AS (
             SELECT pc.opp_id, pc.my_wins, pc.opp_wins, pp.first_name, pp.last_name
             FROM pair_caller pc
             JOIN player_profile pp ON pp.player_id = pc.opp_id
             WHERE pc.games >= 2 AND pc.my_wins = 0
             ORDER BY pc.opp_wins DESC LIMIT 1
           )
      SELECT CASE
        WHEN (SELECT player_id FROM me) IS NULL THEN NULL
        ELSE jsonb_build_object(
          'rank',        (SELECT rk FROM current_rank_row),
          'rank_total',  (SELECT n  FROM rank_total),
          'rank_delta',  CASE
                           WHEN (SELECT rk FROM previous_rank_row) IS NULL
                             THEN NULL
                           ELSE (SELECT rk FROM previous_rank_row) - coalesce((SELECT rk FROM current_rank_row), 0)
                         END,
          'wins',           (SELECT wins   FROM me),
          'losses',         (SELECT losses FROM me),
          'current_streak', (SELECT current_streak FROM me),
          'last5',          (SELECT last5 FROM me),
          'diagnostic_key',
            CASE
              WHEN (SELECT gp FROM prev_wins) = 0 OR (SELECT games_played FROM me) = 0 THEN
                'groups.leaderboard.yourStory.diagnosticNew'
              WHEN ((SELECT wins FROM me)::numeric / nullif((SELECT games_played FROM me),0))
                 > ((SELECT w FROM prev_wins)::numeric / nullif((SELECT gp FROM prev_wins),0)) THEN
                'groups.leaderboard.yourStory.diagnosticUp'
              ELSE 'groups.leaderboard.yourStory.diagnosticDown'
            END,
          'diagnostic_params',
            CASE
              WHEN (SELECT gp FROM prev_wins) = 0 OR (SELECT games_played FROM me) = 0 THEN
                jsonb_build_object()
              ELSE
                jsonb_build_object(
                  'percent', abs(round(
                    ( ((SELECT wins FROM me)::numeric / nullif((SELECT games_played FROM me),0))
                    - ((SELECT w   FROM prev_wins)::numeric / nullif((SELECT gp FROM prev_wins),0))
                    ) * 100
                  ))
                )
            END,
          'next_move', NULL,  -- populated client-side; left here for forward-compat
          'stats', jsonb_build_object(
            'activity_heatmap', coalesce(
              (SELECT jsonb_agg(jsonb_build_object('date', d, 'match_count', c) ORDER BY d) FROM heatmap),
              '[]'::jsonb
            ),
            'personal_records', coalesce((
              SELECT jsonb_agg(rec) FROM (
                SELECT jsonb_build_object(
                  'type',         'biggest_beat',
                  'title_key',    'groups.leaderboard.myStats.recordBiggestBeat',
                  'opponent_id',  bb.opp_id,
                  'opponent_name',bb.first_name,
                  'opponent_rating', bb.rating_value,
                  'happened_at',  bb.match_date
                ) AS rec FROM biggest_beat bb
                UNION ALL
                SELECT jsonb_build_object(
                  'type',         'best_streak',
                  'title_key',    'groups.leaderboard.myStats.recordBestStreak',
                  'streak_len',   sr.streak_len,
                  'start_date',   sr.start_d,
                  'end_date',     sr.end_d
                ) AS rec FROM streak_run sr WHERE sr.streak_len >= 2
              ) recs
            ), '[]'::jsonb),
            'set_stats', (
              SELECT jsonb_build_object(
                'first_set_win_pct',
                  CASE WHEN first_set_total > 0
                       THEN round((first_set_wins::numeric / first_set_total) * 100)
                       ELSE NULL END,
                'third_set_win_pct',
                  CASE WHEN third_set_total > 0
                       THEN round((third_set_wins::numeric / third_set_total) * 100)
                       ELSE NULL END,
                'sets_won_pct',
                  CASE WHEN sets_total > 0
                       THEN round((sets_won::numeric / sets_total) * 100)
                       ELSE NULL END,
                'tiebreaks',
                  CASE WHEN tb_total > 0
                       THEN jsonb_build_object('wins', tb_wins, 'losses', tb_total - tb_wins)
                       ELSE NULL END
              )
              FROM set_stats
            ),
            'score_distribution', coalesce(
              (SELECT jsonb_agg(jsonb_build_object('set_score', set_score, 'count', c)) FROM score_dist),
              '[]'::jsonb
            )
          ),
          'matchup_extremes', jsonb_build_object(
            'favorite', (SELECT jsonb_build_object(
                          'opponent_id', b.opp_id,
                          'opponent_name', b.first_name,
                          'wins', b.my_wins,
                          'losses', b.opp_wins
                        ) FROM bunny b),
            'nemesis',  (SELECT jsonb_build_object(
                          'opponent_id', n.opp_id,
                          'opponent_name', n.first_name,
                          'wins', n.my_wins,
                          'losses', n.opp_wins
                        ) FROM nemesis n)
          )
        )
      END
    ),

    -- =========================================================================
    -- DISCOVER LANE
    -- =========================================================================
    'discover', jsonb_build_object(
      -- Unplayed pairings: members with similar skill the caller has never played.
      'unplayed_pairings', coalesce((
        WITH caller_skill AS (
          SELECT rating_value FROM player_skill WHERE player_id = v_caller
        ),
        candidates AS (
          SELECT
            pj.player_id,
            pj.first_name,
            pj.last_name,
            pj.profile_picture_url,
            pj.rating_value,
            pj.games_played
          FROM player_json pj
          WHERE pj.player_id <> v_caller
            AND pj.games_played > 0
            -- Never played before (no entry in pair_h2h with caller).
            AND NOT EXISTS (
              SELECT 1 FROM pair_h2h ph
              WHERE (ph.player_a_id = v_caller AND ph.player_b_id = pj.player_id)
                 OR (ph.player_b_id = v_caller AND ph.player_a_id = pj.player_id)
            )
        )
        SELECT jsonb_agg(jsonb_build_object(
          'peer_player_id', c.player_id,
          'first_name',     c.first_name,
          'last_name',      c.last_name,
          'profile_picture_url', c.profile_picture_url,
          'rating_value',   c.rating_value,
          'games_played',   c.games_played
        ) ORDER BY
            CASE WHEN (SELECT rating_value FROM caller_skill) IS NULL OR c.rating_value IS NULL THEN 1
                 ELSE abs(c.rating_value - (SELECT rating_value FROM caller_skill)) END ASC,
            c.games_played DESC
        )
        FROM (SELECT * FROM candidates LIMIT 3) c
      ), '[]'::jsonb),

      -- Rivalry of the week: pair with most matches in window.
      'rivalry_of_week', (
        SELECT jsonb_build_object(
          'player_a_id', ph.player_a_id,
          'player_b_id', ph.player_b_id,
          'a_first_name',(SELECT first_name FROM player_profile WHERE player_id = ph.player_a_id),
          'b_first_name',(SELECT first_name FROM player_profile WHERE player_id = ph.player_b_id),
          'a_wins',      ph.a_wins,
          'b_wins',      ph.b_wins,
          'matches',     ph.games
        )
        FROM pair_h2h ph
        WHERE ph.games >= 2
        ORDER BY ph.games DESC, abs(ph.a_wins - ph.b_wins) ASC
        LIMIT 1
      ),

      -- Power pair: best doubles duo (≥3 matches together).
      'power_pair', (
        SELECT jsonb_build_object(
          'player_a_id',  pp_.player_a_id,
          'player_b_id',  pp_.player_b_id,
          'a_first_name', (SELECT first_name FROM player_profile WHERE player_id = pp_.player_a_id),
          'b_first_name', (SELECT first_name FROM player_profile WHERE player_id = pp_.player_b_id),
          'wins',         pp_.wins,
          'losses',       pp_.losses
        )
        FROM partner_pairs pp_
        WHERE pp_.matches >= 3
        ORDER BY (pp_.wins::numeric / nullif(pp_.matches,0)) DESC, pp_.matches DESC
        LIMIT 1
      ),

      -- Moments: most-recent inline highlights (computable, not stored).
      'moments', coalesce((
        WITH streak_moments AS (
          SELECT
            'streak'                                                AS type,
            pj.player_id                                            AS player_id,
            'groups.leaderboard.discover.momentStreak'              AS title_key,
            jsonb_build_object(
              'name',  pj.first_name,
              'count', pj.current_streak
            ) AS title_params,
            pj.last_match_date AS happened_at
          FROM player_json pj
          WHERE pj.current_streak >= 4
        ),
        all_moments AS (
          SELECT * FROM streak_moments
        )
        SELECT jsonb_agg(
          jsonb_build_object(
            'type',         type,
            'player_id',    player_id,
            'title_key',    title_key,
            'title_params', title_params,
            'happened_at',  happened_at
          ) ORDER BY happened_at DESC
        )
        FROM (SELECT * FROM all_moments ORDER BY happened_at DESC LIMIT 3) m
      ), '[]'::jsonb),

      -- H2H matrix (groups only).
      'h2h_matrix', CASE WHEN coalesce(v_is_group, FALSE) THEN coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'row_player_id', ph.player_a_id,
          'col_player_id', ph.player_b_id,
          'wins',          ph.a_wins,
          'losses',        ph.b_wins
        ))
        FROM pair_h2h ph
      ), '[]'::jsonb) ELSE NULL END
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_network_pulse(uuid, int) TO authenticated;

COMMENT ON FUNCTION public.get_network_pulse(uuid, int) IS
  'Single-call story-driven payload for the Group/Community Leaderboard tab. '
  'Returns jsonb with headline_insight, form_strip, your_summary (rank, stats, '
  'matchup_extremes), leaderboard, settling_in, discover (unplayed_pairings, '
  'rivalry_of_week, power_pair, moments, h2h_matrix groups-only).';
