-- /find-a-match smoke test: capture leads at the email step, no PaymentIntent dependency.
-- The fake-door flow no longer creates a Stripe PaymentIntent, so the lead is written
-- before the card form (keyed by email) and phone is collected later (if ever).

ALTER TABLE match_smoke_test_lead
    ADD COLUMN IF NOT EXISTS email TEXT;

-- These were required by the old PI-based capture (written at phone verification).
ALTER TABLE match_smoke_test_lead
    ALTER COLUMN payment_intent_id DROP NOT NULL,
    ALTER COLUMN phone DROP NOT NULL;

-- Email is the upsert target for the capture route. NULLs (legacy rows) stay distinct.
CREATE UNIQUE INDEX IF NOT EXISTS idx_match_smoke_test_lead_email
    ON match_smoke_test_lead (email);
