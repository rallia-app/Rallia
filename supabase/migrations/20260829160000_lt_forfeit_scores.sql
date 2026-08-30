-- ============================================================================
-- A walkover is a defeat, and it looks like one: the format's forfeit score.
-- ============================================================================
-- Jean's rule, 2026-08-23 (unplayed-match-resolution.md § 5): in pools as in
-- the draw, a forfeit is a defeat with the same consequences as any other,
-- carrying the format's forfeit score (8-0, or 6-0 6-0). Until now a walkover
-- was stamped 'W/O' with played 0: the winner got a win, but the loser's set
-- and game ratios never moved, so a no-show stayed off the loser's record and
-- not playing could beat losing in a tight pool.
--
-- Two halves, and the standings half is the load-bearing one:
--
-- 1. tournament_pool_standings synthesizes every walkover row from status,
--    winner and format instead of parsing its score text: winner takes the
--    full forfeit line (ratios included), loser its mirror, a double walkover
--    (winner NULL) hands the losing line to both, and the row stays in the
--    denominator. Synthesis rather than text means the rows Série 1 and the
--    resolver already stamped 'W/O' count correctly with no backfill, and a
--    walkover with an attached-but-unplayed game (no verified result to read)
--    counts too. _lt_rank_pool_group reads _pool_stats, so the tie-break
--    cascade follows for free.
--
-- 2. The three walkover writers stamp the visible score via the new
--    lt_forfeit_score helper, player1-first like every score text:
--    tournament_override_score (which now FORCES the format score on the
--    walkover outcome rather than accepting a typed one: the score is fixed
--    by the format, and an organizer holding a real score records completed
--    or retired), tournament_forfeit_registration (mid-pool exit walkovers),
--    and lt_resolve_due_tournament_matches (single walkover; parked in
--    dry-run, so nothing fires live today).
--
-- Deliberately unchanged, per the spec's § 5 ledger table:
--   * lt_advance_double_walkover ("unchanged by any of this"): 'W/O-W/O' text
--     stays; standings synthesize the two defeats from winner IS NULL.
--   * Rating: a walkover never creates a verified match_result, so the cote
--     stays untouched, as before.
--   * Rallia Points: award_tournament_ranking_points pays by placement;
--     the league set/game bonuses read league sheets, not tournament rows.
--
-- Bodies re-issued from their latest migrations, each verified byte-identical
-- against the live local definition before editing: tournament_pool_standings
-- from 20260812210000, tournament_override_score from 20260825120000,
-- tournament_forfeit_registration from 20260811200000,
-- lt_resolve_due_tournament_matches from 20260829150000.
-- ============================================================================

-- ---------------------------------------------------------------- the helper
-- The format's forfeit line, player1-first. one_set 8 games → '8-0';
-- two_of_three 6 games → '6-0 6-0'; three_of_five → three sets; pickleball
-- carries its target in points_per_game ('11-0 11-0'). The legacy fused
-- pickleball_to_* labels fall to the two-set arm, matching their split in
-- 20260731150000.
CREATE OR REPLACE FUNCTION public.lt_forfeit_score(
    p_format          match_format,
    p_games_per_set   smallint,
    p_points_per_game smallint,
    p_winner_is_p1    boolean
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT array_to_string(
        array_fill(
            CASE WHEN p_winner_is_p1 THEN f.unit || '-0' ELSE '0-' || f.unit END,
            ARRAY[f.n]),
        ' ')
      FROM (SELECT COALESCE(p_points_per_game, p_games_per_set, 6::smallint)::int AS unit,
                   CASE p_format WHEN 'one_set' THEN 1
                                 WHEN 'three_of_five' THEN 3
                                 ELSE 2 END AS n) f;
$$;

REVOKE ALL ON FUNCTION public.lt_forfeit_score(match_format, smallint, smallint, boolean)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lt_forfeit_score(match_format, smallint, smallint, boolean)
    TO authenticated;

-- ------------------------------------------- 1. standings synthesize forfeits
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
    v_fsets      integer;
    v_funit      integer;
BEGIN
    SELECT * INTO v_tournament FROM tournaments t WHERE t.id = p_tournament_id;
    IF v_tournament.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;
    IF v_tournament.bracket_type <> 'pool_knockout' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_POOL_TOURNAMENT';
    END IF;

    -- The format's forfeit line (8-0, 6-0 6-0, 11-0 11-0), as sets and games.
    v_fsets := CASE v_tournament.match_format
                   WHEN 'one_set' THEN 1 WHEN 'three_of_five' THEN 3 ELSE 2 END;
    v_funit := COALESCE(v_tournament.points_per_game, v_tournament.games_per_set, 6);

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
    -- match when present, else from the player1-first score text. A walkover
    -- is synthesized from the format instead of read: the winner takes the
    -- full forfeit line, the loser its mirror, and a double walkover (winner
    -- NULL) hands the losing line to both. Status and winner carry it, so
    -- legacy rows whose text still says W/O count the same as new ones.
    per_match AS (
        SELECT pr.reg,
               s.id AS tm_id,
               (s.winner_registration_id = pr.reg)::int AS win,
               CASE WHEN s.status = 'walkover' THEN 0 ELSE 1 END AS played,
               CASE WHEN s.status = 'walkover'
                    THEN CASE WHEN s.winner_registration_id = pr.reg THEN v_fsets ELSE 0 END
                    ELSE COALESCE(ms.sets_w, txt.sets_w, 0)  END AS sets_w,
               CASE WHEN s.status = 'walkover'
                    THEN CASE WHEN s.winner_registration_id = pr.reg THEN 0 ELSE v_fsets END
                    ELSE COALESCE(ms.sets_l, txt.sets_l, 0)  END AS sets_l,
               CASE WHEN s.status = 'walkover'
                    THEN CASE WHEN s.winner_registration_id = pr.reg THEN v_fsets * v_funit ELSE 0 END
                    ELSE COALESCE(ms.games_w, txt.games_w, 0) END AS games_w,
               CASE WHEN s.status = 'walkover'
                    THEN CASE WHEN s.winner_registration_id = pr.reg THEN 0 ELSE v_fsets * v_funit END
                    ELSE COALESCE(ms.games_l, txt.games_l, 0) END AS games_l
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
GRANT EXECUTE ON FUNCTION public.tournament_pool_standings(uuid) TO authenticated;

-- --------------------------- 2. the organizer's walkover outcome is scored
CREATE OR REPLACE FUNCTION public.tournament_override_score(
    p_tournament_match_id    uuid,
    -- Defaulted because a cancellation has no winner: without it the generated
    -- client type demands a uuid the caller has nothing to put in.
    p_winner_registration_id uuid                    DEFAULT NULL,
    p_score                  text                    DEFAULT NULL,
    p_outcome                tournament_match_status DEFAULT 'completed'
)
RETURNS tournament_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    -- How long after completion an organizer can still fix the final. Same
    -- constant as 20260729120000; the window is not what this migration changes.
    c_window constant interval := interval '24 hours';

    v_caller_id       uuid := auth.uid();
    v_tm              tournament_matches;
    v_t               tournaments;
    v_next            tournament_matches;
    v_row             tournament_matches;
    v_post_completion boolean := false;
    v_score           text    := p_score;
    v_winner          uuid    := p_winner_registration_id;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF p_outcome NOT IN ('completed', 'walkover', 'retired', 'cancelled') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_OUTCOME';
    END IF;

    SELECT * INTO v_tm FROM tournament_matches
     WHERE id = p_tournament_match_id FOR UPDATE;
    IF v_tm.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_MATCH_NOT_FOUND';
    END IF;

    IF NOT public.is_tournament_organizer(v_tm.tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    SELECT * INTO v_t FROM tournaments WHERE id = v_tm.tournament_id;

    IF v_t.status = 'in_progress' THEN
        v_post_completion := false;
    ELSIF v_t.status = 'completed' THEN
        -- Grace window on the finished tournament. A NULL completed_at means a
        -- pre-20260714120000 row that was never stamped; treat it as closed
        -- rather than guessing an anchor.
        IF v_t.completed_at IS NULL OR now() >= v_t.completed_at + c_window THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CORRECTION_WINDOW_CLOSED';
        END IF;
        v_post_completion := true;
    ELSE
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_IN_PROGRESS';
    END IF;

    -- Every settled shape is overridable, walkover and cancelled included: the
    -- automated ladder's calls have to be reversible from the app.
    IF v_tm.status NOT IN ('pending', 'in_progress', 'disputed',
                           'completed', 'walkover', 'retired', 'cancelled') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_NOT_OVERRIDABLE';
    END IF;

    IF v_tm.player1_is_bye OR v_tm.player2_is_bye
       OR v_tm.player1_registration_id IS NULL
       OR v_tm.player2_registration_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_SLOTS_INCOMPLETE';
    END IF;

    -- Shape the write per outcome.
    IF p_outcome = 'cancelled' THEN
        -- A pool row nobody played counts for neither player. A bracket slot
        -- cannot simply vanish: somebody has to advance.
        IF v_tm.pool_number IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001',
                MESSAGE = 'CANCEL_NEEDS_BRACKET_OUTCOME';
        END IF;
        v_winner := NULL;
        v_score  := NULL;
    ELSE
        IF v_winner IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WINNER_REQUIRED';
        END IF;
        IF v_winner NOT IN (v_tm.player1_registration_id, v_tm.player2_registration_id) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WINNER_NOT_IN_MATCH';
        END IF;
        -- A walkover carries the format's forfeit score (Jean, 2026-08-23:
        -- 8-0 or 6-0 6-0), fixed by the format and not by the caller: an
        -- organizer holding a real score records completed or retired.
        IF p_outcome = 'walkover' THEN
            v_score := public.lt_forfeit_score(
                v_t.match_format, v_t.games_per_set, v_t.points_per_game,
                v_winner = v_tm.player1_registration_id);
        END IF;
    END IF;

    -- Correcting a row whose winner already advanced AND played on would
    -- invalidate that result.
    IF v_tm.next_match_id IS NOT NULL THEN
        SELECT * INTO v_next FROM tournament_matches
         WHERE id = v_tm.next_match_id FOR UPDATE;
        IF v_next.id IS NOT NULL
           AND (v_next.status = 'completed'
                OR v_next.winner_registration_id IS NOT NULL
                OR v_next.score IS NOT NULL) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NEXT_MATCH_ALREADY_PLAYED';
        END IF;
    END IF;

    UPDATE tournament_matches
       SET winner_registration_id = v_winner,
           score                  = v_score,
           status                 = p_outcome,
           -- A cancelled row was never played, so it keeps no played_at.
           played_at              = CASE WHEN p_outcome = 'cancelled' THEN NULL ELSE now() END,
           version                = version + 1,
           updated_at             = now()
     WHERE id = p_tournament_match_id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament_match', v_row.id, 'override_score', v_caller_id,
        jsonb_build_object(
            'tournament_id', v_row.tournament_id,
            'round', v_row.round_number,
            'position', v_row.match_position,
            'pool_number', v_row.pool_number,
            'outcome', p_outcome::text,
            'winner_registration_id', v_winner,
            'score', v_score,
            'previous_status', v_tm.status,
            'post_completion', v_post_completion
        )
    );

    IF v_winner IS NOT NULL THEN
        PERFORM public.lt_advance_tournament_winner(v_row.id, v_winner);
    END IF;

    -- Being walked over is news the loser cannot infer from the bracket.
    IF p_outcome = 'walkover' THEN
        PERFORM public.lt_notify_tournament_walkover(v_row.id, v_winner, false);
    END IF;

    IF v_post_completion THEN
        BEGIN
            PERFORM public.award_tournament_ranking_points(v_row.tournament_id);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'award_tournament_ranking_points failed after correcting tournament %: %',
                v_row.tournament_id, SQLERRM;
        END;
    END IF;

    RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_override_score(uuid, uuid, text, tournament_match_status)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tournament_override_score(uuid, uuid, text, tournament_match_status)
    TO authenticated;

COMMENT ON FUNCTION public.tournament_override_score(uuid, uuid, text, tournament_match_status) IS
'Organizer/admin authoritative OUTCOME for a tournament_match. p_outcome is one
of completed (a real score), walkover (the format''s forfeit score is stamped),
retired (the score at retirement) or cancelled (pool only, no winner, no
played_at, counts for neither player). Overrides a row in any settled state,
walkover included, so an automated resolution can be undone. Refuses cancelled
on a knockout row (CANCEL_NEEDS_BRACKET_OUTCOME): a bracket slot must send
somebody forward. Applies no reputation penalty, unlike the automated ladder.
Corrects while the next match is unplayed (NEXT_MATCH_ALREADY_PLAYED) and for
24h after the tournament completes (CORRECTION_WINDOW_CLOSED). Spec:
specs/17-leagues-tournaments/unplayed-match-resolution.md §Organizer override.';

-- ------------------------------- 3. mid-pool forfeit walkovers are scored
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
    v_match_ids  uuid[];
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
           forfeited_at = now(),
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

    WITH settled AS (
        UPDATE tournament_matches tm
           SET status                 = 'walkover',
               winner_registration_id = CASE WHEN tm.player1_registration_id = p_registration_id
                                             THEN tm.player2_registration_id
                                             ELSE tm.player1_registration_id END,
               score                  = public.lt_forfeit_score(
                                            v_tournament.match_format,
                                            v_tournament.games_per_set,
                                            v_tournament.points_per_game,
                                            tm.player2_registration_id = p_registration_id),
               played_at              = now(),
               version                = version + 1,
               updated_at             = now()
         WHERE tm.tournament_id = v_tournament.id
           AND tm.bracket_side  = 'pool'
           AND tm.status IN ('pending', 'in_progress', 'disputed')
           AND p_registration_id IN (tm.player1_registration_id, tm.player2_registration_id)
        RETURNING tm.id
    )
    SELECT coalesce(array_agg(id), '{}'::uuid[]), count(*)::int
      INTO v_match_ids, v_settled
      FROM settled;

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

    PERFORM public.lt_notify_pool_forfeit(v_row.id, v_match_ids);

    RETURN v_row;
END;
$$;

-- ------------------------------ 4. the resolver's single walkover, scored
CREATE OR REPLACE FUNCTION public.lt_resolve_due_tournament_matches(p_dry_run boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rec       record;
    v_eff       timestamptz;
    v_grace     timestamptz;
    v_e1        jsonb;
    v_e2        jsonb;
    v_has1      boolean;
    v_has2      boolean;
    v_winner    uuid;
    v_loser     uuid;
    v_acted     integer := 0;
    v_prefix    text := CASE WHEN p_dry_run THEN 'dryrun_' ELSE '' END;
    v_rows      jsonb;
    v_uid       uuid;
BEGIN
    FOR v_rec IN
        SELECT tm.*, t.name AS t_name, t.end_date AS t_end, t.organizer_id AS t_org,
               t.match_format AS t_format, t.games_per_set AS t_gps,
               t.points_per_game AS t_ppg
          FROM tournament_matches tm
          JOIN tournaments t ON t.id = tm.tournament_id
         WHERE t.status = 'in_progress'
           AND tm.status IN ('pending', 'in_progress', 'disputed')
           AND tm.player1_registration_id IS NOT NULL
           AND tm.player2_registration_id IS NOT NULL
           AND NOT tm.player1_is_bye AND NOT tm.player2_is_bye
         FOR UPDATE OF tm SKIP LOCKED
    LOOP
        v_eff := public.lt_effective_match_deadline(
            (SELECT m FROM tournament_matches m WHERE m.id = v_rec.id));
        CONTINUE WHEN v_eff IS NULL OR v_eff > now();

        -- Disputes are never auto-resolved: escalate once, wait.
        IF v_rec.status = 'disputed' THEN
            IF NOT EXISTS (
                SELECT 1 FROM leagues_tournaments_audit a
                 WHERE a.scope = 'tournament_match' AND a.entity_id = v_rec.id
                   AND a.action IN ('dispute_escalated', 'dryrun_dispute_escalated')
            ) THEN
                INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
                VALUES ('tournament_match', v_rec.id, v_prefix || 'dispute_escalated', v_rec.t_org,
                        jsonb_build_object('tournament_id', v_rec.tournament_id, 'deadline_at', v_eff));
                IF NOT p_dry_run THEN
                    SELECT jsonb_agg(jsonb_build_object(
                        'user_id', o.organizer_id,
                        'type', 'tournament_dispute_escalated',
                        'target_id', v_rec.tournament_id,
                        'title', CASE WHEN public.lt_user_is_fr(o.organizer_id)
                                   THEN 'Litige à trancher' ELSE 'Dispute needs a ruling' END,
                        'body', CASE WHEN public.lt_user_is_fr(o.organizer_id)
                                  THEN v_rec.t_name || ' : une partie contestée a dépassé son échéance et attend ta décision.'
                                  ELSE v_rec.t_name || ': a disputed game passed its deadline and awaits your ruling.'
                                END,
                        'payload', jsonb_build_object(
                            'tournamentId', v_rec.tournament_id,
                            'tournamentMatchId', v_rec.id),
                        'priority', 'high'
                    )) INTO v_rows
                    FROM (SELECT t.organizer_id FROM tournaments t WHERE t.id = v_rec.tournament_id) o;
                    IF v_rows IS NOT NULL THEN
                        PERFORM insert_notifications(v_rows);
                    END IF;
                END IF;
                v_acted := v_acted + 1;
            END IF;
            CONTINUE;
        END IF;

        -- Step 0: an attached game is mutual agreement → one automatic grace.
        IF v_rec.match_id IS NOT NULL THEN
            IF NOT EXISTS (
                SELECT 1 FROM leagues_tournaments_audit a
                 WHERE a.scope = 'tournament_match' AND a.entity_id = v_rec.id
                   AND a.action IN ('auto_grace', 'dryrun_auto_grace')
            ) THEN
                SELECT GREATEST(
                           (m.match_date + COALESCE(m.start_time, time '20:00'))::timestamptz
                               + interval '72 hours',
                           now() + interval '24 hours')
                  INTO v_grace
                  FROM match m WHERE m.id = v_rec.match_id;
                IF v_grace IS NOT NULL THEN
                    IF NOT p_dry_run THEN
                        UPDATE tournament_matches
                           SET deadline_override_at = v_grace,
                               version = version + 1, updated_at = now()
                         WHERE id = v_rec.id;
                    END IF;
                    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
                    VALUES ('tournament_match', v_rec.id, v_prefix || 'auto_grace', v_rec.t_org,
                            jsonb_build_object('tournament_id', v_rec.tournament_id,
                                               'grace_until', v_grace));
                    v_acted := v_acted + 1;
                END IF;
            END IF;
            -- Grace already granted and expired with a game still attached:
            -- leave it to the score/auto-confirm path and the organizer.
            CONTINUE;
        END IF;

        -- Step 1: effort split.
        v_e1 := public.lt_side_effort(v_rec.id, public.lt_registration_users(v_rec.player1_registration_id));
        v_e2 := public.lt_side_effort(v_rec.id, public.lt_registration_users(v_rec.player2_registration_id));
        v_has1 := (v_e1->>'voted')::boolean OR (v_e1->>'posted_card')::boolean OR (v_e1->>'messaged')::boolean;
        v_has2 := (v_e2->>'voted')::boolean OR (v_e2->>'posted_card')::boolean OR (v_e2->>'messaged')::boolean;

        IF v_has1 AND v_has2 THEN
            IF EXISTS (
                SELECT 1 FROM leagues_tournaments_audit a
                 WHERE a.scope = 'tournament_match' AND a.entity_id = v_rec.id
                   AND a.action IN ('auto_extension', 'dryrun_auto_extension')
            ) THEN
                v_winner := NULL;  -- extension spent → double walkover below
            ELSE
                IF NOT p_dry_run THEN
                    UPDATE tournament_matches
                       SET deadline_override_at = LEAST(now() + interval '72 hours',
                                                        GREATEST(v_rec.t_end, now() + interval '48 hours')),
                           version = version + 1, updated_at = now()
                     WHERE id = v_rec.id;
                    SELECT jsonb_agg(jsonb_build_object(
                        'user_id', u.uid,
                        'type', 'tournament_deadline_extended',
                        'target_id', v_rec.tournament_id,
                        'title', CASE WHEN public.lt_user_is_fr(u.uid)
                                   THEN 'Prolongation automatique' ELSE 'Automatic extension' END,
                        'body', CASE WHEN public.lt_user_is_fr(u.uid)
                                  THEN v_rec.t_name || ' : vous cherchez tous les deux un moment. Dernière prolongation, ensuite la partie est annulée pour les deux.'
                                  ELSE v_rec.t_name || ': you are both trying to find a time. One last extension, then the game is voided for both.'
                                END,
                        'payload', jsonb_build_object(
                            'tournamentId', v_rec.tournament_id,
                            'tournamentMatchId', v_rec.id),
                        'priority', 'high'
                    )) INTO v_rows
                    FROM (SELECT unnest(public.lt_registration_users(v_rec.player1_registration_id)
                                     || public.lt_registration_users(v_rec.player2_registration_id)) AS uid) u;
                    IF v_rows IS NOT NULL THEN
                        PERFORM insert_notifications(v_rows);
                    END IF;
                END IF;
                INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
                VALUES ('tournament_match', v_rec.id, v_prefix || 'auto_extension', v_rec.t_org,
                        jsonb_build_object('tournament_id', v_rec.tournament_id,
                                           'effort_p1', v_e1, 'effort_p2', v_e2));
                v_acted := v_acted + 1;
                CONTINUE;
            END IF;
        END IF;

        IF v_has1 <> v_has2 THEN
            -- One-sided effort → walkover for the effortful side.
            IF v_has1 THEN
                v_winner := v_rec.player1_registration_id;
                v_loser  := v_rec.player2_registration_id;
            ELSE
                v_winner := v_rec.player2_registration_id;
                v_loser  := v_rec.player1_registration_id;
            END IF;

            INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
            VALUES ('tournament_match', v_rec.id, v_prefix || 'auto_walkover', v_rec.t_org,
                    jsonb_build_object('tournament_id', v_rec.tournament_id,
                                       'winner_registration_id', v_winner,
                                       'effort_p1', v_e1, 'effort_p2', v_e2));
            IF NOT p_dry_run THEN
                UPDATE tournament_matches
                   SET status = 'walkover', winner_registration_id = v_winner,
                       score = public.lt_forfeit_score(
                                   v_rec.t_format, v_rec.t_gps, v_rec.t_ppg,
                                   v_winner = v_rec.player1_registration_id),
                       played_at = now(),
                       version = version + 1, updated_at = now()
                 WHERE id = v_rec.id;
                PERFORM public.lt_advance_tournament_winner(v_rec.id, v_winner);
                FOREACH v_uid IN ARRAY public.lt_registration_users(v_loser) LOOP
                    INSERT INTO reputation_event
                        (player_id, event_type, base_impact, metadata, event_occurred_at)
                    VALUES (v_uid, 'tournament_unresponsive', -15,
                            jsonb_build_object('tournamentId', v_rec.tournament_id,
                                               'tournamentMatchId', v_rec.id), now());
                END LOOP;
                PERFORM public.lt_notify_tournament_walkover(v_rec.id, v_winner, false);
            END IF;
            v_acted := v_acted + 1;
        ELSE
            -- Neither side (or extension spent) → double walkover.
            INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
            VALUES ('tournament_match', v_rec.id, v_prefix || 'auto_double_walkover', v_rec.t_org,
                    jsonb_build_object('tournament_id', v_rec.tournament_id,
                                       'effort_p1', v_e1, 'effort_p2', v_e2));
            IF NOT p_dry_run THEN
                PERFORM public.lt_advance_double_walkover(v_rec.id);
                FOREACH v_uid IN ARRAY (public.lt_registration_users(v_rec.player1_registration_id)
                                     || public.lt_registration_users(v_rec.player2_registration_id)) LOOP
                    INSERT INTO reputation_event
                        (player_id, event_type, base_impact, metadata, event_occurred_at)
                    VALUES (v_uid, 'tournament_unresponsive', -15,
                            jsonb_build_object('tournamentId', v_rec.tournament_id,
                                               'tournamentMatchId', v_rec.id), now());
                END LOOP;
                PERFORM public.lt_notify_tournament_walkover(v_rec.id, NULL, true);
            END IF;
            v_acted := v_acted + 1;
        END IF;
    END LOOP;

    RETURN v_acted;
END;
$$;
