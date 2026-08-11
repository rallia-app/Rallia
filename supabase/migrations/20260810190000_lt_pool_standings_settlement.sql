-- Pool + knockout tournaments — F2: standings + settlement.
--
--   * tournament_pool_standings — derived (never stored) per-pool ranking.
--     Order: wins → head-to-head when exactly two are tied → set ratio over
--     all pool matches → game ratio → seed position. Whenever a ratio step
--     reduces a bigger tie to exactly two players, head-to-head decides
--     between them (standard round-robin procedure). Withdrawn/disqualified
--     registrations rank last in their pool and are flagged ineligible.
--   * tournament_forfeit_registration — organizer removes a player during
--     the pool phase: registration goes 'disqualified', every unsettled pool
--     match becomes a walkover win for the opponent. Two already-forfeited
--     players never meet: their mutual match was settled by the first call.
--   * lt_propagate_match_result_to_bracket — body from 20260612160300 with
--     the settle guard widened from 'completed' to every terminal status, so
--     a late player confirmation can't overwrite a walkover or an override.
--
-- Set/game counters come from the linked verified match when there is one
-- (the standard score path). For organizer overrides (score text only) the
-- score is read winner-first, which is how the override sheet captures it.
-- Walkovers carry no sets and don't count as played.

-- ============================================
-- _lt_rank_pool_group — recursive tie resolution inside one pool.
-- Levels: 1 = set ratio, 2 = game ratio, 3 = seed position (total order).
-- Reads the caller's _pool_stats temp table.
-- ============================================

CREATE OR REPLACE FUNCTION public._lt_rank_pool_group(
    p_tournament_id uuid,
    p_regs          uuid[],
    p_level         integer
)
RETURNS uuid[]
LANGUAGE plpgsql
AS $$
DECLARE
    v_n        integer := coalesce(array_length(p_regs, 1), 0);
    v_h2h      uuid;
    v_ordered  uuid[];
    v_result   uuid[] := '{}';
    v_group    uuid[];
    v_prev_key numeric;
    v_key      numeric;
    v_reg      uuid;
BEGIN
    IF v_n <= 1 THEN
        RETURN p_regs;
    END IF;

    IF v_n = 2 THEN
        SELECT tm.winner_registration_id INTO v_h2h
          FROM tournament_matches tm
         WHERE tm.tournament_id = p_tournament_id
           AND tm.bracket_side  = 'pool'
           AND tm.status IN ('completed', 'retired', 'walkover')
           AND tm.winner_registration_id IS NOT NULL
           AND tm.player1_registration_id = ANY (p_regs)
           AND tm.player2_registration_id = ANY (p_regs)
         LIMIT 1;
        IF v_h2h IS NOT NULL THEN
            RETURN ARRAY[v_h2h] || array_remove(p_regs, v_h2h);
        END IF;
    END IF;

    IF p_level >= 3 THEN
        RETURN ARRAY(
            SELECT s.reg FROM _pool_stats s
             WHERE s.reg = ANY (p_regs)
             ORDER BY s.seed_pos
        );
    END IF;

    v_ordered := ARRAY(
        SELECT s.reg FROM _pool_stats s
         WHERE s.reg = ANY (p_regs)
         ORDER BY CASE WHEN p_level = 1 THEN s.set_ratio ELSE s.game_ratio END DESC,
                  s.seed_pos
    );

    v_group    := '{}';
    v_prev_key := NULL;
    FOREACH v_reg IN ARRAY v_ordered LOOP
        SELECT CASE WHEN p_level = 1 THEN s.set_ratio ELSE s.game_ratio END
          INTO v_key FROM _pool_stats s WHERE s.reg = v_reg;
        IF v_prev_key IS NOT NULL AND v_key IS DISTINCT FROM v_prev_key THEN
            v_result := v_result
                || public._lt_rank_pool_group(p_tournament_id, v_group, p_level + 1);
            v_group := '{}';
        END IF;
        v_group    := v_group || v_reg;
        v_prev_key := v_key;
    END LOOP;
    IF array_length(v_group, 1) = v_n THEN
        -- The key didn't split anything: move straight down a level.
        RETURN public._lt_rank_pool_group(p_tournament_id, v_group, p_level + 1);
    END IF;
    v_result := v_result
        || public._lt_rank_pool_group(p_tournament_id, v_group, p_level + 1);
    RETURN v_result;
END;
$$;

-- ============================================
-- tournament_pool_standings — derived standings, one row per registration
-- that appears in a pool. SECURITY INVOKER: table RLS decides visibility.
-- ============================================

CREATE OR REPLACE FUNCTION public.tournament_pool_standings(
    p_tournament_id uuid
)
RETURNS TABLE (
    pool_number     integer,
    pool_rank       integer,
    registration_id uuid,
    user_id         uuid,
    partner_user_id uuid,
    wins            integer,
    settled         integer,
    sets_won        integer,
    sets_lost       integer,
    games_won       integer,
    games_lost      integer,
    withdrawn       boolean,
    eligible        boolean
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_tournament tournaments;
    v_pool       integer;
    v_active     uuid[];
    v_out        uuid[];
    v_ordered    uuid[];
    v_group      uuid[];
    v_prev_wins  integer;
    v_reg        uuid;
    v_wins       integer;
    v_rank       integer;
BEGIN
    SELECT * INTO v_tournament FROM tournaments t WHERE t.id = p_tournament_id;
    IF v_tournament.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;
    IF v_tournament.bracket_type <> 'pool_knockout' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_POOL_TOURNAMENT';
    END IF;

    CREATE TEMP TABLE IF NOT EXISTS _pool_stats (
        reg        uuid PRIMARY KEY,
        pool       integer NOT NULL,
        usr        uuid,
        partner    uuid,
        wins       integer NOT NULL,
        settled    integer NOT NULL,
        sets_w     integer NOT NULL,
        sets_l     integer NOT NULL,
        games_w    integer NOT NULL,
        games_l    integer NOT NULL,
        set_ratio  numeric NOT NULL,
        game_ratio numeric NOT NULL,
        seed_pos   integer NOT NULL,
        is_out     boolean NOT NULL
    ) ON COMMIT DROP;
    TRUNCATE _pool_stats;

    INSERT INTO _pool_stats
    WITH pool_regs AS (
        SELECT DISTINCT tm.pool_number AS pool, r.reg
          FROM tournament_matches tm
          CROSS JOIN LATERAL (VALUES
              (tm.player1_registration_id), (tm.player2_registration_id)
          ) AS r(reg)
         WHERE tm.tournament_id = p_tournament_id
           AND tm.bracket_side  = 'pool'
           AND r.reg IS NOT NULL
    ),
    settled AS (
        SELECT tm.*
          FROM tournament_matches tm
         WHERE tm.tournament_id = p_tournament_id
           AND tm.bracket_side  = 'pool'
           AND tm.status IN ('completed', 'retired', 'walkover')
    ),
    -- Per (registration, settled match): sets/games from the linked verified
    -- match when present, else from the winner-first score text.
    per_match AS (
        SELECT pr.reg,
               s.id AS tm_id,
               (s.winner_registration_id = pr.reg)::int AS win,
               CASE WHEN s.status = 'walkover' THEN 0 ELSE 1 END AS played,
               COALESCE(ms.sets_w, txt.sets_w, 0)  AS sets_w,
               COALESCE(ms.sets_l, txt.sets_l, 0)  AS sets_l,
               COALESCE(ms.games_w, txt.games_w, 0) AS games_w,
               COALESCE(ms.games_l, txt.games_l, 0) AS games_l
          FROM pool_regs pr
          JOIN settled s
            ON pr.reg IN (s.player1_registration_id, s.player2_registration_id)
          LEFT JOIN tournament_registrations reg2 ON reg2.id = pr.reg
          LEFT JOIN LATERAL (
              -- min() collapses a doubles pair to its single team side, so
              -- each set is counted once regardless of participant count.
              SELECT count(*) FILTER (WHERE (tn.t = 1) = (st.team1_score > st.team2_score)
                                        AND st.team1_score <> st.team2_score)::int AS sets_w,
                     count(*) FILTER (WHERE (tn.t = 1) = (st.team1_score < st.team2_score)
                                        AND st.team1_score <> st.team2_score)::int AS sets_l,
                     sum(CASE WHEN tn.t = 1 THEN st.team1_score ELSE st.team2_score END)::int AS games_w,
                     sum(CASE WHEN tn.t = 1 THEN st.team2_score ELSE st.team1_score END)::int AS games_l
                FROM (SELECT min(mp.team_number) AS t
                        FROM match_participant mp
                       WHERE mp.match_id = s.match_id
                         AND mp.player_id IN (reg2.user_id, reg2.partner_user_id)) tn
                JOIN match_result mr ON mr.match_id = s.match_id AND mr.is_verified IS TRUE
                JOIN match_set st ON st.match_result_id = mr.id
               WHERE tn.t IS NOT NULL
          ) ms ON s.match_id IS NOT NULL
          LEFT JOIN LATERAL (
              SELECT sum(CASE WHEN win_side THEN gw ELSE gl END)::int  AS games_w,
                     sum(CASE WHEN win_side THEN gl ELSE gw END)::int  AS games_l,
                     count(*) FILTER (WHERE (gw > gl) = win_side AND gw <> gl)::int AS sets_w,
                     count(*) FILTER (WHERE (gw < gl) = win_side AND gw <> gl)::int AS sets_l
                FROM (
                    SELECT split_part(setp, '-', 1)::int AS gw,
                           split_part(setp, '-', 2)::int AS gl,
                           (s.winner_registration_id = pr.reg) AS win_side
                      FROM regexp_split_to_table(s.score, '\s+') AS setp
                     WHERE setp ~ '^\d+-\d+$'
                ) parsed
          ) txt ON s.match_id IS NULL AND s.score IS NOT NULL
    ),
    totals AS (
        SELECT pm.reg,
               sum(pm.win)::int      AS wins,
               count(*)::int         AS settled,
               sum(pm.played)::int   AS played,
               sum(pm.sets_w)::int   AS sets_w,
               sum(pm.sets_l)::int   AS sets_l,
               sum(pm.games_w)::int  AS games_w,
               sum(pm.games_l)::int  AS games_l
          FROM per_match pm
         GROUP BY pm.reg
    )
    SELECT pr.reg,
           pr.pool,
           tr.user_id,
           tr.partner_user_id,
           COALESCE(t.wins, 0),
           COALESCE(t.settled, 0),
           COALESCE(t.sets_w, 0),
           COALESCE(t.sets_l, 0),
           COALESCE(t.games_w, 0),
           COALESCE(t.games_l, 0),
           CASE WHEN COALESCE(t.sets_w, 0) + COALESCE(t.sets_l, 0) = 0 THEN -1
                ELSE t.sets_w::numeric / (t.sets_w + t.sets_l) END,
           CASE WHEN COALESCE(t.games_w, 0) + COALESCE(t.games_l, 0) = 0 THEN -1
                ELSE t.games_w::numeric / (t.games_w + t.games_l) END,
           (row_number() OVER (ORDER BY tr.seed_rank ASC NULLS LAST, tr.registered_at ASC, tr.id ASC))::int,
           tr.status IN ('withdrawn', 'disqualified')
      FROM pool_regs pr
      JOIN tournament_registrations tr ON tr.id = pr.reg
      LEFT JOIN totals t ON t.reg = pr.reg;

    FOR v_pool IN
        SELECT DISTINCT s.pool FROM _pool_stats s ORDER BY s.pool
    LOOP
        v_active := ARRAY(
            SELECT s.reg FROM _pool_stats s
             WHERE s.pool = v_pool AND NOT s.is_out
             ORDER BY s.wins DESC, s.seed_pos
        );
        v_out := ARRAY(
            SELECT s.reg FROM _pool_stats s
             WHERE s.pool = v_pool AND s.is_out
             ORDER BY s.wins DESC, s.set_ratio DESC, s.game_ratio DESC, s.seed_pos
        );

        -- Actives: group by wins, resolve each tie group through the cascade.
        v_ordered   := '{}';
        v_group     := '{}';
        v_prev_wins := NULL;
        FOREACH v_reg IN ARRAY v_active LOOP
            SELECT s.wins INTO v_wins FROM _pool_stats s WHERE s.reg = v_reg;
            IF v_prev_wins IS NOT NULL AND v_wins <> v_prev_wins THEN
                v_ordered := v_ordered
                    || public._lt_rank_pool_group(p_tournament_id, v_group, 1);
                v_group := '{}';
            END IF;
            v_group     := v_group || v_reg;
            v_prev_wins := v_wins;
        END LOOP;
        IF array_length(v_group, 1) > 0 THEN
            v_ordered := v_ordered
                || public._lt_rank_pool_group(p_tournament_id, v_group, 1);
        END IF;

        v_ordered := v_ordered || v_out;

        v_rank := 0;
        FOREACH v_reg IN ARRAY v_ordered LOOP
            v_rank := v_rank + 1;
            RETURN QUERY
                SELECT s.pool, v_rank, s.reg, s.usr, s.partner,
                       s.wins, s.settled, s.sets_w, s.sets_l, s.games_w, s.games_l,
                       s.is_out, NOT s.is_out
                  FROM _pool_stats s WHERE s.reg = v_reg;
        END LOOP;
    END LOOP;
END;
$$;

-- ============================================
-- tournament_forfeit_registration — organizer removes a player mid-pools.
-- ============================================

CREATE OR REPLACE FUNCTION public.tournament_forfeit_registration(
    p_registration_id uuid,
    p_version_was     integer,
    p_reason          text DEFAULT NULL
)
RETURNS tournament_registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id  uuid := auth.uid();
    v_reg        tournament_registrations;
    v_tournament tournaments;
    v_row        tournament_registrations;
    v_settled    integer;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT r.* INTO v_reg FROM tournament_registrations r WHERE r.id = p_registration_id;
    IF v_reg.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REGISTRATION_NOT_FOUND';
    END IF;

    IF NOT (public.is_tournament_organizer(v_reg.tournament_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = v_reg.tournament_id FOR UPDATE;
    -- Pool phase only: pools exist, knockout not yet generated. Knockout-phase
    -- exits stay on the override/walkover path like single elimination.
    IF v_tournament.bracket_type <> 'pool_knockout'
       OR v_tournament.status <> 'in_progress'
       OR EXISTS (
           SELECT 1 FROM tournament_matches
            WHERE tournament_id = v_tournament.id AND bracket_side = 'main'
       )
       OR NOT EXISTS (
           SELECT 1 FROM tournament_matches
            WHERE tournament_id = v_tournament.id AND bracket_side = 'pool'
       ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'FORFEIT_NOT_ALLOWED';
    END IF;

    UPDATE tournament_registrations
       SET status       = 'disqualified',
           withdrawn_at = now(),
           version      = version + 1,
           updated_at   = now()
     WHERE id      = p_registration_id
       AND version = p_version_was
       AND status  = 'registered'
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (
            SELECT 1 FROM tournament_registrations
             WHERE id = p_registration_id AND version <> p_version_was
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REGISTRATION_NOT_FOUND';
    END IF;

    UPDATE tournament_matches tm
       SET status                 = 'walkover',
           winner_registration_id = CASE WHEN tm.player1_registration_id = p_registration_id
                                         THEN tm.player2_registration_id
                                         ELSE tm.player1_registration_id END,
           played_at              = now(),
           version                = version + 1,
           updated_at             = now()
     WHERE tm.tournament_id = v_tournament.id
       AND tm.bracket_side  = 'pool'
       AND tm.status IN ('pending', 'in_progress', 'disputed')
       AND p_registration_id IN (tm.player1_registration_id, tm.player2_registration_id);
    GET DIAGNOSTICS v_settled = ROW_COUNT;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'registration', v_row.id, 'pool_forfeit', v_caller_id,
        jsonb_build_object(
            'tournament_id', v_row.tournament_id,
            'user_id', v_row.user_id,
            'reason', p_reason,
            'walkovers_created', v_settled
        )
    );

    RETURN v_row;
END;
$$;

-- ============================================
-- lt_propagate_match_result_to_bracket — body from 20260612160300; the
-- settle guard now covers every terminal status so a late confirmation can't
-- overwrite a walkover, retirement, cancellation or override.
-- ============================================

CREATE OR REPLACE FUNCTION public.lt_propagate_match_result_to_bracket(p_match_result_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_mr           match_result;
    v_tm           tournament_matches;
    v_winner_user  uuid;
    v_winner_reg   uuid;
    v_score_text   text;
BEGIN
    SELECT * INTO v_mr FROM match_result WHERE id = p_match_result_id;
    IF v_mr.id IS NULL OR v_mr.is_verified IS NOT TRUE THEN
        RETURN;
    END IF;

    SELECT * INTO v_tm FROM tournament_matches WHERE match_id = v_mr.match_id;
    IF v_tm.id IS NULL THEN
        RETURN;
    END IF;
    IF v_tm.status IN ('completed', 'walkover', 'retired', 'cancelled') THEN
        RETURN;
    END IF;

    SELECT mp.player_id INTO v_winner_user
      FROM match_participant mp
     WHERE mp.match_id    = v_mr.match_id
       AND mp.team_number = v_mr.winning_team
     LIMIT 1;
    IF v_winner_user IS NULL THEN
        RETURN;
    END IF;

    SELECT r.id INTO v_winner_reg
      FROM tournament_registrations r
     WHERE r.id IN (v_tm.player1_registration_id, v_tm.player2_registration_id)
       AND (r.user_id = v_winner_user OR r.partner_user_id = v_winner_user);
    IF v_winner_reg IS NULL THEN
        RETURN;
    END IF;

    SELECT string_agg(s.team1_score || '-' || s.team2_score, ' ' ORDER BY s.set_number)
      INTO v_score_text
      FROM match_set s
     WHERE s.match_result_id = v_mr.id;

    UPDATE tournament_matches
       SET winner_registration_id = v_winner_reg,
           score                  = v_score_text,
           status                 = 'completed',
           played_at              = now(),
           version                = version + 1,
           updated_at             = now()
     WHERE id = v_tm.id;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament_match', v_tm.id, 'submit_score',
        coalesce(v_mr.confirmed_by, v_mr.submitted_by),
        jsonb_build_object(
            'tournament_id', v_tm.tournament_id,
            'round', v_tm.round_number,
            'position', v_tm.match_position,
            'winner_registration_id', v_winner_reg,
            'score', v_score_text,
            'match_result_id', v_mr.id
        )
    );

    PERFORM public.lt_advance_tournament_winner(v_tm.id, v_winner_reg);
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_pool_standings(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_forfeit_registration(uuid, integer, text) TO authenticated;
