-- =============================================================================
-- Client-callable refresh request (Step 3 of the SWR availability pipeline)
--
-- Bridges the gap between client-side anon-key authentication and the
-- service-role-only refresh edge function. The client calls this RPC with
-- the facility ids it just saw in a suggestion response; the RPC filters to
-- the subset that actually needs a refresh and fires the edge function via
-- pg_net using the secret apikey from the vault.
--
-- Async by design: net.http_post returns immediately with a request id. The
-- actual provider fetch happens out-of-band on the edge worker. The caller
-- receives the count of facilities scheduled, useful for telemetry.
--
-- Abuse surface: capped at 50 facility ids per call; only forwards
-- already-stale facilities, so a flood of requests against fresh data
-- bottoms out at a no-op. Lease + advisory-lock on the worker side prevent
-- duplicate provider hits.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.request_facility_refresh(
  p_facility_ids uuid[]
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_input      uuid[];
  v_stale      uuid[];
  v_count      int;
  v_url        text;
  v_apikey     text;
BEGIN
  IF p_facility_ids IS NULL OR array_length(p_facility_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  -- Cap input to match the edge function's per-invocation limit.
  IF array_length(p_facility_ids, 1) > 50 THEN
    v_input := p_facility_ids[1:50];
  ELSE
    v_input := p_facility_ids;
  END IF;

  SELECT array_agg(s.facility_id) INTO v_stale
  FROM public.snapshot_facilities_needing_refresh(v_input) s;

  IF v_stale IS NULL OR array_length(v_stale, 1) IS NULL THEN
    RETURN 0;
  END IF;

  v_count := array_length(v_stale, 1);

  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets
   WHERE name = 'supabase_functions_url'
   LIMIT 1;

  SELECT decrypted_secret INTO v_apikey
    FROM vault.decrypted_secrets
   WHERE name = 'service_role_key'
   LIMIT 1;

  IF v_url IS NULL OR v_apikey IS NULL THEN
    -- Vault not provisioned (local dev that hasn't set up the secrets).
    -- Surface as a no-op rather than an error — the snapshot just stays
    -- cold-start neutral for this caller.
    RAISE WARNING 'request_facility_refresh: missing vault secrets, skipping HTTP dispatch';
    RETURN 0;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/refresh-facility-availability',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey',       v_apikey
    ),
    body    := jsonb_build_object('facility_ids', v_stale),
    timeout_milliseconds := 60000
  );

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_facility_refresh(uuid[])
  TO anon, authenticated;

COMMENT ON FUNCTION public.request_facility_refresh IS
  'Client-callable bridge to the refresh-facility-availability edge function. '
  'Filters to stale facilities via snapshot_facilities_needing_refresh, then '
  'fires pg_net with the secret apikey from the vault. Async — returns the '
  'count of facilities scheduled, not the result of the refresh.';
