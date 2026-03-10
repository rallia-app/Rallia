-- Migration: Add network_favorite_facility table for community favorite facilities feature
-- This allows communities to store unlimited favorite facilities (unlike player favorites which are limited to 3)
-- Only moderators/owners can manage favorite facilities
-- Facilities must belong to the same sport as the community (or both sports if community has no sport)
-- Created: 2025-03-10

-- Create the network_favorite_facility table
CREATE TABLE IF NOT EXISTS network_favorite_facility (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id UUID NOT NULL REFERENCES network(id) ON DELETE CASCADE,
  facility_id UUID NOT NULL REFERENCES facility(id) ON DELETE CASCADE,
  display_order INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Each network can only favorite a facility once
  CONSTRAINT network_favorite_facility_unique UNIQUE(network_id, facility_id),
  -- Display order must be positive
  CONSTRAINT network_favorite_facility_order_check CHECK (display_order >= 1)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_network_favorite_facility_network_id ON network_favorite_facility(network_id);
CREATE INDEX IF NOT EXISTS idx_network_favorite_facility_facility_id ON network_favorite_facility(facility_id);

-- Enable RLS
ALTER TABLE network_favorite_facility ENABLE ROW LEVEL SECURITY;

-- RLS Policies (drop first for idempotency when re-running migration)
DROP POLICY IF EXISTS "Anyone can view network favorite facilities" ON network_favorite_facility;
DROP POLICY IF EXISTS "Moderators can insert network favorite facilities" ON network_favorite_facility;
DROP POLICY IF EXISTS "Moderators can update network favorite facilities" ON network_favorite_facility;
DROP POLICY IF EXISTS "Moderators can delete network favorite facilities" ON network_favorite_facility;

-- Helper function: is_network_moderator already exists from previous migrations
-- No need to recreate it - it checks if a player is moderator/owner of a network

-- Anyone authenticated can view network favorite facilities (for display in community)
CREATE POLICY "Anyone can view network favorite facilities"
  ON network_favorite_facility FOR SELECT
  TO authenticated
  USING (true);

-- Only moderators/owners can insert favorite facilities
CREATE POLICY "Moderators can insert network favorite facilities"
  ON network_favorite_facility FOR INSERT
  TO authenticated
  WITH CHECK (is_network_moderator(network_id, auth.uid()));

-- Only moderators/owners can update favorite facilities
CREATE POLICY "Moderators can update network favorite facilities"
  ON network_favorite_facility FOR UPDATE
  TO authenticated
  USING (is_network_moderator(network_id, auth.uid()));

-- Only moderators/owners can delete favorite facilities
CREATE POLICY "Moderators can delete network favorite facilities"
  ON network_favorite_facility FOR DELETE
  TO authenticated
  USING (is_network_moderator(network_id, auth.uid()));

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_network_favorite_facility_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS network_favorite_facility_updated_at ON network_favorite_facility;
CREATE TRIGGER network_favorite_facility_updated_at
  BEFORE UPDATE ON network_favorite_facility
  FOR EACH ROW
  EXECUTE FUNCTION update_network_favorite_facility_updated_at();

-- Comment on table
COMMENT ON TABLE network_favorite_facility IS 'Junction table linking communities/networks to their favorite facilities (unlimited). Managed by moderators/owners.';
COMMENT ON COLUMN network_favorite_facility.display_order IS 'Order of display, allows moderators to prioritize favorites';

-- Grant permissions
GRANT SELECT ON network_favorite_facility TO authenticated;
GRANT INSERT, UPDATE, DELETE ON network_favorite_facility TO authenticated;
