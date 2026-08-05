-- ============================================================================
-- Leagues — let a queued player see their place in line
-- ============================================================================
-- lmw_select lets a player read only their OWN league_member_waitlist row
-- (organizers see the whole queue). Their raw `position` value is an insertion
-- counter, not a rank — after promotions the head of the queue can hold
-- position 7 with nobody ahead — and counting rows ahead requires reading rows
-- RLS hides. This SECURITY DEFINER helper returns the caller's live 1-based
-- rank and the queue size for one league; empty when they are not queued.
-- Mobile uses it to replace the bare "request sent" chip with "#N in line".
-- ============================================================================

CREATE OR REPLACE FUNCTION public.league_waitlist_position(p_league_id uuid)
RETURNS TABLE (queue_rank integer, queue_size integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT r.rnk::integer, (SELECT count(*) FROM league_member_waitlist
                             WHERE league_id = p_league_id AND promoted_at IS NULL)::integer
      FROM (
        SELECT user_id,
               row_number() OVER (ORDER BY position ASC, joined_at ASC) AS rnk
          FROM league_member_waitlist
         WHERE league_id = p_league_id AND promoted_at IS NULL
      ) r
     WHERE r.user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.league_waitlist_position(uuid) TO authenticated;

COMMENT ON FUNCTION public.league_waitlist_position(uuid) IS
'The calling player''s live 1-based rank in a league''s un-promoted waitlist,
plus the queue size. Empty result when not queued.';
