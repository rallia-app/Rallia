-- =============================================================================
-- Migration: Migrate existing 'group' conversations to exact types,
-- update trigger and RPC to use conversation_type directly for filtering.
-- =============================================================================

-- =============================================================================
-- 1. Migrate existing 'group' conversations to their correct type
-- =============================================================================

-- player_group conversations
UPDATE conversation c
SET conversation_type = 'player_group'
FROM network n
JOIN network_type nt ON nt.id = n.network_type_id
WHERE n.conversation_id = c.id
  AND nt.name = 'player_group'
  AND c.conversation_type = 'group';

-- community conversations
UPDATE conversation c
SET conversation_type = 'community'
FROM network n
JOIN network_type nt ON nt.id = n.network_type_id
WHERE n.conversation_id = c.id
  AND nt.name = 'community'
  AND c.conversation_type = 'group';

-- club conversations
UPDATE conversation c
SET conversation_type = 'club'
FROM network n
JOIN network_type nt ON nt.id = n.network_type_id
WHERE n.conversation_id = c.id
  AND nt.name = 'club'
  AND c.conversation_type = 'group';

-- Remaining 'group' conversations with no linked network → 'group_chat'
UPDATE conversation
SET conversation_type = 'group_chat'
WHERE conversation_type = 'group'
  AND id NOT IN (
    SELECT conversation_id FROM network WHERE conversation_id IS NOT NULL
  );

-- =============================================================================
-- 2. Update create_network_conversation() trigger to use exact types
-- =============================================================================

CREATE OR REPLACE FUNCTION create_network_conversation()
RETURNS TRIGGER AS $$
DECLARE
  new_conversation_id UUID;
  v_network_type_name TEXT;
  v_conv_type conversation_type;
BEGIN
  -- Look up the network type name
  SELECT name INTO v_network_type_name
  FROM public.network_type
  WHERE id = NEW.network_type_id;

  -- Only create conversations for types that need one
  IF v_network_type_name IN ('player_group', 'community', 'club', 'friends')
     AND NEW.conversation_id IS NULL THEN

    -- Map network type to conversation type
    IF v_network_type_name = 'friends' THEN
      v_conv_type := 'group_chat';
    ELSE
      v_conv_type := v_network_type_name::conversation_type;
    END IF;

    -- Create the conversation with the exact type
    INSERT INTO public.conversation (conversation_type, title, created_by)
    VALUES (v_conv_type, NEW.name, NEW.created_by)
    RETURNING id INTO new_conversation_id;

    -- Link the conversation to the network
    NEW.conversation_id := new_conversation_id;

    -- Add the creator as a participant
    INSERT INTO public.conversation_participant (conversation_id, player_id)
    VALUES (new_conversation_id, NEW.created_by);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 3. Update get_player_conversations_filtered RPC to use direct type checks
-- =============================================================================

DROP FUNCTION IF EXISTS get_player_conversations_filtered(uuid, text, text, int, int);

CREATE OR REPLACE FUNCTION get_player_conversations_filtered(
  p_player_id uuid,
  p_filter text DEFAULT 'all',
  p_search text DEFAULT '',
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0
)
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
  -- Get all conversations where player is a participant
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

  -- Get last message for each conversation
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

  -- Get participant counts
  participant_counts AS (
    SELECT
      cp.conversation_id,
      COUNT(*) AS participant_count
    FROM conversation_participant cp
    WHERE cp.conversation_id IN (SELECT conversation_id FROM player_conversations)
    GROUP BY cp.conversation_id
  ),

  -- Get unread counts
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

  -- Get other participant for direct conversations
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

  -- Get network info for group conversations (still needed for cover images)
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

  -- Get match info for match-linked conversations
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
  ),

  -- Assemble full results before filtering
  full_results AS (
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
    -- Must have messages OR be match-linked, and NOT archived
    WHERE (lm.message_id IS NOT NULL OR c.match_id IS NOT NULL)
      AND COALESCE(pc.is_archived, false) = false
  )

  SELECT fr.*
  FROM full_results fr
  WHERE
    -- Type filter: now uses conversation_type directly
    CASE p_filter
      WHEN 'all' THEN true
      WHEN 'unread' THEN fr.unread_count > 0
      WHEN 'direct' THEN fr.conversation_type = 'direct'
      WHEN 'group_chat' THEN fr.conversation_type = 'group_chat'
      WHEN 'player_group' THEN fr.conversation_type = 'player_group'
      WHEN 'community' THEN fr.conversation_type = 'community'
      WHEN 'club' THEN fr.conversation_type = 'club'
      WHEN 'match' THEN fr.conversation_type = 'match'
      ELSE true
    END
    -- Search filter
    AND (
      p_search = ''
      OR p_search IS NULL
      OR fr.title ILIKE '%' || p_search || '%'
      OR fr.other_participant_first_name ILIKE '%' || p_search || '%'
      OR fr.other_participant_last_name ILIKE '%' || p_search || '%'
      OR fr.match_sport_name ILIKE '%' || p_search || '%'
    )
  ORDER BY
    fr.is_pinned DESC,
    COALESCE(fr.last_message_at, fr.created_at) DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION get_player_conversations_filtered(uuid, text, text, int, int) TO authenticated;

COMMENT ON FUNCTION get_player_conversations_filtered IS
  'Filtered + paginated conversation previews for the chat inbox. Filters directly on conversation_type (direct/group_chat/player_group/community/club/match). Supports search and offset-based pagination. Excludes archived conversations.';

-- =============================================================================
-- 4. Fix get_message_volume to count all group-like types
-- =============================================================================

CREATE OR REPLACE FUNCTION get_message_volume(
  p_start_date date,
  p_end_date date
) RETURNS TABLE (
  date date,
  direct_messages bigint,
  group_messages bigint,
  match_messages bigint,
  total_messages bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    msg.created_at::date AS date,
    COUNT(*) FILTER (WHERE c.conversation_type = 'direct')::bigint AS direct_messages,
    COUNT(*) FILTER (WHERE c.conversation_type IN ('group', 'group_chat', 'player_group', 'community', 'club'))::bigint AS group_messages,
    COUNT(*) FILTER (WHERE c.conversation_type = 'match')::bigint AS match_messages,
    COUNT(*)::bigint AS total_messages
  FROM message msg
  JOIN conversation c ON c.id = msg.conversation_id
  WHERE msg.created_at::date BETWEEN p_start_date AND p_end_date
    AND msg.deleted_at IS NULL
  GROUP BY msg.created_at::date
  ORDER BY msg.created_at::date;
END;
$$;

GRANT EXECUTE ON FUNCTION get_message_volume(date, date) TO authenticated;

-- =============================================================================
-- COMPLETION
-- =============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Conversation type data migration completed successfully';
END $$;
