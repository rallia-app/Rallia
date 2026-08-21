-- ============================================================================
-- Leagues — the sheet is a draft until the organizer publishes it
-- ============================================================================
-- From Jean's league test review, section 3.4: « l'organisateur doit avoir le
-- pouvoir d'utiliser nos pairages auto mais ensuite pouvoir faire de legers
-- ajustements avant la publication finale ». Today generating a sheet IS
-- publishing it: session_matches becomes readable by every member the instant
-- lt_run_session_sheet commits, so every adjustment happens on a sheet the
-- players are already looking at.
--
-- The draft cannot live on sessions.status: the generator pairs from CONFIRMED
-- presence, and nobody confirms a session they cannot see. The session stays
-- published (people confirm), and the SHEET gets its own publication stamp.
--
--   sessions.sheet_published_at NULL  -> draft, organizer-only
--                               set   -> published, members see the pairings
--
-- Four moving parts:
--   * the column, backfilled so every sheet that is visible today stays
--     visible (this must never retroactively hide a live night's pairings);
--   * lt_run_session_sheet drops the stamp on generate AND regenerate, since a
--     regenerated sheet is a different sheet;
--   * session_publish_sheet, the organizer's one-tap release, idempotent so a
--     double tap is harmless;
--   * smatches_select amended in place (never added alongside: permissive
--     policies OR together, so a second policy would grant back what this one
--     withholds).
--
-- The RLS amendment is what makes the draft real, and it covers more than the
-- sheet screen: listMyUnscheduledSessionMatches reads the same table with the
-- player's own client, so a draft sheet also stops pushing "you have a game to
-- organize" cards at players who are not supposed to know their pairing yet.
--
-- Deliberately NOT here: a "the sheet is out" notification. None exists today
-- (session_published fires at session publication, to collect confirmations),
-- so publishing the sheet is exactly as loud as generating it used to be. A
-- new notification type is a 6-way sync and belongs in its own change.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The column, and the backfill that keeps every existing sheet visible
-- ---------------------------------------------------------------------------
ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS sheet_published_at timestamptz;

COMMENT ON COLUMN public.sessions.sheet_published_at IS
'When the organizer released the match sheet to the members. NULL = the sheet
is a draft, readable by the organizer alone. Reset to NULL by every
(re)generation, stamped by session_publish_sheet.';

-- Everything that already has a sheet has, by definition, a published one:
-- until this migration, generating was publishing. Stamp them from the
-- session's own publication time so the value means something, falling back to
-- creation for the rows that predate published_at.
UPDATE public.sessions ss
   SET sheet_published_at = COALESCE(ss.published_at, ss.created_at)
 WHERE ss.sheet_published_at IS NULL
   AND EXISTS (SELECT 1 FROM public.session_matches sm WHERE sm.session_id = ss.id);

-- ---------------------------------------------------------------------------
-- lt_run_session_sheet — same body as 20260731120000, plus the draft reset
-- ---------------------------------------------------------------------------
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
    IF v_confirmed < (CASE WHEN v_format <> 'singles' THEN 4 ELSE 2 END) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ENOUGH_CONFIRMED';
    END IF;

    -- Optimistic lock on the session row.
    -- A regenerated sheet is a new sheet: it drops back to draft so the
    -- organizer republishes deliberately, and members never see pairings
    -- shift under them between one refresh and the next.
    UPDATE sessions
       SET version            = version + 1,
           sheet_published_at = NULL,
           updated_at         = now()
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

    -- Confirmed roster minus locked players, in ranking order. This array is
    -- the only thing pairing_mode changes; it is reordered just below.
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

    -- The pairing mode is applied here and nowhere else.
    CASE v_session.pairing_mode
        WHEN 'random' THEN
            SELECT coalesce(array_agg(u ORDER BY random()), ARRAY[]::uuid[])
              INTO v_sorted
              FROM unnest(v_sorted) AS u;
        WHEN 'avoid_repeat' THEN
            v_sorted := public.lt_order_avoid_repeat(v_session.season_id, v_sorted);
        ELSE
            NULL;  -- by_rank, swiss, balanced_doubles: ranking order stands.
    END CASE;

    -- Mutual pre-pairs on the unlocked roster (a named b AND b named a).
    SELECT coalesce(array_agg(x.user_id), ARRAY[]::uuid[]),
           coalesce(array_agg(y.user_id), ARRAY[]::uuid[])
      INTO v_pair_a, v_pair_b
      FROM session_presence x
      JOIN session_presence y
        ON y.session_id = x.session_id AND y.user_id = x.preferred_partner_id
     WHERE x.session_id = p_session_id
       AND v_format <> 'singles'
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

        IF v_format <> 'singles' THEN
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
                    p_session_id, v_round, v_format,
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
'Pairing for a published session, singles or doubles/mixed per the session''s
primary formats_allowed entry. sessions.pairing_mode reorders the confirmed
roster (random shuffles, avoid_repeat walks least-met, the rest keep ranking
order); byes, locked rows and round rotation consume that order unchanged.
Leaves the sheet in DRAFT (sheet_published_at = NULL): session_publish_sheet
releases it to the members.';

-- ---------------------------------------------------------------------------
-- session_publish_sheet — the organizer's release
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.session_publish_sheet(
    p_session_id  uuid,
    p_version_was integer
)
RETURNS sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller  uuid := auth.uid();
    v_session sessions;
    v_season  seasons;
    v_matches integer;
    v_row     sessions;
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

    IF v_session.status NOT IN ('published', 'in_progress') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_NOT_ACTIVE';
    END IF;

    -- Idempotent: publishing an already-published sheet is what a double tap
    -- looks like, and re-stamping it would move a time members have seen.
    IF v_session.sheet_published_at IS NOT NULL THEN
        RETURN v_session;
    END IF;

    SELECT count(*) INTO v_matches
      FROM session_matches
     WHERE session_id = p_session_id AND is_drill = false;
    IF v_matches = 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHEET_EMPTY';
    END IF;

    UPDATE sessions
       SET sheet_published_at = now(),
           version            = version + 1,
           updated_at         = now()
     WHERE id = p_session_id AND version = p_version_was
    RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('session', p_session_id, 'publish_sheet', v_caller,
            jsonb_build_object('matches', v_matches));

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.session_publish_sheet(uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.session_publish_sheet(uuid, integer) IS
'Releases a draft match sheet to the league members. Organizer only, idempotent
on an already-published sheet, refuses an empty one (SHEET_EMPTY).';

-- ---------------------------------------------------------------------------
-- smatches_select — a draft sheet is the organizer's alone
-- ---------------------------------------------------------------------------
-- Amended in place from 20260727120000. The only change is the last AND: the
-- reader must either be looking at a published sheet, or be the organizer of
-- the league that owns it. is_admin() keeps its short-circuit at the top.
ALTER POLICY "smatches_select" ON public.session_matches
  USING ((( SELECT public.is_admin() ) OR (EXISTS ( SELECT 1
   FROM ((public.sessions ss
     JOIN public.seasons s ON ((s.id = ss.season_id)))
     JOIN public.leagues l ON ((l.id = s.league_id)))
  WHERE ((ss.id = session_matches.session_id)
     AND ((l.visibility = 'public'::public.tournament_visibility)
          OR public.is_league_organizer(l.id)
          OR public.is_active_league_member(l.id))
     AND ((ss.sheet_published_at IS NOT NULL) OR public.is_league_organizer(l.id)))))));
