-- ============================================================================
-- The resolver comes out of dry-run.
-- ============================================================================
-- 20260820120000 parked it because the ladder read chat and would have
-- double-walkovered the 40 % of Série 1 pairings that carried no in-app
-- signals, a third of which were really played. That ladder is gone: since
-- 20260831130000 the decision reads gate answers, hours, bookings and
-- check-ins, and it ACTS only on events running the scheduling funnel.
--
-- That last clause is what makes this safe rather than brave. An event without
-- the funnel has no gate answers, so every side scores U; those events keep
-- being audited under the dryrun_ prefix and are never acted on, whatever this
-- cron passes. Série 2, which is live, paid, and NOT on the funnel, is
-- therefore untouched by this change: its pools will still be settled by hand.
--
-- Revert = reschedule with (true), which forces audit-only everywhere.
-- ============================================================================

SELECT cron.unschedule('lt-tournament-deadline-resolver')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lt-tournament-deadline-resolver');

SELECT cron.schedule(
  'lt-tournament-deadline-resolver',
  '*/15 * * * *',
  $$ SELECT public.lt_resolve_due_tournament_matches(false); $$
);
