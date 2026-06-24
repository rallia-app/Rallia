-- ============================================================================
-- Fix + localize network_deleted notifications (admin_delete_network)
-- ============================================================================
-- Bug: the member-notification call passed `p_data :=`, but insert_notification
-- takes `p_payload`. The mismatch raised on every call and was swallowed by the
-- surrounding `EXCEPTION WHEN OTHERS THEN NULL`, so group/community-deletion
-- notifications never delivered. This corrects p_data -> p_payload and, while
-- there, localizes the copy per recipient via public.lt_user_is_fr(uuid).
-- Definition is the exact current pg_get_functiondef output with only those
-- changes; EN output is unchanged. CREATE OR REPLACE preserves grants.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_delete_network(p_network_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id UUID;
  v_network_name TEXT;
  v_network_type TEXT;
  v_member_ids UUID[];
  v_member_id UUID;
  v_title_en TEXT;
  v_body_en TEXT;
  v_title_fr TEXT;
  v_body_fr TEXT;
  v_is_fr BOOLEAN;
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

  -- Prepare bilingual notification content based on network type; the loop
  -- below picks per-recipient by preferred_locale.
  IF v_network_type = 'player_group' THEN
    v_title_en := 'Group Deleted';
    v_body_en  := format('The group "%s" has been deleted by an administrator.', v_network_name);
    v_title_fr := 'Groupe supprimé';
    v_body_fr  := format('Le groupe « %s » a été supprimé par un administrateur.', v_network_name);
  ELSE
    v_title_en := 'Community Deleted';
    v_body_en  := format('The community "%s" has been deleted by an administrator.', v_network_name);
    v_title_fr := 'Communauté supprimée';
    v_body_fr  := format('La communauté « %s » a été supprimée par un administrateur.', v_network_name);
  END IF;
  IF p_reason IS NOT NULL AND p_reason != '' THEN
    v_body_en := v_body_en || format(' Reason: %s', p_reason);
    v_body_fr := v_body_fr || format(' Raison : %s', p_reason);
  END IF;

  -- Send notifications to all members
  IF v_member_ids IS NOT NULL AND v_members_count > 0 THEN
    FOREACH v_member_id IN ARRAY v_member_ids
    LOOP
      v_is_fr := public.lt_user_is_fr(v_member_id);
      BEGIN
        PERFORM insert_notification(
          p_user_id := v_member_id,
          p_type := 'network_deleted'::notification_type_enum,
          p_target_id := p_network_id,
          p_title := CASE WHEN v_is_fr THEN v_title_fr ELSE v_title_en END,
          p_body := CASE WHEN v_is_fr THEN v_body_fr ELSE v_body_en END,
          p_payload := jsonb_build_object(
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
$function$;

COMMIT;
