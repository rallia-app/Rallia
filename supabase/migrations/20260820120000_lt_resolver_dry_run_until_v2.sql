-- ============================================================================
-- Park the tournament deadline resolver in DRY-RUN until evidence model v2.
-- ============================================================================
-- The Série 1 census (prod, 2026-08-19) showed 40% of playable pairings had
-- ZERO in-app scheduling signals; at least a third of those still played a
-- real game and the rest, organizer-keyed, cannot be told apart from advances:
-- players arrange by text and enter nothing. The live ladder's effort split
-- (lt_side_effort: votes / posted card / messages) reads exactly those
-- pairings as no-effort-both-sides and would double-walkover them at the
-- deadline, with reputation hits, on paid draws (Série 2 is paid).
--
-- Spec: specs/17-leagues-tournaments/autonomous-advancement.md replaces the
-- effort split with a resolution order gated on delivered-and-acknowledged
-- evidence. Until that ships, the resolver runs in dry-run: it audits every
-- decision it WOULD take (actions prefixed 'dryrun_') without acting, which
-- turns the Série 2 pool phase into the v2 validation dataset the spec's
-- rollout step 3 calls for.
--
-- Deliberately unchanged: the T-48h/T-12h player nudges (separate cron) and
-- the organizer gate nudges keep firing; the organizer settles stragglers
-- manually at the deadline, as in Série 1. Dry-run also skips grace and
-- extension stamping, which is safe because nothing penalizing fires either.
-- Revert = reschedule with (false) when resolution order v2 goes live.
-- ============================================================================

SELECT cron.unschedule('lt-tournament-deadline-resolver')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lt-tournament-deadline-resolver');

SELECT cron.schedule(
  'lt-tournament-deadline-resolver',
  '*/15 * * * *',
  $$ SELECT public.lt_resolve_due_tournament_matches(true); $$
);
