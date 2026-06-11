-- ============================================
-- Fix: break cyclic RLS policy references on tournaments / tournament_registrations
-- ============================================
-- The migration 20260510170001 installed two policies that reference each
-- other through inline EXISTS subqueries:
--
--   tournaments_select:           EXISTS (SELECT FROM tournament_registrations ...)
--   treg_select:                  EXISTS (SELECT FROM tournaments ...)
--
-- A SELECT on `tournaments` triggers tournaments_select, which evaluates
-- the registrations EXISTS, which triggers treg_select, which evaluates
-- the tournaments EXISTS — and so on. PG raises:
--   ERROR: infinite recursion detected in policy for relation "tournaments"
--
-- Fix: introduce two SECURITY DEFINER plpgsql helpers that bypass RLS on
-- the inner query, and rewrite the policies to use them. SECURITY DEFINER
-- runs with the function owner's privileges (postgres in supabase local,
-- which has BYPASSRLS); plpgsql functions are not inlined by the planner,
-- so SECURITY DEFINER actually takes effect.
--
-- Same shape applied pre-emptively to tournament_matches_select for the
-- analogous registrations EXISTS clause it carries.
--
-- This migration is a follow-up to 20260510170003 (which converted the
-- existing role helpers to plpgsql but did not address the cross-table
-- policy cycle).
-- ============================================


-- =====================
-- New helpers
-- =====================

CREATE OR REPLACE FUNCTION public.is_tournament_registrant(p_tournament_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM tournament_registrations r
         WHERE r.tournament_id = p_tournament_id
           AND r.user_id       = auth.uid()
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_tournament_registrant(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.tournament_is_public(p_tournament_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM tournaments t
         WHERE t.id = p_tournament_id
           AND t.visibility = 'public'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_is_public(uuid) TO authenticated;


-- =====================
-- Rewrite policies to use the helpers
-- =====================

-- tournaments_select: replace the registrations EXISTS with the helper
DROP POLICY IF EXISTS tournaments_select ON tournaments;
CREATE POLICY tournaments_select ON tournaments FOR SELECT
USING (
    public.is_admin()
    OR visibility = 'public'
    OR organizer_id = auth.uid()
    OR public.is_tournament_organizer(id)
    OR public.is_tournament_registrant(id)
    OR (
        visibility = 'community'
        AND network_id IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM network_member nm
             WHERE nm.network_id = tournaments.network_id
               AND nm.player_id  = auth.uid()
               AND nm.status     = 'active'
        )
    )
);


-- treg_select: replace the tournaments EXISTS with the helper
DROP POLICY IF EXISTS treg_select ON tournament_registrations;
CREATE POLICY treg_select ON tournament_registrations FOR SELECT
USING (
    public.is_admin()
    OR user_id = auth.uid()
    OR public.is_tournament_organizer(tournament_id)
    OR public.tournament_is_public(tournament_id)
);


-- tmatches_select: same shape, both cross-table EXISTS replaced
DROP POLICY IF EXISTS tmatches_select ON tournament_matches;
CREATE POLICY tmatches_select ON tournament_matches FOR SELECT
USING (
    public.is_admin()
    OR public.tournament_is_public(tournament_id)
    OR public.is_tournament_organizer(tournament_id)
    OR public.is_tournament_registrant(tournament_id)
);
