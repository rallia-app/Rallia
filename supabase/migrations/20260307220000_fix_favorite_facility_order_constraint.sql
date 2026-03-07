-- Migration: Fix player_favorite_facility display_order constraint
-- Problem: Constraint limited display_order to 1-3, but users playing both sports
-- may have more than 3 favorite facilities (some facilities serve both tennis and pickleball)
-- Solution: Remove the upper limit, keep only minimum of 1

-- Drop the existing constraint
ALTER TABLE public.player_favorite_facility
DROP CONSTRAINT IF EXISTS player_favorite_facility_order_check;

-- Add new constraint with no upper limit (only positive integers)
ALTER TABLE public.player_favorite_facility
ADD CONSTRAINT player_favorite_facility_order_check 
CHECK (display_order >= 1);

-- Comment explaining the change
COMMENT ON COLUMN public.player_favorite_facility.display_order IS 
'Order in which favorite facilities are displayed. Must be >= 1. No upper limit since users playing both tennis and pickleball may have 6+ favorites (3+ per sport, with some facilities serving both).';
