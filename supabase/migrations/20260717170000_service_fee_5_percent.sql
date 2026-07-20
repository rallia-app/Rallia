-- Lower the platform-wide default service fee from 6% to 5% of the entry
-- price (flat $1.50 add-on and $20 cap unchanged). Organizer- and event-level
-- overrides are untouched; the row update is guarded so a hand-tuned value
-- other than the original 600 bps is never clobbered.

ALTER TABLE public.platform_service_fee_default
    ALTER COLUMN pct_bps SET DEFAULT 500;

UPDATE public.platform_service_fee_default
SET pct_bps = 500, updated_at = now()
WHERE id = true AND pct_bps = 600;

COMMENT ON TABLE public.platform_service_fee_default IS 'Single-row global default service-fee parameters (5% + $1.50, $20 cap). Adjust to retune the platform-wide default.';
