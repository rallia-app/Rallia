-- =============================================================================
-- Phase 1.5 — Drop duplicate indexes.
--
-- Each pair below indexes the same column(s) with the same uniqueness/order.
-- Postgres maintains every index on every write, so each duplicate pair costs
-- WAL twice for no read benefit. For each pair we keep the constraint-backed
-- side (or the one with active scans) and drop the redundant sibling.
--
-- Verified via pg_constraint.conindid and pg_stat_user_indexes on prod
-- (see chat log 2026-05-18).
--
-- Uses plain DROP INDEX (not CONCURRENTLY): the Supabase CLI wraps migrations
-- in a transaction, which CONCURRENTLY forbids. Drops are catalog-only and
-- complete in milliseconds. IF EXISTS keeps this idempotent if already applied
-- via psql.
-- =============================================================================

DROP INDEX IF EXISTS public.idx_court_sports_unique;        -- 0 scans; keep uq_court_sports_court_sport (5.9M scans)
DROP INDEX IF EXISTS public.uq_facility_images_storage_key; -- keep facility_images_storage_key_key (UNIQUE constraint)
DROP INDEX IF EXISTS public.uq_files_storage_key;           -- keep files_storage_key_key (UNIQUE constraint)
DROP INDEX IF EXISTS public.invitations_token_idx;          -- keep invitations_token_key (UNIQUE constraint)
DROP INDEX IF EXISTS public.uq_play_attributes_sport_name;  -- keep play_attribute_sport_id_name_key (UNIQUE)
DROP INDEX IF EXISTS public.uq_play_styles_sport_name;      -- keep play_style_sport_id_name_key (UNIQUE)

-- rating_reference_request: old short-name set, replaced by idx_rating_reference_request_* (active).
DROP INDEX IF EXISTS public.idx_rating_ref_requests_expires;
DROP INDEX IF EXISTS public.idx_rating_ref_requests_score;
DROP INDEX IF EXISTS public.idx_rating_ref_requests_referee;
DROP INDEX IF EXISTS public.idx_rating_ref_requests_requester;
DROP INDEX IF EXISTS public.idx_rating_ref_requests_status;
