-- =============================================================================
-- Migration: Fix foreign key constraints blocking account deletion
-- Description: Several FKs reference profile(id) without ON DELETE, defaulting
-- to NO ACTION which blocks the cascade from auth.users -> profile deletion.
-- =============================================================================

-- 1. profile.referred_by -> profile(id): SET NULL on delete
ALTER TABLE public.profile
  DROP CONSTRAINT IF EXISTS profile_referred_by_fkey;
ALTER TABLE public.profile
  ADD CONSTRAINT profile_referred_by_fkey
  FOREIGN KEY (referred_by) REFERENCES public.profile(id) ON DELETE SET NULL;

-- 2. referral_fingerprint.matched_player_id -> profile(id): SET NULL on delete
ALTER TABLE public.referral_fingerprint
  DROP CONSTRAINT IF EXISTS referral_fingerprint_matched_player_id_fkey;
ALTER TABLE public.referral_fingerprint
  ADD CONSTRAINT referral_fingerprint_matched_player_id_fkey
  FOREIGN KEY (matched_player_id) REFERENCES public.profile(id) ON DELETE SET NULL;

-- 3. match_report.reviewed_by -> profile(id): SET NULL on delete
ALTER TABLE public.match_report
  DROP CONSTRAINT IF EXISTS match_report_reviewed_by_fkey;
ALTER TABLE public.match_report
  ADD CONSTRAINT match_report_reviewed_by_fkey
  FOREIGN KEY (reviewed_by) REFERENCES public.profile(id) ON DELETE SET NULL;
