-- ============================================================================
-- Discovery ceiling: lower the tiers to sit under the measured fatigue threshold
--
-- 20260831190000 set these tiers (5 / 3 / 1) from join rates alone. Join rate
-- says how much a push is worth; it says nothing about what a push costs. The
-- cost is now measured, and the converter tier was above it.
--
-- Fatigue does not show up as players disabling push app-wide. It shows up as a
-- surgical opt-out from this notification type, and it tracks dose sharply.
-- Production, nearby pushes received 2026-06-01 onward:
--
--   dose (3 months)   players   app-wide push off   muted nearby specifically
--   never                 174               1.7%                        2.3%
--   1-8                   227               1.8%                        2.6%
--   9-30                  177               1.7%                        4.5%
--   31-80                 167               0.6%                       12.0%
--   80+                   168               3.6%                       11.9%
--
-- App-wide disabling does not track dose at all. Type-specific muting triples
-- between the 9-30 and 31-80 bands, so the inflection sits near 10 per month,
-- roughly 2.3 per week. A muted player is permanently unreachable, which is a
-- far more expensive outcome than a single unconverted push.
--
-- The old converter tier of 5 per week is ~21 a month, inside the 12% band. The
-- players earning the most value from the lane were the ones being pushed
-- hardest toward muting it.
--
-- New tiers, all at or under the inflection:
--   converter (joined in 60d)          3/week  ~13/mo, slightly over but earning it
--   default (includes every new player) 2/week  ~9/mo, just under
--   cold (20+ pushes, 0 joins)          1/week  ~4/mo
--
-- The default tier matters most: new players are the best-converting cohort at
-- 3.03%, and they are also the easiest to lose before they ever see value.
--
-- Correlational, not causal: heavy-dosed players live in denser areas and differ
-- in other ways. The effect is large and consistent enough to act on, and the
-- direction of the risk is asymmetric.
--
-- This is the ceiling only. The larger lever is a relevance bar, since 45% of
-- nearby volume goes to recipients with neither a favorited facility nor
-- declared availability covering the game hour and converts at 0.15%. That
-- should be backtested against discovery_push_outcome before it ships.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.discovery_ceiling(
  p_pushes_60d integer,
  p_joins_60d  integer
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN COALESCE(p_joins_60d, 0) > 0   THEN 3  -- converts, earns headroom
    WHEN COALESCE(p_pushes_60d, 0) >= 20 THEN 1  -- 0.08% join rate, throttle
    ELSE 2                                       -- default, includes new players
  END;
$function$;

COMMENT ON FUNCTION public.discovery_ceiling(integer, integer) IS
  'Discovery pushes allowed per rolling 7 days, given a player 60-day push and join counts. Tiers sit at or under the measured fatigue inflection (~10 pushes/month, where type-specific opt-out triples from 4.5% to 12%).';
