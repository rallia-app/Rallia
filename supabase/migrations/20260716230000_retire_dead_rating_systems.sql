-- ============================================================================
-- Rating systems — retire the dead ones, enforce one active per sport
-- ============================================================================
-- `tournaments.min_rating` is a bare numeric with no rating system attached, so
-- "4.0" is only meaningful if the sport has exactly one system it can be on.
-- Today that is true by accident of the client: SPORT_RATING_SYSTEM_MAP pins
-- tennis→ntrp and pickleball→dupr, and nothing else is reachable. But the DB
-- happily holds five is_active systems, including UTR (max 16.5) sitting next
-- to NTRP (max 7.0) on the same sport — so a raw 4.0 is ambiguous at the schema
-- level even though it isn't in practice.
--
-- Circuit Rallia needs to resolve min_rating → skill_level to price an event's
-- level. Rather than mirror the client constant into Postgres (a second source
-- of truth that rots silently), make `is_active` mean what it says:
--
--   1. Retire utr, self_tennis, self_pickle. All three are provably dead —
--      zero rating_score references from any player_rating_score row, active or
--      not, and unreachable from the app.
--   2. A partial unique index guarantees at most ONE active system per sport,
--      so "the sport's rating system" is a well-defined lookup from now on.
--   3. lt_sport_rating_system(sport) is the single resolver.
--
-- Nothing reads rating_system.is_active today (the app filters by `code`), so
-- retiring these three is inert for every existing caller.
-- ============================================================================

UPDATE public.rating_system
   SET is_active  = false,
       updated_at = now()
 WHERE code IN ('utr', 'self_tennis', 'self_pickle');

-- Guard the invariant min_rating depends on: one active system per sport, so a
-- bare rating number can always be resolved to exactly one scale.
CREATE UNIQUE INDEX IF NOT EXISTS rating_system_one_active_per_sport
    ON public.rating_system (sport_id)
 WHERE is_active;

COMMENT ON COLUMN public.rating_system.is_active IS
  'Whether this system is the one players rate on for its sport. Exactly one '
  'active system per sport (enforced by rating_system_one_active_per_sport) — '
  'this is what lets a bare number like tournaments.min_rating resolve to a '
  'single scale.';

CREATE OR REPLACE FUNCTION public.lt_sport_rating_system(p_sport_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT id FROM rating_system
     WHERE sport_id = p_sport_id AND is_active
     LIMIT 1;
$$;

COMMENT ON FUNCTION public.lt_sport_rating_system(uuid) IS
  'The single active rating system for a sport. Use this to interpret any bare '
  'rating number stored against that sport.';

GRANT EXECUTE ON FUNCTION public.lt_sport_rating_system(uuid) TO authenticated, service_role;
