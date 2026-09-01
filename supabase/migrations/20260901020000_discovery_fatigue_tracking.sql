-- ============================================================================
-- Track what discovery notifications cost: type-specific push opt-out by dose
--
-- discovery_push_outcome (20260831180000) measures what a push is worth. Nothing
-- measures what it costs, and the cost is the binding constraint on how much we
-- can send. 20260901010000 lowered the ceilings on the strength of a one-off
-- query; this makes that number standing.
--
-- The signal is NOT players disabling push app-wide, which does not track dose
-- at all (1.7 / 1.8 / 1.7 / 0.6 / 3.6% across dose bands). It is players muting
-- this notification type specifically on the push channel, which triples between
-- the 9-30 and 31-80 bands (4.5% -> 12.0%). A muted player is permanently
-- unreachable, so this is the expensive failure mode, not an unconverted push.
--
-- get_discovery_fatigue() takes an as-of timestamp and reconstructs the cohort
-- table at that moment. That works because notification_preference.created_at is
-- a reliable opt-out timestamp here: only 49 of 4,030 rows on production were
-- ever edited after creation. Unlike the compat_supply snapshot, whose trend is
-- forward-only, this one can be backfilled, and the migration seeds 12 weeks so
-- the series is useful the day it lands.
--
-- Caveat carried in the data, not just the commit: dose and opt-out are
-- correlated, not causally established. Heavily-pushed players live in denser
-- areas and differ in other ways.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Cohort table as of any moment
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_discovery_fatigue(
  p_as_of timestamptz DEFAULT now()
)
RETURNS TABLE (
  dose_bucket  text,
  players      bigint,
  muted_push   bigint,
  muted_pct    numeric,
  app_push_off bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH dose AS (
    SELECT n.user_id, count(*) AS n
    FROM notification n
    WHERE n.type IN ('nearby_match_available', 'match_last_minute_spots')
      AND n.created_at <  p_as_of
      AND n.created_at >= p_as_of - INTERVAL '90 days'
    GROUP BY n.user_id
  ),
  base AS (
    SELECT
      COALESCE(d.n, 0) AS dose,
      EXISTS (
        SELECT 1 FROM notification_preference np
        WHERE np.user_id = p.id
          AND np.channel = 'push'
          AND np.enabled = false
          AND np.notification_type IN ('nearby_match_available', 'match_last_minute_spots')
          AND np.created_at < p_as_of
      ) AS muted,
      NOT COALESCE(p.push_notifications_enabled, true) AS app_off
    FROM player p
    LEFT JOIN dose d ON d.user_id = p.id
    WHERE p.created_at < p_as_of
  )
  SELECT
    CASE WHEN dose = 0  THEN 'a: never pushed'
         WHEN dose <= 8  THEN 'b: 1-8'
         WHEN dose <= 30 THEN 'c: 9-30'
         WHEN dose <= 80 THEN 'd: 31-80'
         ELSE 'e: 80+' END,
    count(*),
    count(*) FILTER (WHERE muted),
    round(100.0 * count(*) FILTER (WHERE muted) / nullif(count(*), 0), 1),
    count(*) FILTER (WHERE app_off)
  FROM base
  GROUP BY 1
  ORDER BY 1;
$function$;

COMMENT ON FUNCTION public.get_discovery_fatigue(timestamptz) IS
  'Type-specific push opt-out rate by 90-day discovery dose, reconstructable at any as-of moment. The cost side of the discovery budget; discovery_push_outcome is the value side.';

-- ----------------------------------------------------------------------------
-- Weekly headline into analytics_snapshot
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.snapshot_discovery_fatigue(
  p_as_of timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_n integer;
  v_date date := (p_as_of AT TIME ZONE 'America/Toronto')::date;
BEGIN
  DELETE FROM analytics_snapshot
   WHERE snapshot_date = v_date AND metric_type = 'discovery_fatigue';

  WITH f AS (SELECT * FROM public.get_discovery_fatigue(p_as_of)),
  agg AS (
    SELECT
      sum(players)                                        AS players,
      sum(muted_push)                                     AS muted,
      sum(players)    FILTER (WHERE dose_bucket > 'c')    AS heavy_players,
      sum(muted_push) FILTER (WHERE dose_bucket > 'c')    AS heavy_muted,
      sum(players)    FILTER (WHERE dose_bucket IN ('b: 1-8','c: 9-30')) AS light_players,
      sum(muted_push) FILTER (WHERE dose_bucket IN ('b: 1-8','c: 9-30')) AS light_muted
    FROM f
  )
  INSERT INTO analytics_snapshot (snapshot_date, sport_id, metric_type, metric_name, metric_value)
  SELECT v_date, NULL, 'discovery_fatigue', m.name, m.val
  FROM agg
  CROSS JOIN LATERAL (VALUES
    ('muted_pct_overall', COALESCE(round(100.0 * agg.muted       / nullif(agg.players, 0), 2), 0)),
    ('muted_pct_heavy',   COALESCE(round(100.0 * agg.heavy_muted / nullif(agg.heavy_players, 0), 2), 0)),
    ('muted_pct_light',   COALESCE(round(100.0 * agg.light_muted / nullif(agg.light_players, 0), 2), 0)),
    ('muted_players',     COALESCE(agg.muted, 0)::numeric),
    ('tracked_players',   COALESCE(agg.players, 0)::numeric)
  ) m(name, val)
  -- Skip dates with no players at all: a 0% rate over an empty denominator is
  -- not a data point, and metric_value is NOT NULL.
  WHERE COALESCE(agg.players, 0) > 0;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

COMMENT ON FUNCTION public.snapshot_discovery_fatigue(timestamptz) IS
  'Writes the discovery_fatigue headline into analytics_snapshot for the given as-of date. Idempotent per date.';

-- ----------------------------------------------------------------------------
-- Backfill 12 weeks, so the trend exists immediately rather than accruing
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_week timestamptz;
BEGIN
  FOR v_week IN
    SELECT generate_series(now() - INTERVAL '12 weeks', now(), INTERVAL '1 week')
  LOOP
    PERFORM public.snapshot_discovery_fatigue(v_week);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Weekly, offset from the other Monday snapshot jobs
-- ----------------------------------------------------------------------------
SELECT cron.schedule(
  'snapshot-discovery-fatigue-weekly',
  '30 6 * * 1',
  $$ SELECT public.snapshot_discovery_fatigue(); $$
);
