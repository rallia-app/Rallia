-- =============================================================================
-- Player availability: replace 3-period enum with 6-block enum, add freshness
--
-- Today `player_availability.period` is `period_enum` with three values
-- (morning, afternoon, evening). That coarseness lets matches at 6 AM and
-- 11 AM look identical to scoring — bad suggestions surface that can't
-- actually happen. We're moving to 6 blocks:
--
--   early     06:00–09:00
--   morning   09:00–12:00
--   midday    12:00–14:00
--   afternoon 14:00–17:00
--   evening   17:00–20:00
--   late      20:00–23:00
--
-- We also add `last_confirmed_at TIMESTAMPTZ` so the UI can flag stale data
-- and the weekly "confirm your week" notification (added in a later
-- migration) has a freshness signal to query against.
--
-- Backfill strategy: every existing row is auto-doubled into two new-enum
-- rows (morning→early+morning, afternoon→midday+afternoon,
-- evening→evening+late). All rows post-backfill get last_confirmed_at=NULL
-- so the staleness UI prompts every existing user to refine on next visit —
-- no forced re-onboarding. ON CONFLICT DO NOTHING guards against the
-- (player_id, day, period) unique constraint in case a player already has
-- a row at the destination period.
--
-- The enum swap is atomic: create new → ALTER COLUMN TYPE (which preserves
-- indexes by rebuild) → backfill rows → drop old type → rename new to
-- canonical name. period_enum is not referenced in any function signature
-- (verified via grep) — only in function bodies as ::TEXT casts — so no
-- function recreation is forced by the type drop.
-- =============================================================================

-- 1. Create the new 6-value enum under a temp name.
CREATE TYPE public.period_enum_new AS ENUM (
  'early',
  'morning',
  'midday',
  'afternoon',
  'evening',
  'late'
);

-- 2. Swap the column type. The 3 existing values (morning/afternoon/evening)
--    are all present in the new enum, so the TEXT cast round-trip succeeds
--    for every row. Postgres rebuilds dependent indexes automatically.
ALTER TABLE public.player_availability
  ALTER COLUMN period TYPE public.period_enum_new
  USING period::TEXT::public.period_enum_new;

-- 3. Add the freshness timestamp. Nullable, defaults to NULL so every
--    existing row immediately reads as "needs refinement" in the UI.
ALTER TABLE public.player_availability
  ADD COLUMN IF NOT EXISTS last_confirmed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.player_availability.last_confirmed_at IS
  'Last time the player confirmed this availability slot (via explicit '
  'edit or a no-op "save" tap from the weekly refresh prompt). NULL means '
  'the row was backfilled from the legacy 3-period schema and has never '
  'been confirmed under the 6-block model. Used to drive staleness UX and '
  'the weekly refresh notification.';

-- 4. Backfill: split each legacy row into the new finer-grained companion.
--    morning  → also early
--    afternoon → also midday
--    evening   → also late
--    The original morning/afternoon/evening rows are preserved as-is.
--    last_confirmed_at stays NULL on every row (existing + backfilled) so
--    the staleness UI fires for everyone exactly once.
INSERT INTO public.player_availability (player_id, day, period, is_active, last_confirmed_at)
  SELECT player_id, day, 'early'::public.period_enum_new, is_active, NULL
    FROM public.player_availability
   WHERE period = 'morning'::public.period_enum_new
ON CONFLICT (player_id, day, period) DO NOTHING;

INSERT INTO public.player_availability (player_id, day, period, is_active, last_confirmed_at)
  SELECT player_id, day, 'midday'::public.period_enum_new, is_active, NULL
    FROM public.player_availability
   WHERE period = 'afternoon'::public.period_enum_new
ON CONFLICT (player_id, day, period) DO NOTHING;

INSERT INTO public.player_availability (player_id, day, period, is_active, last_confirmed_at)
  SELECT player_id, day, 'late'::public.period_enum_new, is_active, NULL
    FROM public.player_availability
   WHERE period = 'evening'::public.period_enum_new
ON CONFLICT (player_id, day, period) DO NOTHING;

-- 5. Drop the old enum (now unreferenced) and rename the new one into place.
DROP TYPE public.period_enum;
ALTER TYPE public.period_enum_new RENAME TO period_enum;
