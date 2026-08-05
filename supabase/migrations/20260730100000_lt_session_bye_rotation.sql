-- ============================================================================
-- Leagues — an odd roster benched the same player in every round, all season
-- ============================================================================
-- lt_run_session_sheet (20260618130000) handles an odd confirmed roster by
-- skipping the first entry of the ranking-ordered array:
--
--     v_start := CASE WHEN v_n % 2 = 1 THEN 2 ELSE 1 END;
--
-- and it re-derives that array per round with lt_rotate_for_round, which pins
-- index 1 and rotates only the tail. Index 1 is exactly the entry the odd-start
-- skips, so on an odd roster the rotation never moves the bye: the top-ranked
-- player sits out ROUND 1, ROUND 2, ROUND 3 — every round of the session. A
-- five-player, three-round night has one member drive to the club and play
-- nothing. Verified on a local five-player session: 4 players in 3 of 3 rounds,
-- 1 player in 0 of 3.
--
-- It also repeats across sessions, because the selection is a pure function of
-- standing: whoever leads the table byes every week they show up to an odd
-- night, which is both the least fair choice and self-reinforcing (the byed
-- player banks no points, so eventually someone else leads and inherits it).
--
-- Fix, following the usual round-robin convention: the bye rotates, and it goes
-- to whoever has sat out least this season.
--
--   * Per season, count each confirmed player's prior byes — a bye is a
--     'confirmed' presence in a completed session with no non-drill match in
--     that session (byes have no row of their own; the session_matches CHECK
--     requires cardinality(team_b_user_ids) IN (1,2), so this stays derived).
--   * Order the bye queue by (prior byes ASC, season points ASC, user_id) and
--     walk it one entry per round, so round R benches queue[R] rather than the
--     same player every time.
--   * The remaining players still pair adjacently in ranking order, so BY_RANK
--     is unchanged for the even case and for who-plays-whom.
--
-- Pairing for an even roster is byte-for-byte the previous behaviour; only the
-- odd branch changes. Companion migration 20260730100100 stops the bye costing
-- the byed player their attendance and points.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lt_run_session_sheet(
    p_session_id   uuid,
    p_version_was  integer,
    p_action       text
)
RETURNS sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller         uuid := auth.uid();
    v_session        sessions;
    v_season         seasons;
    v_confirmed      integer;
    v_locked_players uuid[];
    v_sorted         uuid[];
    v_bye_queue      uuid[];
    v_order          uuid[];
    v_byer           uuid;
    v_round          integer;
    v_n              integer;
    v_i              integer;
    v_row            sessions;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_session FROM sessions WHERE id = p_session_id;
    IF v_session.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_NOT_FOUND';
    END IF;

    SELECT * INTO v_season FROM seasons WHERE id = v_session.season_id;

    IF NOT (public.is_league_organizer(v_season.league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    IF v_session.status <> 'published' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_NOT_PUBLISHED';
    END IF;

    -- Cannot recompute over matches that already started / completed.
    IF EXISTS (
        SELECT 1 FROM session_matches
         WHERE session_id = p_session_id AND locked = false AND status <> 'pending'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHEET_LOCKED';
    END IF;

    SELECT count(*) INTO v_confirmed
      FROM session_presence
     WHERE session_id = p_session_id AND status = 'confirmed';
    IF v_confirmed < 2 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ENOUGH_CONFIRMED';
    END IF;

    -- Optimistic lock on the session row.
    UPDATE sessions
       SET version = version + 1, updated_at = now()
     WHERE id = p_session_id AND version = p_version_was
    RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;

    -- Players fixed in locked rows are excluded from re-pairing.
    SELECT coalesce(array_agg(DISTINCT u), ARRAY[]::uuid[]) INTO v_locked_players
      FROM (
        SELECT unnest(team_a_user_ids || team_b_user_ids) AS u
          FROM session_matches
         WHERE session_id = p_session_id AND locked = true
      ) s;

    DELETE FROM session_matches
     WHERE session_id = p_session_id AND locked = false;

    -- Confirmed roster minus locked players, in ranking order.
    SELECT coalesce(
             array_agg(sp.user_id ORDER BY
               coalesce(sr.points, 0) DESC,
               coalesce(sr.tiebreak_seed, 0) ASC,
               sp.user_id),
             ARRAY[]::uuid[])
      INTO v_sorted
      FROM session_presence sp
      LEFT JOIN season_rankings sr
        ON sr.season_id = v_session.season_id AND sr.user_id = sp.user_id
     WHERE sp.session_id = p_session_id
       AND sp.status = 'confirmed'
       AND NOT (sp.user_id = ANY (v_locked_players));

    -- Bye queue: fewest byes taken so far this season first, then the lower
    -- standing. Only consulted on an odd roster. Prior byes are derived — a
    -- 'confirmed' presence in a completed session of this season with no
    -- non-drill match in that session.
    SELECT coalesce(array_agg(q.user_id ORDER BY q.prior_byes ASC, q.points ASC, q.user_id), ARRAY[]::uuid[])
      INTO v_bye_queue
      FROM (
        SELECT u AS user_id,
               coalesce(sr.points, 0) AS points,
               (
                 SELECT count(*)
                   FROM session_presence psp
                   JOIN sessions pss ON pss.id = psp.session_id
                  WHERE pss.season_id = v_session.season_id
                    AND pss.status    = 'completed'
                    AND psp.user_id   = u
                    AND psp.status    = 'confirmed'
                    AND NOT EXISTS (
                          SELECT 1 FROM session_matches psm
                           WHERE psm.session_id = pss.id
                             AND psm.is_drill = false
                             AND (u = ANY (psm.team_a_user_ids) OR u = ANY (psm.team_b_user_ids))
                    )
               ) AS prior_byes
          FROM unnest(v_sorted) AS u
          LEFT JOIN season_rankings sr
            ON sr.season_id = v_session.season_id AND sr.user_id = u
      ) q;

    FOR v_round IN 1..greatest(v_session.rounds, 1) LOOP
        v_n := coalesce(array_length(v_sorted, 1), 0);

        IF v_n % 2 = 1 THEN
            -- Walk the queue one entry per round so a multi-round night spreads
            -- its byes instead of benching one player start to finish.
            v_byer := v_bye_queue[((v_round - 1) % greatest(array_length(v_bye_queue, 1), 1)) + 1];
            SELECT coalesce(array_agg(u ORDER BY ord), ARRAY[]::uuid[])
              INTO v_order
              FROM unnest(v_sorted) WITH ORDINALITY AS t(u, ord)
             WHERE u <> v_byer;
        ELSE
            -- Even roster: unchanged — pin the top seed, rotate the tail.
            v_order := public.lt_rotate_for_round(v_sorted, v_round);
        END IF;

        v_n := coalesce(array_length(v_order, 1), 0);

        v_i := 1;
        WHILE v_i + 1 <= v_n LOOP
            INSERT INTO session_matches (
                session_id, round_number, format, team_a_user_ids, team_b_user_ids, status
            )
            VALUES (
                p_session_id, v_round, 'singles',
                ARRAY[v_order[v_i]], ARRAY[v_order[v_i + 1]], 'pending'
            );
            v_i := v_i + 2;
        END LOOP;
    END LOOP;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'session', p_session_id, p_action, v_caller,
        jsonb_build_object('confirmed', v_confirmed, 'rounds', greatest(v_session.rounds, 1))
    );

    RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.lt_run_session_sheet(uuid, integer, text) IS
'BY_RANK singles pairing for a published session. On an odd roster the bye
rotates per round and prefers whoever has byed least this season; byes are
derived (confirmed presence with no match), never stored.';
