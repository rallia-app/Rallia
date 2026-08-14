-- Canonicalize tournament_matches.score on a player1-first orientation.
--
-- Four sites disagreed about what the string means. TournamentRecordScoreSheet
-- serializes player1-first, PoolsSection prints it raw next to
-- "player1 vs player2", lt_propagate_match_result_to_bracket copied the linked
-- match's team1-team2 verbatim (team 1 is the match's own ordering, unrelated
-- to the bracket row), and tournament_pool_standings parsed it winner-first.
-- Both readings are wrong in a measurable way, verified on staging:
--   * an organizer-entered game won by the player2 side credited its sets and
--     games to the loser. On a live pool line a 3-0 record read sets 6-0 when
--     the text was winner-first and 4-2 for the same games stored
--     player1-first, and those ratios are what the tie-break cascade uses to
--     decide qualification and knockout seeding;
--   * a linked game rendered as a loss for its winner whenever the bracket's
--     player1 sat on the match's team 2.
--
-- Player1-first wins because it is the only orientation defined without a
-- winner (walkovers, cancellations, even splits) and it is already what the
-- app writes. The parser and the bridge move to it here; no other function
-- parses the column (checked against pg_proc).

-- ============================================
-- 1. tournament_pool_standings — the score text is player1-first.
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
SECURITY DEFINER
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

    -- RLS no longer filters the reads below, so reproduce tmatches_select:
    -- whoever may see the tournament's matches may see its standings.
    IF NOT (
        public.is_admin()
        OR public.tournament_is_public(p_tournament_id)
        OR public.is_tournament_organizer(p_tournament_id)
        OR public.is_tournament_registrant(p_tournament_id)
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_VISIBLE';
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
    -- match when present, else from the player1-first score text.
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
              -- The left number of every set belongs to the row's player1, so
              -- orientation comes from the slot, never from who won. Read
              -- winner-first, sets and games landed on the wrong player for
              -- every game the player2 side took, and those are the ratios the
              -- tie-break cascade ranks on.
              SELECT sum(CASE WHEN is_p1 THEN gp1 ELSE gp2 END)::int  AS games_w,
                     sum(CASE WHEN is_p1 THEN gp2 ELSE gp1 END)::int  AS games_l,
                     count(*) FILTER (WHERE (gp1 > gp2) = is_p1 AND gp1 <> gp2)::int AS sets_w,
                     count(*) FILTER (WHERE (gp1 < gp2) = is_p1 AND gp1 <> gp2)::int AS sets_l
                FROM (
                    SELECT split_part(setp, '-', 1)::int AS gp1,
                           split_part(setp, '-', 2)::int AS gp2,
                           (s.player1_registration_id = pr.reg) AS is_p1
                      FROM regexp_split_to_table(s.score, '\s+') AS setp
                     WHERE setp ~ '^\d+-\d+$'
                ) parsed
          ) txt ON s.match_id IS NULL AND s.score IS NOT NULL
    ),
    totals AS (
        SELECT pm.reg,
               sum(pm.win)::int      AS wins,
               count(*)::int         AS settled,
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
-- 2. lt_propagate_match_result_to_bracket — orient the copied score to player1.
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
    v_p1_team      smallint;
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

    -- Which side of the MATCH the bracket's player1 played on. The two
    -- orderings are independent, so copying team1-team2 verbatim rendered a win
    -- as a loss whenever player1 happened to sit on team 2.
    SELECT min(mp.team_number) INTO v_p1_team
      FROM match_participant mp
      JOIN tournament_registrations r ON r.id = v_tm.player1_registration_id
     WHERE mp.match_id = v_mr.match_id
       AND mp.player_id IN (r.user_id, r.partner_user_id);

    SELECT string_agg(
               CASE WHEN v_p1_team = 2
                    THEN s.team2_score || '-' || s.team1_score
                    ELSE s.team1_score || '-' || s.team2_score END,
               ' ' ORDER BY s.set_number)
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

COMMENT ON COLUMN public.tournament_matches.score IS
    'Per-set games, player1 first ("6-4 3-6 6-2" means player1 took the first set 6-4). Readers orient on the slot, never on the winner.';

GRANT EXECUTE ON FUNCTION public.tournament_pool_standings(uuid) TO authenticated;
