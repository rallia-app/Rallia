-- Migration: Add availability providers for Boucherville, Blainville, and Stade IGA
--
-- Context: Boucherville and Blainville use the same IC3/Otium protocol as Montreal
-- (same POST body, same response format, different base URLs). Stade IGA uses
-- ActivityMessenger (GET-based API). This migration:
--   1. Removes the UNIQUE constraint on provider_type so multiple cities can share ic3_otium
--   2. Renames Montreal's provider_type from 'loisir_montreal' to 'ic3_otium'
--   3. Adds data_provider entries for each new municipality/venue
--   4. Links organizations and facilities to their providers

-- =============================================================================
-- 1. Drop UNIQUE constraint on provider_type
--    Multiple cities share the same protocol (ic3_otium) — the provider_type
--    identifies the TypeScript class, not the instance.
-- =============================================================================

ALTER TABLE data_provider DROP CONSTRAINT IF EXISTS data_provider_provider_type_key;

-- =============================================================================
-- 2. Rename Montreal's provider_type to the generic IC3/Otium identifier
-- =============================================================================

UPDATE data_provider
SET provider_type = 'ic3_otium',
    name = 'IC3/Otium - Ville de Montréal'
WHERE provider_type = 'loisir_montreal';

-- =============================================================================
-- 3. Insert new IC3/Otium providers
-- =============================================================================

-- Boucherville (confirmed working: 128+ tennis/pickleball slots)
INSERT INTO data_provider (id, name, provider_type, api_base_url, api_config, booking_url_template, is_active)
VALUES (
  gen_random_uuid(),
  'IC3/Otium - Ville de Boucherville',
  'ic3_otium',
  'https://inscriptions.boucherville.ca/Bouchervilleprod/api/U6510',
  '{"searchPath": "/public/search", "defaultLimit": 500}'::jsonb,
  'https://inscriptions.boucherville.ca/Bouchervilleprod/#/U6510/view/{facilityId}/{startDateTime}/{endDateTime}/{facilityScheduleId}',
  true
);

-- Blainville (API works but no availability data configured yet)
INSERT INTO data_provider (id, name, provider_type, api_base_url, api_config, booking_url_template, is_active)
VALUES (
  gen_random_uuid(),
  'IC3/Otium - Ville de Blainville',
  'ic3_otium',
  'https://inscriptions.blainville.ca/IC3.WebSite/api/U6510',
  '{"searchPath": "/public/search/", "defaultLimit": 500}'::jsonb,
  'https://inscriptions.blainville.ca/IC3.WebSite/#/U6510/view/{facilityId}/{startDateTime}/{endDateTime}/{facilityScheduleId}',
  true
);

-- =============================================================================
-- 4. Insert ActivityMessenger provider for Stade IGA
-- =============================================================================

INSERT INTO data_provider (id, name, provider_type, api_base_url, api_config, booking_url_template, is_active)
VALUES (
  gen_random_uuid(),
  'ActivityMessenger - Stade IGA',
  'activity_messenger',
  'https://activitymessenger.com',
  '{"orgId": "2904"}'::jsonb,
  'https://activitymessenger.com/org/2904/package/{packageId}',
  true
);

-- =============================================================================
-- 5. Link organizations to their providers
-- =============================================================================

-- Boucherville org -> IC3/Otium Boucherville provider
UPDATE organization
SET data_provider_id = (
  SELECT id FROM data_provider WHERE name = 'IC3/Otium - Ville de Boucherville' LIMIT 1
)
WHERE id = '9fce7aba-c789-47ca-b71a-eaf0d3c8d97e';

-- Blainville org -> IC3/Otium Blainville provider
UPDATE organization
SET data_provider_id = (
  SELECT id FROM data_provider WHERE name = 'IC3/Otium - Ville de Blainville' LIMIT 1
)
WHERE id = 'e7544de4-8cb7-46d0-aa48-bb7e5b0040f0';

-- =============================================================================
-- 6. Map Boucherville facility external IDs (IC3 siteIds from init endpoint)
-- =============================================================================

-- Parc Pierre-Laporte -> siteId 102 (tennis hard courts)
UPDATE facility
SET external_provider_id = '102'
WHERE id = '82ddd5f2-4429-4b15-83e5-ed882ececb08';

-- Ecole secondaire de Mortagne -> siteId 53 (pickleball courts)
UPDATE facility
SET external_provider_id = '53'
WHERE id = 'b2cf2f2d-3519-4d33-8e63-16791fe1c1fa';

-- =============================================================================
-- 7. Map Stade IGA facilities to ActivityMessenger provider + package IDs
--    These facilities override the org-level provider since Stade IGA
--    is under a Montreal org but uses ActivityMessenger, not IC3.
-- =============================================================================

-- Parc Jarry (Stade IGA) - Terrains de tennis interieurs durs -> package 630
UPDATE facility
SET data_provider_id = (
  SELECT id FROM data_provider WHERE name = 'ActivityMessenger - Stade IGA' LIMIT 1
),
external_provider_id = '630'
WHERE id = 'dfef03b6-3682-4336-870d-51c52a7ac36b';

-- Parc Jarry (Stade IGA) - Terrains de tennis interieurs terre battue -> package 631
UPDATE facility
SET data_provider_id = (
  SELECT id FROM data_provider WHERE name = 'ActivityMessenger - Stade IGA' LIMIT 1
),
external_provider_id = '631'
WHERE id = '74b56876-c674-4162-b852-fa942e61f167';
