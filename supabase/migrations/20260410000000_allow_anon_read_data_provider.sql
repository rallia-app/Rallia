-- Migration: Allow anonymous users to read active data providers
-- This enables signed-out users to see court availability on facility cards
-- and the facility detail screen. The slot press action is still guarded
-- by auth/onboarding in the mobile app.

CREATE POLICY "Anonymous users can read active data providers"
ON data_provider
FOR SELECT
TO anon
USING (is_active = TRUE);
