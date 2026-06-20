-- Make table-level GRANTs explicit for core player/match tables.
-- Idempotent and a no-op against prod/staging (grants already present);
-- restores them on local resets and codifies them ahead of Supabase
-- removing implicit Data API grants (2026-10-30).

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile TO service_role, authenticated;
GRANT SELECT ON public.profile TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.player TO service_role, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_sport TO service_role, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.match TO service_role, authenticated;
GRANT SELECT ON public.match TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.match_participant TO service_role, authenticated;
