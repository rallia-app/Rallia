-- =============================================================================
-- Restore anon EXECUTE on search_players_nearby.
--
-- The caller-guards sweep (20260821200000) applied its blanket
-- "REVOKE ALL ... FROM PUBLIC, anon" to every function it touched. That policy
-- fits the player- and admin-scoped RPCs in that sweep, but the player
-- directory is a signed-out read: the Community screen renders for guests and
-- p_current_user_id is optional. Since the sweep, a signed-out fetch answers
-- 42501 "permission denied for function search_players_nearby".
--
-- The function's own guard stays intact: it only raises when a JWT is present
-- and p_current_user_id disagrees with auth.uid(), so an anon caller passes.
-- =============================================================================

GRANT EXECUTE ON FUNCTION public.search_players_nearby(
  uuid, uuid, text, double precision, double precision,
  text, numeric, integer, text, text, text,
  uuid[], uuid[], boolean, boolean, uuid[],
  text, integer, integer,
  uuid[], text, boolean, smallint, smallint
) TO anon;
