-- ============================================================================
-- Migration: Momentum experiment foundation (bucketing + rollout + holdout)
-- Created: 2026-08-05
-- Description: Momentum harvesting item 11. Deterministic per-user bucketing
--              with remote-config rollout for every momentum notification
--              type, without a flag platform:
--
--   - momentum_bucket(user, key) -> 0..99, a pure hash. Analysts can compute
--     it offline from user_id alone, so holdout-vs-treated comparisons need
--     no send-time stamping (join notification_sent / match_joined by user).
--   - admin_settings rows momentum_<type> = {"enabled": bool,
--     "rollout_pct": 0..100}, editable at runtime via update_admin_setting
--     (super_admin RPC) as kill switch and rollout dial. A rollout_pct of 90
--     creates a stable 10% holdout for measurement.
--   - One BEFORE INSERT trigger on notification enforces the gate uniformly
--     for all momentum types: sweeps stay unchanged, holdout users get no
--     row (no push, no in-app entry), and per-match "once ever" markers
--     still stamp, so a holdout user is not retried match by match.
--
-- Default config ships enabled at 100% (no holdout) so behavior is unchanged
-- until the rollout dial is deliberately turned.
-- ============================================================================

-- 1. Deterministic bucket 0..99
CREATE OR REPLACE FUNCTION public.momentum_bucket(p_user uuid, p_key text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (abs(hashtextextended(p_key || ':' || p_user::text, 42)) % 100)::int;
$$;

-- 2. Config lookup + gate decision
CREATE OR REPLACE FUNCTION public.momentum_enabled_for(p_user uuid, p_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg jsonb;
BEGIN
  SELECT value INTO v_cfg FROM public.admin_settings WHERE key = 'momentum_' || p_key;
  IF v_cfg IS NULL THEN
    RETURN true;  -- unconfigured type: fail open
  END IF;
  IF NOT COALESCE((v_cfg->>'enabled')::boolean, true) THEN
    RETURN false;
  END IF;
  RETURN public.momentum_bucket(p_user, p_key)
       < COALESCE((v_cfg->>'rollout_pct')::int, 100);
END;
$$;

REVOKE ALL ON FUNCTION public.momentum_enabled_for(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.momentum_bucket(uuid, text) TO authenticated, service_role;

-- 3. Uniform gate on the notification pipeline
CREATE OR REPLACE FUNCTION public.tg_momentum_notification_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.momentum_enabled_for(NEW.user_id, NEW.type::text) THEN
    RETURN NULL;  -- silently skip: no row, no push, no in-app entry
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS momentum_notification_gate ON public.notification;
CREATE TRIGGER momentum_notification_gate
  BEFORE INSERT ON public.notification
  FOR EACH ROW
  WHEN (NEW.type IN (
    'court_booking_nudge',
    'match_last_minute_spots',
    'match_unfilled_recovery',
    'play_rhythm_nudge',
    'tournament_registration_open'
  ))
  EXECUTE FUNCTION public.tg_momentum_notification_gate();

-- 4. Seed config rows (enabled, full rollout: behavior unchanged until dialed)
INSERT INTO public.admin_settings (key, value, description)
VALUES
  ('momentum_court_booking_nudge',
   '{"enabled": true, "rollout_pct": 100}',
   'Momentum item 5: book-your-court nudge. rollout_pct < 100 creates a stable holdout.'),
  ('momentum_match_last_minute_spots',
   '{"enabled": true, "rollout_pct": 100}',
   'Momentum item 6: last-minute open-spots push. rollout_pct < 100 creates a stable holdout.'),
  ('momentum_match_unfilled_recovery',
   '{"enabled": true, "rollout_pct": 100}',
   'Momentum item 7: unfilled-host recovery. rollout_pct < 100 creates a stable holdout.'),
  ('momentum_play_rhythm_nudge',
   '{"enabled": true, "rollout_pct": 100}',
   'Momentum item 8: play-rhythm gap nudge. rollout_pct < 100 creates a stable holdout.'),
  ('momentum_tournament_registration_open',
   '{"enabled": true, "rollout_pct": 100}',
   'Momentum item 9: tournament registration-open fan-out. Keep at 100 unless testing.')
ON CONFLICT (key) DO NOTHING;
