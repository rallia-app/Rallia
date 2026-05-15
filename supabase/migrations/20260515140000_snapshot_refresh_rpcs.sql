-- =============================================================================
-- Snapshot refresh RPCs + lease table (Step 2 of the SWR availability pipeline)
--
-- Supporting infrastructure for the refresh-facility-availability edge
-- function. All RPCs are SECURITY DEFINER and granted to service_role only;
-- they are not part of the public Data API.
-- =============================================================================

-- =============================================================================
-- Lease table
--
-- Coordinates simultaneous refresh attempts: the edge function probes the
-- lease before paying for a provider call. The lease is short-lived (60s)
-- and self-recovers if a worker dies mid-fetch.
-- =============================================================================

CREATE TABLE public.facility_refresh_lease (
  facility_id  uuid        PRIMARY KEY REFERENCES public.facility(id) ON DELETE CASCADE,
  acquired_at  timestamptz NOT NULL,
  expires_at   timestamptz NOT NULL
);

ALTER TABLE public.facility_refresh_lease ENABLE ROW LEVEL SECURITY;

-- No SELECT policies — only service_role (which bypasses RLS) ever touches
-- this table. Anon/authenticated have no need to see it.
GRANT ALL ON public.facility_refresh_lease TO service_role;

CREATE INDEX idx_refresh_lease_expires
  ON public.facility_refresh_lease (expires_at);

-- =============================================================================
-- resolve_facility_providers
--
-- Returns (facility, external_provider_id, provider_type, api_base_url,
-- api_config) for the given facility ids, walking the facility →
-- data_provider link with a fallback to facility → organization →
-- data_provider. Mirrors the resolution the suggestion RPCs already do.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.resolve_facility_providers(
  p_facility_ids uuid[]
)
RETURNS TABLE (
  facility_id          uuid,
  external_provider_id text,
  provider_type        text,
  api_base_url         text,
  api_config           jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    f.id                                                    AS facility_id,
    f.external_provider_id,
    dp.provider_type::text,
    dp.api_base_url::text,
    dp.api_config
  FROM public.facility f
  LEFT JOIN public.organization  o  ON o.id  = f.organization_id
  LEFT JOIN public.data_provider dp ON dp.id = COALESCE(f.data_provider_id, o.data_provider_id)
                                   AND dp.is_active = TRUE
  WHERE f.id = ANY(p_facility_ids);
$$;

GRANT EXECUTE ON FUNCTION public.resolve_facility_providers(uuid[]) TO service_role;

-- =============================================================================
-- snapshot_try_lock_facility
--
-- Atomic lease acquisition: returns TRUE if the caller now owns a 60-second
-- lease on this facility's refresh slot, FALSE if another worker holds an
-- active lease. Stale leases (expired) are recycled by the UPDATE branch.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.snapshot_try_lock_facility(
  p_facility_id uuid
)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  WITH attempt AS (
    INSERT INTO public.facility_refresh_lease (facility_id, acquired_at, expires_at)
    VALUES (p_facility_id, now(), now() + interval '60 seconds')
    ON CONFLICT (facility_id) DO UPDATE
      SET acquired_at = EXCLUDED.acquired_at,
          expires_at  = EXCLUDED.expires_at
      WHERE facility_refresh_lease.expires_at < now()
    RETURNING 1
  )
  SELECT EXISTS(SELECT 1 FROM attempt);
$$;

GRANT EXECUTE ON FUNCTION public.snapshot_try_lock_facility(uuid) TO service_role;

-- =============================================================================
-- snapshot_replace_facility_rows
--
-- Atomic replace of the upcoming-window snapshot rows for one facility.
-- Called by the edge function after a successful provider fetch. Behavior:
--   1. Re-takes a transactional advisory lock — serializes simultaneous
--      writers for the same facility, even if the lease probe was racy.
--   2. Re-checks `snapshot_needs_refresh`. If another worker already wrote
--      fresh data while we were fetching, returns 'already_fresh' and
--      doesn't overwrite (avoids clobbering work).
--   3. DELETE the upcoming-window rows for this facility.
--   4. INSERT the fresh rows from p_rows.
--   5. UPSERT facility_refresh_log with success.
--   6. Release the lease (DELETE the row).
-- Returns the number of rows written, plus a status.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.snapshot_replace_facility_rows(
  p_facility_id uuid,
  p_source      text,
  p_rows        jsonb
)
RETURNS TABLE (status text, rows_written int)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_key bigint;
  v_lock_ok  boolean;
  v_needed   boolean;
  v_written  int;
BEGIN
  v_lock_key := hashtextextended('snapshot_refresh:' || p_facility_id::text, 0);
  v_lock_ok  := pg_try_advisory_xact_lock(v_lock_key);
  IF NOT v_lock_ok THEN
    status := 'locked'; rows_written := 0;
    RETURN NEXT; RETURN;
  END IF;

  v_needed := public.snapshot_needs_refresh(p_facility_id);
  IF NOT v_needed THEN
    DELETE FROM public.facility_refresh_lease WHERE facility_id = p_facility_id;
    status := 'already_fresh'; rows_written := 0;
    RETURN NEXT; RETURN;
  END IF;

  DELETE FROM public.facility_availability_snapshot
   WHERE facility_id = p_facility_id
     AND slot_start >= now();

  INSERT INTO public.facility_availability_snapshot (
    facility_id,
    external_court_id,
    slot_start,
    slot_end,
    is_available,
    source,
    external_slot_id,
    court_name,
    court_number,
    price_cents,
    currency,
    refreshed_at
  )
  SELECT
    p_facility_id,
    elem->>'external_court_id',
    (elem->>'slot_start')::timestamptz,
    (elem->>'slot_end')::timestamptz,
    COALESCE((elem->>'is_available')::boolean, TRUE),
    p_source,
    NULLIF(elem->>'external_slot_id', ''),
    NULLIF(elem->>'court_name', ''),
    NULLIF(elem->>'court_number', '')::int,
    NULLIF(elem->>'price_cents', '')::int,
    NULLIF(elem->>'currency', ''),
    now()
  FROM jsonb_array_elements(p_rows) AS elem
  ON CONFLICT (facility_id, external_court_id, slot_start) DO UPDATE
    SET slot_end         = EXCLUDED.slot_end,
        is_available     = EXCLUDED.is_available,
        source           = EXCLUDED.source,
        external_slot_id = EXCLUDED.external_slot_id,
        court_name       = EXCLUDED.court_name,
        court_number     = EXCLUDED.court_number,
        price_cents      = EXCLUDED.price_cents,
        currency         = EXCLUDED.currency,
        refreshed_at     = EXCLUDED.refreshed_at;

  GET DIAGNOSTICS v_written = ROW_COUNT;

  INSERT INTO public.facility_refresh_log (
    facility_id, refreshed_at, source, last_error, consecutive_errors
  )
  VALUES (p_facility_id, now(), p_source, NULL, 0)
  ON CONFLICT (facility_id) DO UPDATE
    SET refreshed_at       = EXCLUDED.refreshed_at,
        source             = EXCLUDED.source,
        last_error         = NULL,
        consecutive_errors = 0;

  DELETE FROM public.facility_refresh_lease WHERE facility_id = p_facility_id;

  status := 'wrote'; rows_written := v_written;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.snapshot_replace_facility_rows(uuid, text, jsonb)
  TO service_role;

-- =============================================================================
-- snapshot_record_refresh_error
--
-- Called when the provider fetch fails. Increments the error counter and
-- releases the lease — but does NOT touch snapshot rows (a transient
-- provider failure shouldn't clobber the last successful snapshot).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.snapshot_record_refresh_error(
  p_facility_id uuid,
  p_source      text,
  p_error       text
)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.facility_refresh_log (
    facility_id, refreshed_at, source, last_error, consecutive_errors
  )
  VALUES (p_facility_id, now(), p_source, p_error, 1)
  ON CONFLICT (facility_id) DO UPDATE
    SET refreshed_at       = EXCLUDED.refreshed_at,
        source             = EXCLUDED.source,
        last_error         = EXCLUDED.last_error,
        consecutive_errors = facility_refresh_log.consecutive_errors + 1;

  DELETE FROM public.facility_refresh_lease WHERE facility_id = p_facility_id;
$$;

GRANT EXECUTE ON FUNCTION public.snapshot_record_refresh_error(uuid, text, text)
  TO service_role;

COMMENT ON TABLE public.facility_refresh_lease IS
  'Short-lived (60s) leases that coalesce simultaneous refresh workers for the same facility. Released by snapshot_replace_facility_rows / snapshot_record_refresh_error, or auto-recovered when expires_at < now().';

COMMENT ON FUNCTION public.snapshot_replace_facility_rows IS
  'Atomic replace of upcoming-window snapshot rows. Re-takes the advisory lock, re-checks freshness, then DELETE+INSERT under the lock. Idempotent — repeated calls for fresh data return already_fresh and do not overwrite.';
