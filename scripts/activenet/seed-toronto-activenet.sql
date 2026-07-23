-- ActiveNet (City of Toronto) availability provider — seed + facility links.
--
-- Wires the 13 Toronto public-park courts verified against ActiveNet on
-- 2026-07-22 (see rallia-business/data-and-material/market-research/
-- integration/toronto-activenet-crosswalk.csv). Run AFTER the adapter code
-- (provider_type 'active_net') is deployed, on STAGING first.
--
-- NOT run automatically. Review, then execute manually.
--
-- Notes:
-- * external_provider_id = ActiveNet reservation resource id (one court per
--   resource for these 13; multi-court parks use a comma-separated list).
-- * Booking is optional in Toronto (walk-up always allowed): an available
--   slot means "not booked", not "court empty".
-- * $5/hr City of Toronto insurance fee applies at booking; not exposed by
--   the availability endpoint, so snapshot rows carry no price.
-- * Verify ToS posture for scheduled polling before enabling in prod.

BEGIN;

-- served_sport_ids = tennis only: ActiveNet reservation group 2 books TENNIS
-- courts (the city's $5/hr insurance line applies to "tennis court bookings").
-- Dual-sport parks (Park Lawn, Westmount) would otherwise be ambiguous during
-- sport_id resolution, since ActiveNet rows carry no facility-type info.
INSERT INTO data_provider (id, name, provider_type, api_base_url, api_config, booking_url_template, is_active, served_sport_ids)
VALUES (
  gen_random_uuid(),
  'ActiveNet - City of Toronto',
  'active_net',
  'https://anc.ca.apm.activecommunities.com/toronto',
  jsonb_build_object(
    'timezone', 'America/Toronto',
    'dailyPath', '/rest/reservation/resource/availability/daily',
    'reservationGroupId', 2
  ),
  'https://anc.ca.apm.activecommunities.com/toronto/reservation/landing/quick?locale=en-US&groupId=2',
  true,
  (SELECT array_agg(id) FROM sport WHERE lower(name) = 'tennis')
)
ON CONFLICT DO NOTHING;

-- Link the 13 verified facilities (exact-name matched, 2026-07-22 migration)
WITH provider AS (
  SELECT id FROM data_provider WHERE name = 'ActiveNet - City of Toronto' LIMIT 1
), crosswalk(facility_id, resource_id) AS (
  VALUES
    ('3a4d5d59-4628-ee51-7c7b-2637b43c1680'::uuid, '7724'),  -- Bestview Park
    ('d20b850f-9f71-d445-5107-6ab92a798368'::uuid, '7725'),  -- Buttonwood Park
    ('677e2e42-542c-93d5-e70a-77d5926f1814'::uuid, '338'),   -- Champlain Parkette
    ('bf883227-dd35-a946-dfb5-2f8e69198225'::uuid, '7726'),  -- Cliffwood Park
    ('ff2dc944-dd2a-a33e-77af-e8c80a6ba492'::uuid, '7728'),  -- Fenside Park
    ('9ecfbf1f-0b40-370c-8a46-bead1425206c'::uuid, '3816'),  -- Jonathan Ashbridge Park
    ('1c9f0d5e-29c1-de8d-bdc6-11f503e11a7c'::uuid, '7733'),  -- Manchester Park
    ('3199728f-3ee4-3e54-ee9b-698e4be8d654'::uuid, '7729'),  -- Maple Leaf Park
    ('46565d37-0e7c-ab44-d891-4791f7f220bc'::uuid, '7723'),  -- Michael Mostyn Balmoral Park
    ('4520c19f-1ca4-5db3-276b-7bca43fc6b68'::uuid, '5428'),  -- Park Lawn Park
    ('c572e4af-6bd2-98e4-1add-815a640e2a5e'::uuid, '7730'),  -- Pelmo Park
    ('15e3b587-871a-9d00-02fe-d65647b59659'::uuid, '7731'),  -- Sweeney Park
    ('754cc1c6-7615-1ff4-de4f-bf54e93cd09c'::uuid, '7734')   -- Westmount Park
)
UPDATE facility f
SET data_provider_id = provider.id,
    external_provider_id = crosswalk.resource_id,
    timezone = COALESCE(f.timezone, 'America/Toronto'),
    updated_at = now()
FROM provider, crosswalk
WHERE f.id = crosswalk.facility_id
  AND f.data_provider_id IS NULL;   -- never clobber an existing wiring

-- Expect: 13
SELECT count(*) AS wired
FROM facility
WHERE external_provider_id IS NOT NULL
  AND data_provider_id = (SELECT id FROM data_provider WHERE name = 'ActiveNet - City of Toronto');

COMMIT;
