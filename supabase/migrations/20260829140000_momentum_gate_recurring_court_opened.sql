-- ============================================================================
-- Migration: Put recurring_court_opened behind the momentum gate
-- Created: 2026-08-29
-- Description: Every other host-facing nudge sits behind the momentum gate, so
--              it has a runtime kill switch and a rollout dial via
--              admin_settings. recurring_court_opened shipped without one,
--              which meant the only way to stop it was a migration.
--
--              That dial is not decoration: match_last_minute_spots and
--              play_rhythm_nudge are both currently switched off through it.
--              A brand new push type is exactly the one you most want to be
--              able to turn off without a deploy.
--
--              Trigger type list copied from the latest definition
--              (20260816220100) with the new type appended. Seeded enabled at
--              100%, so behaviour is unchanged until the dial is turned.
-- ============================================================================

DROP TRIGGER IF EXISTS momentum_notification_gate ON public.notification;
CREATE TRIGGER momentum_notification_gate
  BEFORE INSERT ON public.notification
  FOR EACH ROW
  WHEN (NEW.type IN (
    'court_booking_nudge',
    'match_last_minute_spots',
    'match_unfilled_recovery',
    'play_rhythm_nudge',
    'tournament_registration_open',
    'tournament_registration_closing_soon',
    'recurring_court_opened'
  ))
  EXECUTE FUNCTION public.tg_momentum_notification_gate();

INSERT INTO public.admin_settings (key, value, description)
VALUES
  ('momentum_recurring_court_opened',
   '{"enabled": true, "rollout_pct": 100}',
   'Recurring games: courts-just-opened alert to the host. rollout_pct < 100 creates a stable holdout.')
ON CONFLICT (key) DO NOTHING;
