-- Signed-out browsing of the event module reads player cards (rosters,
-- brackets, standings), so anon needs SELECT on the tables the anon RLS
-- policies from 20260314000000_allow_anon_player_directory_view.sql already
-- cover. Without the table GRANT, one embed raises 42501 and kills the whole
-- select.
--
-- Idempotent and a no-op against prod/staging (grants already present);
-- restores them on local resets and codifies them ahead of Supabase removing
-- implicit Data API grants (2026-10-30). Same intent as
-- 20260616180000_restore_core_table_grants.sql, which covered profile/match.

GRANT SELECT ON public.player TO anon;
GRANT SELECT ON public.player_sport TO anon;
GRANT SELECT ON public.player_rating_score TO anon;
GRANT SELECT ON public.player_reputation TO anon;
