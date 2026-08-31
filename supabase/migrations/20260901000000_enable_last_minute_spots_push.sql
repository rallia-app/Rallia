-- ============================================================================
-- Re-enable the last-minute open-spots push, at a 25% canary
--
-- This reverses the product decision recorded in
-- 20260807140000_disable_last_minute_spots_push. That migration gave two
-- reasons for switching the lane off, and only one of them still holds.
--
-- Reason 2, resolved: "it shares the 3-per-7-days discovery budget with the
-- existing nearby-game pushes, so it competed with them for the same slots."
-- 20260831170000 gave the lane its own budget. Replaying the live gate stack
-- against production for the 129 eligible matches since 2026-08-05, 3,923
-- candidate slots passed reach and rating and 64% were blocked purely by the
-- shared count. That competition is gone.
--
-- Reason 1, partly holds but is smaller than it looked: "its reachable audience
-- was very small once both gates applied". Measured on production rather than
-- estimated: 51 matches reached the 2-6 hour window over 7 days, averaging 12
-- candidates each, giving roughly 453 sends per week across 301 distinct
-- players at full rollout, about 1.5 per player per week. Narrow, but not
-- negligible, and every one of them is a game starting within hours that still
-- has an open spot.
--
-- Verified on staging 2026-08-31 with scripts/seed-discovery-staging.sql: with
-- the flag on, one seeded match sent 16 pushes and a re-run sent 0, so the
-- per-pair dedup and the new own budget both hold. With the flag off the same
-- fixture produced nothing, because tg_momentum_notification_gate RETURNs NULL
-- and drops the row without an error.
--
-- Canary rather than full on. The lane has never delivered a single push in
-- production, so there is no live evidence for how people respond to it. 25%
-- buckets stably by user (momentum_bucket hashes key + user id), so the same
-- players stay in the cohort as it ramps.
--
-- To ramp, no deploy needed:
--   UPDATE public.admin_settings
--      SET value = jsonb_set(value, '{rollout_pct}', '100'::jsonb)
--    WHERE key = 'momentum_match_last_minute_spots';
--
-- To roll back, same shape with '{enabled}' set to 'false'.
--
-- Judge it on joins, not opens: discovery_push_outcome (20260831180000) now
-- attributes both discovery types. Nearby currently converts at 0.91%. If this
-- lane lands materially below that after a couple of hundred sends, it is not
-- earning its volume and should go back off.
-- ============================================================================

DO $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.admin_settings
     SET value = jsonb_set(
                   jsonb_set(value, '{enabled}', 'true'::jsonb),
                   '{rollout_pct}', '25'::jsonb
                 ),
         description = 'Momentum item 6: last-minute open-spots push. '
                       || 'RE-ENABLED 2026-08-31 at a 25% canary after '
                       || '20260831170000 gave the lane its own discovery '
                       || 'budget, removing the contention with nearby pushes '
                       || 'that motivated the 2026-08-07 shutdown. Ramp via '
                       || 'rollout_pct; judge on join rate in '
                       || 'discovery_push_outcome, not opens.',
         updated_at = now()
   WHERE key = 'momentum_match_last_minute_spots';

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- The row is seeded by 20260805180000 with ON CONFLICT DO NOTHING, so it must
  -- already exist. A miss means the seed never ran here and the gate would fail
  -- open, sending at 100% with no flag to turn it off.
  IF v_rows <> 1 THEN
    RAISE EXCEPTION
      'momentum_match_last_minute_spots is missing from admin_settings (% rows updated); 20260805180000 must run first',
      v_rows;
  END IF;
END $$;
