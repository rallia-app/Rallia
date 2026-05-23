-- =============================================================================
-- Daily pre-warm of the availability snapshot (Step 7, final piece of SWR)
--
-- One pg_cron job that hits refresh-facility-availability for the top-N
-- favorited facilities at 8:00 UTC (~4:00 EDT) — just ahead of morning
-- traffic. Ensures the day's first users get a warm snapshot instead of
-- paying the cold-start poll in useCourtAvailability or being served
-- yesterday's data via the suggestion RPCs.
--
-- This is a *smoothing* job, not a load-bearing one. The SWR trigger from
-- the suggestion service (Step 3) keeps the snapshot warm during the day
-- on its own; the pre-warm is just insurance against the first morning
-- request paying the full provider round-trip.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: which facilities to pre-warm
--
-- Top N facilities by favorite count, scoped to those with an external
-- provider configured (locals don't go through the snapshot). Ties broken
-- by recency of last-favorited so newly-favorited facilities don't get
-- crowded out by long-tail history.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.snapshot_prewarm_facility_ids(
  p_limit int DEFAULT 50
)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(facility_id), ARRAY[]::uuid[])
  FROM (
    SELECT pff.facility_id
    FROM public.player_favorite_facility pff
    JOIN public.facility f ON f.id = pff.facility_id
    LEFT JOIN public.organization o ON o.id = f.organization_id
    WHERE COALESCE(f.data_provider_id, o.data_provider_id) IS NOT NULL
    GROUP BY pff.facility_id
    ORDER BY COUNT(*) DESC, MAX(pff.created_at) DESC
    LIMIT p_limit
  ) top;
$$;

GRANT EXECUTE ON FUNCTION public.snapshot_prewarm_facility_ids(int) TO service_role;

COMMENT ON FUNCTION public.snapshot_prewarm_facility_ids IS
  'Returns the top-N facility ids to pre-warm, scoped to those with an '
  'external provider. Ordered by favorite count desc, ties broken by '
  'recency of last favoriting.';

-- -----------------------------------------------------------------------------
-- Daily expired-row cleanup
--
-- Pairs with the pre-warm. Deletes snapshot rows whose slot_start has
-- already passed — without this the table grows ~50% per day from rows
-- that are no longer relevant to the 3-day window.
-- -----------------------------------------------------------------------------

SELECT cron.schedule(
  'snapshot-cleanup-expired-daily',
  '0 7 * * *',  -- 7:00 UTC daily, 1h before pre-warm
  $cmd$
    SELECT public.snapshot_cleanup_expired();
  $cmd$
);

-- -----------------------------------------------------------------------------
-- Pre-warm cron: 8:00 UTC daily
-- -----------------------------------------------------------------------------

SELECT cron.schedule(
  'snapshot-prewarm-availability',
  '0 8 * * *',  -- 8:00 UTC daily (~4:00 EDT)
  $cmd$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret FROM vault.decrypted_secrets
         WHERE name = 'supabase_functions_url'
         LIMIT 1
      ) || '/functions/v1/refresh-facility-availability',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey',       (
          SELECT decrypted_secret FROM vault.decrypted_secrets
           WHERE name = 'service_role_key'
           LIMIT 1
        )
      ),
      body := jsonb_build_object(
        'facility_ids', public.snapshot_prewarm_facility_ids(50)
      ),
      timeout_milliseconds := 120000
    );
  $cmd$
);
