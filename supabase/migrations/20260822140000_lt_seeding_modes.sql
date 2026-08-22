-- ============================================
-- Leagues & Tournaments — selectable seeding mode
-- ============================================
-- 20260822120000 gave every draw one fixed ladder: Circuit Rallia points,
-- then rating, then sign-up order, with the organizer's seed_rank on top as
-- the override. The order was right for a ranked event and wrong for a social
-- one, and the organizer's only escape was to hand-order the whole field.
--
-- tournaments.seeding_mode now picks which ladder runs:
--
--   circuit  Circuit Rallia points DESC, rating DESC, sign-up   (default)
--   rating   rating DESC, Circuit points DESC, sign-up
--   signup   sign-up order (first registered is seed 1)
--   manual   the organizer's order, nothing computed
--
-- seed_rank still wins over the computed order in every mode, so a mode is
-- the starting point and never a cage. Two rules keep the picker honest:
--
--   * Switching to a computed mode CLEARS seed_rank — otherwise a leftover
--     manual order would silently outrank the mode the organizer just picked
--     and the switch would look broken.
--   * Switching to 'manual' FREEZES the order currently on screen into
--     seed_rank, so "I'll take it from here" starts from what they were
--     looking at rather than from a blank sign-up list.
--   * tournament_set_seeds flips the mode to 'manual' — reordering by hand
--     IS choosing manual, and the picker should say so.
--
-- The previews and the publish paths are untouched: they call
-- lt_tournament_seed_order, which resolves the mode itself. That was the
-- point of routing all four through one ladder.
--
-- Bodies copied from the latest definitions (live md5 verified):
--   lt_tournament_seed_order / _lt_stamp_seed_ranks  20260822120000
--   tournament_set_seeds                             20260628120000
-- ============================================


-- --------------------------------------------
-- 1. The column
-- --------------------------------------------
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS seeding_mode text NOT NULL DEFAULT 'circuit';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournaments_seeding_mode_check') THEN
        ALTER TABLE public.tournaments
          ADD CONSTRAINT tournaments_seeding_mode_check
          CHECK (seeding_mode IN ('circuit', 'rating', 'signup', 'manual'));
    END IF;
END $$;

COMMENT ON COLUMN public.tournaments.seeding_mode IS
    'Which ladder lt_tournament_seed_order runs for this draw: circuit '
    '(Circuit Rallia points), rating, signup (FIFO) or manual. An organizer '
    'seed_rank still overrides the computed order in every mode.';


-- --------------------------------------------
-- 2. Seed-rank writes, in one place
-- --------------------------------------------
-- treg_seed_unique_per_tournament is a non-deferrable exclusion constraint, so
-- a new permutation over an already-seeded set collides mid-statement unless
-- the old values are nulled first. NULL is exempt from the partial index.
CREATE OR REPLACE FUNCTION public._lt_assign_seed_ranks(
    p_tournament_id uuid,
    p_order         uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE tournament_registrations
       SET seed_rank = NULL
     WHERE tournament_id = p_tournament_id
       AND seed_rank IS NOT NULL;

    IF coalesce(array_length(p_order, 1), 0) = 0 THEN
        RETURN;
    END IF;

    UPDATE tournament_registrations tr
       SET seed_rank = o.ord
      FROM unnest(p_order) WITH ORDINALITY AS o(reg_id, ord)
     WHERE tr.id = o.reg_id
       AND tr.tournament_id = p_tournament_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._lt_assign_seed_ranks(uuid, uuid[]) FROM PUBLIC;


-- Body from 20260822120000, with the clear-then-assign dance moved into
-- _lt_assign_seed_ranks so set_seeding_mode and the publish paths share it.
CREATE OR REPLACE FUNCTION public._lt_stamp_seed_ranks(p_tournament_id uuid)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order uuid[];
BEGIN
    SELECT array_agg(o.registration_id ORDER BY o.suggested_seed)
      INTO v_order
      FROM public.lt_tournament_seed_order(p_tournament_id) o;

    IF EXISTS (
        SELECT 1 FROM tournament_registrations
         WHERE tournament_id = p_tournament_id
           AND status = 'registered'
           AND seed_rank IS NULL
    ) THEN
        PERFORM public._lt_assign_seed_ranks(p_tournament_id, v_order);
    END IF;

    RETURN v_order;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._lt_stamp_seed_ranks(uuid) FROM PUBLIC;


-- --------------------------------------------
-- 3. The ladder learns the mode
-- --------------------------------------------
-- Same signature and same return type as 20260822120000, so every caller
-- (previews, publish paths, tournament_seed_suggestions) picks the mode up
-- without a change. The two sort keys are resolved per mode; signup and
-- manual leave both NULL, which drops the order straight through to
-- registered_at.
CREATE OR REPLACE FUNCTION public.lt_tournament_seed_order(p_tournament_id uuid)
RETURNS TABLE (
    registration_id uuid,
    suggested_seed  integer,
    seed_rank       smallint,
    circuit_points  integer,
    circuit_rank    integer,
    rating          double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH t AS (
        SELECT tt.id, tt.sport_id, tt.seeding_mode,
               CASE WHEN tt.entry_format = 'singles' THEN 'singles' ELSE 'doubles' END AS board
          FROM tournaments tt
         WHERE tt.id = p_tournament_id
    ),
    board AS (
        SELECT b.user_id, b.points, b.rank
          FROM t,
               public.tournament_ranked_board(t.sport_id, NULL, NULL, NULL, t.board) b
    ),
    regs AS (
        SELECT tr.id, tr.seed_rank, tr.registered_at, tr.user_id, tr.partner_user_id
          FROM tournament_registrations tr
         WHERE tr.tournament_id = p_tournament_id
           AND tr.status = 'registered'
    ),
    members AS (
        SELECT r.id AS reg_id, m.user_id
          FROM regs r
          CROSS JOIN LATERAL (VALUES (r.user_id), (r.partner_user_id)) AS m(user_id)
         WHERE m.user_id IS NOT NULL
    ),
    scored AS (
        SELECT m.reg_id,
               sum(coalesce(b.points, 0))::int AS circuit_points,
               min(b.rank)::int                AS circuit_rank,
               avg(rs.value)                   AS rating
          FROM members m
          CROSS JOIN t
          LEFT JOIN board b                 ON b.user_id = m.user_id
          LEFT JOIN player_sport ps         ON ps.player_id = m.user_id AND ps.sport_id = t.sport_id
          LEFT JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
          LEFT JOIN rating_score rs         ON rs.id = prs.rating_score_id
         GROUP BY m.reg_id
    )
    SELECT r.id,
           (row_number() OVER (
               ORDER BY r.seed_rank ASC NULLS LAST,
                        CASE t.seeding_mode
                            WHEN 'circuit' THEN s.circuit_points::double precision
                            WHEN 'rating'  THEN s.rating
                        END DESC NULLS LAST,
                        CASE t.seeding_mode
                            WHEN 'circuit' THEN s.rating
                            WHEN 'rating'  THEN s.circuit_points::double precision
                        END DESC NULLS LAST,
                        r.registered_at ASC,
                        r.id ASC))::int,
           r.seed_rank,
           s.circuit_points,
           s.circuit_rank,
           s.rating
      FROM regs r
      JOIN scored s ON s.reg_id = r.id
      CROSS JOIN t
     ORDER BY 2;
$$;
REVOKE EXECUTE ON FUNCTION public.lt_tournament_seed_order(uuid) FROM PUBLIC;
COMMENT ON FUNCTION public.lt_tournament_seed_order(uuid) IS
  'Effective seed order of a tournament''s registered entries. seed_rank '
  '(organizer override) always leads; the computed tail follows '
  'tournaments.seeding_mode — circuit (Circuit Rallia points of the sport + '
  'singles/doubles board, partners summed, then rating), rating (rating '
  'first, partners averaged), signup or manual (registration order). Read by '
  'every preview and publish path; internal, see tournament_seed_suggestions.';


-- --------------------------------------------
-- 4. Picking the mode
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.tournament_set_seeding_mode(
    p_tournament_id uuid,
    p_mode          text,
    p_version_was   integer
)
RETURNS tournaments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id  uuid := auth.uid();
    v_tournament tournaments;
    v_prev       text;
    v_order      uuid[];
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;
    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;
    IF p_mode IS NULL OR p_mode NOT IN ('circuit', 'rating', 'signup', 'manual') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_SEEDING_MODE';
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
    IF v_tournament.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;
    IF v_tournament.version <> p_version_was THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;
    -- Settable any time before the draw exists; once it does, the seeding is
    -- history and the mode would be a lie.
    IF EXISTS (SELECT 1 FROM tournament_matches WHERE tournament_id = p_tournament_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'BRACKET_ALREADY_GENERATED';
    END IF;
    IF v_tournament.status NOT IN ('draft', 'registration_open', 'registration_closed') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_READY';
    END IF;

    v_prev := v_tournament.seeding_mode;
    IF v_prev = p_mode THEN
        RETURN v_tournament;   -- no-op: never clobber seeds on a re-pick
    END IF;

    -- Read the order the organizer is looking at BEFORE the mode changes,
    -- since the ladder resolves the mode from the row we are about to update.
    IF p_mode = 'manual' THEN
        SELECT array_agg(o.registration_id ORDER BY o.suggested_seed)
          INTO v_order
          FROM public.lt_tournament_seed_order(p_tournament_id) o;
    END IF;

    -- No version bump: the setup screen holds one version across seeding and
    -- publish, same contract as tournament_set_seeds.
    UPDATE tournaments
       SET seeding_mode = p_mode
     WHERE id = p_tournament_id
    RETURNING * INTO v_tournament;

    IF p_mode = 'manual' THEN
        PERFORM public._lt_assign_seed_ranks(p_tournament_id, v_order);
    ELSE
        UPDATE tournament_registrations
           SET seed_rank = NULL
         WHERE tournament_id = p_tournament_id
           AND seed_rank IS NOT NULL;
    END IF;

    INSERT INTO leagues_tournaments_audit
        (scope, entity_id, action, actor_id, payload_before, payload_after)
    VALUES (
        'tournament', p_tournament_id, 'set_seeding_mode', v_caller_id,
        jsonb_build_object('seeding_mode', v_prev),
        jsonb_build_object('seeding_mode', p_mode)
    );

    RETURN v_tournament;
END;
$$;
GRANT EXECUTE ON FUNCTION public.tournament_set_seeding_mode(uuid, text, integer) TO authenticated;
COMMENT ON FUNCTION public.tournament_set_seeding_mode(uuid, text, integer) IS
  'Organizer picks which ladder seeds the draw. Switching to a computed mode '
  'clears any manual seed_rank; switching to manual freezes the order '
  'currently produced by the old mode so the organizer keeps their starting '
  'point. Refuses once the draw exists. Does not bump tournament.version.';


-- --------------------------------------------
-- 5. Hand-ordering IS manual mode
-- --------------------------------------------
-- Body from 20260628120000 with one addition: the mode flip at the end. The
-- organizer dragged the field into an order, so the picker has to stop
-- claiming the draw follows the Circuit.
CREATE OR REPLACE FUNCTION public.tournament_set_seeds(
    p_tournament_id            uuid,
    p_ordered_registration_ids uuid[],
    p_version_was              integer
)
RETURNS SETOF tournament_registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id        uuid := auth.uid();
    v_tournament       tournaments;
    v_registered_count integer;
    v_provided_count   integer := coalesce(array_length(p_ordered_registration_ids, 1), 0);
    v_distinct_count   integer;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;
    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
    IF v_tournament.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;
    IF v_tournament.version <> p_version_was THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;
    IF v_tournament.status <> 'registration_closed' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_READY';
    END IF;
    IF EXISTS (SELECT 1 FROM tournament_matches WHERE tournament_id = p_tournament_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'BRACKET_ALREADY_GENERATED';
    END IF;

    SELECT count(*) INTO v_registered_count
    FROM tournament_registrations
    WHERE tournament_id = p_tournament_id AND status = 'registered';

    SELECT count(DISTINCT u) INTO v_distinct_count
    FROM unnest(p_ordered_registration_ids) AS u;

    IF v_provided_count <> v_registered_count OR v_provided_count <> v_distinct_count THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEED_SET_MISMATCH';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM unnest(p_ordered_registration_ids) AS u(id)
        LEFT JOIN tournament_registrations tr
          ON tr.id = u.id
         AND tr.tournament_id = p_tournament_id
         AND tr.status = 'registered'
        WHERE tr.id IS NULL
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEED_FOREIGN_ID';
    END IF;

    -- Clear existing seeds first. The per-tournament seed_rank exclusion
    -- constraint (treg_seed_unique_per_tournament) is NOT deferrable and is
    -- enforced per row, so reassigning a new permutation over an already-seeded
    -- set would transiently collide mid-statement. NULL seed_rank is exempt
    -- from the (partial) constraint, so null them all, then assign the order.
    PERFORM public._lt_assign_seed_ranks(p_tournament_id, p_ordered_registration_ids);

    -- An explicit order IS the manual mode; leaving the tournament on
    -- 'circuit' would have the picker advertise a ladder nobody is running.
    UPDATE tournaments
       SET seeding_mode = 'manual'
     WHERE id = p_tournament_id
       AND seeding_mode <> 'manual';

    RETURN QUERY
        SELECT * FROM tournament_registrations
         WHERE tournament_id = p_tournament_id AND status = 'registered'
         ORDER BY seed_rank ASC NULLS LAST, registered_at ASC, id ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.tournament_set_seeds(uuid, uuid[], integer) TO authenticated;
