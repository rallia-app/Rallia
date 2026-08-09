-- ============================================================================
-- Leagues — a recurring session keeps its wall-clock time across DST
-- ============================================================================
-- 20260807360000 stepped occurrences with `interval '7 days'` on a timestamptz.
-- The server runs in UTC, where a day-interval is an exact 168 hours, so a
-- Tuesday 18:00 league created in October landed at 17:00 after the November
-- fall-back. Outlook, which the review cites as the model, keeps local time.
--
-- The stepping now happens in the league's own timezone: convert the first
-- occurrence to local wall time, add calendar days there, convert back. Same
-- guards, same drafts-only behaviour, same signature.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.session_create_series(
    p_season_id        uuid,
    p_name             text,
    p_first_at         timestamptz,
    p_repeat_every_days integer,
    p_occurrences      integer,
    p_timezone         text DEFAULT NULL,
    p_duration_minutes smallint DEFAULT 90,
    p_facility_id      uuid DEFAULT NULL,
    p_venue_name       text DEFAULT NULL,
    p_capacity         smallint DEFAULT NULL,
    p_rounds           smallint DEFAULT 1,
    p_pairing_mode     pairing_mode DEFAULT 'by_rank'
)
RETURNS SETOF sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_season      seasons;
    v_tz          text := COALESCE(p_timezone, 'UTC');
    v_first_local timestamp;
    v_last_at     timestamptz;
    v_at          timestamptz;
    i             integer;
BEGIN
    -- Weekly, every two weeks, every four weeks. Anything else would need a
    -- real recurrence rule (nth weekday, month ends), which nobody has asked
    -- for and which the season window makes largely pointless.
    IF p_repeat_every_days NOT IN (7, 14, 28) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RECURRENCE';
    END IF;
    IF p_occurrences IS NULL OR p_occurrences NOT BETWEEN 2 AND 26 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_OCCURRENCES';
    END IF;

    BEGIN
        v_first_local := p_first_at AT TIME ZONE v_tz;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TIMEZONE';
    END;

    SELECT * INTO v_season FROM seasons WHERE id = p_season_id;
    IF v_season.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_FOUND';
    END IF;

    -- The last one has to land inside the season. end_date is a date, so the
    -- comparison is against the end of that day.
    v_last_at := (v_first_local
                  + ((p_occurrences - 1) * p_repeat_every_days) * interval '1 day')
                 AT TIME ZONE v_tz;
    IF v_last_at >= (v_season.end_date + 1)::timestamptz THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SERIES_EXCEEDS_SEASON';
    END IF;

    FOR i IN 0..(p_occurrences - 1) LOOP
        -- Calendar-day arithmetic on the LOCAL timestamp: 18:00 stays 18:00 on
        -- both sides of a DST transition.
        v_at := (v_first_local + (i * p_repeat_every_days) * interval '1 day')
                AT TIME ZONE v_tz;
        RETURN QUERY
        SELECT * FROM public.session_create(
            p_season_id, p_name, v_at, p_timezone, p_duration_minutes,
            p_facility_id, p_venue_name, p_capacity, p_rounds, p_pairing_mode);
    END LOOP;

    RETURN;
END;
$$;

COMMENT ON FUNCTION public.session_create_series(
    uuid, text, timestamptz, integer, integer, text, smallint, uuid, text,
    smallint, smallint, pairing_mode) IS
'Creates p_occurrences draft sessions spaced p_repeat_every_days apart (7, 14 or
28), stepped in p_timezone so the wall-clock time survives DST, all inside the
season window, by calling session_create for each. Nothing is published:
publication stays a manual, per-session organizer action.';
