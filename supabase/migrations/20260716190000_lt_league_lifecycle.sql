-- League lifecycle: pause / resume / close (V6 gap).
--
-- Organizers had no way to wind a league down. league_status already had
-- ('active','paused','closed') but only 'active' was ever set: there was no RPC
-- to leave it, and 'paused' was inert — its ONLY reader anywhere was
-- season_create's LEAGUE_NOT_ACTIVE check.
--
-- Deliberately NOT mirroring tournaments here. Tournaments have cancelled +
-- archived; leagues have neither by design (leagues.md §League archival: closed
-- leagues are archived implicitly because they retain seasonal data members
-- revisit). So closing is terminal and there is no separate archive state.
--
-- Spec state table (leagues.md §League lifecycle):
--        new members? | new seasons? | members can play?
-- active      yes            yes            yes
-- paused      no             no             yes (in-flight sessions finish)
-- closed      no             no             no

ALTER TABLE leagues
    ADD COLUMN IF NOT EXISTS closed_at     timestamptz,
    ADD COLUMN IF NOT EXISTS closed_reason text;

-- ---------------------------------------------------------------------------
-- league_pause / league_resume
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.league_pause(
    p_league_id   uuid,
    p_version_was integer
)
RETURNS leagues
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_row       leagues;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF NOT public.is_league_organizer(p_league_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    -- Guard-in-the-UPDATE (the tournament_cancel pattern): the status and version
    -- predicates make the transition atomic under concurrency.
    UPDATE leagues
       SET status     = 'paused',
           version    = version + 1,
           updated_at = now()
     WHERE id      = p_league_id
       AND version = p_version_was
       AND status  = 'active'
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (SELECT 1 FROM leagues WHERE id = p_league_id AND version <> p_version_was) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM leagues WHERE id = p_league_id) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_FOUND';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_ACTIVE';
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('league', v_row.id, 'pause', v_caller_id,
            jsonb_build_object('status', v_row.status));

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_pause(uuid, integer) TO authenticated;


CREATE OR REPLACE FUNCTION public.league_resume(
    p_league_id   uuid,
    p_version_was integer
)
RETURNS leagues
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_row       leagues;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF NOT public.is_league_organizer(p_league_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    -- Only paused resumes. A closed league is terminal (no reopen path by design).
    UPDATE leagues
       SET status     = 'active',
           version    = version + 1,
           updated_at = now()
     WHERE id      = p_league_id
       AND version = p_version_was
       AND status  = 'paused'
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (SELECT 1 FROM leagues WHERE id = p_league_id AND version <> p_version_was) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM leagues WHERE id = p_league_id) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_FOUND';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_PAUSED';
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('league', v_row.id, 'resume', v_caller_id,
            jsonb_build_object('status', v_row.status));

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_resume(uuid, integer) TO authenticated;


-- ---------------------------------------------------------------------------
-- league_close
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.league_close(
    p_league_id   uuid,
    p_reason      text,
    p_version_was integer
)
RETURNS leagues
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_row       leagues;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF NOT public.is_league_organizer(p_league_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    -- Refuse rather than force-cascade: closing means members can no longer play,
    -- and an open season may have live sessions and an unsettled ranking. This
    -- mirrors season_close, which refuses on published/in_progress sessions, so
    -- teardown is orderly from the inside out (sessions -> season -> league).
    IF EXISTS (SELECT 1 FROM seasons WHERE league_id = p_league_id AND status = 'open') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_HAS_OPEN_SEASONS';
    END IF;

    UPDATE leagues
       SET status        = 'closed',
           closed_at     = now(),
           closed_reason = p_reason,
           version       = version + 1,
           updated_at    = now()
     WHERE id      = p_league_id
       AND version = p_version_was
       AND status IN ('active', 'paused')
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (SELECT 1 FROM leagues WHERE id = p_league_id AND version <> p_version_was) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM leagues WHERE id = p_league_id) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_FOUND';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_CLOSABLE';
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('league', v_row.id, 'close', v_caller_id,
            jsonb_build_object('status', v_row.status, 'reason', p_reason));

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_close(uuid, text, integer) TO authenticated;


-- ---------------------------------------------------------------------------
-- Make 'paused' actually mean something.
--
-- Both functions below already SELECT the league row but never consulted its
-- status, so a paused league still accepted new seasons being opened and new
-- sessions being created. Re-emitted verbatim from the live definitions with a
-- single LEAGUE_NOT_ACTIVE guard added. league_create/league_join/
-- league_invite_members/season_create already enforce this.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.season_open(p_season_id uuid, p_version_was integer)
 RETURNS seasons
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_caller_id uuid := auth.uid();
    v_season    seasons;
    v_league    leagues;
    v_row       seasons;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_season FROM seasons WHERE id = p_season_id;
    IF v_season.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_FOUND';
    END IF;

    SELECT * INTO v_league FROM leagues WHERE id = v_season.league_id;

    IF NOT (public.is_league_organizer(v_season.league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    -- Added: opening a season is new season activity, barred while paused/closed.
    IF v_league.status <> 'active' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_ACTIVE';
    END IF;

    IF v_season.end_date < current_date THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_ENDED';
    END IF;

    UPDATE seasons
       SET status           = 'open',
           rules_locked_at  = now(),
           version          = version + 1,
           updated_at       = now()
     WHERE id      = p_season_id
       AND version = p_version_was
       AND status  = 'draft'
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (SELECT 1 FROM seasons WHERE id = p_season_id AND version <> p_version_was) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_DRAFT';
    END IF;

    INSERT INTO season_rankings (season_id, user_id, tiebreak_seed)
    SELECT
        v_row.id,
        lm.user_id,
        hashtext(v_row.id::text || lm.user_id::text)::bigint
      FROM league_members lm
     WHERE lm.league_id = v_row.league_id
       AND lm.status = 'active'
    ON CONFLICT (season_id, user_id) DO NOTHING;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'season', v_row.id, 'open', v_caller_id,
        jsonb_build_object('league_id', v_row.league_id, 'status', v_row.status)
    );

    RETURN v_row;
END;
$function$;


CREATE OR REPLACE FUNCTION public.session_create(p_season_id uuid, p_name text, p_scheduled_at timestamp with time zone, p_timezone text DEFAULT NULL::text, p_duration_minutes smallint DEFAULT 90, p_facility_id uuid DEFAULT NULL::uuid, p_venue_name text DEFAULT NULL::text, p_capacity smallint DEFAULT NULL::smallint, p_rounds smallint DEFAULT 1, p_pairing_mode pairing_mode DEFAULT 'by_rank'::pairing_mode)
 RETURNS sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_caller_id    uuid := auth.uid();
    v_season       seasons;
    v_league       leagues;
    v_formats      entry_format[];
    v_match_format match_format;
    v_tz           text;
    v_row          sessions;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_season FROM seasons WHERE id = p_season_id;
    IF v_season.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_FOUND';
    END IF;

    SELECT * INTO v_league FROM leagues WHERE id = v_season.league_id;

    IF NOT (public.is_league_organizer(v_season.league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    -- Added: a paused league takes no new sessions; in-flight ones still play out.
    IF v_league.status <> 'active' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_ACTIVE';
    END IF;

    IF v_season.status <> 'open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_OPEN';
    END IF;

    IF length(coalesce(trim(p_name), '')) = 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_NAME';
    END IF;

    IF p_scheduled_at IS NULL OR p_scheduled_at <= now() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_SCHEDULE';
    END IF;

    -- Formats / match format inherit the season's frozen rules.
    v_formats := COALESCE(
        (SELECT array_agg(value::entry_format)
           FROM jsonb_array_elements_text(v_season.rules -> 'formatsAllowed')),
        ARRAY['singles']::entry_format[]
    );
    v_match_format := NULLIF(v_season.rules ->> 'matchFormat', '')::match_format;

    v_tz := COALESCE(NULLIF(p_timezone, ''), 'America/Toronto');

    INSERT INTO sessions (
        season_id, name, scheduled_at, duration_minutes, timezone,
        facility_id, venue_name, capacity, rounds,
        formats_allowed, match_format, pairing_mode, status
    )
    VALUES (
        p_season_id, p_name, p_scheduled_at, COALESCE(p_duration_minutes, 90), v_tz,
        COALESCE(p_facility_id, v_league.facility_id),
        COALESCE(p_venue_name, v_league.venue_name),
        p_capacity, COALESCE(p_rounds, 1),
        v_formats, v_match_format, COALESCE(p_pairing_mode, 'by_rank'), 'draft'
    )
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'session', v_row.id, 'create', v_caller_id,
        jsonb_build_object(
            'season_id', p_season_id,
            'name', v_row.name,
            'scheduled_at', v_row.scheduled_at
        )
    );

    RETURN v_row;
END;
$function$;
