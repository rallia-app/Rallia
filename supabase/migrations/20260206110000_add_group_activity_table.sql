-- Migration: Add group_activity table
-- This table was missing from the database despite being referenced in code
-- It tracks activity feed for groups/communities (member joins, matches, etc.)

-- =============================================================================
-- TABLE: group_activity (for tracking group activities on home tab)
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
  related_entity_id UUID, -- Can reference match_id, message_id, etc.
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add comment
COMMENT ON TABLE public.group_activity IS 'Activity feed for group/community home page showing recent events';

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_group_activity_network_id ON public.group_activity(network_id);
CREATE INDEX IF NOT EXISTS idx_group_activity_created_at ON public.group_activity(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_activity_type ON public.group_activity(activity_type);

-- RLS for group_activity
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
-- FUNCTION: Log group activity when member joins
-- =============================================================================
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

-- Trigger for member joined activity
DROP TRIGGER IF EXISTS trigger_log_member_joined ON public.network_member;
CREATE TRIGGER trigger_log_member_joined
  AFTER INSERT ON public.network_member
  FOR EACH ROW
  EXECUTE FUNCTION log_member_joined_activity();

-- =============================================================================
-- FUNCTION: Log group activity when member leaves
-- =============================================================================
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

-- Trigger for member left activity
DROP TRIGGER IF EXISTS trigger_log_member_left ON public.network_member;
CREATE TRIGGER trigger_log_member_left
  AFTER UPDATE ON public.network_member
  FOR EACH ROW
  EXECUTE FUNCTION log_member_left_activity();

-- =============================================================================
-- FUNCTION: Log group activity when member is promoted/demoted
-- =============================================================================
CREATE OR REPLACE FUNCTION log_member_role_change_activity()
RETURNS TRIGGER AS $$
BEGIN
  -- Only log if the role actually changed and member is still active
  IF OLD.role IS DISTINCT FROM NEW.role AND NEW.status = 'active' THEN
    IF NEW.role = 'moderator' AND OLD.role = 'member' THEN
      -- Member was promoted
      INSERT INTO public.group_activity (network_id, player_id, activity_type, related_entity_id, metadata)
      VALUES (
        NEW.network_id, 
        NEW.player_id, 
        'member_promoted',
        NEW.player_id,
        jsonb_build_object('promoted_at', NOW(), 'new_role', NEW.role, 'old_role', OLD.role)
      );
    ELSIF NEW.role = 'member' AND OLD.role = 'moderator' THEN
      -- Member was demoted
      INSERT INTO public.group_activity (network_id, player_id, activity_type, related_entity_id, metadata)
      VALUES (
        NEW.network_id, 
        NEW.player_id, 
        'member_demoted',
        NEW.player_id,
        jsonb_build_object('demoted_at', NOW(), 'new_role', NEW.role, 'old_role', OLD.role)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for member role change (promotion/demotion) activity
DROP TRIGGER IF EXISTS trigger_log_member_role_change ON public.network_member;
CREATE TRIGGER trigger_log_member_role_change
  AFTER UPDATE ON public.network_member
  FOR EACH ROW
  EXECUTE FUNCTION log_member_role_change_activity();

-- =============================================================================
-- RPC: Get group activity feed
-- =============================================================================
-- Drop existing function first to allow return type change
DROP FUNCTION IF EXISTS get_group_activity(UUID, INTEGER);

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
  player_first_name TEXT,
  player_last_name TEXT,
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
    pr.first_name AS player_first_name,
    pr.last_name AS player_last_name,
    pr.profile_picture_url AS player_avatar_url
  FROM public.group_activity ga
  LEFT JOIN public.profile pr ON pr.id = ga.player_id
  WHERE ga.network_id = p_network_id
  ORDER BY ga.created_at DESC
  LIMIT p_limit;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_group_activity(UUID, INTEGER) TO authenticated;

DO $$
BEGIN
  RAISE NOTICE 'group_activity table and related functions created successfully';
END $$;
