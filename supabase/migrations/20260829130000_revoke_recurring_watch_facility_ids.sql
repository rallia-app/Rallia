-- ============================================================================
-- Migration: Lock recurring_watch_facility_ids to service_role
-- Created: 2026-08-29
-- Description: 20260828122000 granted EXECUTE to service_role but never revoked
--              the PUBLIC default, so anon could call it. The function is
--              SECURITY DEFINER, so that let an unauthenticated caller
--              enumerate facilities carrying an upcoming unbooked recurring
--              game, bypassing RLS on match and facility. Its two siblings in
--              that migration carry the revoke; this one was missed.
-- ============================================================================

REVOKE ALL ON FUNCTION public.recurring_watch_facility_ids(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recurring_watch_facility_ids(int) TO service_role;
