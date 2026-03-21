-- =============================================================================
-- Migration: Drop unused tables
-- Description: Remove tables that are not referenced anywhere in app code,
--              edge functions, or DB triggers/functions.
-- =============================================================================

-- player_review: Planned feature never implemented. Zero references in
-- apps/, packages/, or supabase/functions/.
DROP TABLE IF EXISTS public.player_review CASCADE;

-- verification_code: Not used by the app. A previous migration
-- (20260131100000_drop_unused_verification_code_table) already attempted removal.
DROP TABLE IF EXISTS public.verification_code CASCADE;
