-- Migration: Chat attachments
-- Adds support for sending images, videos, and documents inside a chat message.
-- - Allows attachment-only messages (content nullable)
-- - Creates message_attachment join table to the existing `file` table
-- - Adds RLS policies gated on conversation participation
-- - Enables realtime for the new table
-- - Extends conversation RPCs with last-message attachment kind/count so the
--   inbox can render "📷 Photo" style previews when content is empty.

-- =============================================================================
-- 1. Allow attachment-only messages
-- =============================================================================

ALTER TABLE public.message
  ALTER COLUMN content DROP NOT NULL;

-- The search-vector trigger already uses COALESCE(NEW.content, ''), so it
-- continues to work with NULL content.

-- =============================================================================
-- 2. message_attachment table
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.message_attachment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.message(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES public.file(id) ON DELETE RESTRICT,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, file_id)
);

CREATE INDEX IF NOT EXISTS idx_message_attachment_message
  ON public.message_attachment (message_id);

COMMENT ON TABLE public.message_attachment IS
  'Join table linking a message to one or more rows in the file table. Ordered via position.';

-- =============================================================================
-- 3. RLS
-- =============================================================================

ALTER TABLE public.message_attachment ENABLE ROW LEVEL SECURITY;

-- SELECT: any participant of the message's conversation can read its attachments.
DROP POLICY IF EXISTS "Participants can view message attachments" ON public.message_attachment;
CREATE POLICY "Participants can view message attachments"
  ON public.message_attachment FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.message m
      WHERE m.id = message_attachment.message_id
        AND m.conversation_id IN (SELECT get_user_conversation_ids(auth.uid()))
    )
  );

-- INSERT: caller must be the sender of the message AND the uploader of the file.
DROP POLICY IF EXISTS "Senders can attach own files" ON public.message_attachment;
CREATE POLICY "Senders can attach own files"
  ON public.message_attachment FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.message m
      WHERE m.id = message_attachment.message_id
        AND m.sender_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.file f
      WHERE f.id = message_attachment.file_id
        AND f.uploaded_by = auth.uid()
    )
  );

-- DELETE: senders can detach their own attachments. CASCADE on message handles
-- the bulk case (message hard-delete), but this lets a sender remove a single
-- attachment if we ever expose that UI.
DROP POLICY IF EXISTS "Senders can remove own attachments" ON public.message_attachment;
CREATE POLICY "Senders can remove own attachments"
  ON public.message_attachment FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.message m
      WHERE m.id = message_attachment.message_id
        AND m.sender_id = auth.uid()
    )
  );

-- =============================================================================
-- 4. Realtime publication
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'message_attachment'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.message_attachment';
  END IF;
END $$;

ALTER TABLE public.message_attachment REPLICA IDENTITY FULL;

-- =============================================================================
-- 5. Update get_player_conversations_optimized to surface attachment kind/count
-- =============================================================================

DROP FUNCTION IF EXISTS get_player_conversations_optimized(uuid, uuid);

CREATE OR REPLACE FUNCTION get_player_conversations_optimized(
  p_player_id uuid,
  p_sport_id uuid DEFAULT NULL
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
  last_message_attachment_kind text,
  last_message_attachment_count integer,
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

  last_message_attachments AS (
    SELECT
      lm.conversation_id,
      -- Pick the dominant kind for the preview icon. Prefer image > video > document.
      (
        SELECT f.file_type::text
        FROM message_attachment ma
        JOIN file f ON f.id = ma.file_id
        WHERE ma.message_id = lm.message_id
        ORDER BY CASE f.file_type::text
                   WHEN 'image' THEN 1
                   WHEN 'video' THEN 2
                   WHEN 'document' THEN 3
                   ELSE 4
                 END,
                 ma.position
        LIMIT 1
      ) AS kind,
      (
        SELECT COUNT(*)::int
        FROM message_attachment ma
        WHERE ma.message_id = lm.message_id
      ) AS count
    FROM last_messages lm
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
      n.cover_image_url,
      n.sport_id AS network_sport_id
    FROM network n
    JOIN network_type nt ON nt.id = n.network_type_id
    WHERE n.conversation_id IN (SELECT conversation_id FROM player_conversations)
  ),

  match_info AS (
    SELECT
      c.id AS conversation_id,
      m.format::text AS match_format,
      m.match_date,
      s.name::text AS sport_name,
      m.sport_id AS match_sport_id
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
    lma.kind AS last_message_attachment_kind,
    COALESCE(lma.count, 0) AS last_message_attachment_count,
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
  LEFT JOIN last_message_attachments lma ON lma.conversation_id = c.id
  LEFT JOIN participant_counts pcount ON pcount.conversation_id = c.id
  LEFT JOIN unread_counts uc ON uc.conversation_id = c.id
  LEFT JOIN other_participants op ON op.conversation_id = c.id
  LEFT JOIN network_info ni ON ni.conversation_id = c.id
  LEFT JOIN match_info mi ON mi.conversation_id = c.id
  WHERE (lm.message_id IS NOT NULL OR c.match_id IS NOT NULL)
    AND (
      p_sport_id IS NULL
      OR mi.match_sport_id = p_sport_id
      OR ni.network_sport_id = p_sport_id
      OR (mi.match_sport_id IS NULL AND ni.network_sport_id IS NULL)
    )
  ORDER BY
    COALESCE(pc.is_pinned, false) DESC,
    lm.message_at DESC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION get_player_conversations_optimized(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION get_player_conversations_optimized IS
  'Optimized conversation previews for a player. Surfaces last-message attachment kind and count for inbox previews when content is empty.';

-- =============================================================================
-- 6. Update get_player_conversations_filtered with the same fields
-- =============================================================================

DROP FUNCTION IF EXISTS get_player_conversations_filtered(uuid, text, text, int, int, uuid);

CREATE OR REPLACE FUNCTION get_player_conversations_filtered(
  p_player_id uuid,
  p_filter text DEFAULT 'all',
  p_search text DEFAULT '',
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0,
  p_sport_id uuid DEFAULT NULL
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
  last_message_attachment_kind text,
  last_message_attachment_count integer,
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

  last_message_attachments AS (
    SELECT
      lm.conversation_id,
      (
        SELECT f.file_type::text
        FROM message_attachment ma
        JOIN file f ON f.id = ma.file_id
        WHERE ma.message_id = lm.message_id
        ORDER BY CASE f.file_type::text
                   WHEN 'image' THEN 1
                   WHEN 'video' THEN 2
                   WHEN 'document' THEN 3
                   ELSE 4
                 END,
                 ma.position
        LIMIT 1
      ) AS kind,
      (
        SELECT COUNT(*)::int
        FROM message_attachment ma
        WHERE ma.message_id = lm.message_id
      ) AS count
    FROM last_messages lm
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
      n.cover_image_url,
      n.sport_id AS network_sport_id
    FROM network n
    JOIN network_type nt ON nt.id = n.network_type_id
    WHERE n.conversation_id IN (SELECT conversation_id FROM player_conversations)
  ),

  match_info AS (
    SELECT
      c.id AS conversation_id,
      m.format::text AS match_format,
      m.match_date,
      s.name::text AS sport_name,
      m.sport_id AS match_sport_id
    FROM conversation c
    JOIN match m ON m.id = c.match_id
    JOIN sport s ON s.id = m.sport_id
    WHERE c.match_id IS NOT NULL
      AND c.id IN (SELECT conversation_id FROM player_conversations)
  ),

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
      lma.kind AS last_message_attachment_kind,
      COALESCE(lma.count, 0) AS last_message_attachment_count,
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
      mi.sport_name AS match_sport_name,
      mi.match_sport_id,
      ni.network_sport_id
    FROM conversation c
    JOIN player_conversations pc ON pc.conversation_id = c.id
    LEFT JOIN last_messages lm ON lm.conversation_id = c.id
    LEFT JOIN last_message_attachments lma ON lma.conversation_id = c.id
    LEFT JOIN participant_counts pcount ON pcount.conversation_id = c.id
    LEFT JOIN unread_counts uc ON uc.conversation_id = c.id
    LEFT JOIN other_participants op ON op.conversation_id = c.id
    LEFT JOIN network_info ni ON ni.conversation_id = c.id
    LEFT JOIN match_info mi ON mi.conversation_id = c.id
    WHERE (lm.message_id IS NOT NULL OR c.match_id IS NOT NULL)
      AND COALESCE(pc.is_archived, false) = false
      AND (
        p_sport_id IS NULL
        OR mi.match_sport_id = p_sport_id
        OR ni.network_sport_id = p_sport_id
        OR (mi.match_sport_id IS NULL AND ni.network_sport_id IS NULL)
      )
  )

  SELECT
    fr.id,
    fr.conversation_type,
    fr.title,
    fr.picture_url,
    fr.match_id,
    fr.created_at,
    fr.updated_at,
    fr.last_message_id,
    fr.last_message_content,
    fr.last_message_at,
    fr.last_message_sender_id,
    fr.last_message_sender_first_name,
    fr.last_message_attachment_kind,
    fr.last_message_attachment_count,
    fr.is_pinned,
    fr.is_muted,
    fr.is_archived,
    fr.last_read_at,
    fr.participant_count,
    fr.unread_count,
    fr.other_participant_id,
    fr.other_participant_first_name,
    fr.other_participant_last_name,
    fr.other_participant_picture_url,
    fr.other_participant_last_seen_at,
    fr.network_id,
    fr.network_type,
    fr.network_cover_image_url,
    fr.match_format,
    fr.match_date,
    fr.match_sport_name
  FROM full_results fr
  WHERE
    CASE p_filter
      WHEN 'all' THEN true
      WHEN 'unread' THEN fr.unread_count > 0
      WHEN 'direct' THEN fr.conversation_type = 'direct'
                          AND fr.network_type IS NULL
                          AND fr.match_id IS NULL
      WHEN 'group_chat' THEN fr.network_type = 'friends'
      WHEN 'player_group' THEN fr.network_type = 'player_group'
      WHEN 'community' THEN fr.network_type = 'community'
      WHEN 'club' THEN fr.network_type = 'club'
      WHEN 'match' THEN fr.match_id IS NOT NULL
      ELSE true
    END
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

GRANT EXECUTE ON FUNCTION get_player_conversations_filtered(uuid, text, text, int, int, uuid) TO authenticated;

COMMENT ON FUNCTION get_player_conversations_filtered IS
  'Filtered + paginated conversation previews. Surfaces last-message attachment kind/count for inbox previews when content is empty.';

-- =============================================================================
-- COMPLETION
-- =============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Chat attachments migration completed successfully';
END $$;
