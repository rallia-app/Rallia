-- ============================================================================
-- Migration: enable RLS on digest_send_log and digest_event
-- Created: 2026-05-07
-- Description:
--   These tables are written exclusively by Edge Functions
--   (send-morning-digest, resend-webhook) using the service_role key, and are
--   never read or written from the client. Enabling RLS without policies
--   denies all access to anon and authenticated; service_role bypasses RLS so
--   the existing Edge Functions continue to work unchanged.
-- ============================================================================

ALTER TABLE public.digest_send_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digest_event    ENABLE ROW LEVEL SECURITY;
