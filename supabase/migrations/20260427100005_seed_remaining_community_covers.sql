-- =============================================================================
-- Migration: Seed cover images for the remaining 3 zone families
-- Description: Backfills cover_image_url on the 18 communities that shipped
--              without a cover (Monkland Ace, Plateau Ace, Promenades Smash).
--              Sources are Wikimedia Commons under CC BY / CC BY-SA. Display
--              must include attribution per license terms.
-- Attribution:
--   - Monkland Ace:    "Girouard - Monkland" by Jeangagnon (CC BY-SA 4.0)
--                      https://commons.wikimedia.org/wiki/File:Girouard_-_Monkland_-_2023-12-06.jpg
--   - Plateau Ace:     "Parc Jeanne-Mance @ Montréal" via Flickr (CC BY 2.0)
--                      https://commons.wikimedia.org/wiki/File:Parc_Jeanne-Mance_@_Montréal_(30417170042).jpg
--   - Promenades Smash: "Parc Maisonneuve 26" by Jeangagnon (CC BY-SA 3.0)
--                      https://commons.wikimedia.org/wiki/File:Parc_Maisonneuve_26.jpg
-- =============================================================================

UPDATE public.network
SET cover_image_url = 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f7/Girouard_-_Monkland_-_2023-12-06.jpg/1280px-Girouard_-_Monkland_-_2023-12-06.jpg'
WHERE zone IS NOT NULL
  AND name LIKE 'Monkland Ace — %'
  AND cover_image_url IS NULL;

UPDATE public.network
SET cover_image_url = 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Parc_Jeanne-Mance_%40_Montr%C3%A9al_%2830417170042%29.jpg/1280px-Parc_Jeanne-Mance_%40_Montr%C3%A9al_%2830417170042%29.jpg'
WHERE zone IS NOT NULL
  AND name LIKE 'Plateau Ace — %'
  AND cover_image_url IS NULL;

UPDATE public.network
SET cover_image_url = 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Parc_Maisonneuve_26.jpg/1280px-Parc_Maisonneuve_26.jpg'
WHERE zone IS NOT NULL
  AND name LIKE 'Promenades Smash — %'
  AND cover_image_url IS NULL;

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
  RAISE NOTICE 'Community covers: % / % populated', v_with, v_total;
END
$$;
