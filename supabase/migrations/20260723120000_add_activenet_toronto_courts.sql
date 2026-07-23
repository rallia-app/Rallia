-- Wire 13 City of Toronto public-park tennis courts to ActiveNet
-- (Active Network / activecommunities.com), Toronto's municipal reservation
-- platform. First deployment of provider_type 'active_net'.
--
-- The facilities landed as static listings in the 2026-07-22 Canadian
-- expansion survey (attributes.source = expansion_court_survey_2026_07);
-- this migration attaches the availability feed. The 13 court↔resource pairs
-- were verified against the live API on 2026-07-22 (exact name match — the
-- survey and ActiveNet share the same City of Toronto source data). See
-- rallia-business/data-and-material/market-research/integration/.
--
-- ActiveNet specifics the config encodes:
--   * Availability comes from the PUBLIC per-resource endpoint
--     GET {base}/rest/reservation/resource/availability/daily/{resourceId}
--     — no session/CSRF (unlike the bulk quick-reservation POST, which is
--     gated). external_provider_id = ActiveNet reservation resource id;
--     comma-separated when a park later gets Court - 2+ resources.
--   * Toronto allows WALK-UP play even on reservable courts, so an available
--     slot means "not booked", not "court is empty" — a weaker signal than
--     booking-mandatory providers (IC3 Montréal). Client copy should say
--     "reservable", not "free".
--   * Booking window: 14 days for residents (7 for L'Amoreaux). A $5/hr
--     City of Toronto insurance fee applies at booking and is not exposed by
--     the availability endpoint, so snapshot rows carry no price.
--   * served_sport_ids = tennis only: reservation group 2 ("Courts") books
--     tennis. Without this, dual-sport parks (Park Lawn, Westmount) would be
--     ambiguous in sport_id resolution — ActiveNet rows carry no
--     facility-type info.
--   * The pre-login resource list caps at ~14 courts; extending coverage
--     beyond these 13 needs an authenticated harvest of the full resource
--     list (then extend the mapping below — exact-name matching holds).
--
-- Ordering: deploy the refresh-facility-availability function (with the
-- 'active_net' adapter) BEFORE or WITH this migration, or refreshes for
-- these facilities error with "Unsupported provider_type" until it ships.

insert into public.data_provider
  (id, name, provider_type, api_base_url, api_config, booking_url_template, is_active, served_sport_ids)
select
  gen_random_uuid(),
  'ActiveNet - City of Toronto',
  'active_net',
  'https://anc.ca.apm.activecommunities.com/toronto',
  '{"timezone": "America/Toronto", "dailyPath": "/rest/reservation/resource/availability/daily", "reservationGroupId": 2}'::jsonb,
  'https://anc.ca.apm.activecommunities.com/toronto/reservation/landing/quick?locale=en-US&groupId=2',
  true,
  (select array_agg(id) from public.sport where name = 'tennis')
where not exists (
  select 1 from public.data_provider where name = 'ActiveNet - City of Toronto'
);

-- Resolve by name + city (not hardcoded ids) so the migration is stable
-- across environments — same rationale as 20260722130000 / the Laval fix in
-- 20260518240100. Only touches facilities that are still unwired, so it is
-- idempotent and never clobbers an existing provider link.
with activenet as (
  select id from public.data_provider where name = 'ActiveNet - City of Toronto'
),
mapping(facility_name, resource_id) as (
  values
    ('Bestview Park',                 '7724'),
    ('Buttonwood Park',               '7725'),
    ('Champlain Parkette',            '338'),
    ('Cliffwood Park',                '7726'),
    ('Fenside Park',                  '7728'),
    ('Jonathan Ashbridge Park',       '3816'),
    ('Manchester Park',               '7733'),
    ('Maple Leaf Park',               '7729'),
    ('Michael Mostyn Balmoral Park',  '7723'),
    ('Park Lawn Park',                '5428'),
    ('Pelmo Park',                    '7730'),
    ('Sweeney Park',                  '7731'),
    ('Westmount Park',                '7734')
)
update public.facility f
   set data_provider_id     = activenet.id,
       external_provider_id = mapping.resource_id,
       timezone             = coalesce(f.timezone, 'America/Toronto')
  from activenet, mapping
 where f.name = mapping.facility_name
   and f.city ilike 'toronto%'
   and f.data_provider_id is null
   and f.external_provider_id is null;
