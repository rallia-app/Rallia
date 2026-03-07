-- Allow authenticated users to view any player's favorite facilities
-- This enables showing "Preferred Courts" on player profiles

-- Add a policy that allows all authenticated users to SELECT from player_favorite_facility
DROP POLICY IF EXISTS "Users can view all player favorite facilities" ON player_favorite_facility;
CREATE POLICY "Users can view all player favorite facilities"
ON player_favorite_facility
FOR SELECT
TO authenticated
USING (true);
