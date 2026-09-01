-- ============================================================================
-- A deadline that has passed cannot be moved.
-- ============================================================================
-- unplayed-match-resolution.md § 7 (principle 7) and § 9: the machine grants
-- itself no time, and the organizer moves a deadline only while it is still in
-- the future. Once it passes, the pairing is decided and the way back is
-- restore or override, not a rewritten clock.
--
-- tournament_set_round_deadlines has enforced this phase-wide since it landed
-- (DEADLINE_PASSED). The per-pairing twin never got the same guard, so an
-- organizer could keep pushing an expired pairing forward indefinitely: the
-- automatic grace this project removed, granted by hand instead. Jean's
-- objection (2026-08-31) is to exactly that shape, whoever grants it.
--
-- Also closes the silent case in the default-deadline seeder: it returned
-- without seeding anything when end_date was already behind the generation, so
-- a draw published late got no deadlines at all and therefore no automation
-- ever. A tournament with pairings now always has a clock.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tournament_extend_match_deadline(
    p_tournament_match_id uuid,
    p_deadline_at         timestamptz,
    p_reason              text DEFAULT NULL::text
)
RETURNS tournament_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_tm        tournament_matches;
    v_row       tournament_matches;
    v_current   timestamptz;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tournament_match_id;
    IF v_tm.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_NOT_FOUND';
    END IF;
    IF NOT public.is_tournament_organizer(v_tm.tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;
    IF v_tm.status NOT IN ('pending', 'in_progress', 'disputed') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_ALREADY_RESOLVED';
    END IF;
    IF p_deadline_at IS NULL OR p_deadline_at <= now() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DEADLINE_IN_PAST';
    END IF;

    -- The hard stop. A pairing whose deadline has passed is the resolver's, and
    -- the resolver runs every 15 minutes: without this, the window between
    -- expiry and the next run is a grace period an organizer can keep reopening.
    v_current := public.lt_effective_match_deadline(v_tm);
    IF v_current IS NOT NULL AND v_current <= now() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DEADLINE_PASSED';
    END IF;

    UPDATE tournament_matches
       SET deadline_override_at = p_deadline_at,
           version              = version + 1,
           updated_at           = now()
     WHERE id = p_tournament_match_id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament_match', v_row.id, 'extend_deadline', v_caller_id,
        jsonb_build_object(
            'tournament_id', v_row.tournament_id,
            'deadline_at', p_deadline_at,
            'reason', p_reason
        )
    );

    PERFORM public.lt_notify_tournament_deadline_changed(
        v_row.tournament_id, v_row.bracket_side, ARRAY[v_row.round_number]::smallint[]);

    RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.tournament_extend_match_deadline(uuid, timestamptz, text) IS
'Organizer/admin moves ONE pairing''s deadline, and only while it is still in
the future: DEADLINE_PASSED once it has expired, matching the phase-wide RPC.
This is the sanctioned replacement for the automatic grace and extension that
were removed, not a way to re-grant them by hand. Spec:
unplayed-match-resolution.md § 7.';

-- ------------------------------------------------- always leave a clock behind
CREATE OR REPLACE FUNCTION public._lt_seed_default_deadlines(
    p_tournament_id uuid,
    p_side          text,
    p_from          timestamptz,
    p_to            timestamptz,
    p_rounds        integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_to    timestamptz;
    v_span  interval;
BEGIN
    IF p_rounds < 1 THEN
        RETURN;
    END IF;

    -- A draw published on or after its own end_date used to get no deadlines at
    -- all, which is unlimited time: the one outcome this system exists to
    -- prevent. Fall back to a week per round so there is always something to
    -- count down to; the organizer can move it while it is still ahead.
    v_to := CASE WHEN p_to IS NULL OR p_to <= p_from
                 THEN p_from + (interval '7 days' * p_rounds)
                 ELSE p_to END;

    v_span := (v_to - p_from) / p_rounds;

    IF p_side = 'pool' THEN
        INSERT INTO tournament_round_deadlines (tournament_id, bracket_side, round_number, deadline_at)
        VALUES (p_tournament_id, 'pool', 0, v_to)
        ON CONFLICT (tournament_id, bracket_side, round_number)
        DO UPDATE SET deadline_at = EXCLUDED.deadline_at, updated_at = now();
    ELSE
        FOR r IN 1..p_rounds LOOP
            INSERT INTO tournament_round_deadlines (tournament_id, bracket_side, round_number, deadline_at)
            VALUES (p_tournament_id, 'main', r, p_from + v_span * r)
            ON CONFLICT (tournament_id, bracket_side, round_number)
            DO UPDATE SET deadline_at = EXCLUDED.deadline_at, updated_at = now();
        END LOOP;
    END IF;
END;
$$;

COMMENT ON FUNCTION public._lt_seed_default_deadlines(uuid, text, timestamptz, timestamptz, integer) IS
'Stamps the default round deadlines at generation, splitting the window evenly
(round-deadlines.md § Defaults). Never leaves a draw without a clock: an
unusable end_date falls back to a week per round rather than seeding nothing.';
