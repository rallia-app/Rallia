-- Repoint the 3 Stade IGA (Parc Jarry) facilities to their current
-- ActivityMessenger package IDs.
--
-- Stade IGA runs separate seasonal packages on ActivityMessenger. The IDs we
-- had (winter "Régulier" packages: 630 indoor hard, 631 indoor clay, 1153
-- outdoor hard, valid "2 octobre au 31 mai") stopped returning availability
-- once the winter season closed and the summer packages ("☀️ 1er juin au
-- 1er octobre inclus") took over with brand-new IDs. Real-time availability
-- went blank for all 3 facilities as a result.
--
-- New summer package IDs (org 2904, category "Location de terrains"):
--   2449  Intérieur dur  ☀️  (courts Intérieur 2-12)
--   2450  Terre battue   ☀️  (courts Terre battue 1-4)
--   2451  Extérieur      ☀️  (courts Extérieur 5/6/9)
--
-- These return the same open-slot shape the refresh worker already parses, so
-- no code change is needed. Matching on the old external_provider_id keeps the
-- update idempotent and safe to re-run.

UPDATE facility
SET external_provider_id = '2449'
WHERE name = 'Parc Jarry (Stade IGA) - Terrains de tennis intérieurs durs'
  AND external_provider_id = '630';

UPDATE facility
SET external_provider_id = '2450'
WHERE name = 'Parc Jarry (Stade IGA) - Terrains de tennis intérieurs terre battue'
  AND external_provider_id = '631';

UPDATE facility
SET external_provider_id = '2451'
WHERE name = 'Parc Jarry (Stade IGA) - Terrains de tennis extérieurs durs'
  AND external_provider_id = '1153';
