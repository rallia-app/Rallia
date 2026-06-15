-- ============================================
-- Leagues & Tournaments — explicit table GRANTs
-- ============================================
-- Supabase is removing the default Data API privileges that PostgREST relies
-- on (for the Rallia project: 2026-10-30). After that, `authenticated` will
-- have NO privileges on these tables unless granted explicitly, and every
-- read would fail with `permission denied` even though RLS would allow it.
--
-- The L&T schema (20260510165900) and RLS (20260510170001) migrations created
-- 19 tables but never granted table privileges — they depended on the legacy
-- defaults. This migration makes the grants explicit.
--
-- Privilege model:
--   - Reads go through PostgREST as `authenticated`, gated by the SELECT
--     RLS policies → grant SELECT.
--   - Writes go exclusively through SECURITY DEFINER RPCs, which run as the
--     function owner (bypassing both RLS and caller grants). Every child
--     table additionally has a `*_no_direct_write` policy denying direct DML.
--     So no INSERT/UPDATE/DELETE grants are needed for `authenticated`.
--   - `service_role` bypasses RLS but still needs table privileges for the
--     edge-function / admin paths that read these tables directly.
-- ============================================

DO $$
DECLARE
    v_table text;
    v_tables text[] := ARRAY[
        'tournaments',
        'tournament_invite_links',
        'tournament_co_organizers',
        'tournament_registrations',
        'tournament_waitlist',
        'tournament_matches',
        'tournament_match_scores',
        'leagues',
        'league_invite_links',
        'league_members',
        'league_member_waitlist',
        'seasons',
        'sessions',
        'session_courts',
        'session_presence',
        'session_matches',
        'session_match_scores',
        'season_rankings',
        'leagues_tournaments_audit'
    ];
BEGIN
    FOREACH v_table IN ARRAY v_tables LOOP
        EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role;', v_table);
    END LOOP;
END
$$;
