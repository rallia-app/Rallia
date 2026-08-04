-- ============================================
-- Leagues & Tournaments — Stripe receipt URL on the payment ledger
-- ============================================
-- The webhook stores charge.receipt_url on payment_intent.succeeded so the app
-- can offer a "View receipt" link. Readable by payer/organizer through the
-- existing SELECT policies; written only by the service-role webhook.
-- ============================================

ALTER TABLE public.lt_registration_payment
    ADD COLUMN IF NOT EXISTS stripe_receipt_url text;

COMMENT ON COLUMN public.lt_registration_payment.stripe_receipt_url
    IS 'Stripe-hosted receipt page for the succeeded charge (charge.receipt_url), stored by lt-payment-webhook.';
