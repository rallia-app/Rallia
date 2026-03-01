-- Migration: Add Module Column to Feedback Table
-- Description: Adds a module/feature area column to feedback for analytics breakdown by app feature
-- This allows the User Feedback graph in Moderation & Safety analytics to show
-- bug reports vs feature requests per module

-- =============================================================================
-- ADD MODULE COLUMN
-- =============================================================================

-- Add the module column with default 'other' for existing records
ALTER TABLE public.feedback 
ADD COLUMN IF NOT EXISTS module TEXT NOT NULL DEFAULT 'other'
CHECK (module IN (
  'match_features',
  'profile_settings', 
  'messaging',
  'rating_system',
  'player_directory',
  'notifications',
  'performance',
  'other'
));

-- Create index for efficient grouping queries
CREATE INDEX IF NOT EXISTS idx_feedback_module ON public.feedback(module);

-- =============================================================================
-- UPDATE get_feedback_sentiment() RPC
-- Now returns data grouped by MODULE with bug/feature counts per module
-- Drop existing function first as return type is changing
-- =============================================================================

DROP FUNCTION IF EXISTS get_feedback_sentiment();

CREATE OR REPLACE FUNCTION get_feedback_sentiment()
RETURNS TABLE (
  category text,
  bug_reports bigint,
  feature_requests bigint,
  open_count bigint,
  in_progress_count bigint,
  resolved_count bigint
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    f.module::text AS category,
    COUNT(*) FILTER (WHERE f.category = 'bug')::bigint AS bug_reports,
    COUNT(*) FILTER (WHERE f.category = 'feature')::bigint AS feature_requests,
    COUNT(*) FILTER (WHERE f.status IN ('new', 'reviewed'))::bigint AS open_count,
    COUNT(*) FILTER (WHERE f.status = 'in_progress')::bigint AS in_progress_count,
    COUNT(*) FILTER (WHERE f.status IN ('resolved', 'closed'))::bigint AS resolved_count
  FROM feedback f
  GROUP BY f.module
  ORDER BY (COUNT(*) FILTER (WHERE f.category = 'bug') + COUNT(*) FILTER (WHERE f.category = 'feature')) DESC;
END;
$$;

-- Grant execution permission
GRANT EXECUTE ON FUNCTION get_feedback_sentiment() TO authenticated;

-- Update comment
COMMENT ON FUNCTION get_feedback_sentiment() IS 'Returns feedback sentiment breakdown grouped by app module, with bug reports and feature requests counts per module';

-- =============================================================================
-- MODULE DISPLAY NAME HELPER (optional - can be used in admin screens)
-- =============================================================================

CREATE OR REPLACE FUNCTION get_feedback_module_display_name(module_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE module_key
    WHEN 'match_features' THEN 'Match Features'
    WHEN 'profile_settings' THEN 'Profile & Settings'
    WHEN 'messaging' THEN 'Messaging'
    WHEN 'rating_system' THEN 'Rating System'
    WHEN 'player_directory' THEN 'Player Directory'
    WHEN 'notifications' THEN 'Notifications'
    WHEN 'performance' THEN 'Performance'
    WHEN 'other' THEN 'Other'
    ELSE module_key
  END;
$$;

GRANT EXECUTE ON FUNCTION get_feedback_module_display_name(text) TO authenticated;
