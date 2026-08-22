-- =============================================================================
-- get_total_unread_count: the chat tab badge.
--
-- getTotalUnreadCount() used to fetch the whole conversation list
-- (get_player_conversations_optimized) and sum unread_count client-side, on a
-- 1s-staleTime query that every realtime message event and every mark-as-read
-- settle refetches. This is the same predicate as the unread_counts CTE of
-- get_player_conversations_optimized and as get_unread_conversations_count,
-- summed instead of counted per conversation. A caller only gets their own
-- count.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_total_unread_count(p_player_id uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(m.id)::int
  FROM conversation_participant cp
  JOIN message m
    ON m.conversation_id = cp.conversation_id
   AND m.sender_id != p_player_id
   AND m.deleted_at IS NULL
   AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
  WHERE cp.player_id = p_player_id
    AND p_player_id = auth.uid()
    AND COALESCE(cp.is_archived, false) = false;
$$;

REVOKE ALL ON FUNCTION public.get_total_unread_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_total_unread_count(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_total_unread_count(uuid) IS
  'Total unread messages across the caller''s non-archived conversations (chat tab badge). Mirrors the unread_counts CTE of get_player_conversations_optimized.';
