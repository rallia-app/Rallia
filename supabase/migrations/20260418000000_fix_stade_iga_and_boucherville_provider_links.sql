-- Fix provider linkage for Stade IGA and Boucherville facilities.
--
-- The previous migration (20260415000000) used hardcoded facility UUIDs that
-- only matched one environment. This migration re-applies the same links using
-- name-based lookups so it is safe to run in any environment.

-- Stade IGA: link indoor hard courts to ActivityMessenger package 630
UPDATE facility
SET
  data_provider_id = (SELECT id FROM data_provider WHERE name = 'ActivityMessenger - Stade IGA' LIMIT 1),
  external_provider_id = '630'
WHERE name = 'Parc Jarry (Stade IGA) - Terrains de tennis intérieurs durs'
  AND data_provider_id IS NULL;

-- Stade IGA: link indoor clay courts to ActivityMessenger package 631
UPDATE facility
SET
  data_provider_id = (SELECT id FROM data_provider WHERE name = 'ActivityMessenger - Stade IGA' LIMIT 1),
  external_provider_id = '631'
WHERE name = 'Parc Jarry (Stade IGA) - Terrains de tennis intérieurs terre battue'
  AND data_provider_id IS NULL;

-- Link Boucherville and Blainville organizations to their IC3/Otium providers
UPDATE organization
SET data_provider_id = (SELECT id FROM data_provider WHERE name = 'IC3/Otium - Ville de Boucherville' LIMIT 1)
WHERE slug = 'ville-de-boucherville' AND data_provider_id IS NULL;

UPDATE organization
SET data_provider_id = (SELECT id FROM data_provider WHERE name = 'IC3/Otium - Ville de Blainville' LIMIT 1)
WHERE slug = 'ville-de-blainville' AND data_provider_id IS NULL;

-- Boucherville: link Parc Pierre-Laporte to IC3/Otium siteId 102
UPDATE facility
SET external_provider_id = '102'
WHERE name = 'Parc Pierre Laporte'
  AND organization_id = (SELECT id FROM organization WHERE slug = 'ville-de-boucherville' LIMIT 1)
  AND external_provider_id IS NULL;

-- Boucherville: link École secondaire de Mortagne to IC3/Otium siteId 53
UPDATE facility
SET external_provider_id = '53'
WHERE name ILIKE '%mortagne%'
  AND organization_id = (SELECT id FROM organization WHERE slug = 'ville-de-boucherville' LIMIT 1)
  AND external_provider_id IS NULL;
