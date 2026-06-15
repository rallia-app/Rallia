-- =============================================================================
-- Keep profile.last_active_at truthful
--
-- profile.last_active_at was set once at signup (DEFAULT NOW(), initial
-- schema) and never updated by anything, so every read path that treats it as
-- an activity signal was actually reading signup time:
--   - player_activity_score() → suggestion ranking (0.10/0.15 weight): all
--     users >90d tenure scored 0.10 "likely churned" regardless of activity
--   - get_broadcast_recipients p_active_since / p_inactive_before filters
--   - admin dashboard "last active" + group/community member lists
--
-- The app already has a real heartbeat: useUpdateLastSeen writes
-- player.last_seen_at every 2 minutes while the app is foregrounded. This
-- migration mirrors that heartbeat into profile.last_active_at via trigger,
-- throttled to at most one profile write per hour per user so the hot
-- heartbeat path picks up no meaningful write amplification, then backfills
-- existing rows from player.last_seen_at.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_profile_last_active()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profile
  SET last_active_at = NEW.last_seen_at
  WHERE id = NEW.id
    AND (last_active_at IS NULL
         OR last_active_at < NEW.last_seen_at - INTERVAL '1 hour');
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_profile_last_active IS
  'Mirrors player.last_seen_at into profile.last_active_at, throttled to one '
  'profile write per hour per user.';

DROP TRIGGER IF EXISTS trg_sync_profile_last_active ON public.player;
CREATE TRIGGER trg_sync_profile_last_active
AFTER UPDATE OF last_seen_at ON public.player
FOR EACH ROW
WHEN (NEW.last_seen_at IS NOT NULL AND NEW.last_seen_at IS DISTINCT FROM OLD.last_seen_at)
EXECUTE FUNCTION public.sync_profile_last_active();

COMMENT ON COLUMN public.profile.last_active_at IS
  'Last activity, mirrored from the player.last_seen_at heartbeat with up to '
  '1h lag. Before 2026-06-10 this was only set at signup.';

-- One-time backfill: lift profiles to the player heartbeat where it is newer.
UPDATE public.profile pr
SET last_active_at = pl.last_seen_at
FROM public.player pl
WHERE pl.id = pr.id
  AND pl.last_seen_at IS NOT NULL
  AND (pr.last_active_at IS NULL OR pl.last_seen_at > pr.last_active_at);
