-- =============================================================================
-- Don't notify players for auto-generated matches.
--
-- The weekly check-in auto-creates open matches (is_auto_generated = TRUE) —
-- potentially several per player per week (one per available day, per sport).
-- The on-create notification triggers fan a push out to every nearby player
-- and every group member on each insert, which would spam users with
-- notifications for synthetic matches that may never fill.
--
-- Gate both create-time notify triggers with a WHEN clause so their functions
-- never fire for auto-generated matches. Manually-created matches
-- (is_auto_generated = FALSE or NULL) are unaffected. The host-participant and
-- match-chat triggers are intentionally left as-is.
-- =============================================================================

DROP TRIGGER IF EXISTS match_notify_nearby_players_on_create ON public.match;
CREATE TRIGGER match_notify_nearby_players_on_create
  AFTER INSERT ON public.match
  FOR EACH ROW
  WHEN (NEW.is_auto_generated IS DISTINCT FROM TRUE)
  EXECUTE FUNCTION public.notify_nearby_players_on_match_created();

DROP TRIGGER IF EXISTS match_notify_group_members_on_create ON public.match;
CREATE TRIGGER match_notify_group_members_on_create
  AFTER INSERT ON public.match
  FOR EACH ROW
  WHEN (NEW.is_auto_generated IS DISTINCT FROM TRUE)
  EXECUTE FUNCTION public.notify_group_members_on_match_created();
