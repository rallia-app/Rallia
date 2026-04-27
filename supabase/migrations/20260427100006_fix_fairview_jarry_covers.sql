-- =============================================================================
-- Migration: Fix Fairview and Jarry community cover images
-- Description: The cover URLs seeded in 20260427100000 for the Fairview Smash
--              and Jarry Serve families pointed at Wikimedia files that don't
--              actually exist (404). This migration replaces them:
--                - Jarry Serve  → Coupe Rogers 2015 action shot (CC BY-SA 2.0)
--                - Fairview Smash → NULL (no good free-licensed photo found;
--                                  let the mobile UI show its fallback gradient)
-- Attribution:
--   "Coupe Rogers 2015 @ Montréal !" (CC BY-SA 2.0) — Flickr 19971852104
--   https://commons.wikimedia.org/wiki/File:Coupe_Rogers_2015_@_Montréal_!_(19971852104).jpg
-- =============================================================================

UPDATE public.network
SET cover_image_url = 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Coupe_Rogers_2015_%40_Montr%C3%A9al_%21_%2819971852104%29.jpg/1280px-Coupe_Rogers_2015_%40_Montr%C3%A9al_%21_%2819971852104%29.jpg'
WHERE zone IS NOT NULL
  AND name LIKE 'Jarry Serve — %';

UPDATE public.network
SET cover_image_url = NULL
WHERE zone IS NOT NULL
  AND name LIKE 'Fairview Smash — %';

DO $$
DECLARE
  v_with INTEGER;
  v_total INTEGER;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE cover_image_url IS NOT NULL),
    COUNT(*)
  INTO v_with, v_total
  FROM public.network WHERE zone IS NOT NULL;
  RAISE NOTICE 'Community covers after fix: % / % populated (Fairview intentionally NULL)', v_with, v_total;
END
$$;
