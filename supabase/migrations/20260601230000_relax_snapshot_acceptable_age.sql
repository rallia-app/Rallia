-- =============================================================================
-- Relax the availability-snapshot TTL ladder
--
-- The original ladder (20260515130000) treated any facility with a slot in the
-- next 2 hours as stale after just 90 seconds. Combined with the client-side
-- fire-and-forget SWR trigger (request_facility_refresh), this drove ~2,000
-- refresh-facility-availability invocations/day and the occasional 150s worker
-- wall-clock kill (546) on large batches against slow provider APIs.
--
-- Court availability rarely flips within 90 seconds, so we relax the ladder:
--
--     slot within  <2h  : 90s  -> 3 minutes
--     slot within 2-12h  : 5m   -> 5 minutes (band re-cut from <24h to <12h)
--     slot beyond  12h   : 15m  -> 10 minutes
--
-- This cuts refresh frequency (and the snapshot write churn it generates)
-- several-fold while keeping near-term slots fresh enough for the UI.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.snapshot_acceptable_age(slot_start timestamptz)
RETURNS interval
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN slot_start < now() + interval '2 hours'  THEN interval '3 minutes'
    WHEN slot_start < now() + interval '12 hours' THEN interval '5 minutes'
    ELSE interval '10 minutes'
  END;
$$;

COMMENT ON FUNCTION public.snapshot_acceptable_age IS
  'TTL ladder for snapshot rows, keyed on slot_start. 3min for slots in next 2h; '
  '5min for next 12h; 10min beyond that. Drives snapshot_needs_refresh and the SWR '
  'trigger in the suggestion service layer.';
