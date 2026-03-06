-- Grant anon role access to get_reputation_summary so reputation badges
-- are visible to signed-out users. The function is SECURITY DEFINER,
-- so it safely bypasses RLS and only returns aggregated reputation data.
GRANT EXECUTE ON FUNCTION get_reputation_summary(UUID) TO anon;

-- Allow anon users to read public reputations from player_reputation.
-- This is needed because match detail queries join player_reputation via
-- PostgREST, and without this policy the join returns null for anon users,
-- hiding the "most wanted" ribbon badge on participant avatars.
DROP POLICY IF EXISTS "player_reputation_read_public_anon" ON player_reputation;
CREATE POLICY "player_reputation_read_public_anon" ON player_reputation
    FOR SELECT
    TO anon
    USING (is_public = true);
