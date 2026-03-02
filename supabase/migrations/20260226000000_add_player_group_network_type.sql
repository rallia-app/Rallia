-- =============================================================================
-- Migration: Add player_group network type
-- Description: Ensures the player_group network type exists in the database.
--              This was previously only in seed.sql but is required for production.
-- =============================================================================

-- Insert the player_group network type if it doesn't exist
INSERT INTO public.network_type (name, display_name, description, is_active)
VALUES ('player_group', 'Player Group', 'Player-created groups for organizing matches', true)
ON CONFLICT (name) DO NOTHING;

-- Verify the insert
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.network_type WHERE name = 'player_group') THEN
    RAISE EXCEPTION 'Failed to insert player_group network type';
  END IF;
  RAISE NOTICE 'player_group network type exists in network_type table';
END
$$;
