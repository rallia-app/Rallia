-- =============================================================================
-- Migration: Fix remaining FK constraints blocking account deletion
-- Description: FKs referencing player(id) and admin(id) with NO ACTION block
-- the cascade chain auth.users -> profile -> player/admin -> dependent tables.
-- =============================================================================

-- ---- FKs referencing player(id) ----

-- match_result.submitted_by -> player(id): SET NULL on delete
ALTER TABLE public.match_result
  DROP CONSTRAINT IF EXISTS match_result_submitted_by_fkey;
ALTER TABLE public.match_result
  ADD CONSTRAINT match_result_submitted_by_fkey
  FOREIGN KEY (submitted_by) REFERENCES public.player(id) ON DELETE SET NULL;

-- match_result.confirmed_by -> player(id): SET NULL on delete
ALTER TABLE public.match_result
  DROP CONSTRAINT IF EXISTS match_result_confirmed_by_fkey;
ALTER TABLE public.match_result
  ADD CONSTRAINT match_result_confirmed_by_fkey
  FOREIGN KEY (confirmed_by) REFERENCES public.player(id) ON DELETE SET NULL;

-- match_result.rebuttal_submitted_by -> player(id): SET NULL on delete
ALTER TABLE public.match_result
  DROP CONSTRAINT IF EXISTS match_result_rebuttal_submitted_by_fkey;
ALTER TABLE public.match_result
  ADD CONSTRAINT match_result_rebuttal_submitted_by_fkey
  FOREIGN KEY (rebuttal_submitted_by) REFERENCES public.player(id) ON DELETE SET NULL;

-- score_confirmation.player_id -> player(id): CASCADE on delete
ALTER TABLE public.score_confirmation
  DROP CONSTRAINT IF EXISTS score_confirmation_player_id_fkey;
ALTER TABLE public.score_confirmation
  ADD CONSTRAINT score_confirmation_player_id_fkey
  FOREIGN KEY (player_id) REFERENCES public.player(id) ON DELETE CASCADE;

-- ---- FKs referencing admin(id) ----

-- admin_alert.read_by -> admin(id): SET NULL on delete
ALTER TABLE public.admin_alert
  DROP CONSTRAINT IF EXISTS admin_alert_read_by_fkey;
ALTER TABLE public.admin_alert
  ADD CONSTRAINT admin_alert_read_by_fkey
  FOREIGN KEY (read_by) REFERENCES public.admin(id) ON DELETE SET NULL;

-- admin_alert.dismissed_by -> admin(id): SET NULL on delete
ALTER TABLE public.admin_alert
  DROP CONSTRAINT IF EXISTS admin_alert_dismissed_by_fkey;
ALTER TABLE public.admin_alert
  ADD CONSTRAINT admin_alert_dismissed_by_fkey
  FOREIGN KEY (dismissed_by) REFERENCES public.admin(id) ON DELETE SET NULL;
