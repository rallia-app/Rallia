-- Allow match participants to view all score confirmations for their matches.
-- Previously only player_id = auth.uid() was allowed, which prevented the UI
-- from showing accurate confirmation progress in doubles matches.

-- Drop the restrictive SELECT policy
DROP POLICY IF EXISTS "Players can view their own confirmations" ON score_confirmation;

-- Create a broader policy: participants can see all confirmations for matches they're in
CREATE POLICY "Participants can view match score confirmations"
  ON score_confirmation FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM match_result mr
      JOIN match_participant mp ON mp.match_id = mr.match_id
      WHERE mr.id = score_confirmation.match_result_id
        AND mp.player_id = auth.uid()
        AND mp.status = 'joined'
    )
  );
