-- =============================================================================
-- Invite-all follow-through: cleanup when a spot actually fills.
--
-- With auto matches broadcasting invites to every eligible opponent
-- (20260609185000), the first acceptance wins. Two cleanups keep that honest:
--
--   1. Auto match reaches capacity → void its unanswered 'pending' invites
--      (status → 'cancelled', the same state host-cancelled invitations use).
--      The invite stops being actionable everywhere pending is surfaced, the
--      second accepter never lands on a dead match, and get_auto_invite_funnel
--      already excludes status='cancelled' from its denominators.
--
--   2. The accepter's own overlapping, still-unfilled auto-generated matches
--      are redundant placeholders once they've committed to play that slot —
--      cancel them so they stop competing for the same opponent pool. (Their
--      lapsed pendings get expired_at from the hourly expire_stale_match_invites
--      sweep, which already treats cancelled matches.)
--
-- Trigger scope: non-host rows landing on 'joined' (INSERT covers direct open
-- joins; UPDATE covers invite accepts and approved requests). Host self-rows
-- from match creation are excluded — generation deliberately lets a host's own
-- sports share one hour, so a host row must never cancel sibling auto matches.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.match_fill_cleanup_on_join()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match    record;
  v_capacity int;
  v_joined   int;
BEGIN
  SELECT mt.format, mt.match_date, mt.start_time, mt.end_time,
         mt.is_auto_generated, mt.cancelled_at
    INTO v_match
    FROM public.match mt
   WHERE mt.id = NEW.match_id;
  IF NOT FOUND OR v_match.cancelled_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- 1. Auto match at capacity → void unanswered invites.
  IF v_match.is_auto_generated THEN
    v_capacity := CASE WHEN v_match.format = 'doubles' THEN 4 ELSE 2 END;
    SELECT count(*) INTO v_joined
      FROM public.match_participant mp
     WHERE mp.match_id = NEW.match_id AND mp.status = 'joined';
    IF v_joined >= v_capacity THEN
      UPDATE public.match_participant mp
         SET status = 'cancelled'
       WHERE mp.match_id = NEW.match_id
         AND mp.status = 'pending'
         AND mp.is_host = FALSE;
    END IF;
  END IF;

  -- 2. Cancel the accepter's own redundant solo auto matches in this slot.
  UPDATE public.match m
     SET cancelled_at = now()
   WHERE m.created_by = NEW.player_id
     AND m.is_auto_generated = TRUE
     AND m.cancelled_at IS NULL
     AND m.id <> NEW.match_id
     AND m.match_date = v_match.match_date
     AND m.start_time < v_match.end_time
     AND m.end_time   > v_match.start_time
     AND NOT EXISTS (
       SELECT 1 FROM public.match_participant mpx
        WHERE mpx.match_id = m.id
          AND mpx.status = 'joined'
          AND mpx.player_id <> NEW.player_id
     );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_match_fill_cleanup_on_join ON public.match_participant;
CREATE TRIGGER trg_match_fill_cleanup_on_join
  AFTER INSERT OR UPDATE OF status ON public.match_participant
  FOR EACH ROW
  WHEN (NEW.status = 'joined' AND NOT NEW.is_host)
  EXECUTE FUNCTION public.match_fill_cleanup_on_join();

COMMENT ON FUNCTION public.match_fill_cleanup_on_join() IS
  'On a non-host participant landing as joined: voids remaining pending '
  'invites once an auto match hits capacity (status -> cancelled), and '
  'cancels the joiner''s own overlapping still-unfilled auto-generated '
  'matches. Idempotent; re-fires on joined->joined no-op updates.';
