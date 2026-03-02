-- =============================================================================
-- REPAIR SCRIPT - Run this directly in Supabase SQL Editor
-- This re-applies all schema elements that were tampered with
-- Safe to run multiple times (idempotent)
-- =============================================================================

-- =============================================================================
-- PART 1: MISSING ENUMS
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE match_format_enum AS ENUM ('singles', 'doubles');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE court_status_enum AS ENUM ('reserved', 'to_reserve');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE match_visibility_enum AS ENUM ('public', 'private');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE match_join_mode_enum AS ENUM ('direct', 'request');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE cost_split_type_enum AS ENUM ('host_pays', 'split_equal', 'custom');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE location_type_enum AS ENUM ('facility', 'custom', 'tbd');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE share_channel_enum AS ENUM ('sms', 'email', 'whatsapp', 'share_sheet', 'copy_link');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE share_status_enum AS ENUM ('pending', 'sent', 'viewed', 'accepted', 'expired', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE badge_status_enum AS ENUM ('self_declared', 'certified', 'disputed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE storage_provider_enum AS ENUM ('supabase', 'backblaze');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE network_member_request_type AS ENUM ('direct_add', 'join_request', 'member_referral', 'invite_code');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE notification_priority_enum AS ENUM ('low', 'normal', 'high', 'urgent');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- PART 2: GROUP_ACTIVITY TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.group_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id UUID NOT NULL REFERENCES public.network(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.player(id) ON DELETE CASCADE,
  activity_type VARCHAR(50) NOT NULL CHECK (activity_type IN (
    'member_joined', 
    'member_left',
    'member_promoted',
    'member_demoted',
    'match_created', 
    'match_completed',
    'game_created',
    'message_sent',
    'group_updated'
  )),
  related_entity_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.group_activity IS 'Activity feed for group/community home page showing recent events';

CREATE INDEX IF NOT EXISTS idx_group_activity_network_id ON public.group_activity(network_id);
CREATE INDEX IF NOT EXISTS idx_group_activity_created_at ON public.group_activity(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_activity_type ON public.group_activity(activity_type);

ALTER TABLE public.group_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view group activity" ON public.group_activity;
CREATE POLICY "Members can view group activity" ON public.group_activity
  FOR SELECT
  USING (
    network_id IN (
      SELECT network_id FROM public.network_member 
      WHERE player_id = auth.uid() AND status = 'active'
    )
    OR network_id IN (
      SELECT id FROM public.network WHERE created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "System can insert group activity" ON public.group_activity;
CREATE POLICY "System can insert group activity" ON public.group_activity
  FOR INSERT
  WITH CHECK (
    network_id IN (
      SELECT network_id FROM public.network_member 
      WHERE player_id = auth.uid() AND status = 'active'
    )
    OR network_id IN (
      SELECT id FROM public.network WHERE created_by = auth.uid()
    )
  );

-- =============================================================================
-- PART 3: NETWORK COLUMNS (max_members, member_count, archived_at)
-- =============================================================================

ALTER TABLE public.network ADD COLUMN IF NOT EXISTS max_members INTEGER DEFAULT 10;
ALTER TABLE public.network ADD COLUMN IF NOT EXISTS member_count INTEGER DEFAULT 0;
ALTER TABLE public.network ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

COMMENT ON COLUMN public.network.max_members IS 'Maximum number of members allowed (enforced for groups, ignored for communities)';
COMMENT ON COLUMN public.network.member_count IS 'Current number of active members in the network';

-- =============================================================================
-- PART 4: FUNCTIONS
-- =============================================================================

-- auto_add_creator_as_moderator function
CREATE OR REPLACE FUNCTION auto_add_creator_as_moderator()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_auto_add_creator ON public.network;
CREATE TRIGGER trigger_auto_add_creator
  AFTER INSERT ON public.network
  FOR EACH ROW
  EXECUTE FUNCTION auto_add_creator_as_moderator();

-- check_community_access function (with proper TEXT casting)
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
AS $$
DECLARE
  v_community_exists BOOLEAN;
  v_is_public BOOLEAN;
  v_is_archived BOOLEAN;
  v_created_by UUID;
  v_membership_status TEXT;
  v_membership_role TEXT;
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
  
  -- Get membership info (cast to TEXT to avoid type mismatch)
  SELECT 
    nm.status::TEXT,
    nm.role::TEXT
  INTO v_membership_status, v_membership_role
  FROM public.network_member nm
  WHERE nm.network_id = p_community_id AND nm.player_id = p_player_id;
  
  -- Check if player is the creator (always has access)
  IF p_player_id = v_created_by THEN
    RETURN QUERY SELECT 
      TRUE,
      COALESCE(v_membership_status = 'active', FALSE),
      v_membership_status,
      v_membership_role,
      v_is_public,
      v_has_moderator,
      'Creator has full access'::TEXT;
    RETURN;
  END IF;
  
  -- If player is an active member, grant access
  IF v_membership_status = 'active' THEN
    RETURN QUERY SELECT 
      TRUE,
      TRUE,
      v_membership_status,
      v_membership_role,
      v_is_public,
      v_has_moderator,
      'Active member'::TEXT;
    RETURN;
  END IF;
  
  -- If player has a pending request
  IF v_membership_status = 'pending' THEN
    RETURN QUERY SELECT 
      FALSE,
      FALSE,
      v_membership_status,
      v_membership_role,
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
$$;

GRANT EXECUTE ON FUNCTION check_community_access(UUID, UUID) TO authenticated;

-- update_network_member_count function
CREATE OR REPLACE FUNCTION update_network_member_count()
RETURNS TRIGGER AS $$
BEGIN
  -- Handle INSERT
  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    UPDATE public.network 
    SET member_count = member_count + 1 
    WHERE id = NEW.network_id;
  -- Handle DELETE
  ELSIF TG_OP = 'DELETE' AND OLD.status = 'active' THEN
    UPDATE public.network 
    SET member_count = GREATEST(0, member_count - 1) 
    WHERE id = OLD.network_id;
  -- Handle UPDATE (status change)
  ELSIF TG_OP = 'UPDATE' THEN
    -- Became active
    IF NEW.status = 'active' AND OLD.status != 'active' THEN
      UPDATE public.network 
      SET member_count = member_count + 1 
      WHERE id = NEW.network_id;
    -- Became inactive
    ELSIF NEW.status != 'active' AND OLD.status = 'active' THEN
      UPDATE public.network 
      SET member_count = GREATEST(0, member_count - 1) 
      WHERE id = NEW.network_id;
    END IF;
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_update_network_member_count ON public.network_member;
DROP TRIGGER IF EXISTS trigger_update_network_member_count_insert ON public.network_member;
DROP TRIGGER IF EXISTS trigger_update_network_member_count_update ON public.network_member;
DROP TRIGGER IF EXISTS trigger_update_network_member_count_delete ON public.network_member;

CREATE TRIGGER trigger_update_network_member_count_insert
  AFTER INSERT ON public.network_member
  FOR EACH ROW
  EXECUTE FUNCTION update_network_member_count();

CREATE TRIGGER trigger_update_network_member_count_update
  AFTER UPDATE ON public.network_member
  FOR EACH ROW
  EXECUTE FUNCTION update_network_member_count();

CREATE TRIGGER trigger_update_network_member_count_delete
  AFTER DELETE ON public.network_member
  FOR EACH ROW
  EXECUTE FUNCTION update_network_member_count();

-- log_member_joined_activity function
CREATE OR REPLACE FUNCTION log_member_joined_activity()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'active' THEN
    INSERT INTO public.group_activity (network_id, player_id, activity_type, metadata)
    VALUES (
      NEW.network_id, 
      NEW.player_id, 
      'member_joined',
      jsonb_build_object('joined_at', NEW.joined_at)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_log_member_joined ON public.network_member;
CREATE TRIGGER trigger_log_member_joined
  AFTER INSERT ON public.network_member
  FOR EACH ROW
  EXECUTE FUNCTION log_member_joined_activity();

-- log_member_left_activity function
CREATE OR REPLACE FUNCTION log_member_left_activity()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if member status changed from active to removed/blocked
  IF OLD.status = 'active' AND (NEW.status = 'removed' OR NEW.status = 'blocked') THEN
    INSERT INTO public.group_activity (network_id, player_id, activity_type, metadata)
    VALUES (
      OLD.network_id, 
      OLD.player_id, 
      'member_left',
      jsonb_build_object('left_at', NOW())
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_log_member_left ON public.network_member;
CREATE TRIGGER trigger_log_member_left
  AFTER UPDATE ON public.network_member
  FOR EACH ROW
  EXECUTE FUNCTION log_member_left_activity();

-- log_network_created_activity function
CREATE OR REPLACE FUNCTION log_network_created_activity()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.group_activity (
    network_id,
    player_id,
    activity_type,
    metadata
  )
  VALUES (
    NEW.id,
    NEW.created_by,
    'group_updated',
    jsonb_build_object(
      'action', 'created',
      'network_name', NEW.name,
      'created_at', NEW.created_at
    )
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_log_network_created ON public.network;
CREATE TRIGGER trigger_log_network_created
  AFTER INSERT ON public.network
  FOR EACH ROW
  EXECUTE FUNCTION log_network_created_activity();

-- get_group_activity function
CREATE OR REPLACE FUNCTION get_group_activity(
  p_network_id UUID,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  network_id UUID,
  player_id UUID,
  activity_type VARCHAR(50),
  related_entity_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ,
  player_first_name VARCHAR,
  player_last_name VARCHAR,
  player_avatar_url TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ga.id,
    ga.network_id,
    ga.player_id,
    ga.activity_type,
    ga.related_entity_id,
    ga.metadata,
    ga.created_at,
    p.first_name AS player_first_name,
    p.last_name AS player_last_name,
    p.avatar_url AS player_avatar_url
  FROM public.group_activity ga
  LEFT JOIN public.player p ON p.id = ga.player_id
  WHERE ga.network_id = p_network_id
  ORDER BY ga.created_at DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_group_activity(UUID, INTEGER) TO authenticated;

-- get_public_communities function
CREATE OR REPLACE FUNCTION get_public_communities(p_player_id UUID DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  cover_image_url TEXT,
  member_count INTEGER,
  created_by UUID,
  created_at TIMESTAMPTZ,
  is_member BOOLEAN,
  membership_status TEXT,
  membership_role TEXT
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    n.id,
    n.name,
    n.description,
    n.cover_image_url,
    n.member_count,
    n.created_by,
    n.created_at,
    CASE WHEN nm.id IS NOT NULL THEN true ELSE false END as is_member,
    nm.status::TEXT as membership_status,
    nm.role::TEXT as membership_role
  FROM public.network n
  JOIN public.network_type nt ON n.network_type_id = nt.id
  LEFT JOIN public.network_member nm ON nm.network_id = n.id 
    AND nm.player_id = COALESCE(p_player_id, auth.uid())
  WHERE nt.name = 'community'
    AND n.is_private = false
    AND n.member_count > 0
    AND n.archived_at IS NULL
  ORDER BY n.member_count DESC, n.created_at DESC;
END;
$$;

-- handle_orphaned_community function
CREATE OR REPLACE FUNCTION handle_orphaned_community()
RETURNS TRIGGER AS $$
BEGIN
  -- If member_count goes to 0, mark as archived
  IF NEW.member_count = 0 AND (OLD.member_count IS NULL OR OLD.member_count > 0) THEN
    NEW.archived_at := NOW();
  END IF;
  
  -- If member_count increases from 0, unarchive
  IF NEW.member_count > 0 AND OLD.member_count = 0 AND OLD.archived_at IS NOT NULL THEN
    NEW.archived_at := NULL;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_handle_orphaned_community ON public.network;
CREATE TRIGGER trigger_handle_orphaned_community
BEFORE UPDATE OF member_count ON public.network
FOR EACH ROW
EXECUTE FUNCTION handle_orphaned_community();

-- =============================================================================
-- PART 5: FIX EXISTING DATA
-- =============================================================================

-- Fix existing networks that have no members - add creator as moderator
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

-- Recalculate member_count for all networks
UPDATE public.network n
SET member_count = COALESCE((
  SELECT COUNT(*) 
  FROM public.network_member nm 
  WHERE nm.network_id = n.id AND nm.status = 'active'
), 0);

-- Ensure max_members has a reasonable default
UPDATE public.network n
SET max_members = 10
WHERE max_members IS NULL OR max_members = 0;

-- =============================================================================
-- COMPLETION
-- =============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Schema repair completed successfully!';
END $$;
