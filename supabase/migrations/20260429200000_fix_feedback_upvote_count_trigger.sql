-- Make the upvote_count maintenance trigger run with elevated privileges so it
-- can update public.feedback regardless of the caller's RLS visibility. Without
-- SECURITY DEFINER, the trigger runs as `authenticated`, which has no UPDATE
-- policy on feedback, so the counter UPDATE silently affects 0 rows. The vote
-- row is still persisted (the user appears voted), but the count stays at 0
-- and snaps back on the next refetch.

CREATE OR REPLACE FUNCTION sync_feedback_upvote_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

-- Backfill counts that should already exist (no-op if all rows are 0).
UPDATE public.feedback f
   SET upvote_count = sub.cnt
  FROM (
    SELECT feedback_id, COUNT(*)::INTEGER AS cnt
    FROM public.feedback_vote
    GROUP BY feedback_id
  ) sub
 WHERE f.id = sub.feedback_id
   AND f.upvote_count IS DISTINCT FROM sub.cnt;
