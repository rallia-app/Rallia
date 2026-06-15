-- ============================================
-- Leagues & Tournaments — self-driving registration window
-- ============================================
-- Spec: specs/17-leagues-tournaments/tournaments.md §Creation (defaults),
--       §Lifecycle (auto-close), §Allowed transitions (open gate)
--
-- Three gaps closed:
--   1. tournament_create now defaults registration_closes_at to
--      start_date - 24h (spec default; was NULL → registration stayed open
--      until manually closed, even past the start date).
--   2. tournament_open_registration now enforces start_date > now()
--      (TOURNAMENT_START_PASSED), stamps registration_opens_at, and pushes a
--      stale closes_at (already in the past at open time, e.g. a tournament
--      starting within 24h) out to start_date so a last-minute open isn't
--      immediately re-closed by the cron.
--   3. lt_close_due_tournament_registrations() + pg_cron job every 15 min
--      auto-close registration_open tournaments whose closes_at or
--      start_date has passed. Pure SQL — no edge function needed until
--      notifications ship (V10).
--
-- tournament_create body is otherwise identical to 20260527000300.
-- ============================================

CREATE OR REPLACE FUNCTION public.tournament_create(
    p_name              text,
    p_sport_id          uuid,
    p_max_participants  smallint,
    p_start_date        timestamptz,
    p_end_date          timestamptz,
    p_description       text                          DEFAULT NULL,
    p_visibility        tournament_visibility         DEFAULT 'private',
    p_registration_mode tournament_registration_mode  DEFAULT 'open',
    p_bracket_type      bracket_type                  DEFAULT 'single_elimination',
    p_match_format      match_format                  DEFAULT NULL,
    p_entry_format      entry_format                  DEFAULT 'singles',
    p_facility_id       uuid                          DEFAULT NULL,
    p_venue_name        text                          DEFAULT NULL,
    p_network_id        uuid                          DEFAULT NULL,
    p_registration_opens_at  timestamptz              DEFAULT NULL,
    p_registration_closes_at timestamptz              DEFAULT NULL
)
RETURNS tournaments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id     uuid := auth.uid();
    v_sport_name    text;
    v_match_format  match_format;
    v_recent_count  integer;
    v_closes_at     timestamptz;
    v_row           tournaments;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    -- Doubles / mixed-doubles are not yet playable end-to-end (no partner
    -- registration flow, attach requires exactly two participants). Block
    -- creation until that ships.
    IF p_entry_format <> 'singles' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DOUBLES_NOT_SUPPORTED';
    END IF;

    -- Sport-scope: caller must have an active player_sport row for this sport.
    PERFORM public.assert_caller_plays_sport(p_sport_id);

    -- If a network_id was passed, it must reference a community-type network.
    IF p_network_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1
              FROM network n
              JOIN network_type nt ON nt.id = n.network_type_id
             WHERE n.id = p_network_id
               AND nt.name = 'community'
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001',
                MESSAGE = 'NETWORK_NOT_COMMUNITY';
        END IF;
    END IF;

    -- Rate limit: 5 tournaments per organizer per 24 hours (admins exempt).
    IF NOT public.is_admin() THEN
        SELECT count(*) INTO v_recent_count
          FROM tournaments
         WHERE organizer_id = v_caller_id
           AND created_at  > now() - interval '24 hours';

        IF v_recent_count >= 5 THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001',
                MESSAGE = 'RATE_LIMITED';
        END IF;
    END IF;

    -- Sport-aware match_format default.
    IF p_match_format IS NULL THEN
        SELECT name INTO v_sport_name FROM sport WHERE id = p_sport_id;
        v_match_format := CASE v_sport_name
            WHEN 'pickleball' THEN 'pickleball_to_11'::match_format
            ELSE 'two_of_three'::match_format
        END;
    ELSE
        v_match_format := p_match_format;
    END IF;

    -- Spec default: registration closes 24h before start (clamped so a
    -- tournament created <24h out doesn't get a closes_at in the past).
    v_closes_at := COALESCE(
        p_registration_closes_at,
        GREATEST(p_start_date - interval '24 hours', now())
    );

    INSERT INTO tournaments (
        name, sport_id, max_participants, start_date, end_date,
        description, visibility, registration_mode,
        bracket_type, match_format, entry_format,
        facility_id, venue_name, network_id,
        registration_opens_at, registration_closes_at,
        organizer_id
    )
    VALUES (
        p_name, p_sport_id, p_max_participants, p_start_date, p_end_date,
        p_description, p_visibility, p_registration_mode,
        p_bracket_type, v_match_format, p_entry_format,
        p_facility_id, p_venue_name, p_network_id,
        p_registration_opens_at, v_closes_at,
        v_caller_id
    )
    RETURNING * INTO v_row;

    -- Audit row in the same transaction.
    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament', v_row.id, 'create', v_caller_id,
        jsonb_build_object(
            'name', v_row.name,
            'sport_id', v_row.sport_id,
            'max_participants', v_row.max_participants,
            'start_date', v_row.start_date,
            'end_date', v_row.end_date,
            'visibility', v_row.visibility,
            'registration_mode', v_row.registration_mode
        )
    );

    RETURN v_row;
END;
$$;


-- =====================
-- tournament_open_registration: start-date gate + opens_at stamp + stale
-- closes_at clamp.
-- =====================

CREATE OR REPLACE FUNCTION public.tournament_open_registration(
    p_tournament_id uuid,
    p_version_was   integer
)
RETURNS tournaments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_row       tournaments;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    UPDATE tournaments
       SET status     = 'registration_open',
           registration_opens_at = COALESCE(registration_opens_at, now()),
           registration_closes_at = CASE
               WHEN registration_closes_at IS NOT NULL AND registration_closes_at <= now()
               THEN start_date
               ELSE registration_closes_at
           END,
           version    = version + 1,
           updated_at = now()
     WHERE id      = p_tournament_id
       AND version = p_version_was
       AND status  = 'draft'
       AND start_date > now()
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        -- Version, status, or start-date gate failed; report which.
        IF EXISTS (SELECT 1 FROM tournaments WHERE id = p_tournament_id AND version <> p_version_was) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        IF EXISTS (SELECT 1 FROM tournaments WHERE id = p_tournament_id AND status = 'draft' AND start_date <= now()) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_START_PASSED';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_DRAFT';
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament', v_row.id, 'open_registration', v_caller_id,
        jsonb_build_object('status', v_row.status)
    );

    RETURN v_row;
END;
$$;


-- =====================
-- Auto-close: cron-invoked closer for due registration windows.
-- =====================

CREATE OR REPLACE FUNCTION public.lt_close_due_tournament_registrations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_closed integer;
BEGIN
    WITH due AS (
        UPDATE tournaments
           SET status     = 'registration_closed',
               version    = version + 1,
               updated_at = now()
         WHERE status = 'registration_open'
           AND (
                (registration_closes_at IS NOT NULL AND registration_closes_at <= now())
             OR start_date <= now()
           )
        RETURNING id, organizer_id
    )
    -- actor_id is NOT NULL; the close runs on the organizer's behalf, so
    -- attribute it to them under a distinct action name.
    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    SELECT 'tournament', due.id, 'auto_close_registration', due.organizer_id,
           jsonb_build_object('status', 'registration_closed')
      FROM due;

    GET DIAGNOSTICS v_closed = ROW_COUNT;
    RETURN v_closed;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lt_close_due_tournament_registrations() FROM anon, authenticated;

COMMENT ON FUNCTION public.lt_close_due_tournament_registrations()
    IS 'Cron-invoked: closes registration on registration_open tournaments whose registration_closes_at or start_date has passed. Spec: specs/17-leagues-tournaments/tournaments.md §Lifecycle.';

SELECT cron.unschedule('lt-close-tournament-registration') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'lt-close-tournament-registration'
);

SELECT cron.schedule(
  'lt-close-tournament-registration',
  '*/15 * * * *',
  $$ SELECT public.lt_close_due_tournament_registrations(); $$
);
