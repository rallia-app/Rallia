-- /find-a-match smoke test: location signals for pre-launch density analysis.
-- `city` holds the chosen facility's city and is null whenever the visitor never
-- picks one, which is exactly the flexible case we now offer. home_city/home_region
-- record where the VISITOR is instead, so density can be measured either way.
-- max_distance_km and facility_preference capture how far people will travel and
-- whether they wanted a specific site at all. facility_id was already sent by the
-- client and silently dropped.

ALTER TABLE match_smoke_test_lead
    ADD COLUMN IF NOT EXISTS home_city TEXT,
    ADD COLUMN IF NOT EXISTS home_region TEXT,
    ADD COLUMN IF NOT EXISTS max_distance_km INTEGER,
    ADD COLUMN IF NOT EXISTS facility_id UUID,
    ADD COLUMN IF NOT EXISTS facility_preference TEXT;

CREATE INDEX IF NOT EXISTS idx_match_smoke_test_lead_postal
    ON match_smoke_test_lead (postal_code);
