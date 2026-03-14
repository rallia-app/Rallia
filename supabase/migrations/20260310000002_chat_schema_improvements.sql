-- Migration: Chat Schema Improvements
-- Fixes: N+1 in getOrCreateDirectConversation, unbounded mark_messages_as_read,
--        missing auth in mark_message_as_delivered, missing composite index,
--        English-only full-text search, overly permissive participant INSERT policy,
--        missing trigger for conversation.updated_at on new message

-- =============================================================================
-- 1. RPC: Find existing direct conversation between two players (replaces N+1)
-- =============================================================================

CREATE OR REPLACE FUNCTION find_direct_conversation(p_player1 uuid, p_player2 uuid)
RETURNS uuid AS $$
  SELECT c.id
  FROM conversation c
  JOIN conversation_participant cp1 ON cp1.conversation_id = c.id AND cp1.player_id = p_player1
  JOIN conversation_participant cp2 ON cp2.conversation_id = c.id AND cp2.player_id = p_player2
  WHERE c.conversation_type = 'direct'
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION find_direct_conversation(uuid, uuid) TO authenticated;

-- =============================================================================
-- 2. Bound mark_messages_as_read to only update recent messages
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mark_messages_as_read(
  p_conversation_id uuid,
  p_reader_id uuid
)
RETURNS void AS $$
DECLARE
  v_last_read_at timestamptz;
BEGIN
  -- Verify the reader is a participant in this conversation
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_participant
    WHERE conversation_id = p_conversation_id
    AND player_id = p_reader_id
  ) THEN
    RAISE EXCEPTION 'User is not a participant in this conversation';
  END IF;

  -- Get the participant's current last_read_at to bound the update
  SELECT last_read_at INTO v_last_read_at
  FROM public.conversation_participant
  WHERE conversation_id = p_conversation_id
  AND player_id = p_reader_id;

  -- Only update messages newer than last_read_at (or all if never read)
  UPDATE public.message
  SET status = 'read'
  WHERE conversation_id = p_conversation_id
    AND sender_id != p_reader_id
    AND status IN ('sent', 'delivered')
    AND (v_last_read_at IS NULL OR created_at > v_last_read_at);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 3. Add authorization check to mark_message_as_delivered
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mark_message_as_delivered(
  p_message_id uuid
)
RETURNS void AS $$
BEGIN
  -- Verify the caller is a participant in the message's conversation
  IF NOT EXISTS (
    SELECT 1 FROM public.message m
    JOIN public.conversation_participant cp ON cp.conversation_id = m.conversation_id
    WHERE m.id = p_message_id
    AND cp.player_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'User is not a participant in this conversation';
  END IF;

  -- Only mark as delivered if still 'sent' and not sent by the caller
  UPDATE public.message
  SET status = 'delivered'
  WHERE id = p_message_id
    AND status = 'sent'
    AND sender_id != auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 4. Add composite index on message(conversation_id, created_at DESC)
-- =============================================================================

-- Drop the individual created_at index since the composite one covers it
DROP INDEX IF EXISTS idx_message_created_at;

CREATE INDEX IF NOT EXISTS idx_message_conversation_created
  ON public.message (conversation_id, created_at DESC);

-- Also add composite for unread count queries: conversation + sender + deleted + created
CREATE INDEX IF NOT EXISTS idx_message_unread_lookup
  ON public.message (conversation_id, sender_id, created_at)
  WHERE deleted_at IS NULL;

-- =============================================================================
-- 5. Fix full-text search to use 'simple' config (language-agnostic)
-- =============================================================================

-- Update the trigger function to use 'simple' instead of 'english'
CREATE OR REPLACE FUNCTION update_message_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('simple', COALESCE(NEW.content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Update the search function to use 'simple' as well
CREATE OR REPLACE FUNCTION search_conversation_messages(
  p_conversation_id UUID,
  p_query TEXT,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE(
  id UUID,
  conversation_id UUID,
  sender_id UUID,
  content TEXT,
  created_at TIMESTAMPTZ,
  rank REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.conversation_id,
    m.sender_id,
    m.content,
    m.created_at,
    ts_rank(m.search_vector, plainto_tsquery('simple', p_query)) AS rank
  FROM public.message m
  WHERE m.conversation_id = p_conversation_id
    AND m.deleted_at IS NULL
    AND m.search_vector @@ plainto_tsquery('simple', p_query)
  ORDER BY rank DESC, m.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- Backfill existing messages with 'simple' config search vectors
UPDATE public.message
SET search_vector = to_tsvector('simple', COALESCE(content, ''))
WHERE deleted_at IS NULL;

-- =============================================================================
-- 6. Restrict conversation_participant INSERT policy
-- =============================================================================

-- Drop the existing overly permissive policy
DROP POLICY IF EXISTS "Users can add participants to conversations" ON public.conversation_participant;

-- New policy: users can add participants if they are the creator, an existing
-- participant, or adding themselves. Self-joins are allowed for now to support
-- match chat flows (ensureMatchChat) and other cases. Can be tightened later.
CREATE POLICY "Users can add participants to conversations"
  ON public.conversation_participant FOR INSERT
  WITH CHECK (
    -- User is the creator of the conversation
    EXISTS (
      SELECT 1 FROM public.conversation c
      WHERE c.id = conversation_id
      AND c.created_by = auth.uid()
    )
    OR
    -- User is already a participant (existing members inviting others)
    -- Uses SECURITY DEFINER function to avoid infinite recursion
    conversation_id IN (SELECT get_user_conversation_ids(auth.uid()))
    OR
    -- User is adding themselves
    player_id = auth.uid()
  );

-- =============================================================================
-- 7. Auto-update conversation.updated_at on new message (trigger)
-- =============================================================================

CREATE OR REPLACE FUNCTION update_conversation_on_new_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.conversation
  SET updated_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_update_conversation_on_message ON public.message;
CREATE TRIGGER trigger_update_conversation_on_message
  AFTER INSERT ON public.message
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_on_new_message();

-- =============================================================================
-- 8. Fix get_player_conversations_optimized to filter deleted messages in unread count
-- =============================================================================

DROP FUNCTION IF EXISTS get_player_conversations_optimized(uuid);

CREATE OR REPLACE FUNCTION get_player_conversations_optimized(p_player_id uuid)
RETURNS TABLE (
  id uuid,
  conversation_type text,
  title text,
  picture_url text,
  match_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  last_message_id uuid,
  last_message_content text,
  last_message_at timestamptz,
  last_message_sender_id uuid,
  last_message_sender_first_name text,
  is_pinned boolean,
  is_muted boolean,
  is_archived boolean,
  last_read_at timestamptz,
  participant_count bigint,
  unread_count bigint,
  other_participant_id uuid,
  other_participant_first_name text,
  other_participant_last_name text,
  other_participant_picture_url text,
  other_participant_last_seen_at timestamptz,
  network_id uuid,
  network_type text,
  network_cover_image_url text,
  match_format text,
  match_date date,
  match_sport_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH
  player_conversations AS (
    SELECT
      cp.conversation_id,
      cp.is_pinned,
      cp.is_muted,
      cp.is_archived,
      cp.last_read_at
    FROM conversation_participant cp
    WHERE cp.player_id = p_player_id
  ),

  last_messages AS (
    SELECT DISTINCT ON (m.conversation_id)
      m.conversation_id,
      m.id AS message_id,
      m.content,
      m.created_at AS message_at,
      m.sender_id,
      p.first_name AS sender_first_name
    FROM message m
    JOIN player pl ON pl.id = m.sender_id
    JOIN profile p ON p.id = pl.id
    WHERE m.conversation_id IN (SELECT conversation_id FROM player_conversations)
      AND m.deleted_at IS NULL
    ORDER BY m.conversation_id, m.created_at DESC
  ),

  participant_counts AS (
    SELECT
      cp.conversation_id,
      COUNT(*) AS participant_count
    FROM conversation_participant cp
    WHERE cp.conversation_id IN (SELECT conversation_id FROM player_conversations)
    GROUP BY cp.conversation_id
  ),

  unread_counts AS (
    SELECT
      pc.conversation_id,
      COUNT(m.id) AS unread_count
    FROM player_conversations pc
    LEFT JOIN message m ON m.conversation_id = pc.conversation_id
      AND m.sender_id != p_player_id
      AND m.deleted_at IS NULL
      AND (pc.last_read_at IS NULL OR m.created_at > pc.last_read_at)
    GROUP BY pc.conversation_id
  ),

  other_participants AS (
    SELECT
      c.id AS conversation_id,
      pl.id AS other_player_id,
      pr.first_name,
      pr.last_name,
      pr.profile_picture_url,
      pl.last_seen_at
    FROM conversation c
    JOIN conversation_participant cp ON cp.conversation_id = c.id
    JOIN player pl ON pl.id = cp.player_id
    JOIN profile pr ON pr.id = pl.id
    WHERE c.conversation_type = 'direct'
      AND c.id IN (SELECT conversation_id FROM player_conversations)
      AND cp.player_id != p_player_id
  ),

  network_info AS (
    SELECT
      n.conversation_id,
      n.id AS network_id,
      nt.name AS network_type,
      n.cover_image_url
    FROM network n
    JOIN network_type nt ON nt.id = n.network_type_id
    WHERE n.conversation_id IN (SELECT conversation_id FROM player_conversations)
  ),

  match_info AS (
    SELECT
      c.id AS conversation_id,
      m.format::text AS match_format,
      m.match_date,
      s.name::text AS sport_name
    FROM conversation c
    JOIN match m ON m.id = c.match_id
    JOIN sport s ON s.id = m.sport_id
    WHERE c.match_id IS NOT NULL
      AND c.id IN (SELECT conversation_id FROM player_conversations)
  )

  SELECT
    c.id,
    c.conversation_type::text,
    c.title,
    c.picture_url,
    c.match_id,
    c.created_at,
    c.updated_at,
    lm.message_id AS last_message_id,
    lm.content AS last_message_content,
    lm.message_at AS last_message_at,
    lm.sender_id AS last_message_sender_id,
    lm.sender_first_name AS last_message_sender_first_name,
    COALESCE(pc.is_pinned, false) AS is_pinned,
    COALESCE(pc.is_muted, false) AS is_muted,
    COALESCE(pc.is_archived, false) AS is_archived,
    pc.last_read_at,
    COALESCE(pcount.participant_count, 0) AS participant_count,
    COALESCE(uc.unread_count, 0) AS unread_count,
    op.other_player_id AS other_participant_id,
    op.first_name AS other_participant_first_name,
    op.last_name AS other_participant_last_name,
    op.profile_picture_url AS other_participant_picture_url,
    op.last_seen_at AS other_participant_last_seen_at,
    ni.network_id,
    ni.network_type,
    COALESCE(ni.cover_image_url, c.picture_url) AS network_cover_image_url,
    mi.match_format,
    mi.match_date,
    mi.sport_name AS match_sport_name
  FROM conversation c
  JOIN player_conversations pc ON pc.conversation_id = c.id
  LEFT JOIN last_messages lm ON lm.conversation_id = c.id
  LEFT JOIN participant_counts pcount ON pcount.conversation_id = c.id
  LEFT JOIN unread_counts uc ON uc.conversation_id = c.id
  LEFT JOIN other_participants op ON op.conversation_id = c.id
  LEFT JOIN network_info ni ON ni.conversation_id = c.id
  LEFT JOIN match_info mi ON mi.conversation_id = c.id
  WHERE lm.message_id IS NOT NULL OR c.match_id IS NOT NULL
  ORDER BY
    COALESCE(pc.is_pinned, false) DESC,
    lm.message_at DESC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION get_player_conversations_optimized(uuid) TO authenticated;

-- =============================================================================
-- COMPLETION
-- =============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Chat schema improvements migration completed successfully';
END $$;
