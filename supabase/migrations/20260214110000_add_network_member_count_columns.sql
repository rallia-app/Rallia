-- Migration: Add missing max_members and member_count columns to network table
-- These columns are expected by the code but were never added to the database

-- Add max_members column with default of 10 for groups (communities will ignore it)
ALTER TABLE public.network 
ADD COLUMN IF NOT EXISTS max_members INTEGER DEFAULT 10;

-- Add member_count column with default of 0
ALTER TABLE public.network 
ADD COLUMN IF NOT EXISTS member_count INTEGER DEFAULT 0;

-- Add comments
COMMENT ON COLUMN public.network.max_members IS 'Maximum number of members allowed (enforced for groups, ignored for communities)';
COMMENT ON COLUMN public.network.member_count IS 'Current number of active members in the network';

-- Update member_count for all existing networks based on actual member count
UPDATE public.network n
SET member_count = (
  SELECT COUNT(*) 
  FROM public.network_member nm 
  WHERE nm.network_id = n.id AND nm.status = 'active'
);

-- =============================================================================
-- FUNCTION: Auto-update member_count when network_member changes
-- =============================================================================
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

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trigger_update_network_member_count ON public.network_member;

-- Create trigger for INSERT
CREATE TRIGGER trigger_update_network_member_count_insert
  AFTER INSERT ON public.network_member
  FOR EACH ROW
  EXECUTE FUNCTION update_network_member_count();

-- Create trigger for UPDATE
CREATE TRIGGER trigger_update_network_member_count_update
  AFTER UPDATE ON public.network_member
  FOR EACH ROW
  EXECUTE FUNCTION update_network_member_count();

-- Create trigger for DELETE
CREATE TRIGGER trigger_update_network_member_count_delete
  AFTER DELETE ON public.network_member
  FOR EACH ROW
  EXECUTE FUNCTION update_network_member_count();

DO $$
BEGIN
  RAISE NOTICE 'Added max_members and member_count columns to network table';
END $$;
