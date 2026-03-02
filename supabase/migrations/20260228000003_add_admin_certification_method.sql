-- Migration: Add 'admin' value to rating_certification_method_enum
-- This allows distinguishing between:
--   - proof: Certified via 2+ approved proofs at current rating level
--   - referrals: Certified via 3+ references from certified players
--   - external_rating: Certified via external API integration (USTA, DUPR, UTR)
--   - admin: Certified manually by an administrator
--
-- Note: ALTER TYPE ... ADD VALUE cannot run inside a transaction in PostgreSQL.
-- This migration uses the workaround approach:
-- 1. Create new enum with all values
-- 2. Alter column to use new enum
-- 3. Drop old enum
-- 4. Rename new enum to old name

-- Step 1: Create the new enum type with all values including 'admin'
CREATE TYPE rating_certification_method_enum_new AS ENUM (
  'admin',
  'external_rating',
  'proof',
  'referrals'
);

-- Step 2: Alter the column to use the new enum type
-- First, alter to text, then to new enum (required for safe casting)
ALTER TABLE player_rating_score 
  ALTER COLUMN certified_via TYPE text;

ALTER TABLE player_rating_score 
  ALTER COLUMN certified_via TYPE rating_certification_method_enum_new 
  USING certified_via::rating_certification_method_enum_new;

-- Step 3: Drop the old enum type
DROP TYPE rating_certification_method_enum;

-- Step 4: Rename the new enum to the original name
ALTER TYPE rating_certification_method_enum_new RENAME TO rating_certification_method_enum;

-- Add comment explaining the enum values
COMMENT ON TYPE rating_certification_method_enum IS 
'Methods by which a player rating can be certified:
- admin: Manually certified by an administrator
- external_rating: Imported from external rating API (USTA, DUPR, UTR)
- proof: 2+ approved proofs at current rating level
- referrals: 3+ references from certified players at same/higher level';
