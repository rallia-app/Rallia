-- Migration: Add feedback visibility and upvotes
-- Description: Enables users to browse and upvote public bug/feature reports.
--   - Adds visibility/hidden_at/upvote_count columns to feedback
--   - Auto-promotes new bug/feature submissions to public via trigger
--   - Creates feedback_vote table with RLS and counter trigger
--   - Extends feedback SELECT policy so authenticated users can read
--     non-hidden public bug/feature rows

-- =============================================================================
-- 1. FEEDBACK COLUMNS
-- =============================================================================

ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'
  CHECK (visibility IN ('private', 'public'));

ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS upvote_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_feedback_public_sort
  ON public.feedback(category, upvote_count DESC, created_at DESC)
  WHERE visibility = 'public' AND hidden_at IS NULL;

-- =============================================================================
-- 2. AUTO-PROMOTE BUG/FEATURE TO PUBLIC ON INSERT
-- =============================================================================

CREATE OR REPLACE FUNCTION set_feedback_default_visibility()
RETURNS TRIGGER AS $$
BEGIN
  -- Only override the default; respect explicit caller value of 'public'.
  IF NEW.visibility = 'private' AND NEW.category IN ('bug', 'feature') THEN
    NEW.visibility := 'public';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_feedback_default_visibility ON public.feedback;
CREATE TRIGGER trg_feedback_default_visibility
  BEFORE INSERT ON public.feedback
  FOR EACH ROW
  EXECUTE FUNCTION set_feedback_default_visibility();

-- =============================================================================
-- 3. FEEDBACK VOTE TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.feedback_vote (
  feedback_id UUID NOT NULL REFERENCES public.feedback(id) ON DELETE CASCADE,
  player_id   UUID NOT NULL REFERENCES public.player(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (feedback_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_vote_player
  ON public.feedback_vote(player_id);

-- =============================================================================
-- 4. KEEP upvote_count IN SYNC
-- =============================================================================

CREATE OR REPLACE FUNCTION sync_feedback_upvote_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.feedback
       SET upvote_count = upvote_count + 1
     WHERE id = NEW.feedback_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.feedback
       SET upvote_count = GREATEST(upvote_count - 1, 0)
     WHERE id = OLD.feedback_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_feedback_vote_count ON public.feedback_vote;
CREATE TRIGGER trg_feedback_vote_count
  AFTER INSERT OR DELETE ON public.feedback_vote
  FOR EACH ROW
  EXECUTE FUNCTION sync_feedback_upvote_count();

-- =============================================================================
-- 5. ROW LEVEL SECURITY
-- =============================================================================

-- Allow authenticated users to read public, non-hidden bug/feature rows.
DROP POLICY IF EXISTS "Authenticated can read public feedback" ON public.feedback;
CREATE POLICY "Authenticated can read public feedback"
  ON public.feedback
  FOR SELECT
  TO authenticated
  USING (
    visibility = 'public'
    AND hidden_at IS NULL
    AND category IN ('bug', 'feature')
  );

ALTER TABLE public.feedback_vote ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view all votes" ON public.feedback_vote;
CREATE POLICY "Users can view all votes"
  ON public.feedback_vote
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Users can insert their own vote" ON public.feedback_vote;
CREATE POLICY "Users can insert their own vote"
  ON public.feedback_vote
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = player_id);

DROP POLICY IF EXISTS "Users can delete their own vote" ON public.feedback_vote;
CREATE POLICY "Users can delete their own vote"
  ON public.feedback_vote
  FOR DELETE
  TO authenticated
  USING (auth.uid() = player_id);

DROP POLICY IF EXISTS "Service role full access on votes" ON public.feedback_vote;
CREATE POLICY "Service role full access on votes"
  ON public.feedback_vote
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- 6. GRANTS
-- =============================================================================

GRANT SELECT, INSERT, DELETE ON public.feedback_vote TO authenticated;
GRANT ALL ON public.feedback_vote TO service_role;
