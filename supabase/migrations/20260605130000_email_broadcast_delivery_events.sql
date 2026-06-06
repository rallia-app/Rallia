-- ============================================================================
-- Migration: per-recipient delivery lifecycle for email broadcasts
-- Created: 2026-06-05
-- Description:
--   Adds delivered/opened/clicked timestamps to email_broadcast_recipient so the
--   admin broadcast detail page can show a delivery funnel without scanning the
--   high-write digest_event telemetry table. Populated by resend-webhook when a
--   Resend event (email.delivered / email.opened / email.clicked) ties back to a
--   broadcast recipient via resend_id. First-event-wins (webhook guards on NULL).
--
--   Additive, nullable columns only. No new grants: the table already grants
--   SELECT, INSERT, UPDATE to service_role (20260601210001), which covers new
--   columns. RLS unchanged (enabled, no policies → never exposed via Data API).
-- ============================================================================

ALTER TABLE public.email_broadcast_recipient
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opened_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS clicked_at   TIMESTAMPTZ;

COMMENT ON COLUMN public.email_broadcast_recipient.delivered_at IS
  'When Resend reported the message delivered (email.delivered), via resend-webhook.';
COMMENT ON COLUMN public.email_broadcast_recipient.opened_at IS
  'First time Resend reported an open (email.opened), via resend-webhook.';
COMMENT ON COLUMN public.email_broadcast_recipient.clicked_at IS
  'First time Resend reported a link click (email.clicked), via resend-webhook.';
