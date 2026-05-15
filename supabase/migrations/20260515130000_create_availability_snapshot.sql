-- =============================================================================
-- Availability snapshot (Step 1 of the SWR availability pipeline)
--
-- Persists per-court availability fetched from external providers (IC3/Otium,
-- ActivityMessenger) over a 3-day rolling horizon — the maximum window both
-- providers return today. Populated by the refresh-facility-availability edge
-- function under stale-while-revalidate semantics; consumed by the suggestion
-- RPCs (hard filter + soft bookability score) and FacilityDetail.
--
-- This migration creates schema and helpers only. No consumer is wired up yet.
-- =============================================================================

-- =============================================================================
-- TABLES
-- =============================================================================

CREATE TABLE public.facility_availability_snapshot (
  facility_id        uuid        NOT NULL REFERENCES public.facility(id) ON DELETE CASCADE,
  external_court_id  text        NOT NULL,
  slot_start         timestamptz NOT NULL,
  slot_end           timestamptz NOT NULL,
  is_available       boolean     NOT NULL,
  source             text        NOT NULL,
  external_slot_id   text,
  court_name         text,
  court_number       int,
  price_cents        int,
  currency           text,
  refreshed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (facility_id, external_court_id, slot_start)
);

-- `facility_refresh_log` distinguishes "never looked at this facility" from
-- "looked, found no slots" — snapshot row presence alone can't carry that.
CREATE TABLE public.facility_refresh_log (
  facility_id        uuid        PRIMARY KEY REFERENCES public.facility(id) ON DELETE CASCADE,
  refreshed_at       timestamptz NOT NULL,
  source             text        NOT NULL,
  last_error         text,
  consecutive_errors int         NOT NULL DEFAULT 0
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Suggestion-RPC hot path: "is this facility bookable in the upcoming window?"
CREATE INDEX idx_fas_facility_window
  ON public.facility_availability_snapshot (facility_id, slot_start)
  WHERE is_available = TRUE;

-- Cleanup hot path: rows where slot_start has already passed.
CREATE INDEX idx_fas_expired
  ON public.facility_availability_snapshot (slot_start)
  WHERE is_available = TRUE;

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE public.facility_availability_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_refresh_log           ENABLE ROW LEVEL SECURITY;

-- Both tables are world-readable: anon callers need bookability data for the
-- /play page and the anon suggestion RPC. No PII; all rows are derived from
-- public-facing provider APIs.
CREATE POLICY "snapshot_read_all"
  ON public.facility_availability_snapshot
  FOR SELECT
  TO anon, authenticated
  USING (TRUE);

CREATE POLICY "refresh_log_read_all"
  ON public.facility_refresh_log
  FOR SELECT
  TO anon, authenticated
  USING (TRUE);

-- Writes are exclusively via the refresh-facility-availability edge function,
-- which authenticates as service_role and bypasses RLS. No INSERT/UPDATE/
-- DELETE policies are intentional.

-- =============================================================================
-- GRANTS
-- (Supabase is removing default Data API grants — explicit grants required.)
-- =============================================================================

GRANT SELECT ON public.facility_availability_snapshot TO anon, authenticated;
GRANT SELECT ON public.facility_refresh_log           TO anon, authenticated;
GRANT ALL    ON public.facility_availability_snapshot TO service_role;
GRANT ALL    ON public.facility_refresh_log           TO service_role;

-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================

-- TTL ladder. Sooner slots demand fresher data; bookings against imminent
-- slots can flip in seconds, while bookings 2-3 days out are far calmer.
CREATE OR REPLACE FUNCTION public.snapshot_acceptable_age(slot_start timestamptz)
RETURNS interval
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN slot_start < now() + interval '2 hours'  THEN interval '90 seconds'
    WHEN slot_start < now() + interval '24 hours' THEN interval '5 minutes'
    ELSE interval '15 minutes'
  END;
$$;

-- Returns TRUE if the facility should be refreshed now. TTL is driven by the
-- soonest upcoming slot — since one provider call refreshes the entire
-- window, the strictest TTL among current snapshot rows wins. Empty snapshot
-- with a prior refresh_log entry defaults to a moderate 5-minute cadence.
CREATE OR REPLACE FUNCTION public.snapshot_needs_refresh(p_facility_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH last_refresh AS (
    SELECT refreshed_at FROM public.facility_refresh_log
    WHERE facility_id = p_facility_id
  ),
  soonest AS (
    SELECT MIN(slot_start) AS slot_start
    FROM public.facility_availability_snapshot
    WHERE facility_id = p_facility_id
      AND slot_start  > now()
      AND is_available = TRUE
  )
  SELECT
    NOT EXISTS (SELECT 1 FROM last_refresh)
    OR (
      SELECT lr.refreshed_at < now() - public.snapshot_acceptable_age(
        COALESCE(s.slot_start, now() + interval '2 hours')
      )
      FROM last_refresh lr
      LEFT JOIN soonest s ON TRUE
    );
$$;

-- Batched variant. The TS suggestion service passes the set of facility ids
-- present in an RPC result and gets back the subset that need a refresh, in
-- one round-trip.
CREATE OR REPLACE FUNCTION public.snapshot_facilities_needing_refresh(
  p_facility_ids uuid[]
)
RETURNS TABLE (facility_id uuid)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT f.id
  FROM unnest(p_facility_ids) AS f(id)
  WHERE public.snapshot_needs_refresh(f.id);
$$;

-- Deletes snapshot rows whose slot_start has already passed. Invoked by a
-- daily pg_cron job (added in Step 7) and safe to call from anywhere.
CREATE OR REPLACE FUNCTION public.snapshot_cleanup_expired()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int;
BEGIN
  WITH d AS (
    DELETE FROM public.facility_availability_snapshot
    WHERE slot_start < now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_deleted FROM d;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.snapshot_acceptable_age(timestamptz)         TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.snapshot_needs_refresh(uuid)                 TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.snapshot_facilities_needing_refresh(uuid[])  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.snapshot_cleanup_expired()                   TO service_role;

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE public.facility_availability_snapshot IS
  'Per-court snapshot of external-provider availability over a 3-day rolling horizon. '
  'Populated by the refresh-facility-availability edge function via stale-while-revalidate. '
  'Read-side source of truth for the suggestion RPCs and FacilityDetail.';

COMMENT ON TABLE public.facility_refresh_log IS
  'Last-refresh timestamp per facility. Distinct from snapshot row presence so callers '
  'can distinguish "never refreshed" from "refreshed, provider returned no slots".';

COMMENT ON FUNCTION public.snapshot_acceptable_age IS
  'TTL ladder for snapshot rows, keyed on slot_start. 90s for slots in next 2h; 5min '
  'for next 24h; 15min beyond that. Drives snapshot_needs_refresh and the SWR trigger '
  'in the suggestion service layer.';

COMMENT ON FUNCTION public.snapshot_needs_refresh IS
  'Returns TRUE when a facility''s snapshot is older than the TTL of its soonest upcoming '
  'slot. Never-refreshed facilities and empty-with-prior-refresh facilities also return TRUE.';
