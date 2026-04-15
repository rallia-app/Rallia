-- Migration: Auto-add users to "Rallia Beta" communities on onboarding completion
-- Users who complete onboarding before April 25, 2026 00:00 ET are automatically
-- added to the existing "Rallia Beta" communities matching their selected sports.
-- Created: 2026-04-13

-- ============================================
-- TRIGGER FUNCTION: Add to Rallia Beta communities on onboarding completion
-- ============================================

CREATE OR REPLACE FUNCTION add_to_rallia_beta_communities()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_community_type_id UUID;
  v_community RECORD;
BEGIN
  -- Only trigger when onboarding_completed changes from FALSE/NULL to TRUE
  IF NOT (NEW.onboarding_completed = TRUE
          AND (OLD.onboarding_completed IS DISTINCT FROM TRUE)) THEN
    RETURN NEW;
  END IF;

  -- Check date cutoff: only for users completing before end of April 24, 2026 ET
  IF NOW() >= '2026-04-25T00:00:00-04:00'::timestamptz THEN
    RETURN NEW;
  END IF;

  -- Verify player record exists
  IF NOT EXISTS (SELECT 1 FROM player WHERE id = NEW.id) THEN
    RAISE LOG 'Beta community auto-join skipped (no player record): user_id=%', NEW.id;
    RETURN NEW;
  END IF;

  -- Get community type ID
  SELECT id INTO v_community_type_id
  FROM network_type WHERE name = 'community';

  -- For each "Rallia Beta" community, check if user plays that sport and add them
  FOR v_community IN
    SELECT n.id AS network_id, n.sport_id
    FROM network n
    WHERE n.name = 'Rallia Beta'
      AND n.network_type_id = v_community_type_id
      AND n.archived_at IS NULL
  LOOP
    -- Check if user plays this sport (or community has no sport_id = both sports)
    IF v_community.sport_id IS NULL
       OR EXISTS (
         SELECT 1 FROM player_sport
         WHERE player_id = NEW.id
         AND sport_id = v_community.sport_id
       ) THEN

      -- Add as active member (skip if already a member)
      INSERT INTO network_member (
        network_id, player_id, status, joined_at
      ) VALUES (
        v_community.network_id, NEW.id, 'active'::network_member_status, NOW()
      )
      ON CONFLICT (network_id, player_id) DO NOTHING;

    END IF;
  END LOOP;

  RAISE LOG 'Beta community auto-join completed: player_id=%', NEW.id;
  RETURN NEW;
END;
$$;

-- ============================================
-- CREATE TRIGGER ON PROFILE TABLE
-- ============================================

DROP TRIGGER IF EXISTS trigger_add_to_beta_communities ON profile;

CREATE TRIGGER trigger_add_to_beta_communities
  AFTER UPDATE OF onboarding_completed ON profile
  FOR EACH ROW
  EXECUTE FUNCTION add_to_rallia_beta_communities();

-- ============================================
-- BACKFILL: Add existing onboarded users to Rallia Beta communities
-- ============================================

INSERT INTO network_member (network_id, player_id, status, joined_at)
SELECT DISTINCT n.id, p.id, 'active'::network_member_status, NOW()
FROM profile p
JOIN player pl ON pl.id = p.id
JOIN player_sport ps ON ps.player_id = p.id
JOIN network n ON n.name = 'Rallia Beta'
  AND n.network_type_id = (SELECT id FROM network_type WHERE name = 'community')
  AND n.archived_at IS NULL
  AND (n.sport_id IS NULL OR n.sport_id = ps.sport_id)
WHERE p.onboarding_completed = TRUE
ON CONFLICT (network_id, player_id) DO NOTHING;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON FUNCTION add_to_rallia_beta_communities IS
'Trigger function that automatically adds users to "Rallia Beta" communities when they complete onboarding before April 25, 2026 00:00 ET. Users are added to communities matching their selected sports.';

COMMENT ON TRIGGER trigger_add_to_beta_communities ON profile IS
'Fires when onboarding_completed changes to TRUE, adding the user to matching Rallia Beta communities.';
