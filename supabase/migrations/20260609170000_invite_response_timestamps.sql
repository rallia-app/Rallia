-- Invite transition timestamps + explicit expiry (spec A1, docs/instrumentation-second-player-commitment.md).
--
-- Today match_participant only stores current `status`, so the largest funnel segment —
-- invitees who never respond (~80% of auto invites) — is invisible, and time-to-respond
-- is unmeasurable. This migration makes invite outcomes first-class:
--   * responded_at — invitee's first reaction to a pending invite (accept, decline, or
--     proposing a new time), stamped by trigger no matter which code path writes it.
--   * expired_at  — pending invite whose match started (or was cancelled) without any
--     response. Stamped by an hourly pg_cron sweep; status stays 'pending' so no
--     consumer logic breaks (read no-response as: status='pending' AND expired_at set).
--   * joined_at   — now reliably stamped on any transition to 'joined' (was 4% populated).

ALTER TABLE public.match_participant
  ADD COLUMN IF NOT EXISTS responded_at timestamptz,
  ADD COLUMN IF NOT EXISTS expired_at timestamptz;

COMMENT ON COLUMN public.match_participant.responded_at IS
  'First invitee response to a pending invite (accept, decline, or time suggestion). Stamped by trg_match_participant_transitions / trg_time_suggestion_responded_at. NULL = never responded.';
COMMENT ON COLUMN public.match_participant.expired_at IS
  'Pending invite that lapsed unanswered (match started or was cancelled). Stamped hourly by expire_stale_match_invites(); status intentionally stays pending.';

-- 1. Stamp transition timestamps on status change, regardless of which caller updates it.
CREATE OR REPLACE FUNCTION public.stamp_match_participant_transitions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'joined' AND NEW.joined_at IS NULL THEN
    NEW.joined_at := now();
  END IF;
  -- Invitee decision on a pending invite (host approvals of self-requests excluded).
  IF OLD.status = 'pending' AND NEW.status IN ('joined', 'declined') AND NEW.responded_at IS NULL THEN
    NEW.responded_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_match_participant_transitions ON public.match_participant;
CREATE TRIGGER trg_match_participant_transitions
  BEFORE UPDATE OF status ON public.match_participant
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.stamp_match_participant_transitions();

-- 2. Proposing a new time is also a response (status stays 'pending' in that flow).
CREATE OR REPLACE FUNCTION public.stamp_invite_responded_on_time_suggestion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE match_participant
  SET responded_at = now()
  WHERE match_id = NEW.match_id
    AND player_id = NEW.suggester_id
    AND status = 'pending'
    AND responded_at IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_time_suggestion_responded_at ON public.match_time_suggestion;
CREATE TRIGGER trg_time_suggestion_responded_at
  AFTER INSERT ON public.match_time_suggestion
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_invite_responded_on_time_suggestion();

-- 3. Best-effort backfill for already-settled invites. updated_at is approximate (any
--    later update overwrites it) but beats NULL for funnel continuity. Hosts and
--    approved self-requesters are excluded — their 'joined' is not an invitee response.
UPDATE public.match_participant
SET responded_at = updated_at
WHERE responded_at IS NULL
  AND is_host = false
  AND requested_at IS NULL
  AND status IN ('joined', 'declined');

-- 4. Expiry sweep: unanswered pending invites whose match started or was cancelled.
CREATE OR REPLACE FUNCTION public.expire_stale_match_invites()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE match_participant mp
  SET expired_at = now()
  FROM match m
  WHERE m.id = mp.match_id
    AND mp.status = 'pending'
    AND mp.expired_at IS NULL
    AND mp.is_host = false
    AND (
      (m.match_date + COALESCE(m.start_time, '23:59'::time))
        AT TIME ZONE COALESCE(m.timezone, 'America/Toronto') < now()
      OR m.cancelled_at IS NOT NULL
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Backfill historical lapsed invites now, then keep current hourly.
SELECT public.expire_stale_match_invites();

SELECT cron.schedule(
  'expire-stale-invites-hourly',
  '20 * * * *',
  $$ SELECT public.expire_stale_match_invites(); $$
);
