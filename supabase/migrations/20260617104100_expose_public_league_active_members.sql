-- Allow public league spectators to see the visible member roster.
--
-- Pending and suspended rows remain private to the row owner, organizers,
-- active league members, and admins.
CREATE OR REPLACE FUNCTION public.league_is_public(p_league_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
          FROM public.leagues l
         WHERE l.id = p_league_id
           AND l.visibility = 'public'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_is_public(uuid) TO authenticated;

DROP POLICY IF EXISTS lm_select ON public.league_members;
CREATE POLICY lm_select ON public.league_members FOR SELECT
USING (
    public.is_admin()
    OR user_id = auth.uid()
    OR public.is_league_organizer(league_id)
    OR public.is_active_league_member(league_id)
    OR (status = 'active' AND public.league_is_public(league_id))
);
