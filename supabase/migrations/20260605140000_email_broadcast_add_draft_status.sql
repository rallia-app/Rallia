-- ============================================================================
-- Migration: allow 'draft' status on email_broadcast
-- Created: 2026-06-05
-- Description:
--   Lets admins save an unsent broadcast as a draft and resume it later. A draft
--   stores its content (subject/body/cta) plus the chosen audience (segment
--   filters or pasted emails) in the existing audience JSONB, and is excluded
--   from the "Past broadcasts" history until sent. Sending a draft promotes the
--   same row (draft → sending → sent), so no extra columns are needed.
-- ============================================================================

ALTER TABLE public.email_broadcast DROP CONSTRAINT IF EXISTS email_broadcast_status_check;

ALTER TABLE public.email_broadcast
  ADD CONSTRAINT email_broadcast_status_check
  CHECK (status IN ('draft', 'queued', 'sending', 'sent', 'partial', 'failed'));
