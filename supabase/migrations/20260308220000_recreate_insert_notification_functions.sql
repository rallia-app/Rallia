-- Recreate insert_notification and insert_notifications functions
-- They were dropped by 20260308193626 when the notification_type_enum was recreated,
-- but never recreated with the new enum type.

CREATE OR REPLACE FUNCTION insert_notification(
  p_user_id UUID,
  p_type notification_type_enum,
  p_target_id UUID DEFAULT NULL,
  p_title TEXT DEFAULT 'Notification',
  p_body TEXT DEFAULT NULL,
  p_payload JSONB DEFAULT '{}',
  p_priority notification_priority_enum DEFAULT 'normal',
  p_scheduled_at TIMESTAMPTZ DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_organization_id UUID DEFAULT NULL
)
RETURNS notification
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result notification;
BEGIN
  INSERT INTO notification (
    user_id, type, target_id, title, body, payload, priority, scheduled_at, expires_at, organization_id
  )
  VALUES (
    p_user_id, p_type, p_target_id, p_title, p_body, p_payload, p_priority, p_scheduled_at, p_expires_at, p_organization_id
  )
  RETURNING * INTO result;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION insert_notifications(
  p_notifications JSONB
)
RETURNS SETOF notification
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO notification (
    user_id, type, target_id, title, body, payload, priority, scheduled_at, expires_at, organization_id
  )
  SELECT
    (n->>'user_id')::UUID,
    (n->>'type')::notification_type_enum,
    (n->>'target_id')::UUID,
    COALESCE(n->>'title', 'Notification'),
    n->>'body',
    COALESCE((n->'payload')::JSONB, '{}'),
    COALESCE((n->>'priority')::notification_priority_enum, 'normal'),
    (n->>'scheduled_at')::TIMESTAMPTZ,
    (n->>'expires_at')::TIMESTAMPTZ,
    (n->>'organization_id')::UUID
  FROM jsonb_array_elements(p_notifications) AS n
  RETURNING *;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION insert_notification(UUID, notification_type_enum, UUID, TEXT, TEXT, JSONB, notification_priority_enum, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION insert_notifications(JSONB) TO authenticated;
