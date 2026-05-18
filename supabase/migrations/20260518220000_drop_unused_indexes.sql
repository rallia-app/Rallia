-- =============================================================================
-- Drop unused / redundant indexes to reduce write amplification and WAL volume.
--
-- Selected from pg_stat_user_indexes where idx_scan was 0–10 over the current
-- pg_stat_statements window. Each removed index lowers WAL bytes and dirtied
-- pages on every INSERT and non-HOT UPDATE to its table.
--
-- Notable redundancies confirmed via pg_indexes:
--   idx_notifications_user_id (user_id) is fully covered by
--   idx_notifications_user_read (user_id, read_at) — the planner can use the
--   leading column of the composite.
--
-- IMPORTANT: DROP INDEX CONCURRENTLY cannot run inside a transaction block.
-- Apply this migration with psql directly (not wrapped):
--   psql "$DB_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/migrations/20260518220000_drop_unused_indexes.sql
-- =============================================================================

-- match (15 indexes for ~450 live rows; only 2.3% HOT updates)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_match_format;            -- 0 scans
DROP INDEX CONCURRENTLY IF EXISTS public.idx_match_location_gist;     -- 0 scans (GiST, expensive)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_match_cancelled_at;      -- 1 scan
DROP INDEX CONCURRENTLY IF EXISTS public.idx_match_timezone;          -- 8 scans

-- notification (10 indexes; 0% HOT updates)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_notification_scheduled;     -- 0 scans
DROP INDEX CONCURRENTLY IF EXISTS public.idx_notifications_expires_at;   -- 0 scans
DROP INDEX CONCURRENTLY IF EXISTS public.idx_notification_organization;  -- 0 scans
DROP INDEX CONCURRENTLY IF EXISTS public.idx_notifications_type;         -- 1 scan
DROP INDEX CONCURRENTLY IF EXISTS public.idx_notification_priority;      -- 10 scans
DROP INDEX CONCURRENTLY IF EXISTS public.idx_notifications_user_id;      -- redundant: covered by (user_id, read_at)

-- player (8 indexes; 28.7% HOT — last_seen_at heartbeat is hot path)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_player_playing_hand;        -- 0 scans
DROP INDEX CONCURRENTLY IF EXISTS public.idx_player_city;                -- 1 scan
DROP INDEX CONCURRENTLY IF EXISTS public.idx_player_reputation_score;    -- 3 scans
-- idx_player_last_seen_at indexes the column being heartbeat-updated. Dropping
-- it lets the UPDATE qualify for HOT, which keeps writes inside the existing
-- heap page and skips all index WAL for that row.
DROP INDEX CONCURRENTLY IF EXISTS public.idx_player_last_seen_at;        -- 164 scans, blocks HOT

-- message: GIN on search_vector, never used. GIN is the costliest index kind
-- to maintain on writes.
DROP INDEX CONCURRENTLY IF EXISTS public.idx_message_search;             -- 0 scans
