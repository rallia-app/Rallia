-- ============================================================================
-- Leagues — recurring sessions
-- ============================================================================
-- From the league test review: "Permettre, à la création de la séance, de la
-- rendre récurrente (p. ex. une fois par semaine, une fois aux deux semaines,
-- tous les mardis, etc.). S'inspirer de l'approche d'Outlook [...] La
-- publication de la séance doit toutefois toujours se faire manuellement par
-- l'un des organisateurs."
--
-- An organizer running a Tuesday-night league had to fill the same form every
-- week. session_create_series fills it once and materializes the whole run.
--
-- Deliberately simple, and deliberately not a recurrence engine:
--
--   * the occurrences are created up front as ordinary draft sessions, not as
--     a rule evaluated later. Nothing new has to be interpreted at read time,
--     and each one can be edited or cancelled on its own afterwards;
--   * publication stays manual and per session, exactly as the review asks. A
--     series does not publish anything;
--   * the run must fit inside its season. Refusing is better than silently
--     dropping the tail, since the organizer picked the count on purpose.
--
-- Each occurrence goes through session_create, so every rule that applies to a
-- single session (organizer, league active, season open, name, future date)
-- applies to all of them, and the whole series rolls back together.
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
    v_season   seasons;
    v_last_at  timestamptz;
    v_at       timestamptz;
    i          integer;
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

    SELECT * INTO v_season FROM seasons WHERE id = p_season_id;
    IF v_season.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_FOUND';
    END IF;

    -- The last one has to land inside the season. end_date is a date, so the
    -- comparison is against the end of that day.
    v_last_at := p_first_at + ((p_occurrences - 1) * p_repeat_every_days) * interval '1 day';
    IF v_last_at >= (v_season.end_date + 1)::timestamptz THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SERIES_EXCEEDS_SEASON';
    END IF;

    FOR i IN 0..(p_occurrences - 1) LOOP
        v_at := p_first_at + (i * p_repeat_every_days) * interval '1 day';
        RETURN QUERY
        SELECT * FROM public.session_create(
            p_season_id, p_name, v_at, p_timezone, p_duration_minutes,
            p_facility_id, p_venue_name, p_capacity, p_rounds, p_pairing_mode);
    END LOOP;

    RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.session_create_series(
    uuid, text, timestamptz, integer, integer, text, smallint, uuid, text,
    smallint, smallint, pairing_mode) TO authenticated;

COMMENT ON FUNCTION public.session_create_series(
    uuid, text, timestamptz, integer, integer, text, smallint, uuid, text,
    smallint, smallint, pairing_mode) IS
'Creates p_occurrences draft sessions spaced p_repeat_every_days apart (7, 14 or
28), all inside the season window, by calling session_create for each. Nothing
is published: publication stays a manual, per-session organizer action.';
