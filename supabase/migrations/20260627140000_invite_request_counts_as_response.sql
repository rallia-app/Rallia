-- Invited players on request-to-join matches now go pending -> requested (host
-- must approve) instead of pending -> joined. That transition is still a genuine
-- response to the invite, so stamp responded_at on it too — otherwise these
-- invitees look non-responsive in the invite funnel / responsiveness indicator.
-- (Host approval of the resulting self-request, requested -> joined, stays excluded.)

CREATE OR REPLACE FUNCTION public.stamp_match_participant_transitions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'joined' AND NEW.joined_at IS NULL THEN
    NEW.joined_at := now();
  END IF;
  -- Invitee decision on a pending invite (host approvals of self-requests excluded).
  IF OLD.status = 'pending'
     AND NEW.status IN ('joined', 'declined', 'requested')
     AND NEW.responded_at IS NULL THEN
    NEW.responded_at := now();
  END IF;
  RETURN NEW;
END;
$$;
