-- /find-a-match smoke test V2 (willingness-to-pay).
-- Coordinates (email + phone) are now captured at the contact step, BEFORE any
-- price is shown, so the lead is written without a plan. plan_tier/amount_cents
-- become nullable. New columns record the sport, resolved city, language and the
-- randomized A/B assignments (value prop + monthly price) so results can be sliced
-- by variant and segment without retreatment.

ALTER TABLE match_smoke_test_lead
    ADD COLUMN IF NOT EXISTS sport TEXT,
    ADD COLUMN IF NOT EXISTS city TEXT,
    ADD COLUMN IF NOT EXISTS langue TEXT,
    ADD COLUMN IF NOT EXISTS session_id TEXT,
    ADD COLUMN IF NOT EXISTS variant_valueprop TEXT,
    ADD COLUMN IF NOT EXISTS variant_price_cents INTEGER;

-- The lead is captured before the pricing screen, so a plan may never be chosen.
ALTER TABLE match_smoke_test_lead
    ALTER COLUMN plan_tier DROP NOT NULL,
    ALTER COLUMN amount_cents DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_match_smoke_test_lead_session
    ON match_smoke_test_lead (session_id);
