-- =============================================================================
-- Migration: Add network_activity table for community features
-- Description: Creates the network_activity table required by community RPC functions
--              Separate from group_activity to allow communities to scale independently
-- =============================================================================

-- Create the network_activity table (for communities)
-- Schema matches what community RPCs expect: actor_id + target_id pattern
CREATE TABLE IF NOT EXISTS public.network_activity (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  network_id uuid NOT NULL,
  activity_type character varying(50) NOT NULL,
  actor_id uuid,                    -- Who performed the action
  target_id uuid,                   -- Who was affected (e.g., member being approved)
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT network_activity_pkey PRIMARY KEY (id),
  CONSTRAINT network_activity_network_id_fkey FOREIGN KEY (network_id) 
    REFERENCES public.network(id) ON DELETE CASCADE,
  CONSTRAINT network_activity_actor_id_fkey FOREIGN KEY (actor_id) 
    REFERENCES public.player(id) ON DELETE SET NULL,
  CONSTRAINT network_activity_target_id_fkey FOREIGN KEY (target_id) 
    REFERENCES public.player(id) ON DELETE SET NULL
);

-- Add comment
COMMENT ON TABLE public.network_activity IS 'Activity feed for communities - tracks join requests, approvals, moderator actions. Separate from group_activity to allow communities to scale independently.';

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_network_activity_network_id 
  ON public.network_activity(network_id);
CREATE INDEX IF NOT EXISTS idx_network_activity_actor_id 
  ON public.network_activity(actor_id);
CREATE INDEX IF NOT EXISTS idx_network_activity_created_at 
  ON public.network_activity(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_network_activity_type 
  ON public.network_activity(activity_type);

-- Enable RLS
ALTER TABLE public.network_activity ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Members can view activity in their communities
DROP POLICY IF EXISTS "Members can view community activity" ON public.network_activity;
CREATE POLICY "Members can view community activity"
  ON public.network_activity
  FOR SELECT
  USING (
    -- Active members can view
    EXISTS (
      SELECT 1 FROM public.network_member nm
      WHERE nm.network_id = network_activity.network_id
        AND nm.player_id = auth.uid()
        AND nm.status = 'active'
    )
    OR
    -- Community creator can view
    EXISTS (
      SELECT 1 FROM public.network n
      WHERE n.id = network_activity.network_id
        AND n.created_by = auth.uid()
    )
  );

-- RLS Policy: Authenticated users can insert activity (via SECURITY DEFINER functions)
DROP POLICY IF EXISTS "Authenticated can insert activity" ON public.network_activity;
CREATE POLICY "Authenticated can insert activity"
  ON public.network_activity
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Grant permissions
GRANT SELECT ON public.network_activity TO authenticated;
GRANT INSERT ON public.network_activity TO authenticated;
