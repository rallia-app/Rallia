-- ============================================================================
-- Migration: Add admin delete network functionality
-- Description: Adds notification type and RPC for admin to delete networks
--              with notifications to all members
-- ============================================================================

-- Add network_deleted notification type
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'network_deleted';

-- ============================================================================
-- Create admin_delete_network RPC
-- ============================================================================
-- This function allows admins to delete a network (group or community)
-- and notifies all members about the deletion.
-- ============================================================================

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
BEGIN
  -- Get the admin user ID
  v_admin_id := auth.uid();
  
  -- Verify user is an admin with appropriate role
  IF NOT EXISTS (
    SELECT 1 
    FROM admin_user 
    WHERE user_id = v_admin_id 
    AND role IN ('admin', 'moderator', 'support')
    AND is_active = TRUE
  ) THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Unauthorized: Admin access required'
    );
  END IF;

  -- Get network info
  SELECT n.name, nt.name
  INTO v_network_name, v_network_type
  FROM network n
  JOIN network_type nt ON n.type_id = nt.id
  WHERE n.id = p_network_id;

  IF v_network_name IS NULL THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Network not found'
    );
  END IF;

  -- Get all member player IDs (to get their user IDs for notifications)
  SELECT ARRAY_AGG(DISTINCT p.user_id)
  INTO v_member_ids
  FROM network_member nm
  JOIN player p ON nm.player_id = p.id
  WHERE nm.network_id = p_network_id
  AND nm.status = 'active'
  AND p.user_id IS NOT NULL;

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
  IF v_member_ids IS NOT NULL AND array_length(v_member_ids, 1) > 0 THEN
    FOREACH v_member_id IN ARRAY v_member_ids
    LOOP
      BEGIN
        PERFORM insert_notification(
          p_user_id := v_member_id,
          p_type := 'network_deleted'::notification_type_enum,
          p_target_id := p_network_id,
          p_title := v_notification_title,
          p_body := v_notification_body,
          p_payload := jsonb_build_object(
            'network_id', p_network_id,
            'network_name', v_network_name,
            'network_type', v_network_type,
            'reason', COALESCE(p_reason, ''),
            'deleted_by', v_admin_id
          ),
          p_priority := 'high'::notification_priority_enum
        );
      EXCEPTION WHEN OTHERS THEN
        -- Log but don't fail if notification fails
        RAISE NOTICE 'Failed to send notification to user %: %', v_member_id, SQLERRM;
      END;
    END LOOP;
  END IF;

  -- Delete the network (cascades to network_member, etc.)
  DELETE FROM network WHERE id = p_network_id;

  -- Log the admin action
  INSERT INTO admin_activity_log (
    admin_user_id,
    action,
    target_type,
    target_id,
    details,
    ip_address
  ) VALUES (
    v_admin_id,
    'delete_network',
    v_network_type,
    p_network_id,
    jsonb_build_object(
      'network_name', v_network_name,
      'member_count', COALESCE(array_length(v_member_ids, 1), 0),
      'reason', COALESCE(p_reason, '')
    ),
    NULL
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'network_name', v_network_name,
    'members_notified', COALESCE(array_length(v_member_ids, 1), 0)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', FALSE,
    'error', SQLERRM
  );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION admin_delete_network(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_network(UUID, TEXT) TO service_role;

-- Add comment
COMMENT ON FUNCTION admin_delete_network(UUID, TEXT) IS 
'Admin function to delete a network (group or community) and notify all members. Requires admin role.';
