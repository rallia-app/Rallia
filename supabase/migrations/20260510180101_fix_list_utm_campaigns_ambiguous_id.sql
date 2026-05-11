-- =============================================================================
-- Fix: column reference "id" (and others) was ambiguous inside list_utm_campaigns.
-- Cause: RETURNS TABLE(id UUID, ...) creates OUT params with the same names as
-- public.utm_campaign columns; PL/pgSQL refuses to disambiguate even with
-- `c.id` qualifications.
-- Fix: `#variable_conflict use_column` directive so column names always win.
-- =============================================================================

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
#variable_conflict use_column
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
