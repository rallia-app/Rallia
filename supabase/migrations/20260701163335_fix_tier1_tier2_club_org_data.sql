-- ============================================================================
-- Fix club data — Mont-Royal, Île des Sœurs, Hillside (facility + organization)
-- ============================================================================
-- Three private-club records had data issues surfaced during B2B outreach prep:
--   1. "Club de Tennis Iles des Soeurs" was misspelled — corrected to the proper
--      "Club de Tennis Île des Sœurs" on both facility and organization.
--   2. organization.email / phone / website were NULL for all three — backfilled
--      from each club's public contact info.
--   3. Hillside's facility.postal_code was H3V1B7 — corrected to H3V1G2.
--
-- Rows are matched by slug (stable across environments) rather than UUID, and
-- every statement is a deterministic UPDATE. This makes the migration idempotent
-- and a safe no-op in any environment where a club isn't present (e.g. fresh
-- local resets — these clubs are not created by seed.sql / seed_facilities.sql).
--
-- NOTE: already applied to rallia-prod on 2026-07-01 via MCP under this same
-- version/name, so `db push` will treat prod as up-to-date and apply it to the
-- other environments on their next push.
-- ============================================================================

BEGIN;

-- 1. Île des Sœurs — name spelling (slug intentionally left as-is: stable identifier)
UPDATE public.facility
   SET name = 'Club de Tennis Île des Sœurs', updated_at = now()
 WHERE slug = 'club-de-tennis-iles-des-soeurs-montreal';

UPDATE public.organization
   SET name = 'Club de Tennis Île des Sœurs', updated_at = now()
 WHERE slug = 'club-de-tennis-iles-des-soeurs-montreal';

-- 2. Backfill organization contact fields (email / phone / website)
UPDATE public.organization
   SET email = 'info@mountroyaltennis.com', phone = '514-488-2557',
       website = 'https://mountroyaltennis.com', updated_at = now()
 WHERE slug = 'club-de-tennis-mont-royal-montreal';

UPDATE public.organization
   SET email = 'info@tennis-ids.com', phone = '514-766-1208',
       website = 'https://www.tennis-ids.com', updated_at = now()
 WHERE slug = 'club-de-tennis-iles-des-soeurs-montreal';

UPDATE public.organization
   SET email = 'info@hillsidetennis.ca', phone = '514-738-6371',
       website = 'https://hillsidetennis.ca', updated_at = now()
 WHERE slug = 'club-de-tennis-hillside-montreal';

-- 3. Hillside — postal code correction (H3V1B7 -> H3V1G2)
UPDATE public.facility
   SET postal_code = 'H3V1G2', updated_at = now()
 WHERE slug = 'club-de-tennis-hillside-montreal';

COMMIT;
