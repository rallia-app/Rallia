-- =============================================================================
-- Lower fillfactor on `player` so heartbeat UPDATEs (last_seen_at) stay HOT.
--
-- HOT updates rewrite the row in place without touching any indexes, which is
-- the single biggest WAL reduction available for the heartbeat hot path.
-- Conditions for a HOT update:
--   1. No indexed column is being modified  -> handled by dropping
--      idx_player_last_seen_at in the prior migration.
--   2. The new tuple fits on the same page  -> needs free space, i.e. fillfactor
--      below 100.
--
-- Existing rows will pick up the new fillfactor naturally as they are updated;
-- no VACUUM FULL is required for such a small table (56 kB, ~210 live rows).
-- =============================================================================

ALTER TABLE public.player SET (fillfactor = 80);
