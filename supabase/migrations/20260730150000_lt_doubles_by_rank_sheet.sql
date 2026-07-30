-- ============================================================================
-- Leagues — the sheet generator finally honours doubles sessions
-- ============================================================================
-- The plumbing for doubles has existed end to end — seasons freeze
-- rules.formatsAllowed, session_create copies it into sessions.formats_allowed,
-- session_presence carries preferred_partner_id, session_matches.format is an
-- entry_format and the CHECK admits two players a side — but lt_run_session_sheet
-- ignored all of it and hardcoded 'singles'. A doubles league could be
-- configured and could confirm players, and then got singles sheets.
--
-- BY_RANK doubles, as built here (the primary entry in formats_allowed decides
-- the branch; singles is byte-for-byte the previous behaviour):
--
--   * Mutual pre-pairs lock. Two confirmed players who named each other via
--     preferred_partner_id form a fixed team (the BALANCED_DOUBLES step-1 rule
--     from match-sheet.md; one-sided preferences don't bind). If one partner is
--     benched a round, the other plays that round from the open pool.
--   * Residue byes rotate. With n confirmed, n % 4 players sit each round,
--     walked in chunks along the same fewest-byes-first queue singles uses —
--     except pre-paired players sort to the back of the queue, so a committed
--     pair is only split when there is nobody else left to bench.
--   * Teams form by rank adjacency. After benching, the non-paired players
--     pair up 1&2, 3&4, ... in ranking order (play with your peers), joining
--     the locked pairs as teams.
--   * Teams meet by strength. Teams order by summed season points and adjacent
--     teams play; across rounds the order rotates top-team-pinned, the same
--     round-robin convention as singles — partners stay together for the
--     night, opponents change (match-sheet.md § Round assignment).
--
-- Doubles needs four on the sheet, so the confirmed floor is format-aware:
-- 2 for singles, 4 for doubles.
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
    v_format         entry_format;
    v_confirmed      integer;
    v_locked_players uuid[];
    v_sorted         uuid[];
    v_bye_queue      uuid[];
    v_pair_a         uuid[];
    v_pair_b         uuid[];
    v_pair_members   uuid[];
    v_order          uuid[];
    v_active         uuid[];
    v_bench          uuid[];
    v_ap_members     uuid[];
    v_tm1            uuid[];
    v_tm2            uuid[];
    v_byer           uuid;
    v_round          integer;
    v_residue        integer;
    v_qlen           integer;
    v_k              integer;
    v_pos            integer;
    v_n              integer;
    v_i              integer;
    v_j              integer;
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

    v_format := COALESCE(v_session.formats_allowed[1], 'singles');

    SELECT count(*) INTO v_confirmed
      FROM session_presence
     WHERE session_id = p_session_id AND status = 'confirmed';
    IF v_confirmed < (CASE WHEN v_format = 'doubles' THEN 4 ELSE 2 END) THEN
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

    -- Mutual pre-pairs on the unlocked roster (a named b AND b named a).
    SELECT coalesce(array_agg(x.user_id), ARRAY[]::uuid[]),
           coalesce(array_agg(y.user_id), ARRAY[]::uuid[])
      INTO v_pair_a, v_pair_b
      FROM session_presence x
      JOIN session_presence y
        ON y.session_id = x.session_id AND y.user_id = x.preferred_partner_id
     WHERE x.session_id = p_session_id
       AND v_format = 'doubles'
       AND x.status = 'confirmed' AND y.status = 'confirmed'
       AND y.preferred_partner_id = x.user_id
       AND x.user_id < y.user_id
       AND x.user_id = ANY (v_sorted) AND y.user_id = ANY (v_sorted);
    v_pair_members := v_pair_a || v_pair_b;

    -- Bye queue: fewest byes taken so far this season first, then the lower
    -- standing. Prior byes are derived — a 'confirmed' presence in a completed
    -- session of this season with no non-drill match in that session. In
    -- doubles, pre-paired players sort to the back so a committed pair is only
    -- benched apart when nobody else is left.
    SELECT coalesce(array_agg(q.user_id ORDER BY q.paired ASC, q.prior_byes ASC, q.points ASC, q.user_id), ARRAY[]::uuid[])
      INTO v_bye_queue
      FROM (
        SELECT u AS user_id,
               (u = ANY (v_pair_members))::int AS paired,
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

    v_n     := coalesce(array_length(v_sorted, 1), 0);
    v_qlen  := greatest(coalesce(array_length(v_bye_queue, 1), 1), 1);

    FOR v_round IN 1..greatest(v_session.rounds, 1) LOOP

        IF v_format = 'doubles' THEN
            -- --------------------------------------------------------------
            -- DOUBLES: bench the residue (rotating chunks of the queue), lock
            -- mutual pairs, rank-pair the rest, meet by team strength.
            -- --------------------------------------------------------------
            v_residue := v_n % 4;

            v_bench := ARRAY[]::uuid[];
            FOR v_j IN 0..(v_residue - 1) LOOP
                v_pos := (((v_round - 1) * v_residue + v_j) % v_qlen) + 1;
                v_bench := v_bench || v_bye_queue[v_pos];
            END LOOP;

            SELECT coalesce(array_agg(u ORDER BY ord), ARRAY[]::uuid[])
              INTO v_active
              FROM unnest(v_sorted) WITH ORDINALITY AS t(u, ord)
             WHERE NOT (u = ANY (v_bench));

            -- Pairs whose two members both survived the bench stay locked;
            -- everyone else pairs adjacently in ranking order.
            SELECT coalesce(array_agg(pa) || array_agg(pb), ARRAY[]::uuid[])
              INTO v_ap_members
              FROM unnest(v_pair_a, v_pair_b) AS p(pa, pb)
             WHERE pa = ANY (v_active) AND pb = ANY (v_active);
            v_ap_members := coalesce(v_ap_members, ARRAY[]::uuid[]);

            SELECT array_agg(t.m1 ORDER BY t.strength DESC, t.lo ASC),
                   array_agg(t.m2 ORDER BY t.strength DESC, t.lo ASC)
              INTO v_tm1, v_tm2
              FROM (
                SELECT raw.m1, raw.m2, least(raw.m1, raw.m2) AS lo, st.strength
                  FROM (
                    SELECT p.pa AS m1, p.pb AS m2
                      FROM unnest(v_pair_a, v_pair_b) AS p(pa, pb)
                     WHERE p.pa = ANY (v_active) AND p.pb = ANY (v_active)
                    UNION ALL
                    SELECT s1.u, s2.u
                      FROM (SELECT u, row_number() OVER (ORDER BY ord) AS rn
                              FROM unnest(v_active) WITH ORDINALITY AS a(u, ord)
                             WHERE NOT (u = ANY (v_ap_members))) s1
                      JOIN (SELECT u, row_number() OVER (ORDER BY ord) AS rn
                              FROM unnest(v_active) WITH ORDINALITY AS a(u, ord)
                             WHERE NOT (u = ANY (v_ap_members))) s2
                        ON s2.rn = s1.rn + 1
                     WHERE s1.rn % 2 = 1
                  ) raw
                  CROSS JOIN LATERAL (
                    SELECT coalesce(sum(sr.points), 0) AS strength
                      FROM season_rankings sr
                     WHERE sr.season_id = v_session.season_id
                       AND sr.user_id IN (raw.m1, raw.m2)
                  ) st
              ) t;

            v_k := coalesce(array_length(v_tm1, 1), 0);

            -- Adjacent teams play; the order rotates per round with the top
            -- team pinned (the singles round-robin convention, team-level).
            v_j := 1;
            WHILE v_j + 1 <= v_k LOOP
                v_i := CASE WHEN v_j = 1 THEN 1
                            ELSE 2 + ((v_j - 2 + v_round - 1) % (v_k - 1)) END;
                v_pos := CASE WHEN v_j + 1 = 1 THEN 1
                              ELSE 2 + ((v_j + 1 - 2 + v_round - 1) % (v_k - 1)) END;
                INSERT INTO session_matches (
                    session_id, round_number, format, team_a_user_ids, team_b_user_ids, status
                )
                VALUES (
                    p_session_id, v_round, 'doubles',
                    ARRAY[v_tm1[v_i], v_tm2[v_i]], ARRAY[v_tm1[v_pos], v_tm2[v_pos]], 'pending'
                );
                v_j := v_j + 2;
            END LOOP;

        ELSIF v_n % 2 = 1 THEN
            -- --------------------------------------------------------------
            -- SINGLES, odd roster: walk the queue one entry per round so a
            -- multi-round night spreads its byes.
            -- --------------------------------------------------------------
            v_byer := v_bye_queue[((v_round - 1) % v_qlen) + 1];
            SELECT coalesce(array_agg(u ORDER BY ord), ARRAY[]::uuid[])
              INTO v_order
              FROM unnest(v_sorted) WITH ORDINALITY AS t(u, ord)
             WHERE u <> v_byer;

            v_i := 1;
            WHILE v_i + 1 <= coalesce(array_length(v_order, 1), 0) LOOP
                INSERT INTO session_matches (
                    session_id, round_number, format, team_a_user_ids, team_b_user_ids, status
                )
                VALUES (
                    p_session_id, v_round, 'singles',
                    ARRAY[v_order[v_i]], ARRAY[v_order[v_i + 1]], 'pending'
                );
                v_i := v_i + 2;
            END LOOP;

        ELSE
            -- Even singles roster: unchanged — pin the top seed, rotate the tail.
            v_order := public.lt_rotate_for_round(v_sorted, v_round);
            v_i := 1;
            WHILE v_i + 1 <= coalesce(array_length(v_order, 1), 0) LOOP
                INSERT INTO session_matches (
                    session_id, round_number, format, team_a_user_ids, team_b_user_ids, status
                )
                VALUES (
                    p_session_id, v_round, 'singles',
                    ARRAY[v_order[v_i]], ARRAY[v_order[v_i + 1]], 'pending'
                );
                v_i := v_i + 2;
            END LOOP;
        END IF;
    END LOOP;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'session', p_session_id, p_action, v_caller,
        jsonb_build_object('confirmed', v_confirmed, 'rounds', greatest(v_session.rounds, 1),
                           'format', v_format)
    );

    RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.lt_run_session_sheet(uuid, integer, text) IS
'BY_RANK pairing for a published session, singles or doubles per the session''s
primary formats_allowed entry. Byes rotate along a fewest-byes-first queue
(doubles: residue-sized chunks, pre-paired players benched last); doubles locks
mutual preferred partners, rank-pairs the rest, and meets teams by summed
points. Byes are derived (confirmed presence with no match), never stored.';
