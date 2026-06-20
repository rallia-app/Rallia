-- ============================================
-- Leagues & Tournaments — V9: session scoring + season ranking
-- ============================================
-- Spec: specs/17-leagues-tournaments/rollout.md §V9
--       specs/17-leagues-tournaments/ranking.md, score-entry.md
--
-- Ships:
--   lt_parse_score          score string -> set/game totals (mirrors TS
--                           packages/shared-utils/src/leagues/ranking.ts)
--   recalc_season_ranking   recompute season_rankings from terminal matches
--   session_record_score    organizer/participant records a match result,
--                           recomputes session completion, recalcs ranking
--   season_close            finalize: recalc + snapshot final_standings + close
--
-- Scoring path: results are written directly onto session_matches (singles
-- BY_RANK). This deliberately does NOT reuse the casual match_result/confirm
-- flow (kept out of blast radius); deep casual-match integration is a future
-- enhancement. Byes are not stored as rows (V8), so they award no points here.
-- Head-to-head tiebreak and season badges are deferred. Notifications: V10.
-- ============================================


-- =====================
-- lt_parse_score — mirrors parseScore() in ranking.ts
-- =====================

CREATE OR REPLACE FUNCTION public.lt_parse_score(
    p_score    text,
    OUT a_sets  integer,
    OUT b_sets  integer,
    OUT a_games integer,
    OUT b_games integer
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_clean text;
    v_tok   text;
    v_parts text[];
    v_a     integer;
    v_b     integer;
BEGIN
    a_sets := 0; b_sets := 0; a_games := 0; b_games := 0;
    IF p_score IS NULL THEN RETURN; END IF;

    v_clean := p_score;
    v_clean := regexp_replace(v_clean, '\([^)]*\)', '', 'g');   -- tiebreak detail
    v_clean := regexp_replace(v_clean, '[\[\]]', '', 'g');       -- super-tb brackets
    v_clean := regexp_replace(v_clean, 'to\s+\d+', '', 'gi');    -- pickleball target
    v_clean := regexp_replace(v_clean, 'RET|W/O|DEF|INT', '', 'gi'); -- modifiers
    v_clean := trim(v_clean);
    IF v_clean = '' THEN RETURN; END IF;

    FOR v_tok IN SELECT unnest(regexp_split_to_array(v_clean, '[,\s]+')) LOOP
        v_tok := trim(v_tok);
        CONTINUE WHEN v_tok = '';
        IF v_tok ~ '^\d+-\d+$' THEN
            v_parts := string_to_array(v_tok, '-');
            v_a := v_parts[1]::integer;
            v_b := v_parts[2]::integer;
            a_games := a_games + v_a;
            b_games := b_games + v_b;
            -- Count a set only past a completed-set threshold (tennis 6 /
            -- pickleball 11); partial retirement sets contribute games only.
            IF greatest(v_a, v_b) >= 6 THEN
                IF v_a > v_b THEN a_sets := a_sets + 1;
                ELSIF v_b > v_a THEN b_sets := b_sets + 1;
                END IF;
            END IF;
        END IF;
    END LOOP;
END;
$$;


-- =====================
-- recalc_season_ranking — recompute season_rankings from terminal matches
-- =====================

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

    v_pt_win  := COALESCE((v_season.rules->>'pointWin')::int, 10);
    v_pt_loss := COALESCE((v_season.rules->>'pointLoss')::int, 1);
    v_pt_rw   := COALESCE((v_season.rules->>'pointRetirementWinner')::int, v_pt_win);
    v_pt_rl   := COALESCE((v_season.rules->>'pointRetirementLoser')::int, v_pt_loss);
    v_pt_ww   := COALESCE((v_season.rules->>'pointWalkoverWinner')::int, v_pt_win);
    v_pt_wl   := COALESCE((v_season.rules->>'pointWalkoverLoser')::int, 0);

    -- Sessions that ran (used as the participation denominator).
    SELECT count(*) INTO v_eligible
      FROM sessions WHERE season_id = p_season_id AND status = 'completed';

    -- Reset all members' counters (rows seeded at season_open).
    UPDATE season_rankings
       SET points = 0, wins = 0, losses = 0, draws = 0, no_shows = 0,
           sets_won = 0, sets_lost = 0, games_won = 0, games_lost = 0,
           matches_played = 0, sessions_attended = 0,
           sessions_eligible = v_eligible,
           last_recalculated_at = now(), updated_at = now()
     WHERE season_id = p_season_id;

    -- Per-player contributions from every terminal, non-drill match.
    WITH parsed AS (
        SELECT sm.session_id, sm.status, sm.winner_team,
               sm.team_a_user_ids, sm.team_b_user_ids,
               ps.a_sets, ps.b_sets, ps.a_games, ps.b_games
          FROM session_matches sm
          JOIN sessions ss ON ss.id = sm.session_id
          CROSS JOIN LATERAL public.lt_parse_score(sm.score) ps
         WHERE ss.season_id = p_season_id
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


-- =====================
-- session_record_score — record a match result
-- =====================

CREATE OR REPLACE FUNCTION public.session_record_score(
    p_session_match_id uuid,
    p_winner_team      pairing_team,
    p_score            text                  DEFAULT NULL,
    p_status           session_match_status  DEFAULT 'completed',
    p_version_was      integer               DEFAULT NULL
)
RETURNS session_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller        uuid := auth.uid();
    v_match         session_matches;
    v_session       sessions;
    v_season        seasons;
    v_is_participant boolean;
    v_row           session_matches;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_match FROM session_matches WHERE id = p_session_match_id;
    IF v_match.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_NOT_FOUND';
    END IF;

    SELECT * INTO v_session FROM sessions WHERE id = v_match.session_id;
    SELECT * INTO v_season FROM seasons WHERE id = v_session.season_id;

    v_is_participant := v_caller = ANY (v_match.team_a_user_ids || v_match.team_b_user_ids);
    IF NOT (public.is_league_organizer(v_season.league_id) OR public.is_admin() OR v_is_participant) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ALLOWED';
    END IF;

    IF v_session.status NOT IN ('published', 'in_progress') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_NOT_ACTIVE';
    END IF;
    IF p_status NOT IN ('completed', 'retired', 'walkover') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_STATUS';
    END IF;
    IF p_winner_team IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WINNER_REQUIRED';
    END IF;

    -- `locked` only protects a pairing from regeneration; it does not block
    -- scoring the game.
    UPDATE session_matches
       SET score = p_score, winner_team = p_winner_team, status = p_status,
           played_at = now(), version = version + 1, updated_at = now()
     WHERE id = p_session_match_id AND version = p_version_was
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (SELECT 1 FROM session_matches WHERE id = p_session_match_id AND version <> p_version_was) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_NOT_FOUND';
    END IF;

    INSERT INTO session_match_scores (
        session_match_id, submitted_by, score, outcome_team, status, validated_by, validated_at
    )
    VALUES (
        p_session_match_id, v_caller, COALESCE(p_score, ''), p_winner_team, 'validated', v_caller, now()
    );

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'session_match', v_row.id, 'record_score', v_caller,
        jsonb_build_object('winner_team', p_winner_team, 'status', p_status, 'score', p_score)
    );

    -- Session completes once no playable matches remain.
    IF NOT EXISTS (
        SELECT 1 FROM session_matches
         WHERE session_id = v_session.id AND status IN ('pending', 'in_progress')
    ) AND EXISTS (
        SELECT 1 FROM session_matches
         WHERE session_id = v_session.id AND status <> 'cancelled'
    ) THEN
        UPDATE sessions
           SET status = 'completed', completed_at = now(), version = version + 1, updated_at = now()
         WHERE id = v_session.id AND status <> 'completed';
    END IF;

    PERFORM public.recalc_season_ranking(v_session.season_id);

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.session_record_score(uuid, pairing_team, text, session_match_status, integer)
    TO authenticated;


-- =====================
-- season_close — finalize standings and close the season
-- =====================

CREATE OR REPLACE FUNCTION public.season_close(
    p_season_id   uuid,
    p_version_was integer
)
RETURNS seasons
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller    uuid := auth.uid();
    v_season    seasons;
    v_standings jsonb;
    v_row       seasons;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_season FROM seasons WHERE id = p_season_id;
    IF v_season.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_FOUND';
    END IF;

    IF NOT (public.is_league_organizer(v_season.league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    IF v_season.status <> 'open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_OPEN';
    END IF;

    IF EXISTS (
        SELECT 1 FROM sessions
         WHERE season_id = p_season_id AND status IN ('published', 'in_progress')
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_HAS_OPEN_SESSIONS';
    END IF;

    PERFORM public.recalc_season_ranking(p_season_id);

    SELECT jsonb_agg(
             jsonb_build_object(
               'user_id', user_id, 'rank', rank, 'points', points,
               'wins', wins, 'losses', losses
             ) ORDER BY rank
           )
      INTO v_standings
      FROM season_rankings WHERE season_id = p_season_id;

    UPDATE seasons
       SET status = 'closed', closed_at = now(),
           final_standings = COALESCE(v_standings, '[]'::jsonb),
           version = version + 1, updated_at = now()
     WHERE id = p_season_id AND version = p_version_was AND status = 'open'
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (SELECT 1 FROM seasons WHERE id = p_season_id AND version <> p_version_was) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_OPEN';
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'season', p_season_id, 'close', v_caller,
        jsonb_build_object('league_id', v_season.league_id, 'standings', v_standings)
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.season_close(uuid, integer) TO authenticated;
