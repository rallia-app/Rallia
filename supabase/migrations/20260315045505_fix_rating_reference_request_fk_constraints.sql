-- Migration: Fix rating_reference_request FK constraints and add RLS
-- The requester_id and referee_id columns are missing FK constraints to player(id).
-- Also adds RLS policies for proper access control.

-- ============================================
-- PHASE 0: CLEAN UP ORPHANED/INVALID DATA
-- ============================================

-- Truncate any existing data (likely test data with invalid references/enum values)
-- This is necessary because:
-- 1. Some records have requester_id/referee_id that don't exist in player table
-- 2. Some records may have enum values that were changed
TRUNCATE TABLE rating_reference_request;

-- ============================================
-- PHASE 1: ADD MISSING FK CONSTRAINTS
-- ============================================

-- requester_id references player.id (was missing)
ALTER TABLE rating_reference_request 
  ADD CONSTRAINT rating_reference_request_requester_id_fkey 
  FOREIGN KEY (requester_id) REFERENCES player(id) ON DELETE CASCADE;

-- referee_id references player.id (was missing)
ALTER TABLE rating_reference_request 
  ADD CONSTRAINT rating_reference_request_referee_id_fkey 
  FOREIGN KEY (referee_id) REFERENCES player(id) ON DELETE CASCADE;

-- ============================================
-- PHASE 3: ADD RLS POLICIES (Enable access)
-- ============================================

-- Enable RLS on the table (if not already enabled)
ALTER TABLE rating_reference_request ENABLE ROW LEVEL SECURITY;

-- Policy: Users can see reference requests where they are the requester
CREATE POLICY "Users can view their sent reference requests"
  ON rating_reference_request
  FOR SELECT
  TO authenticated
  USING (requester_id = auth.uid());

-- Policy: Users can see reference requests where they are the referee
CREATE POLICY "Users can view reference requests sent to them"
  ON rating_reference_request
  FOR SELECT
  TO authenticated
  USING (referee_id = auth.uid());

-- Policy: Users can insert reference requests (where they are the requester)
CREATE POLICY "Users can create reference requests"
  ON rating_reference_request
  FOR INSERT
  TO authenticated
  WITH CHECK (requester_id = auth.uid());

-- Policy: Referees can update requests they received (to respond)
CREATE POLICY "Referees can respond to reference requests"
  ON rating_reference_request
  FOR UPDATE
  TO authenticated
  USING (referee_id = auth.uid())
  WITH CHECK (referee_id = auth.uid());

-- Policy: Requesters can delete their own pending requests
CREATE POLICY "Requesters can delete their pending requests"
  ON rating_reference_request
  FOR DELETE
  TO authenticated
  USING (requester_id = auth.uid() AND status = 'pending');

-- ============================================
-- PHASE 4: ADD HELPFUL INDEXES
-- ============================================

-- Ensure indexes exist for performance
CREATE INDEX IF NOT EXISTS idx_rating_reference_request_requester 
  ON rating_reference_request(requester_id);
CREATE INDEX IF NOT EXISTS idx_rating_reference_request_referee 
  ON rating_reference_request(referee_id);
CREATE INDEX IF NOT EXISTS idx_rating_reference_request_status 
  ON rating_reference_request(status);
CREATE INDEX IF NOT EXISTS idx_rating_reference_request_expires 
  ON rating_reference_request(expires_at);
CREATE INDEX IF NOT EXISTS idx_rating_reference_request_player_rating_score 
  ON rating_reference_request(player_rating_score_id);

-- Composite index for common query pattern (referee's pending requests)
CREATE INDEX IF NOT EXISTS idx_rating_reference_request_referee_pending 
  ON rating_reference_request(referee_id, status) WHERE status = 'pending';

COMMENT ON TABLE rating_reference_request IS 
  'Requests for players to validate another player''s declared rating level. '
  'A requester asks a referee (another player at same or higher level) to confirm their rating.';
