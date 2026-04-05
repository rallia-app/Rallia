-- Migration: Add player_interest table for public lead-capture form at /play
-- Created: 2026-04-05

-- ============================================
-- 1. Create player_interest table
-- ============================================

CREATE TABLE IF NOT EXISTS player_interest (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  plays_tennis BOOLEAN NOT NULL DEFAULT false,
  tennis_rating_score_id UUID REFERENCES rating_score(id),
  favorite_tennis_facility_id UUID REFERENCES facility(id),
  favorite_tennis_facility_custom TEXT,
  plays_pickleball BOOLEAN NOT NULL DEFAULT false,
  pickleball_rating_score_id UUID REFERENCES rating_score(id),
  favorite_pickleball_facility_id UUID REFERENCES facility(id),
  favorite_pickleball_facility_custom TEXT,
  weekly_availability JSONB NOT NULL DEFAULT '[]'::jsonb,
  ip_address TEXT,
  location TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 2. Check constraints
-- ============================================

-- At least one sport must be selected
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'player_interest_at_least_one_sport_check'
  ) THEN
    ALTER TABLE player_interest ADD CONSTRAINT player_interest_at_least_one_sport_check
      CHECK (plays_tennis = true OR plays_pickleball = true);
  END IF;
END $$;

-- If tennis, rating is required
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'player_interest_tennis_rating_required_check'
  ) THEN
    ALTER TABLE player_interest ADD CONSTRAINT player_interest_tennis_rating_required_check
      CHECK (plays_tennis = false OR tennis_rating_score_id IS NOT NULL);
  END IF;
END $$;

-- If pickleball, rating is required
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'player_interest_pickleball_rating_required_check'
  ) THEN
    ALTER TABLE player_interest ADD CONSTRAINT player_interest_pickleball_rating_required_check
      CHECK (plays_pickleball = false OR pickleball_rating_score_id IS NOT NULL);
  END IF;
END $$;

-- If tennis, facility (db or custom) is required
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'player_interest_tennis_facility_required_check'
  ) THEN
    ALTER TABLE player_interest ADD CONSTRAINT player_interest_tennis_facility_required_check
      CHECK (plays_tennis = false OR favorite_tennis_facility_id IS NOT NULL OR favorite_tennis_facility_custom IS NOT NULL);
  END IF;
END $$;

-- If pickleball, facility (db or custom) is required
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'player_interest_pickleball_facility_required_check'
  ) THEN
    ALTER TABLE player_interest ADD CONSTRAINT player_interest_pickleball_facility_required_check
      CHECK (plays_pickleball = false OR favorite_pickleball_facility_id IS NOT NULL OR favorite_pickleball_facility_custom IS NOT NULL);
  END IF;
END $$;

-- ============================================
-- 3. RLS policies
-- ============================================

ALTER TABLE player_interest ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'player_interest' AND policyname = 'anyone can insert player interest'
  ) THEN
    CREATE POLICY "anyone can insert player interest"
      ON player_interest
      FOR INSERT
      TO anon, authenticated
      WITH CHECK (true);
  END IF;
END $$;

-- ============================================
-- 4. Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS player_interest_email_idx ON player_interest (email);
