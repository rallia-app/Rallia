-- ============================================================================
-- Migration: Fix admin delete network function v3
-- Description: Fix table name - admin_audit_log not admin_activity_log
-- ============================================================================

-- Drop the existing function
DROP FUNCTION IF EXISTS admin_delete_network(UUID, TEXT);

-- Recreate with correct table reference
CREATE OR REPLACE FUNCTION admin_delete_network(
  p_network_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_network_name TEXT;
  v_network_type TEXT;
  v_member_ids UUID[];
  v_member_id UUID;
  v_notification_title TEXT;
  v_notification_body TEXT;
  v_members_count INTEGER;
BEGIN
  -- Get calling user's admin ID
  SELECT a.id INTO v_admin_id
  FROM admin a
  WHERE a.id = auth.uid();
  
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Unauthorized: Admin access required'
    );
  END IF;

  -- Get network info via JOIN
  SELECT n.name, nt.name
  INTO v_network_name, v_network_type
  FROM network n
  JOIN network_type nt ON nt.id = n.network_type_id
  WHERE n.id = p_network_id;

  IF v_network_name IS NULL THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Network not found'
    );
  END IF;

  -- Get all member user IDs (player.id references profile.id which is the user ID)
  SELECT ARRAY_AGG(DISTINCT p.id)
  INTO v_member_ids
  FROM network_member nm
  JOIN player p ON nm.player_id = p.id
  WHERE nm.network_id = p_network_id
  AND nm.status = 'active';

  v_members_count := COALESCE(array_length(v_member_ids, 1), 0);

  -- Prepare notification content based on network type
  IF v_network_type = 'player_group' THEN
    v_notification_title := 'Group Deleted';
    v_notification_body := format('The group "%s" has been deleted by an administrator.', v_network_name);
    IF p_reason IS NOT NULL AND p_reason != '' THEN
      v_notification_body := v_notification_body || format(' Reason: %s', p_reason);
    END IF;
  ELSE
    v_notification_title := 'Community Deleted';
    v_notification_body := format('The community "%s" has been deleted by an administrator.', v_network_name);
    IF p_reason IS NOT NULL AND p_reason != '' THEN
      v_notification_body := v_notification_body || format(' Reason: %s', p_reason);
    END IF;
  END IF;

  -- Send notifications to all members
  IF v_member_ids IS NOT NULL AND v_members_count > 0 THEN
    FOREACH v_member_id IN ARRAY v_member_ids
    LOOP
      BEGIN
        PERFORM insert_notification(
          p_user_id := v_member_id,
          p_type := 'network_deleted'::notification_type_enum,
          p_target_id := p_network_id,
          p_title := v_notification_title,
          p_body := v_notification_body,
          p_data := jsonb_build_object(
            'network_name', v_network_name,
            'network_type', v_network_type,
            'reason', COALESCE(p_reason, ''),
            'deleted_by', v_admin_id
          )
        );
      EXCEPTION WHEN OTHERS THEN
        -- Continue even if notification fails
        NULL;
      END;
    END LOOP;
  END IF;

  -- Log the deletion in admin_audit_log (correct table name)
  INSERT INTO admin_audit_log (
    admin_id,
    action_type,
    entity_type,
    entity_id,
    old_data,
    metadata
  ) VALUES (
    v_admin_id,
    'delete'::admin_action_type_enum,
    'network'::admin_entity_type_enum,
    p_network_id,
    jsonb_build_object(
      'network_name', v_network_name,
      'network_type', v_network_type
    ),
    jsonb_build_object(
      'reason', COALESCE(p_reason, ''),
      'members_notified', v_members_count
    )
  );

  -- Delete the network (cascades to members, matches, etc.)
  DELETE FROM network WHERE id = p_network_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'network_name', v_network_name,
    'members_notified', v_members_count
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', FALSE,
    'error', SQLERRM
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION admin_delete_network(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION admin_delete_network(UUID, TEXT) IS 
  'Admin function to delete a network with member notifications - FIXED: uses admin_audit_log';
