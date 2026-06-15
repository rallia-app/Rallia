-- Phone verification + lead capture for /find-a-match smoke test

CREATE TABLE IF NOT EXISTS match_smoke_test_phone_code (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT NOT NULL,
    code TEXT NOT NULL,
    payment_intent_id TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_smoke_test_phone_code_lookup
    ON match_smoke_test_phone_code (phone, payment_intent_id, used);

CREATE INDEX IF NOT EXISTS idx_match_smoke_test_phone_code_expires
    ON match_smoke_test_phone_code (expires_at);

CREATE TABLE IF NOT EXISTS match_smoke_test_lead (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_intent_id TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL,
    phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at TIMESTAMPTZ,
    rating TEXT NOT NULL,
    time_slot TEXT NOT NULL,
    location_type TEXT NOT NULL,
    postal_code TEXT,
    plan_tier TEXT NOT NULL,
    credits INTEGER,
    amount_cents INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE match_smoke_test_phone_code ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_smoke_test_lead ENABLE ROW LEVEL SECURITY;

-- Service role only — accessed from Next.js API routes via service key
CREATE POLICY "Service role full access phone codes"
    ON match_smoke_test_phone_code
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access leads"
    ON match_smoke_test_lead
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
