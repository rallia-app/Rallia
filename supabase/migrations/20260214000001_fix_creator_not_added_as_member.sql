-- Migration: Auto-add creator as moderator when network is created
-- Fixes issue where group/community creator is not automatically added as member

-- Check if role column exists before running any of this migration
DO $$
BEGIN
  -- Only run if role column exists on network_member
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'network_member' 
    AND column_name = 'role'
  ) THEN
    -- =============================================================================
    -- FUNCTION: Auto-add creator as moderator when network is created
    -- =============================================================================
    CREATE OR REPLACE FUNCTION auto_add_creator_as_moderator()
    RETURNS TRIGGER AS $func$
    BEGIN
      -- Insert creator as moderator member
      INSERT INTO public.network_member (
        network_id,
        player_id,
        role,
        status,
        joined_at
      )
      VALUES (
        NEW.id,
        NEW.created_by,
        'moderator',
        'active',
        NOW()
      )
      ON CONFLICT (network_id, player_id) DO NOTHING;
      
      -- Update member_count to 1
      UPDATE public.network
      SET member_count = 1
      WHERE id = NEW.id;
      
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql SECURITY DEFINER;

    -- Trigger to auto-add creator when network is created
    DROP TRIGGER IF EXISTS trigger_auto_add_creator ON public.network;
    CREATE TRIGGER trigger_auto_add_creator
      AFTER INSERT ON public.network
      FOR EACH ROW
      EXECUTE FUNCTION auto_add_creator_as_moderator();

    -- =============================================================================
    -- FUNCTION: Log 'group_created' activity when network is created
    -- =============================================================================
    CREATE OR REPLACE FUNCTION log_network_created_activity()
    RETURNS TRIGGER AS $func$
    BEGIN
      -- Insert activity for network creation
      INSERT INTO public.group_activity (
        network_id,
        player_id,
        activity_type,
        metadata
      )
      VALUES (
        NEW.id,
        NEW.created_by,
        'group_updated', -- Using 'group_updated' since 'network_created' is not in enum
        jsonb_build_object(
          'action', 'created',
          'network_name', NEW.name,
          'created_at', NEW.created_at
        )
      );
      
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql SECURITY DEFINER;

    -- Trigger to log activity when network is created
    DROP TRIGGER IF EXISTS trigger_log_network_created ON public.network;
    CREATE TRIGGER trigger_log_network_created
      AFTER INSERT ON public.network
      FOR EACH ROW
      EXECUTE FUNCTION log_network_created_activity();

    -- =============================================================================
    -- Fix existing networks that have no members (orphaned from creation)
    -- Add creator as moderator if they're not already a member
    -- =============================================================================
    INSERT INTO public.network_member (network_id, player_id, role, status, joined_at)
    SELECT 
      n.id,
      n.created_by,
      'moderator',
      'active',
      n.created_at
    FROM public.network n
    WHERE NOT EXISTS (
      SELECT 1 FROM public.network_member nm 
      WHERE nm.network_id = n.id AND nm.player_id = n.created_by
    )
    AND n.created_by IS NOT NULL
    ON CONFLICT (network_id, player_id) DO NOTHING;

    -- Update member_count for all networks to reflect actual active members
    UPDATE public.network n
    SET member_count = (
      SELECT COUNT(*) 
      FROM public.network_member nm 
      WHERE nm.network_id = n.id AND nm.status = 'active'
    );
    
    RAISE NOTICE 'Auto-add creator as moderator trigger created and existing networks fixed';
  ELSE
    RAISE NOTICE 'role column does not exist on network_member - skipping auto-add creator migration';
  END IF;
END $$;

-- =============================================================================
-- Fix check_community_access to also allow access if user is creator
-- Only if role column exists
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'network_member' 
    AND column_name = 'role'
  ) THEN
    CREATE OR REPLACE FUNCTION check_community_access(
      p_community_id UUID,
      p_player_id UUID DEFAULT NULL
    )
    RETURNS TABLE (
      can_access BOOLEAN,
      is_member BOOLEAN,
      membership_status TEXT,
      membership_role TEXT,
      is_public BOOLEAN,
      has_active_moderator BOOLEAN,
      access_reason TEXT
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $func$
    DECLARE
      v_community_exists BOOLEAN;
      v_is_public BOOLEAN;
      v_is_archived BOOLEAN;
      v_created_by UUID;
      v_membership_record RECORD;
      v_has_moderator BOOLEAN;
    BEGIN
      -- Check if community exists and get basic info
      SELECT 
        TRUE,
        NOT n.is_private,
        n.archived_at IS NOT NULL,
        n.created_by
      INTO 
        v_community_exists,
        v_is_public,
        v_is_archived,
        v_created_by
      FROM public.network n
      JOIN public.network_type nt ON nt.id = n.network_type_id
      WHERE n.id = p_community_id
        AND nt.name = 'community';
      
      -- If community doesn't exist, return no access
      IF NOT v_community_exists THEN
        RETURN QUERY SELECT 
          FALSE,
          FALSE,
          NULL::TEXT,
          NULL::TEXT,
          FALSE,
          FALSE,
          'Community not found'::TEXT;
        RETURN;
      END IF;
      
      -- If archived, return no access
      IF v_is_archived THEN
        RETURN QUERY SELECT 
          FALSE,
          FALSE,
          NULL::TEXT,
          NULL::TEXT,
          v_is_public,
          FALSE,
          'Community is archived'::TEXT;
        RETURN;
      END IF;
      
      -- Check if there's an active moderator
      SELECT EXISTS (
        SELECT 1 FROM public.network_member
        WHERE network_id = p_community_id
          AND role = 'moderator'
          AND status = 'active'
      ) INTO v_has_moderator;
      
      -- If no player_id provided, return public info only
      IF p_player_id IS NULL THEN
        RETURN QUERY SELECT 
          v_is_public,
          FALSE,
          NULL::TEXT,
          NULL::TEXT,
          v_is_public,
          v_has_moderator,
          CASE 
            WHEN v_is_public THEN 'Public community - view access'
            ELSE 'Login required for access'
          END::TEXT;
        RETURN;
      END IF;
      
      -- Check if player is the creator (always has access)
      IF p_player_id = v_created_by THEN
        -- Get membership record if exists
        SELECT status, role
        INTO v_membership_record
        FROM public.network_member
        WHERE network_id = p_community_id AND player_id = p_player_id;
        
        RETURN QUERY SELECT 
          TRUE,
          v_membership_record.status = 'active',
          v_membership_record.status,
          v_membership_record.role,
          v_is_public,
          v_has_moderator,
          'Creator has full access'::TEXT;
        RETURN;
      END IF;
      
      -- Check player's membership status
      SELECT status, role
      INTO v_membership_record
      FROM public.network_member
      WHERE network_id = p_community_id AND player_id = p_player_id;
      
      -- If player is an active member, grant access
      IF v_membership_record.status = 'active' THEN
        RETURN QUERY SELECT 
          TRUE,
          TRUE,
          v_membership_record.status,
          v_membership_record.role,
          v_is_public,
          v_has_moderator,
          'Active member'::TEXT;
        RETURN;
      END IF;
      
      -- If player has a pending request
      IF v_membership_record.status = 'pending' THEN
        RETURN QUERY SELECT 
          FALSE,
          FALSE,
          v_membership_record.status,
          v_membership_record.role,
          v_is_public,
          v_has_moderator,
          'Membership request pending'::TEXT;
        RETURN;
      END IF;
      
      -- Player is not a member
      RETURN QUERY SELECT 
        FALSE,
        FALSE,
        NULL::TEXT,
        NULL::TEXT,
        v_is_public,
        v_has_moderator,
        CASE 
          WHEN NOT v_has_moderator THEN 'Community has no active moderator'
          ELSE 'Membership required'
        END::TEXT;
      RETURN;
    END;
    $func$;
  END IF;
END $$;
