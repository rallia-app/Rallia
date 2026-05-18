-- =============================================================================
-- Migration: Admin-managed UTM campaign catalog
-- Description:
--   * Adds public.utm_campaign so non-technical admins can create/archive
--     campaigns from /admin/analytics/links without a code deploy.
--   * `slug` is the literal value that becomes utm_campaign in URLs (unique).
--   * `display_name` + `description` are presentational only.
--   * Archive (don't delete) so historical analytics can still resolve a
--     campaign's friendly name.
--   * Sources/mediums stay in code (vocabulary.ts) — they're pseudo-immutable
--     and renaming retroactively breaks historical funnels.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.utm_campaign (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT        NOT NULL UNIQUE,
  display_name TEXT        NOT NULL,
  description  TEXT,
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  created_by   UUID        REFERENCES public.profile(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at  TIMESTAMPTZ
);

COMMENT ON TABLE public.utm_campaign IS
  'Admin-managed catalog of utm_campaign slugs used by the link-builder UI.';

CREATE INDEX IF NOT EXISTS idx_utm_campaign_active
  ON public.utm_campaign(is_active, created_at DESC);

-- -----------------------------------------------------------------------------
-- list_utm_campaigns — admin-gated list of all (non-archived) campaigns
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.list_utm_campaigns(boolean);

CREATE OR REPLACE FUNCTION public.list_utm_campaigns(p_include_archived boolean DEFAULT false)
RETURNS TABLE(
  id UUID,
  slug TEXT,
  display_name TEXT,
  description TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin WHERE id = auth.uid()) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT c.id, c.slug, c.display_name, c.description, c.is_active,
         c.created_at, c.archived_at
  FROM public.utm_campaign c
  WHERE p_include_archived OR c.is_active
  ORDER BY c.is_active DESC, c.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_utm_campaigns(boolean) TO authenticated;

-- -----------------------------------------------------------------------------
-- create_utm_campaign — admin-gated. Returns the new row id.
-- Slug must be snake_case (validated server-side so the same rule holds for
-- any future caller, not just the UI).
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.create_utm_campaign(text, text, text);

CREATE OR REPLACE FUNCTION public.create_utm_campaign(
  p_slug         text,
  p_display_name text,
  p_description  text DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'create_utm_campaign: caller is not an admin';
  END IF;

  IF p_slug IS NULL OR p_slug = '' THEN
    RAISE EXCEPTION 'create_utm_campaign: slug is required';
  END IF;

  IF p_slug !~ '^[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'create_utm_campaign: slug must be snake_case (a-z, 0-9, _)';
  END IF;

  IF p_display_name IS NULL OR p_display_name = '' THEN
    RAISE EXCEPTION 'create_utm_campaign: display_name is required';
  END IF;

  INSERT INTO public.utm_campaign (slug, display_name, description, created_by)
  VALUES (p_slug, p_display_name, NULLIF(p_description, ''), auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_utm_campaign(text, text, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- archive_utm_campaign — soft delete, preserves historical readability
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.archive_utm_campaign(uuid);

CREATE OR REPLACE FUNCTION public.archive_utm_campaign(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'archive_utm_campaign: caller is not an admin';
  END IF;

  UPDATE public.utm_campaign
  SET is_active = false,
      archived_at = now()
  WHERE id = p_id AND is_active;
END;
$$;

GRANT EXECUTE ON FUNCTION public.archive_utm_campaign(uuid) TO authenticated;
