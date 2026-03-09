-- Migration: Fix type mismatches in get_player_conversations_optimized
-- Cast varchar columns to text to match function return type

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
  -- Last message info
  last_message_id uuid,
  last_message_content text,
  last_message_at timestamptz,
  last_message_sender_id uuid,
  last_message_sender_first_name text,
  -- Participation info
  is_pinned boolean,
  is_muted boolean,
  is_archived boolean,
  last_read_at timestamptz,
  -- Counts
  participant_count bigint,
  unread_count bigint,
  -- Other participant (for direct chats)
  other_participant_id uuid,
  other_participant_first_name text,
  other_participant_last_name text,
  other_participant_picture_url text,
  other_participant_last_seen_at timestamptz,
  -- Network info (for groups)
  network_id uuid,
  network_type text,
  network_cover_image_url text,
  -- Match info
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
  
  -- Get last message for each conversation using DISTINCT ON
  last_messages AS (
    SELECT DISTINCT ON (m.conversation_id)
      m.conversation_id,
      m.id AS message_id,
      m.content,
      m.created_at AS message_at,
      m.sender_id,
      p.first_name::text AS sender_first_name
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
  
  -- Get unread counts (messages after last_read_at, not sent by current player)
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
      pr.first_name::text AS first_name,
      pr.last_name::text AS last_name,
      pr.profile_picture_url::text AS profile_picture_url,
      pl.last_seen_at
    FROM conversation c
    JOIN conversation_participant cp ON cp.conversation_id = c.id
    JOIN player pl ON pl.id = cp.player_id
    JOIN profile pr ON pr.id = pl.id
    WHERE c.conversation_type = 'direct'
      AND c.id IN (SELECT conversation_id FROM player_conversations)
      AND cp.player_id != p_player_id
  ),
  
  -- Get network info for group conversations
  network_info AS (
    SELECT 
      n.conversation_id,
      n.id AS network_id,
      nt.name::text AS network_type,
      n.cover_image_url::text AS cover_image_url
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
  )
  
  SELECT 
    c.id,
    c.conversation_type::text,
    c.title::text,
    c.picture_url::text,
    c.match_id,
    c.created_at,
    c.updated_at,
    -- Last message
    lm.message_id AS last_message_id,
    lm.content::text AS last_message_content,
    lm.message_at AS last_message_at,
    lm.sender_id AS last_message_sender_id,
    lm.sender_first_name AS last_message_sender_first_name,
    -- Participation
    COALESCE(pc.is_pinned, false) AS is_pinned,
    COALESCE(pc.is_muted, false) AS is_muted,
    COALESCE(pc.is_archived, false) AS is_archived,
    pc.last_read_at,
    -- Counts
    COALESCE(pcount.participant_count, 0) AS participant_count,
    COALESCE(uc.unread_count, 0) AS unread_count,
    -- Other participant
    op.other_player_id AS other_participant_id,
    op.first_name AS other_participant_first_name,
    op.last_name AS other_participant_last_name,
    op.profile_picture_url AS other_participant_picture_url,
    op.last_seen_at AS other_participant_last_seen_at,
    -- Network
    ni.network_id,
    ni.network_type,
    COALESCE(ni.cover_image_url, c.picture_url::text) AS network_cover_image_url,
    -- Match
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
  -- Filter: only show conversations with messages OR match-linked chats
  WHERE lm.message_id IS NOT NULL OR c.match_id IS NOT NULL
  ORDER BY 
    COALESCE(pc.is_pinned, false) DESC,
    lm.message_at DESC NULLS LAST;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_player_conversations_optimized(uuid) TO authenticated;
