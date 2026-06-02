-- =============================================================================
-- Migration: Enable RLS on public.utm_campaign
-- Description:
--   Supabase advisor (lint 0013_rls_disabled_in_public) flags this table as
--   reachable via the Data API with RLS disabled. Combined with the default
--   PostgREST grants, anon/authenticated could read or write the campaign
--   catalog directly.
--
--   All legitimate access already goes through admin-gated SECURITY DEFINER
--   RPCs (list_utm_campaigns / create_utm_campaign / archive_utm_campaign),
--   which are owned by postgres and therefore bypass RLS. So we enable RLS
--   with NO permissive policies: this denies every direct Data API request
--   from anon/authenticated while leaving the RPCs (and service_role, which
--   bypasses RLS) fully functional. Least privilege — the table is never meant
--   to be queried directly from the client.
-- =============================================================================

ALTER TABLE public.utm_campaign ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.utm_campaign IS
  'Admin-managed catalog of utm_campaign slugs used by the link-builder UI. '
  'RLS is enabled with no policies on purpose: all access is via admin-gated '
  'SECURITY DEFINER RPCs (list/create/archive_utm_campaign) which bypass RLS; '
  'direct Data API access is intentionally denied.';
