-- ============================================================================
-- Série 1 — make sure the regional draws land with registration OPEN
-- ----------------------------------------------------------------------------
-- 20260725150000 gives the nine regional draws the status the three originals
-- had, so that it works on any environment without hardcoding one. That is
-- correct right up until the moment the old deadline passes.
--
-- The originals close on 2026-07-28 03:59Z, and the cron
-- lt-close-tournament-registration runs every 15 minutes flipping any due
-- tournament to 'registration_closed'. If the split lands after that, all nine
-- draws inherit 'registration_closed' while advertising the new 2026-08-01
-- deadline: registration silently refused, nine tournaments to reopen by hand,
-- right after telling every player their spot was moved for them.
--
-- So: reopen any Série 1 draw whose registration window is genuinely still
-- open. A no-op in the common case where the split already produced open draws.
--
-- Deliberately a separate migration rather than an edit to 20260725150000,
-- which is already applied on staging.
--
-- Reopening fires no notification: notify_tournament_lifecycle only speaks on
-- registration_closed -> in_progress, on cancellation, on completion, or on a
-- date/venue change at unchanged status. None of those match.
-- ============================================================================

UPDATE public.tournaments
   SET status     = 'registration_open',
       updated_at = now()
 WHERE name LIKE 'Série 1 %'
   AND status = 'registration_closed'
   AND registration_closes_at > now()
   AND start_date > now()
   AND bracket_locked_at IS NULL
   AND cancelled_at IS NULL
   AND archived_at IS NULL;
