-- ============================================
-- Fix: RLS helper recursion on tournaments / leagues / league_members
-- ============================================
-- The is_tournament_organizer / is_league_organizer / is_active_league_member
-- helpers in 20260510170001 were declared LANGUAGE sql + SECURITY DEFINER.
-- Postgres can inline simple SQL functions into the calling policy expression,
-- which bypasses SECURITY DEFINER. When the helper queries the same table
-- whose policy invoked it, RLS evaluates a second time → infinite recursion
-- (SQLSTATE 42P17).
--
-- Symptom: any authenticated SELECT on `tournaments`, `leagues`, or
-- `league_members` raises:
--   ERROR: infinite recursion detected in policy for relation "tournaments"
--
-- Fix: redefine the helpers as LANGUAGE plpgsql. plpgsql functions are NOT
-- inlined, so SECURITY DEFINER actually takes effect and bypasses RLS on the
-- helper's internal queries.
--
-- Reference: same pattern used in 20260321090000_fix_admin_rls_infinite_recursion.sql
-- for the public.is_admin() function on the public.admin table.
-- ============================================

CREATE OR REPLACE FUNCTION public.is_tournament_organizer(p_tournament_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM tournaments t
         WHERE t.id = p_tournament_id AND t.organizer_id = auth.uid()
    ) OR EXISTS (
        SELECT 1 FROM tournament_co_organizers c
         WHERE c.tournament_id = p_tournament_id AND c.user_id = auth.uid()
    );
END;
$$;


CREATE OR REPLACE FUNCTION public.is_league_organizer(p_league_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM leagues l
         WHERE l.id = p_league_id AND l.organizer_id = auth.uid()
    ) OR EXISTS (
        SELECT 1 FROM league_members m
         WHERE m.league_id = p_league_id
           AND m.user_id = auth.uid()
           AND m.role = 'co_organizer'
           AND m.status = 'active'
    );
END;
$$;


CREATE OR REPLACE FUNCTION public.is_active_league_member(p_league_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM league_members m
         WHERE m.league_id = p_league_id
           AND m.user_id  = auth.uid()
           AND m.status   = 'active'
    );
END;
$$;
