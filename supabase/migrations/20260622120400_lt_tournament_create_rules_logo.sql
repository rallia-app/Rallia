-- ============================================
-- Leagues & Tournaments — rules & logo at creation
-- ============================================
-- Lets the organizer set the rules text and poster/logo when creating a
-- tournament (previously edit-only). Body is the 20260612160100
-- tournament_create verbatim plus two trailing optional params and their
-- inserts; the registration_closes_at default and doubles support are kept.
--
-- Adding params changes the signature, so this is a new overload: drop the old
-- 16-arg version first (otherwise PostgREST sees two candidates and errors with
-- "function is not unique"). DROP loses grants, so EXECUTE is re-granted below.
-- ============================================

DROP FUNCTION IF EXISTS public.tournament_create(
    text, uuid, smallint, timestamptz, timestamptz,
    text, tournament_visibility, tournament_registration_mode,
    bracket_type, match_format, entry_format,
    uuid, text, uuid, timestamptz, timestamptz
);

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
    p_registration_closes_at timestamptz              DEFAULT NULL,
    p_rules             text                          DEFAULT NULL,
    p_logo_url          text                          DEFAULT NULL
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
        description, rules, logo_url, visibility, registration_mode,
        bracket_type, match_format, entry_format,
        facility_id, venue_name, network_id,
        registration_opens_at, registration_closes_at,
        organizer_id
    )
    VALUES (
        p_name, p_sport_id, p_max_participants, p_start_date, p_end_date,
        p_description, p_rules, p_logo_url, p_visibility, p_registration_mode,
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

GRANT EXECUTE ON FUNCTION public.tournament_create(
    text, uuid, smallint, timestamptz, timestamptz,
    text, tournament_visibility, tournament_registration_mode,
    bracket_type, match_format, entry_format,
    uuid, text, uuid, timestamptz, timestamptz, text, text
) TO authenticated;
