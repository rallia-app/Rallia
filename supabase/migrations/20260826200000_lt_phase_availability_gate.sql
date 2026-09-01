-- ============================================================================
-- Scheduling funnel, slice 1 — the phase availability record IS the gate
-- ============================================================================
-- Série 2, three days in: of 42 pool pairings, 2 were played, 20 had no word
-- from either player, and 19 had two players who talked and still produced no
-- game. Talking is not converting, and the resolver cannot tell those three
-- populations apart, because the only evidence it has is chat text (ruled
-- inadmissible) and a linked game (which is the outcome, not a signal).
--
-- This migration lays the foundation the funnel reads: one durable,
-- phase-scoped record per player, written when they answer the gate. It is
-- deliberately INERT on its own -- nothing yet locks a room or changes a
-- notification. It only makes the evidence recordable, so the lock, the pool
-- room and the options engine can be built against something real.
--
-- Spec: specs/17-leagues-tournaments/scheduling-funnel.md § 2 and
-- specs/17-leagues-tournaments/scheduling-arbitration.md § Phase availability
-- record, which fixes the shape, the ('pool', 0) key and the snapshot rule.
--
-- Three properties worth stating because they are easy to get wrong later:
--
--   * SNAPSHOT, NOT REFERENCE. hours_in_window and grid_snapshot are frozen at
--     response time. A later edit to player_availability produces a NEW gate
--     answer (upsert, responded_at refreshed); it never silently redates the
--     evidence a past decision rested on.
--   * The phase key normalises to ('pool', 0), matching both the shared pool
--     deadline row and lt_effective_match_deadline's own normalisation. One
--     answer covers the whole round robin.
--   * A skip is an ANSWER, not silence: outcome 'skipped' with zero hours. It
--     acknowledges the phase (which is what the resolution ladder reads) while
--     scoring nothing on volume.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Organizer-set minimum, feeding the volume signal only. Never a hard block:
-- refusing an answer would turn the gate into a wall and lose the ack.
-- ---------------------------------------------------------------------------
ALTER TABLE public.tournaments
    ADD COLUMN IF NOT EXISTS min_availability_hours smallint;

COMMENT ON COLUMN public.tournaments.min_availability_hours IS
'Suggested minimum hours a player should offer for a phase (organizer-set,
default NULL = none). Feeds the volume signal in the resolution ladder; never
blocks a gate answer.';

-- ---------------------------------------------------------------------------
-- The record
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tournament_phase_availability (
    tournament_id   uuid        NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
    bracket_side    text        NOT NULL,
    round_number    smallint    NOT NULL,
    player_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    outcome         text        NOT NULL
                                CHECK (outcome IN ('confirmed', 'edited', 'skipped', 'forfeited')),
    responded_at    timestamptz NOT NULL DEFAULT now(),
    hours_in_window smallint    NOT NULL CHECK (hours_in_window >= 0),
    grid_snapshot   jsonb       NOT NULL,
    PRIMARY KEY (tournament_id, bracket_side, round_number, player_id)
);

COMMENT ON TABLE public.tournament_phase_availability IS
'One row per (phase, player): the gate answer that both acknowledges the phase
and declares the hours offered inside its window. Written only through
tournament_submit_phase_availability. Snapshotted at response time, never
recomputed from player_availability.';

-- The ladder reads "has this side answered this phase", so the lookup is by
-- phase, not by player.
CREATE INDEX IF NOT EXISTS tournament_phase_availability_phase_idx
    ON public.tournament_phase_availability (tournament_id, bracket_side, round_number);

ALTER TABLE public.tournament_phase_availability ENABLE ROW LEVEL SECURITY;

-- Readable by anyone who can read the tournament: an opponent seeing "they
-- answered" is the whole point of the pairing room opening. Writes go through
-- the RPC only, so there is no INSERT/UPDATE/DELETE policy at all.
DROP POLICY IF EXISTS tpa_select ON public.tournament_phase_availability;
CREATE POLICY tpa_select ON public.tournament_phase_availability
    FOR SELECT USING (
        (SELECT public.is_admin())
        OR EXISTS (
            SELECT 1 FROM public.tournaments t
             WHERE t.id = tournament_phase_availability.tournament_id
               AND (t.visibility = 'public'
                    OR public.is_tournament_organizer(t.id)
                    OR EXISTS (SELECT 1 FROM public.tournament_registrations r
                                WHERE r.tournament_id = t.id
                                  AND (r.user_id = (SELECT auth.uid())
                                       OR r.partner_user_id = (SELECT auth.uid()))))
        )
    );

-- Explicit grants: the default Data API grants end 2026-10-30, so a new public
-- table that relies on them would go dark.
GRANT SELECT ON public.tournament_phase_availability TO authenticated;
REVOKE ALL ON public.tournament_phase_availability FROM anon;

-- ---------------------------------------------------------------------------
-- The phase window
-- ---------------------------------------------------------------------------
-- Closes at the effective deadline: since Jean's review nothing is collected or
-- bookable past it. Normalises the pool phase to round 0 exactly as
-- lt_effective_match_deadline does, so the gate and the ladder can never
-- disagree about which deadline a phase has.
CREATE OR REPLACE FUNCTION public.lt_phase_deadline(
    p_tournament_id uuid,
    p_bracket_side  text,
    p_round_number  smallint
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT trd.deadline_at
      FROM tournament_round_deadlines trd
     WHERE trd.tournament_id = p_tournament_id
       AND trd.bracket_side  = p_bracket_side
       AND trd.round_number  = CASE WHEN p_bracket_side = 'pool' THEN 0
                                    ELSE p_round_number END;
$$;

COMMENT ON FUNCTION public.lt_phase_deadline(uuid, text, smallint) IS
'The effective deadline for a phase, with the pool phase normalised to round 0.
Mirrors lt_effective_match_deadline minus the per-match override.';

-- ---------------------------------------------------------------------------
-- Hours offered inside the window
-- ---------------------------------------------------------------------------
-- The grid is a weekly recurrence ((day, hour) cells, the shape
-- player_availability stores); the window is a concrete stretch of calendar.
-- The count is therefore an expansion, not a cell count: six cells are worth
-- far more over a sixteen-day pool phase than over a two-day knockout round,
-- and volume has to reflect that.
--
-- p_timezone is the player's zone. It defaults to UTC like session_create's,
-- and the client is expected to pass the real one: a grid is declared in local
-- time and counting it in the wrong zone shifts every evening cell.
CREATE OR REPLACE FUNCTION public.lt_hours_in_window(
    p_grid     jsonb,
    p_from     timestamptz,
    p_to       timestamptz,
    p_timezone text DEFAULT 'UTC'
)
RETURNS smallint
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT LEAST(
        count(*) FILTER (
            WHERE EXISTS (
                SELECT 1 FROM jsonb_array_elements(p_grid) cell
                 WHERE lower(cell ->> 'day') = lower(to_char(h.slot AT TIME ZONE p_timezone, 'FMday'))
                   AND (cell ->> 'hour')::int = extract(hour FROM h.slot AT TIME ZONE p_timezone)::int
            )
        ),
        32767
    )::smallint
      FROM generate_series(
             date_trunc('hour', p_from),
             p_to - interval '1 second',
             interval '1 hour') AS h(slot)
     WHERE jsonb_typeof(p_grid) = 'array';
$$;

COMMENT ON FUNCTION public.lt_hours_in_window(jsonb, timestamptz, timestamptz, text) IS
'Counts the concrete hours between p_from and p_to that fall on a cell of the
weekly grid, read in p_timezone. The grid is [{"day":"monday","hour":18}, ...],
matching player_availability''s (day, hour_of_day). Capped at smallint.';

-- ---------------------------------------------------------------------------
-- The gate
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tournament_submit_phase_availability(
    p_tournament_id uuid,
    p_bracket_side  text,
    p_round_number  smallint,
    p_outcome       text,
    p_grid          jsonb DEFAULT '[]'::jsonb,
    p_timezone      text  DEFAULT 'UTC'
)
RETURNS public.tournament_phase_availability
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller   uuid := auth.uid();
    v_t        tournaments;
    v_deadline timestamptz;
    v_round    smallint := CASE WHEN p_bracket_side = 'pool' THEN 0 ELSE p_round_number END;
    v_grid     jsonb    := COALESCE(p_grid, '[]'::jsonb);
    v_hours    smallint;
    v_row      tournament_phase_availability;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF p_outcome NOT IN ('confirmed', 'edited', 'skipped', 'forfeited') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_OUTCOME';
    END IF;

    IF p_bracket_side IS NULL OR p_bracket_side = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PHASE';
    END IF;

    IF jsonb_typeof(v_grid) <> 'array' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_GRID';
    END IF;

    SELECT * INTO v_t FROM tournaments WHERE id = p_tournament_id;
    IF v_t.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;

    -- The gate belongs to the people playing the phase.
    IF NOT EXISTS (
        SELECT 1 FROM tournament_registrations r
         WHERE r.tournament_id = p_tournament_id
           AND r.status = 'registered'
           AND (r.user_id = v_caller OR r.partner_user_id = v_caller)
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_A_PARTICIPANT';
    END IF;

    -- Answering is only meaningful while the phase is live.
    IF v_t.status NOT IN ('registration_closed', 'in_progress') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_IN_PROGRESS';
    END IF;

    -- Without a deadline there is no window, so there is nothing to count and
    -- no phase to acknowledge. This is the organizer's dependency: the gate
    -- cannot open before they have set the round deadlines.
    v_deadline := public.lt_phase_deadline(p_tournament_id, p_bracket_side, v_round);
    IF v_deadline IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PHASE_DEADLINE_NOT_SET';
    END IF;

    -- Past the deadline the phase is being decided, not planned.
    IF now() >= v_deadline THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PHASE_WINDOW_CLOSED';
    END IF;

    -- A skip declares no hours whatever grid was sent: the answer is the ack,
    -- and pretending otherwise would let a skip score on volume.
    IF p_outcome = 'skipped' THEN
        v_grid  := '[]'::jsonb;
        v_hours := 0;
    ELSE
        v_hours := public.lt_hours_in_window(v_grid, now(), v_deadline, COALESCE(p_timezone, 'UTC'));
    END IF;

    INSERT INTO tournament_phase_availability AS tpa
        (tournament_id, bracket_side, round_number, player_id,
         outcome, responded_at, hours_in_window, grid_snapshot)
    VALUES
        (p_tournament_id, p_bracket_side, v_round, v_caller,
         p_outcome, now(), v_hours, v_grid)
    ON CONFLICT (tournament_id, bracket_side, round_number, player_id)
    DO UPDATE SET outcome         = EXCLUDED.outcome,
                  responded_at    = EXCLUDED.responded_at,
                  hours_in_window = EXCLUDED.hours_in_window,
                  grid_snapshot   = EXCLUDED.grid_snapshot
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit
        (scope, entity_id, action, actor_id, payload_after)
    VALUES ('tournament', p_tournament_id, 'phase_availability_submitted', v_caller,
            jsonb_build_object('bracket_side', p_bracket_side,
                               'round_number', v_round,
                               'outcome', p_outcome,
                               'hours_in_window', v_hours));

    RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_submit_phase_availability(uuid, text, smallint, text, jsonb, text)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tournament_submit_phase_availability(uuid, text, smallint, text, jsonb, text)
    TO authenticated;

COMMENT ON FUNCTION public.tournament_submit_phase_availability(uuid, text, smallint, text, jsonb, text) IS
'The scheduling gate. A registered participant answers once per phase
(''pool'' normalises to round 0): confirmed / edited / skipped / forfeited,
with a weekly grid that is expanded across the phase window and frozen as
hours_in_window + grid_snapshot. Upserts, refreshing responded_at. Refuses
before the organizer has set the phase deadline (PHASE_DEADLINE_NOT_SET) and
after it has passed (PHASE_WINDOW_CLOSED). Spec:
specs/17-leagues-tournaments/scheduling-funnel.md.';
