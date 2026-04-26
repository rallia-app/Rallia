-- Migration: match chat lifecycle is fully derived from match state
--
-- Before: match conversations were created/maintained by client-side TS code
-- (createMatchChat, ensureMatchChat, removePlayerFromMatchChat). Two issues
-- compounded into a real bug:
--   1. The client INSERTed conversation + participants in two non-atomic
--      round-trips. If the participant insert failed RLS, the cleanup DELETE
--      could itself silently no-op (DELETE policy required created_by =
--      auth.uid(), but the orphaned row was stamped as the joiner — so a host
--      accepting a join request couldn't delete the orphan they just made).
--   2. acceptJoinRequest runs in the host's auth context but stamped
--      conversation.created_by = newPlayerId. The bulk participant insert
--      then failed the RLS WITH CHECK on the joiner row. Result: orphan
--      conversations with zero participants. The user's later message INSERT
--      was silently rejected by message_insert_policy, manifesting as
--      "messages don't appear" in singles match chats.
--
-- After: match conversations are a projection of match state, enforced by
-- triggers. Match created → conversation created + host added. Player
-- transitions to/from 'joined' status → conversation_participant follows.
-- The TS layer no longer touches match chat membership.
--
-- This migration also retypes match conversations to conversation_type='match'
-- (the enum value already existed, was unused). This removes the overload
-- where singles match chats looked like 1:1 'direct' chats and doubles match
-- chats looked like 'group' chats — a permanent foot-gun in inbox filters
-- and UI branches.

BEGIN;

-- =============================================================================
-- 1. Retype existing match conversations to 'match'
-- =============================================================================

UPDATE public.conversation
SET conversation_type = 'match'::public.conversation_type
WHERE match_id IS NOT NULL
  AND conversation_type IN ('direct'::public.conversation_type, 'group'::public.conversation_type);

-- =============================================================================
-- 2. Backfill conversation_participant for any orphan match conversations
--    (idempotent — covers staging/local where prod backfill didn't run)
-- =============================================================================

-- Hosts (match.created_by) — always a participant of their match chat
INSERT INTO public.conversation_participant (conversation_id, player_id)
SELECT c.id, m.created_by
FROM public.conversation c
JOIN public.match m ON m.id = c.match_id
WHERE c.match_id IS NOT NULL
  AND m.created_by IS NOT NULL
ON CONFLICT DO NOTHING;

-- Currently-joined participants
INSERT INTO public.conversation_participant (conversation_id, player_id)
SELECT c.id, mp.player_id
FROM public.conversation c
JOIN public.match_participant mp ON mp.match_id = c.match_id
WHERE c.match_id IS NOT NULL
  AND mp.status = 'joined'
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 3. Trigger: create the match chat when a match is inserted
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_match_chat_for_new_match()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id uuid;
BEGIN
  -- Idempotent on conversation.match_id (partial UNIQUE index)
  INSERT INTO public.conversation (conversation_type, match_id, created_by)
  VALUES ('match'::public.conversation_type, NEW.id, NEW.created_by)
  ON CONFLICT (match_id) WHERE match_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_conversation_id;

  IF v_conversation_id IS NULL THEN
    SELECT id INTO v_conversation_id
    FROM public.conversation
    WHERE match_id = NEW.id;
  END IF;

  -- Seed host as participant
  IF NEW.created_by IS NOT NULL AND v_conversation_id IS NOT NULL THEN
    INSERT INTO public.conversation_participant (conversation_id, player_id)
    VALUES (v_conversation_id, NEW.created_by)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS match_chat_create ON public.match;
CREATE TRIGGER match_chat_create
  AFTER INSERT ON public.match
  FOR EACH ROW
  EXECUTE FUNCTION public.create_match_chat_for_new_match();

-- =============================================================================
-- 4. Trigger: keep conversation_participant in sync with match_participant
--    state. Host (match.created_by) is never auto-removed — they own the
--    match chat regardless of any match_participant row state.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_match_chat_participant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id uuid;
  v_match_host uuid;
  v_should_add boolean := false;
  v_should_remove boolean := false;
  v_match_id uuid;
  v_player_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_match_id := OLD.match_id;
    v_player_id := OLD.player_id;
    v_should_remove := (OLD.status = 'joined');
  ELSIF TG_OP = 'INSERT' THEN
    v_match_id := NEW.match_id;
    v_player_id := NEW.player_id;
    v_should_add := (NEW.status = 'joined');
  ELSE  -- UPDATE
    v_match_id := NEW.match_id;
    v_player_id := NEW.player_id;
    v_should_add := (NEW.status = 'joined' AND OLD.status IS DISTINCT FROM 'joined');
    v_should_remove := (OLD.status = 'joined' AND NEW.status IS DISTINCT FROM 'joined');
  END IF;

  IF NOT v_should_add AND NOT v_should_remove THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT id INTO v_conversation_id
  FROM public.conversation
  WHERE match_id = v_match_id;

  -- Lazy-create only on add path. On remove (incl. cascade from match DELETE),
  -- a missing conversation just means there's nothing to do.
  IF v_conversation_id IS NULL AND v_should_add THEN
    SELECT created_by INTO v_match_host FROM public.match WHERE id = v_match_id;
    IF v_match_host IS NULL THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
    INSERT INTO public.conversation (conversation_type, match_id, created_by)
    VALUES ('match'::public.conversation_type, v_match_id, v_match_host)
    ON CONFLICT (match_id) WHERE match_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_conversation_id;
    IF v_conversation_id IS NULL THEN
      SELECT id INTO v_conversation_id FROM public.conversation WHERE match_id = v_match_id;
    END IF;
    IF v_match_host IS NOT NULL AND v_conversation_id IS NOT NULL THEN
      INSERT INTO public.conversation_participant (conversation_id, player_id)
      VALUES (v_conversation_id, v_match_host)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  IF v_conversation_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_should_add THEN
    INSERT INTO public.conversation_participant (conversation_id, player_id)
    VALUES (v_conversation_id, v_player_id)
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_should_remove THEN
    -- Don't remove the host even if their match_participant row went away.
    SELECT created_by INTO v_match_host FROM public.match WHERE id = v_match_id;
    IF v_match_host IS DISTINCT FROM v_player_id THEN
      DELETE FROM public.conversation_participant
      WHERE conversation_id = v_conversation_id
        AND player_id = v_player_id;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS match_chat_sync_participant_iud ON public.match_participant;
CREATE TRIGGER match_chat_sync_participant_iud
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.match_participant
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_match_chat_participant();

-- =============================================================================
-- 5. Tighten conversation SELECT policy
--    The 20260424010000 migration added a match_participant fallback so users
--    could see orphan match conversations. With the trigger guarantee, every
--    legitimate viewer is in conversation_participant, so the fallback is no
--    longer needed (and it papers over the very class of bug we just fixed).
-- =============================================================================

DROP POLICY IF EXISTS "Participants can view conversations" ON public.conversation;

CREATE POLICY "Participants can view conversations"
  ON public.conversation FOR SELECT
  TO authenticated
  USING (
    created_by = auth.uid()
    OR public.is_conversation_participant(id, auth.uid())
  );

-- =============================================================================
-- 6. find_direct_conversation: drop the now-redundant match_id IS NULL filter.
--    Match chats are conversation_type='match', so they no longer collide with
--    direct chats by type alone.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.find_direct_conversation(p_player1 uuid, p_player2 uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
  FROM public.conversation c
  JOIN public.conversation_participant cp1 ON cp1.conversation_id = c.id AND cp1.player_id = p_player1
  JOIN public.conversation_participant cp2 ON cp2.conversation_id = c.id AND cp2.player_id = p_player2
  WHERE c.conversation_type = 'direct'::public.conversation_type
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.find_direct_conversation(uuid, uuid) TO authenticated;

-- =============================================================================
-- 7. get_player_conversations_filtered: 'direct' filter is now just by type;
--    'match' filter is by conversation_type = 'match' (was: match_id IS NOT NULL).
--    Behavior is unchanged in practice because every match-linked row is now
--    typed 'match' and no other rows are.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_player_conversations_filtered(
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
    SELECT cp.conversation_id, cp.is_pinned, cp.is_muted, cp.is_archived, cp.last_read_at
    FROM public.conversation_participant cp
    WHERE cp.player_id = p_player_id
  ),
  last_messages AS (
    SELECT DISTINCT ON (m.conversation_id)
      m.conversation_id, m.id AS message_id, m.content,
      m.created_at AS message_at, m.sender_id, p.first_name AS sender_first_name
    FROM public.message m
    JOIN public.player pl ON pl.id = m.sender_id
    JOIN public.profile p ON p.id = pl.id
    WHERE m.conversation_id IN (SELECT conversation_id FROM player_conversations)
      AND m.deleted_at IS NULL
    ORDER BY m.conversation_id, m.created_at DESC
  ),
  participant_counts AS (
    SELECT cp.conversation_id, COUNT(*) AS participant_count
    FROM public.conversation_participant cp
    WHERE cp.conversation_id IN (SELECT conversation_id FROM player_conversations)
    GROUP BY cp.conversation_id
  ),
  unread_counts AS (
    SELECT pc.conversation_id, COUNT(m.id) AS unread_count
    FROM player_conversations pc
    LEFT JOIN public.message m ON m.conversation_id = pc.conversation_id
      AND m.sender_id != p_player_id
      AND m.deleted_at IS NULL
      AND (pc.last_read_at IS NULL OR m.created_at > pc.last_read_at)
    GROUP BY pc.conversation_id
  ),
  other_participants AS (
    SELECT
      c.id AS conversation_id, pl.id AS other_player_id,
      pr.first_name, pr.last_name, pr.profile_picture_url, pl.last_seen_at
    FROM public.conversation c
    JOIN public.conversation_participant cp ON cp.conversation_id = c.id
    JOIN public.player pl ON pl.id = cp.player_id
    JOIN public.profile pr ON pr.id = pl.id
    WHERE c.conversation_type = 'direct'::public.conversation_type
      AND c.id IN (SELECT conversation_id FROM player_conversations)
      AND cp.player_id != p_player_id
  ),
  network_info AS (
    SELECT
      n.conversation_id, n.id AS network_id, nt.name AS network_type,
      n.cover_image_url, n.sport_id AS network_sport_id
    FROM public.network n
    JOIN public.network_type nt ON nt.id = n.network_type_id
    WHERE n.conversation_id IN (SELECT conversation_id FROM player_conversations)
  ),
  match_info AS (
    SELECT
      c.id AS conversation_id, m.format::text AS match_format,
      m.match_date, s.name::text AS sport_name, m.sport_id AS match_sport_id
    FROM public.conversation c
    JOIN public.match m ON m.id = c.match_id
    JOIN public.sport s ON s.id = m.sport_id
    WHERE c.match_id IS NOT NULL
      AND c.id IN (SELECT conversation_id FROM player_conversations)
  ),
  full_results AS (
    SELECT
      c.id, c.conversation_type::text AS conversation_type, c.title, c.picture_url,
      c.match_id, c.created_at, c.updated_at,
      lm.message_id AS last_message_id, lm.content AS last_message_content,
      lm.message_at AS last_message_at, lm.sender_id AS last_message_sender_id,
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
      ni.network_id, ni.network_type,
      COALESCE(ni.cover_image_url, c.picture_url) AS network_cover_image_url,
      mi.match_format, mi.match_date, mi.sport_name AS match_sport_name,
      mi.match_sport_id, ni.network_sport_id
    FROM public.conversation c
    JOIN player_conversations pc ON pc.conversation_id = c.id
    LEFT JOIN last_messages lm ON lm.conversation_id = c.id
    LEFT JOIN participant_counts pcount ON pcount.conversation_id = c.id
    LEFT JOIN unread_counts uc ON uc.conversation_id = c.id
    LEFT JOIN other_participants op ON op.conversation_id = c.id
    LEFT JOIN network_info ni ON ni.conversation_id = c.id
    LEFT JOIN match_info mi ON mi.conversation_id = c.id
    WHERE NOT COALESCE(pc.is_archived, false)
      AND (lm.message_id IS NOT NULL OR c.match_id IS NOT NULL)
  )
  SELECT
    fr.id, fr.conversation_type, fr.title, fr.picture_url, fr.match_id,
    fr.created_at, fr.updated_at,
    fr.last_message_id, fr.last_message_content, fr.last_message_at,
    fr.last_message_sender_id, fr.last_message_sender_first_name,
    fr.is_pinned, fr.is_muted, fr.is_archived, fr.last_read_at,
    fr.participant_count, fr.unread_count,
    fr.other_participant_id, fr.other_participant_first_name,
    fr.other_participant_last_name, fr.other_participant_picture_url,
    fr.other_participant_last_seen_at,
    fr.network_id, fr.network_type, fr.network_cover_image_url,
    fr.match_format, fr.match_date, fr.match_sport_name
  FROM full_results fr
  WHERE
    CASE p_filter
      WHEN 'all' THEN true
      WHEN 'unread' THEN fr.unread_count > 0
      WHEN 'direct' THEN fr.conversation_type = 'direct'
      WHEN 'group_chat' THEN fr.network_type = 'friends'
      WHEN 'player_group' THEN fr.network_type = 'player_group'
      WHEN 'community' THEN fr.network_type = 'community'
      WHEN 'club' THEN fr.network_type = 'club'
      WHEN 'match' THEN fr.conversation_type = 'match'
      ELSE true
    END
    AND (
      p_search = '' OR p_search IS NULL
      OR fr.title ILIKE '%' || p_search || '%'
      OR fr.other_participant_first_name ILIKE '%' || p_search || '%'
      OR fr.other_participant_last_name ILIKE '%' || p_search || '%'
      OR fr.match_sport_name ILIKE '%' || p_search || '%'
    )
    AND (
      p_sport_id IS NULL
      OR fr.match_sport_id = p_sport_id
      OR fr.network_sport_id = p_sport_id
      OR (fr.match_sport_id IS NULL AND fr.network_sport_id IS NULL)
    )
  ORDER BY
    fr.is_pinned DESC,
    COALESCE(fr.last_message_at, fr.created_at) DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_player_conversations_filtered(uuid, text, text, int, int, uuid) TO authenticated;

COMMIT;
