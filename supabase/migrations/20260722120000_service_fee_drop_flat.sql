-- Drop the $1.00 flat service-fee add-on so the platform-wide default becomes
-- a straight 5% of the entry price (rate and $20 cap unchanged). Founders'
-- decision 2026-07-22: the flat component made cheap league-night entries pay
-- ~12% effective while tournaments paid ~5.5-6%; a uniform 5% is fairer across
-- price points. Rationale documented in the business repo at
-- rallia-business/finance/business-model/pricing-comparables-2026-07.md and
-- organizers.md. Organizer- and event-level overrides are untouched; the row
-- update is guarded so a hand-tuned value other than the current 100 cents is
-- never clobbered.

ALTER TABLE public.platform_service_fee_default
    ALTER COLUMN flat_cents SET DEFAULT 0;

UPDATE public.platform_service_fee_default
SET flat_cents = 0, updated_at = now()
WHERE id = true AND flat_cents = 100;

COMMENT ON TABLE public.platform_service_fee_default IS 'Single-row global default service-fee parameters (5%, no flat add-on, $20 cap). Adjust to retune the platform-wide default.';
