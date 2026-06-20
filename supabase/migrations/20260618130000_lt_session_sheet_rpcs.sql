-- ============================================
-- Leagues & Tournaments — V8: session match-sheet (BY_RANK, singles)
-- ============================================
-- Spec: specs/17-leagues-tournaments/rollout.md §V8
--       specs/17-leagues-tournaments/match-sheet.md §BY_RANK
--
-- Ships:
--   lt_rotate_for_round       round-robin rotation helper (mirrors TS
--                             packages/shared-utils/src/leagues/byRankPairings.ts)
--   lt_run_session_sheet      internal: guards + BY_RANK pairing + version + audit
--   session_generate_sheet    public wrapper (first generation)
--   session_regenerate_sheet  public wrapper (recompute, preserves locked rows)
--   session_set_match_lock    organizer lock/unlock of a session_match
--
-- Scope: singles BY_RANK only. Byes are NOT stored as rows (the session_matches
-- CHECK requires cardinality(team_b_user_ids) IN (1,2)); the odd highest-ranked
-- player is simply left unpaired and surfaced as a bye in the UI. Doubles /
-- BALANCED_DOUBLES, RANDOM/AVOID_REPEAT/SWISS, three_player/drill odd modes,
-- court assignment, and manual edits (swap/add/remove) are out of this slice.
-- Scoring + ranking is V9.
-- ============================================


-- =====================
-- lt_rotate_for_round — mirrors rotateForRound() in byRankPairings.ts
-- =====================
-- Keep the first id fixed; rotate the rest left by (round - 1).

CREATE OR REPLACE FUNCTION public.lt_rotate_for_round(p_ids uuid[], p_round integer)
RETURNS uuid[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_len      integer := coalesce(array_length(p_ids, 1), 0);
    v_tail     uuid[];
    v_tail_len integer;
    v_shift    integer;
BEGIN
    IF v_len <= 2 OR p_round <= 1 THEN
        RETURN p_ids;
    END IF;

    v_tail     := p_ids[2:v_len];
    v_tail_len := v_len - 1;
    v_shift    := (p_round - 1) % v_tail_len;

    IF v_shift = 0 THEN
        RETURN p_ids;
    END IF;

    RETURN ARRAY[p_ids[1]] || v_tail[(v_shift + 1):v_tail_len] || v_tail[1:v_shift];
END;
$$;


-- =====================
-- lt_run_session_sheet — internal generate/regenerate
-- =====================

CREATE OR REPLACE FUNCTION public.lt_run_session_sheet(
    p_session_id  uuid,
    p_version_was integer,
    p_action      text
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
    v_order          uuid[];
    v_round          integer;
    v_n              integer;
    v_i              integer;
    v_start          integer;
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

    FOR v_round IN 1..greatest(v_session.rounds, 1) LOOP
        v_order := public.lt_rotate_for_round(v_sorted, v_round);
        v_n := coalesce(array_length(v_order, 1), 0);

        -- Odd roster: the highest-ranked player byes (no row — see header).
        v_start := CASE WHEN v_n % 2 = 1 THEN 2 ELSE 1 END;

        v_i := v_start;
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

REVOKE EXECUTE ON FUNCTION public.lt_run_session_sheet(uuid, integer, text) FROM anon, authenticated;


-- =====================
-- session_generate_sheet / session_regenerate_sheet
-- =====================

CREATE OR REPLACE FUNCTION public.session_generate_sheet(
    p_session_id  uuid,
    p_version_was integer
)
RETURNS sessions
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.lt_run_session_sheet(p_session_id, p_version_was, 'generate_sheet');
$$;

GRANT EXECUTE ON FUNCTION public.session_generate_sheet(uuid, integer) TO authenticated;


CREATE OR REPLACE FUNCTION public.session_regenerate_sheet(
    p_session_id  uuid,
    p_version_was integer
)
RETURNS sessions
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.lt_run_session_sheet(p_session_id, p_version_was, 'regenerate_sheet');
$$;

GRANT EXECUTE ON FUNCTION public.session_regenerate_sheet(uuid, integer) TO authenticated;


-- =====================
-- session_set_match_lock — organizer lock/unlock a match row
-- =====================

CREATE OR REPLACE FUNCTION public.session_set_match_lock(
    p_session_match_id uuid,
    p_locked           boolean,
    p_version_was      integer
)
RETURNS session_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller    uuid := auth.uid();
    v_match     session_matches;
    v_league_id uuid;
    v_row       session_matches;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_match FROM session_matches WHERE id = p_session_match_id;
    IF v_match.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_NOT_FOUND';
    END IF;

    SELECT se.league_id INTO v_league_id
      FROM sessions s
      JOIN seasons se ON se.id = s.season_id
     WHERE s.id = v_match.session_id;

    IF NOT (public.is_league_organizer(v_league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    UPDATE session_matches
       SET locked = p_locked, version = version + 1, updated_at = now()
     WHERE id = p_session_match_id AND version = p_version_was
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (SELECT 1 FROM session_matches WHERE id = p_session_match_id AND version <> p_version_was) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_NOT_FOUND';
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('session_match', v_row.id, 'set_lock', v_caller, jsonb_build_object('locked', p_locked));

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.session_set_match_lock(uuid, boolean, integer) TO authenticated;
