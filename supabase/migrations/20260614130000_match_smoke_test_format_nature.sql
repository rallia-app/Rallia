ALTER TABLE match_smoke_test_lead
    ADD COLUMN IF NOT EXISTS match_format TEXT,
    ADD COLUMN IF NOT EXISTS match_nature TEXT;
