-- =============================================================================
-- Caller guards, sweep 2: chat + admin RPCs.
--
-- All of these are SECURITY DEFINER and took a player / admin id without
-- checking the caller (see 20260821180000 for the conversation-list RPCs).
-- Bodies are copied verbatim from each function's latest definition and
-- cross-checked against the live catalog; each gets SET search_path = public
-- and a guard that raises 42501:
--   mark_messages_as_read / mark_messages_as_delivered  p_reader_id / p_recipient_id must be auth.uid()
--   find_direct_conversation                            auth.uid() must be one of the two players
--   get_conversation_health / get_match_chat_adoption / get_message_volume   admin only
--   get_admin_alerts / get_alert_counts / mark_alert_read / mark_all_alerts_read / dismiss_alert
--                                                       p_admin_id must be the calling admin
--   get_admin_audit_log                                 admin only (p_admin_id is a filter)
-- debug_check_conversation_participant is dropped (no callers, no policies).
-- lt_notify_tournament_match_ready and lt_get_or_create_tournament_chat are
-- only called from SECURITY DEFINER functions/triggers, so direct execution is
-- revoked like their _unchecked siblings.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mark_messages_as_read(
  p_conversation_id uuid,
  p_reader_id uuid
)
RETURNS void AS $$
DECLARE
  v_last_read_at timestamptz;
BEGIN
  IF p_reader_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'p_reader_id must be the calling user' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_participant
    WHERE conversation_id = p_conversation_id
      AND player_id = p_reader_id
  ) THEN
    RAISE EXCEPTION 'User is not a participant in this conversation';
  END IF;

  SELECT last_read_at INTO v_last_read_at
  FROM public.conversation_participant
  WHERE conversation_id = p_conversation_id
    AND player_id = p_reader_id;

  UPDATE public.message
  SET status = 'read'
  WHERE conversation_id = p_conversation_id
    AND sender_id != p_reader_id
    AND status IN ('sent', 'delivered')
    AND (v_last_read_at IS NULL OR created_at > v_last_read_at);

  UPDATE public.conversation_participant
  SET last_read_at = NOW()
  WHERE conversation_id = p_conversation_id
    AND player_id = p_reader_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.mark_messages_as_read(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_messages_as_read(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_messages_as_delivered(
  p_conversation_id uuid,
  p_recipient_id uuid
)
RETURNS void AS $$
BEGIN
  IF p_recipient_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'p_recipient_id must be the calling user' USING ERRCODE = '42501';
  END IF;
  -- Verify the recipient is a participant in this conversation
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_participant
    WHERE conversation_id = p_conversation_id
    AND player_id = p_recipient_id
  ) THEN
    RAISE EXCEPTION 'User is not a participant in this conversation';
  END IF;

  -- Update messages to 'delivered' where:
  -- 1. Message is in the specified conversation
  -- 2. Message was sent by someone other than the recipient
  -- 3. Message is still 'sent' (not yet delivered or read)
  UPDATE public.message
  SET status = 'delivered'
  WHERE conversation_id = p_conversation_id
    AND sender_id != p_recipient_id
    AND status = 'sent';
    
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.mark_messages_as_delivered(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_messages_as_delivered(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION get_conversation_health()
RETURNS TABLE (
  active_conversations bigint,
  total_conversations bigint,
  avg_response_time_minutes numeric,
  avg_messages_per_conversation numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH conversation_stats AS (
    SELECT 
      c.id,
      c.updated_at,
      COUNT(msg.id) AS message_count,
      (c.updated_at > NOW() - INTERVAL '7 days') AS is_active
    FROM conversation c
    LEFT JOIN message msg ON msg.conversation_id = c.id AND msg.deleted_at IS NULL
    GROUP BY c.id, c.updated_at
  )
  SELECT 
    COUNT(*) FILTER (WHERE is_active)::bigint AS active_conversations,
    COUNT(*)::bigint AS total_conversations,
    0::numeric AS avg_response_time_minutes, -- Placeholder - would need message pairs to calculate
    ROUND(AVG(message_count), 1) AS avg_messages_per_conversation
  FROM conversation_stats;
END;
$$;

REVOKE ALL ON FUNCTION public.get_conversation_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conversation_health() TO authenticated;

CREATE OR REPLACE FUNCTION get_match_chat_adoption(
  p_start_date date,
  p_end_date date
) RETURNS TABLE (
  total_matches bigint,
  matches_with_chat bigint,
  chat_adoption_rate numeric,
  avg_messages_per_match numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH match_chats AS (
    SELECT 
      m.id AS match_id,
      c.id AS conversation_id,
      COUNT(msg.id) AS message_count
    FROM match m
    LEFT JOIN conversation c ON c.match_id = m.id
    LEFT JOIN message msg ON msg.conversation_id = c.id AND msg.deleted_at IS NULL
    WHERE m.created_at::date BETWEEN p_start_date AND p_end_date
    GROUP BY m.id, c.id
  )
  SELECT 
    COUNT(DISTINCT match_id)::bigint AS total_matches,
    COUNT(DISTINCT match_id) FILTER (WHERE conversation_id IS NOT NULL)::bigint AS matches_with_chat,
    CASE WHEN COUNT(DISTINCT match_id) > 0 
      THEN ROUND((COUNT(DISTINCT match_id) FILTER (WHERE conversation_id IS NOT NULL)::numeric / 
                  COUNT(DISTINCT match_id)::numeric) * 100, 2)
      ELSE 0 
    END AS chat_adoption_rate,
    ROUND(AVG(message_count) FILTER (WHERE conversation_id IS NOT NULL), 1) AS avg_messages_per_match
  FROM match_chats;
END;
$$;

REVOKE ALL ON FUNCTION public.get_match_chat_adoption(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_match_chat_adoption(date, date) TO authenticated;

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
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
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

REVOKE ALL ON FUNCTION public.get_message_volume(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_message_volume(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_alerts(
  p_admin_id uuid,
  p_limit int DEFAULT 20,
  p_include_read boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  alert_type text,
  title text,
  message text,
  severity text,
  source_type text,
  source_id uuid,
  action_url text,
  metadata jsonb,
  is_read boolean,
  read_at timestamp with time zone,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_role text;
BEGIN
  IF p_admin_id IS DISTINCT FROM auth.uid() OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'p_admin_id must be the calling admin' USING ERRCODE = '42501';
  END IF;
  SELECT adm.role INTO v_admin_role FROM public.admin adm WHERE adm.id = p_admin_id;

  RETURN QUERY
  SELECT
    a.id,
    a.alert_type,
    a.title,
    a.message,
    a.severity,
    a.source_type,
    a.source_id,
    a.action_url,
    a.metadata,
    a.is_read,
    a.read_at,
    a.created_at
  FROM public.admin_alert a
  WHERE
    v_admin_role = ANY(a.target_roles)
    AND a.is_dismissed = false
    AND (a.expires_at IS NULL OR a.expires_at > now())
    AND (p_include_read = true OR a.is_read = false)
  ORDER BY
    CASE a.severity
      WHEN 'critical' THEN 1
      WHEN 'warning' THEN 2
      ELSE 3
    END,
    a.created_at DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_alerts(uuid, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_alerts(uuid, integer, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_alert_counts(
  p_admin_id uuid
)
RETURNS TABLE (
  total bigint,
  critical bigint,
  warning bigint,
  info bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_role text;
BEGIN
  IF p_admin_id IS DISTINCT FROM auth.uid() OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'p_admin_id must be the calling admin' USING ERRCODE = '42501';
  END IF;
  SELECT adm.role INTO v_admin_role FROM public.admin adm WHERE adm.id = p_admin_id;

  RETURN QUERY
  SELECT
    count(*) as total,
    count(*) FILTER (WHERE a.severity = 'critical') as critical,
    count(*) FILTER (WHERE a.severity = 'warning') as warning,
    count(*) FILTER (WHERE a.severity = 'info') as info
  FROM public.admin_alert a
  WHERE
    v_admin_role = ANY(a.target_roles)
    AND a.is_dismissed = false
    AND a.is_read = false
    AND (a.expires_at IS NULL OR a.expires_at > now());
END;
$$;

REVOKE ALL ON FUNCTION public.get_alert_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_alert_counts(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_alert_read(
  p_alert_id uuid,
  p_admin_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_admin_id IS DISTINCT FROM auth.uid() OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'p_admin_id must be the calling admin' USING ERRCODE = '42501';
  END IF;
  UPDATE public.admin_alert a
  SET
    is_read = true,
    read_by = p_admin_id,
    read_at = now()
  WHERE a.id = p_alert_id
    AND a.is_read = false;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_alert_read(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_alert_read(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_all_alerts_read(
  p_admin_id uuid
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_role text;
  v_count int;
BEGIN
  IF p_admin_id IS DISTINCT FROM auth.uid() OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'p_admin_id must be the calling admin' USING ERRCODE = '42501';
  END IF;
  SELECT adm.role INTO v_admin_role FROM public.admin adm WHERE adm.id = p_admin_id;

  UPDATE public.admin_alert a
  SET
    is_read = true,
    read_by = p_admin_id,
    read_at = now()
  WHERE
    v_admin_role = ANY(a.target_roles)
    AND a.is_read = false
    AND a.is_dismissed = false;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_all_alerts_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_all_alerts_read(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.dismiss_alert(
  p_alert_id uuid,
  p_admin_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_admin_id IS DISTINCT FROM auth.uid() OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'p_admin_id must be the calling admin' USING ERRCODE = '42501';
  END IF;
  UPDATE public.admin_alert a
  SET
    is_dismissed = true,
    dismissed_by = p_admin_id,
    dismissed_at = now()
  WHERE a.id = p_alert_id
    AND a.is_dismissed = false;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.dismiss_alert(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_alert(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_audit_log(
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0,
  p_admin_id uuid DEFAULT NULL,
  p_action_type text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_severity text DEFAULT NULL,
  p_start_date timestamp with time zone DEFAULT NULL,
  p_end_date timestamp with time zone DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  admin_id uuid,
  admin_name text,
  admin_email text,
  admin_role text,
  action_type text,
  entity_type text,
  entity_id uuid,
  entity_name text,
  old_data jsonb,
  new_data jsonb,
  metadata jsonb,
  severity text,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    l.id,
    l.admin_id,
    COALESCE(p.first_name || ' ' || p.last_name, p.display_name, 'Unknown Admin') as admin_name,
    p.email as admin_email,
    adm.role::text as admin_role,
    l.action_type::text,
    l.entity_type::text,
    l.entity_id,
    l.entity_name,
    l.old_data,
    l.new_data,
    l.metadata,
    l.severity,
    l.created_at
  FROM public.admin_audit_log l
  LEFT JOIN public.admin adm ON adm.id = l.admin_id
  LEFT JOIN public.profile p ON p.id = l.admin_id
  WHERE
    (p_admin_id IS NULL OR l.admin_id = p_admin_id)
    AND (p_action_type IS NULL OR l.action_type = p_action_type::admin_action_type_enum)
    AND (p_entity_type IS NULL OR l.entity_type = p_entity_type::admin_entity_type_enum)
    AND (p_severity IS NULL OR l.severity = p_severity)
    AND (p_start_date IS NULL OR l.created_at >= p_start_date)
    AND (p_end_date IS NULL OR l.created_at <= p_end_date)
  ORDER BY l.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_audit_log(integer, integer, uuid, text, text, text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_audit_log(integer, integer, uuid, text, text, text, timestamptz, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.find_direct_conversation(p_player1 uuid, p_player2 uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_player1 AND auth.uid() IS DISTINCT FROM p_player2 THEN
    RAISE EXCEPTION 'the calling user must be one of the two players' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT c.id
    FROM public.conversation c
    JOIN public.conversation_participant cp1 ON cp1.conversation_id = c.id AND cp1.player_id = p_player1
    JOIN public.conversation_participant cp2 ON cp2.conversation_id = c.id AND cp2.player_id = p_player2
    WHERE c.conversation_type = 'direct'::public.conversation_type
    LIMIT 1
  );
END;
$$;
REVOKE ALL ON FUNCTION public.find_direct_conversation(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_direct_conversation(uuid, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.debug_check_conversation_participant(uuid, uuid);

REVOKE ALL ON FUNCTION public.lt_notify_tournament_match_ready(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lt_get_or_create_tournament_chat(uuid) FROM PUBLIC, anon, authenticated;
