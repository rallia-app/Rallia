-- ============================================================================
-- Leagues — flex sessions: a window to play in, not an evening to show up to
-- ============================================================================
-- From Jean's league test review, section 3.4: « pour la date et heure de la
-- seance, mettre aussi une option flex. Les seances de ligue flex ca veut dire
-- que l'organisateur indique une periode pendant laquelle les matchs de la
-- seance doivent se jouer. Cette periode peut s'etendre sur plusieurs jours. »
-- Plus: the fixed/flex choice belongs at league creation, and the session form
-- follows from it.
--
-- Today a session is a point in time (scheduled_at + duration_minutes), so a
-- league whose members arrange their own games over two weeks cannot be
-- expressed at all.
--
-- What makes this small: a session does NOT complete on a clock. It completes
-- when every one of its matches carries a score (see the bridge in
-- 20260812220000). So flex needs no new lifecycle, no sweep, no cron. The
-- window is a statement of intent that the UI renders and the organizer
-- polices, exactly like the evening it replaces.
--
--   sessions.play_window_ends_at NULL -> fixed, an evening (today's behaviour)
--                                set  -> flex, playable from scheduled_at to it
--
-- scheduled_at keeps its meaning as the moment the session opens, which is why
-- the confirm-reminder cron (20260628100100, anchored on
-- COALESCE(confirmation_deadline_at, scheduled_at)) keeps working untouched: a
-- flex window still wants its confirmations in before it opens.
--
-- The league-level choice goes in default_rules as sessionScheduling, beside
-- gamesPerPlayer and matchFormat, which are the other "how this league runs"
-- keys. It seeds every season at season_create and so is forward-looking at the
-- season boundary, like the rest of the rules object.
--
-- Deliberately NOT here: what happens to a pairing nobody played by the end of
-- the window. Nothing happens today when a fixed session's evening passes
-- either, so flex inherits the existing behaviour rather than adding a gap.
-- The eventual answer is drafted in specs/17-leagues-tournaments/formats/
-- ligue-en-boites.md section 11 (responsibility-based walkover, or cancel),
-- and it should land for both kinds of session at once.
--
-- session_create is DROPped rather than replaced: adding a trailing defaulted
-- parameter to a CREATE OR REPLACE leaves the old signature in place as a
-- second overload, which makes the PostgREST call ambiguous. Same for
-- session_create_series. Callers name their arguments, so existing ones keep
-- working against the wider signatures.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The column
-- ---------------------------------------------------------------------------
ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS play_window_ends_at timestamptz;

ALTER TABLE public.sessions
    DROP CONSTRAINT IF EXISTS sessions_play_window_after_start;
ALTER TABLE public.sessions
    ADD CONSTRAINT sessions_play_window_after_start
    CHECK (play_window_ends_at IS NULL OR play_window_ends_at > scheduled_at);

COMMENT ON COLUMN public.sessions.play_window_ends_at IS
'End of a flex session''s play window. NULL = a fixed session, an evening at
scheduled_at lasting duration_minutes. Set = members arrange their own games
anywhere between scheduled_at and this.';

-- ---------------------------------------------------------------------------
-- lt_assert_league_rules — same body as 20260819160000, plus sessionScheduling
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lt_assert_league_rules(p_rules jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
    v_key text;
BEGIN
    IF p_rules IS NULL OR jsonb_typeof(p_rules) <> 'object' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES';
    END IF;

    -- Point values feed a sum, so a string or a null would break the recalc at
    -- score time rather than here. Negative is legal: pointNoShow defaults to -5.
    FOREACH v_key IN ARRAY ARRAY[
        'pointWin', 'pointLoss', 'pointDraw', 'pointBye', 'pointNoShow',
        'pointRetirementWinner', 'pointRetirementLoser',
        'pointWalkoverWinner', 'pointWalkoverLoser',
        'pointPerSetWon', 'pointPerGameWon'
    ] LOOP
        IF p_rules ? v_key THEN
            IF jsonb_typeof(p_rules -> v_key) <> 'number' THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:' || v_key;
            END IF;
            IF (p_rules ->> v_key)::numeric NOT BETWEEN -100 AND 100 THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:' || v_key;
            END IF;
        END IF;
    END LOOP;

    -- The bonuses multiply a count of things WON. A negative one would mean
    -- taking a set costs you points, which no organizer configures on purpose
    -- and which the wizard cannot express.
    FOREACH v_key IN ARRAY ARRAY['pointPerSetWon', 'pointPerGameWon'] LOOP
        IF p_rules ? v_key AND (p_rules ->> v_key)::numeric < 0 THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:' || v_key;
        END IF;
    END LOOP;

    -- The forfeit invariant. Checked pairwise so a partial object (rules are
    -- merged before validation, so in practice every key is present) can still
    -- be validated for what it carries.
    FOREACH v_key IN ARRAY ARRAY['pointWalkoverWinner', 'pointRetirementWinner'] LOOP
        IF p_rules ? v_key AND p_rules ? 'pointWin'
           AND (p_rules ->> v_key)::numeric > (p_rules ->> 'pointWin')::numeric THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:' || v_key;
        END IF;
    END LOOP;
    FOREACH v_key IN ARRAY ARRAY['pointWalkoverLoser', 'pointRetirementLoser'] LOOP
        IF p_rules ? v_key AND p_rules ? 'pointLoss'
           AND (p_rules ->> v_key)::numeric > (p_rules ->> 'pointLoss')::numeric THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:' || v_key;
        END IF;
    END LOOP;

    IF p_rules ? 'matchFormat'
       AND NOT EXISTS (
           SELECT 1
             FROM unnest(enum_range(NULL::match_format)) AS e(v)
            WHERE e.v::text = p_rules ->> 'matchFormat'
       ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:matchFormat';
    END IF;

    -- Fixed = an evening at a set time. Flex = a window members play inside.
    IF p_rules ? 'sessionScheduling'
       AND (p_rules ->> 'sessionScheduling') NOT IN ('fixed', 'flex') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:sessionScheduling';
    END IF;

    IF p_rules ? 'gamesPerSet'
       AND (jsonb_typeof(p_rules -> 'gamesPerSet') <> 'number'
            OR (p_rules ->> 'gamesPerSet')::integer NOT IN (4, 6, 8)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:gamesPerSet';
    END IF;

    IF p_rules ? 'pointsPerGame'
       AND (jsonb_typeof(p_rules -> 'pointsPerGame') <> 'number'
            OR (p_rules ->> 'pointsPerGame')::integer NOT IN (11, 15, 21)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:pointsPerGame';
    END IF;

    -- Games each player plays per session. sessions.rounds is CHECKed 1..6, so a
    -- season default outside that range could never be applied.
    IF p_rules ? 'gamesPerPlayer'
       AND (jsonb_typeof(p_rules -> 'gamesPerPlayer') <> 'number'
            OR (p_rules ->> 'gamesPerPlayer')::integer NOT BETWEEN 1 AND 6) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:gamesPerPlayer';
    END IF;
END;
$$;

COMMENT ON FUNCTION public.lt_assert_league_rules(jsonb) IS
'Validates a league/season rules jsonb: point values numeric and within ±100,
pointPerSetWon/pointPerGameWon non-negative, no walkover/retirement outcome
paying more than its played counterpart, matchFormat a real enum label,
sessionScheduling fixed/flex, gamesPerSet 4/6/8, pointsPerGame 11/15/21,
gamesPerPlayer 1..6. Raises INVALID_RULES[:key].';

-- ---------------------------------------------------------------------------
-- lt_league_default_rules — same body as 20260819160000, plus the default
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lt_league_default_rules(p_sport_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
    v_sport_name text;
    v_match_format text;
BEGIN
    SELECT name INTO v_sport_name FROM sport WHERE id = p_sport_id;
    IF v_sport_name IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SPORT_MISMATCH';
    END IF;

    v_match_format := CASE v_sport_name
        WHEN 'pickleball' THEN 'pickleball_to_11'
        ELSE 'two_of_three'
    END;

    RETURN jsonb_build_object(
        'matchFormat', v_match_format,
        'gamesPerSet', 6,
        'finalSetTiebreak', 'super_tb_10pt',
        'formatsAllowed', jsonb_build_array('singles'),
        'pointWin', 10,
        'pointLoss', 1,
        'pointNoShow', -5,
        'pointBye', 1,
        'pointDraw', 5,
        'pointRetirementWinner', 10,
        'pointRetirementLoser', 1,
        'pointWalkoverWinner', 10,
        'pointWalkoverLoser', 0,
        -- Proportional bonuses, off by default. The result is the whole story
        -- until an organizer says otherwise.
        'pointPerSetWon', 0,
        'pointPerGameWon', 0,
        -- An evening at a set time, which is what every league did before flex.
        'sessionScheduling', 'fixed',
        'enableBonuses', false,
        'tieBreakerOrder', jsonb_build_array(
            'totalPoints', 'headToHead', 'setDifference',
            'gameDifference', 'participationPercent', 'deterministicRandom'
        ),
        'formatWeights', jsonb_build_object(
            'singles', 1.0, 'doubles', 1.0, 'mixed_doubles', 1.0
        ),
        'defaultRatingForUnknown', 0
    );
END;
$$;

COMMENT ON FUNCTION public.lt_league_default_rules(uuid) IS
'Sport-shaped seed for leagues.default_rules. Both proportional bonuses
(pointPerSetWon, pointPerGameWon) seed at 0: result-only scoring.
sessionScheduling seeds fixed: an evening at a set time.';

-- ---------------------------------------------------------------------------
-- session_create — same body as 20260716190000, plus the play window
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.session_create(
    uuid, text, timestamptz, text, smallint, uuid, text, smallint, smallint, pairing_mode);

CREATE OR REPLACE FUNCTION public.session_create(
    p_season_id          uuid,
    p_name               text,
    p_scheduled_at       timestamptz,
    p_timezone           text          DEFAULT NULL,
    p_duration_minutes   smallint      DEFAULT 90,
    p_facility_id        uuid          DEFAULT NULL,
    p_venue_name         text          DEFAULT NULL,
    p_capacity           smallint      DEFAULT NULL,
    p_rounds             smallint      DEFAULT 1,
    p_pairing_mode       pairing_mode  DEFAULT 'by_rank',
    p_play_window_ends_at timestamptz  DEFAULT NULL
)
RETURNS sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

    -- A paused league takes no new sessions; in-flight ones still play out.
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

    -- A window that ends before it opens is not a window. The table CHECK says
    -- the same thing; this one names the parameter the organizer got wrong.
    IF p_play_window_ends_at IS NOT NULL AND p_play_window_ends_at <= p_scheduled_at THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PLAY_WINDOW';
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
        formats_allowed, match_format, pairing_mode, status,
        play_window_ends_at
    )
    VALUES (
        p_season_id, p_name, p_scheduled_at, COALESCE(p_duration_minutes, 90), v_tz,
        COALESCE(p_facility_id, v_league.facility_id),
        COALESCE(p_venue_name, v_league.venue_name),
        p_capacity, COALESCE(p_rounds, 1),
        v_formats, v_match_format, COALESCE(p_pairing_mode, 'by_rank'), 'draft',
        p_play_window_ends_at
    )
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'session', v_row.id, 'create', v_caller_id,
        jsonb_build_object(
            'season_id', p_season_id,
            'name', v_row.name,
            'scheduled_at', v_row.scheduled_at,
            'play_window_ends_at', v_row.play_window_ends_at
        )
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.session_create(
    uuid, text, timestamptz, text, smallint, uuid, text, smallint, smallint,
    pairing_mode, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.session_create(
    uuid, text, timestamptz, text, smallint, uuid, text, smallint, smallint,
    pairing_mode, timestamptz) IS
'Creates a draft session. p_play_window_ends_at turns it into a flex session:
members arrange their own games anywhere between p_scheduled_at and it, instead
of showing up for one evening. NULL keeps the fixed evening.';

-- ---------------------------------------------------------------------------
-- session_create_series — 20260807420000's body verbatim (wall-clock stepping,
-- the up-front season-bounds refusal and the timezone guard all intact), plus
-- a per-occurrence window. A series takes a LENGTH in days rather than an end
-- instant, since each occurrence needs its own.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.session_create_series(
    uuid, text, timestamptz, integer, integer, text, smallint, uuid, text,
    smallint, smallint, pairing_mode);

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
    p_pairing_mode     pairing_mode DEFAULT 'by_rank',
    p_window_days      smallint DEFAULT NULL
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

    -- A window longer than the gap would overlap the next occurrence, leaving
    -- members owing games to two sessions on the same days.
    IF p_window_days IS NOT NULL
       AND (p_window_days < 1 OR p_window_days > p_repeat_every_days) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PLAY_WINDOW';
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
            p_facility_id, p_venue_name, p_capacity, p_rounds, p_pairing_mode,
            CASE WHEN p_window_days IS NULL THEN NULL
                 ELSE v_at + (p_window_days * interval '1 day') END);
    END LOOP;

    RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.session_create_series(
    uuid, text, timestamptz, integer, integer, text, smallint, uuid, text,
    smallint, smallint, pairing_mode, smallint) TO authenticated;

COMMENT ON FUNCTION public.session_create_series(
    uuid, text, timestamptz, integer, integer, text, smallint, uuid, text,
    smallint, smallint, pairing_mode, smallint) IS
'Creates p_occurrences draft sessions spaced p_repeat_every_days apart (7, 14 or
28), stepped in p_timezone so the wall-clock time survives DST, all inside the
season window, by calling session_create for each. p_window_days makes each
occurrence a flex session of that length, capped at the gap so two windows
never overlap. Nothing is published: publication stays a manual, per-session
organizer action.';
