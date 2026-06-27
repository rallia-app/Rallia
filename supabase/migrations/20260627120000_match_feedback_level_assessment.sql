-- =============================================================================
-- MATCH FEEDBACK: OPPONENT LEVEL ASSESSMENT
-- Lets a reviewer declare whether an opponent played below, at, or above the
-- level their rating suggests. Optional, per-opponent, only when they showed up.
-- =============================================================================

-- Enum: how the opponent's play compared to their rating
DO $$ BEGIN
  CREATE TYPE opponent_level_assessment_enum AS ENUM (
    'below',  -- Played below the level their rating suggests
    'at',     -- Played at the level their rating suggests
    'above'   -- Played above the level their rating suggests
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

COMMENT ON TYPE opponent_level_assessment_enum IS
  'Reviewer''s read on how an opponent played relative to their rating';

-- Column on match_feedback (nullable: optional, and N/A when opponent did not show)
ALTER TABLE match_feedback
  ADD COLUMN IF NOT EXISTS level_assessment opponent_level_assessment_enum;

COMMENT ON COLUMN match_feedback.level_assessment IS
  'Did the opponent play below/at/above their rating (null = not answered / no-show)';

-- =============================================================================
-- VERIFICATION
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'opponent_level_assessment_enum') THEN
    RAISE EXCEPTION 'opponent_level_assessment_enum was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'match_feedback' AND column_name = 'level_assessment'
  ) THEN
    RAISE EXCEPTION 'match_feedback.level_assessment column was not created';
  END IF;

  RAISE NOTICE 'Match feedback level-assessment migration completed successfully';
END $$;
