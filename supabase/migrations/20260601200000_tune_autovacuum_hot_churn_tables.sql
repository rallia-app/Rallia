-- Tune per-table autovacuum/autoanalyze on the highest write-churn tables to
-- relieve disk-IO budget pressure.
--
-- Context: prod runs write-bound (IOwait-dominated). The availability refresh
-- pipeline is the top write source. With the default autovacuum thresholds
-- (scale_factor 0.2) these small, hot tables accumulate dead tuples and index
-- bloat between vacuums, which raises the IO cost of every subsequent
-- read/write and feeds the budget-depletion loop. Observed on prod:
--   * facility_availability_snapshot (~5.2k rows): never autovacuumed, dead
--     tuples climbing; 3 actively-used indexes.
--   * player_availability: NEVER autoanalyzed -> planner has no stats (hurts
--     the suggestion/search RPCs); high dead-tuple ratio; ~90% of updates are
--     non-HOT (is_active sits in a partial-index predicate), so each update
--     rewrites all 5 indexes.
--   * facility_refresh_lease: 2 live rows but insert+delete on every refresh.
--   * facility_refresh_log: HOT updates, already healthy; tightened for
--     consistency.
--
-- These tables are small, so frequent vacuums are cheap per run and keep total
-- vacuum IO ~flat while preventing bloat. ALTER TABLE ... SET (reloptions) is a
-- metadata-only change (brief SHARE UPDATE EXCLUSIVE lock; does not block
-- reads/writes and does not rewrite the table).

-- ~5.2k rows, moderate update/delete churn, healthy HOT ratio.
ALTER TABLE public.facility_availability_snapshot SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 50,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_analyze_threshold = 50
);

-- Never autoanalyzed in production; high dead ratio; low HOT-update ratio.
-- Most aggressive analyze cadence so the planner always has fresh stats.
ALTER TABLE public.player_availability SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 50,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_analyze_threshold = 50
);

-- Tiny table with constant insert+delete churn: scale_factor is meaningless at
-- 2 live rows, so drive vacuum/analyze off a low flat threshold to keep dead
-- tuples near zero between refreshes.
ALTER TABLE public.facility_refresh_lease SET (
  autovacuum_vacuum_scale_factor = 0.0,
  autovacuum_vacuum_threshold = 25,
  autovacuum_analyze_scale_factor = 0.0,
  autovacuum_analyze_threshold = 25
);

-- Already healthy (HOT updates); tightened to stay tight.
ALTER TABLE public.facility_refresh_log SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 50,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_analyze_threshold = 50
);
