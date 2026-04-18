-- ============================================
-- CHECK POSTAL CODE COVERAGE RPC
-- ============================================
-- Replaces the hardcoded FSA (Forward Sortation Area) allowlist for
-- pre-onboarding postal code validation. Returns TRUE if the given
-- coordinates are within p_radius_km of at least one active facility
-- that has court availabilities displayed in the app.
--
-- A facility "has court availabilities" when any of:
--   1. It has court_slot records (recurring weekly templates)
--   2. It has future court_one_time_availability records (is_available = true)
--   3. It has an external_provider_id AND an active data_provider
--      (either directly on the facility or inherited from its organization)
-- ============================================

-- Add GIST spatial index on facility.location for ST_DWithin performance
CREATE INDEX IF NOT EXISTS idx_facility_location_gist
  ON facility USING GIST (location);

-- Create the coverage check function
CREATE OR REPLACE FUNCTION check_postal_code_coverage(
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_radius_km DOUBLE PRECISION DEFAULT 15.0
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_point extensions.geography;
BEGIN
  -- Build the user's location as a geography point
  v_point := extensions.ST_SetSRID(
    extensions.ST_MakePoint(p_longitude, p_latitude),
    4326
  )::extensions.geography;

  RETURN EXISTS (
    SELECT 1
    FROM facility f
    LEFT JOIN organization o ON o.id = f.organization_id
    LEFT JOIN data_provider fp ON fp.id = f.data_provider_id AND fp.is_active = TRUE
    LEFT JOIN data_provider op ON op.id = o.data_provider_id AND op.is_active = TRUE
    WHERE f.is_active = TRUE
      AND f.location IS NOT NULL
      AND extensions.ST_DWithin(f.location, v_point, p_radius_km * 1000)
      AND (
        -- Condition 1: Has court_slot records for any active court
        -- court_slot can reference a court directly (court_id) or a facility (facility_id)
        EXISTS (
          SELECT 1
          FROM court c
          INNER JOIN court_slot cs ON cs.court_id = c.id
          WHERE c.facility_id = f.id
            AND c.is_active = TRUE
        )
        OR
        EXISTS (
          SELECT 1
          FROM court_slot cs
          WHERE cs.facility_id = f.id
            AND cs.court_id IS NULL
        )
        OR
        -- Condition 2: Has future one-time availability with is_available = true
        EXISTS (
          SELECT 1
          FROM court_one_time_availability ota
          WHERE ota.facility_id = f.id
            AND ota.is_available = TRUE
            AND ota.availability_date >= CURRENT_DATE
        )
        OR
        -- Condition 3: Has active data_provider + external_provider_id
        -- Provider can be set directly on facility or inherited from organization
        (
          f.external_provider_id IS NOT NULL
          AND (fp.id IS NOT NULL OR op.id IS NOT NULL)
        )
      )
  );
END;
$$;

-- Allow pre-onboarding (anon) and authenticated users to call this function
GRANT EXECUTE ON FUNCTION check_postal_code_coverage(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO anon;
GRANT EXECUTE ON FUNCTION check_postal_code_coverage(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

COMMENT ON FUNCTION check_postal_code_coverage IS
  'Returns TRUE if coordinates are within p_radius_km of a facility with court availability. Used for pre-onboarding postal code coverage validation.';
