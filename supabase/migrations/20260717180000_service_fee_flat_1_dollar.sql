-- Lower the platform-wide default flat service-fee add-on from $1.50 to $1.00
-- (5% rate and $20 cap unchanged). Organizer- and event-level overrides are
-- untouched; the row update is guarded so a hand-tuned value other than the
-- original 150¢ is never clobbered.

ALTER TABLE public.platform_service_fee_default
    ALTER COLUMN flat_cents SET DEFAULT 100;

UPDATE public.platform_service_fee_default
SET flat_cents = 100, updated_at = now()
WHERE id = true AND flat_cents = 150;

COMMENT ON TABLE public.platform_service_fee_default IS 'Single-row global default service-fee parameters (5% + $1.00, $20 cap). Adjust to retune the platform-wide default.';
