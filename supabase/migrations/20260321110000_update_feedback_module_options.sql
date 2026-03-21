-- Migration: Update Feedback Module Options
-- Description: Replace messaging & rating_system with facilities & groups_communities,
-- reorder modules to match new BugReportSheet layout

-- =============================================================================
-- UPDATE CHECK CONSTRAINT
-- =============================================================================

-- Drop existing check constraint (name may vary, use pg_constraint to find it)
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT c.conname INTO constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE t.relname = 'feedback'
    AND n.nspname = 'public'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%module%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.feedback DROP CONSTRAINT %I', constraint_name);
  END IF;
END;
$$;

-- Migrate existing rows that use removed values to 'other'
UPDATE public.feedback SET module = 'other' WHERE module IN ('messaging', 'rating_system');

-- Add new check constraint with updated values
ALTER TABLE public.feedback
ADD CONSTRAINT feedback_module_check CHECK (module IN (
  'profile_settings',
  'match_features',
  'facilities',
  'player_directory',
  'groups_communities',
  'notifications',
  'performance',
  'other'
));

-- =============================================================================
-- UPDATE MODULE DISPLAY NAME HELPER
-- =============================================================================

CREATE OR REPLACE FUNCTION get_feedback_module_display_name(module_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE module_key
    WHEN 'profile_settings' THEN 'Profile & Settings'
    WHEN 'match_features' THEN 'Match Features'
    WHEN 'facilities' THEN 'Facilities'
    WHEN 'player_directory' THEN 'Player Directory'
    WHEN 'groups_communities' THEN 'Groups & Communities'
    WHEN 'notifications' THEN 'Notifications'
    WHEN 'performance' THEN 'Performance'
    WHEN 'other' THEN 'Other'
    ELSE module_key
  END;
$$;
