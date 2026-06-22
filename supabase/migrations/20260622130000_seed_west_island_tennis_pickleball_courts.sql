-- Seed West Island public/club tennis & pickleball courts (DDO, Pointe-Claire, Sainte-Anne-de-Bellevue).
-- Source: West Island court survey (2026-06). Coordinates geocoded from the listed addresses.
-- Court model: "Tennis Courts (#)" = physical courts; the first n_multi of them carry pickleball lines
-- (lines_marked_for_multiple_sports = true, linked to both sports). Dedicated pickleball-only courts
-- (n_dedicated) are added when pickleball capacity exceeds the tennis-court count (e.g. Parc Crevier).
-- Deterministic md5 UUIDs + ON CONFLICT (id) DO NOTHING make this migration idempotent.

begin;

-- 1. Organizations: 3 municipalities + 2 private clubs
insert into organization (id, name, slug, nature, type, city, country, is_active)
select md5('rallia-seed:org:' || slug)::uuid, name, slug,
       nature::organization_nature_enum, type::organization_type_enum, city, 'Canada'::country_enum, true
from (values
  ('ville-de-dollard-des-ormeaux',     'Ville de Dollard-des-Ormeaux',     'public',  'municipality', 'Dollard-des-Ormeaux'),
  ('ville-de-pointe-claire',           'Ville de Pointe-Claire',           'public',  'municipality', 'Pointe-Claire'),
  ('ville-de-sainte-anne-de-bellevue', 'Ville de Sainte-Anne-de-Bellevue', 'public',  'municipality', 'Sainte-Anne-de-Bellevue'),
  ('clearpoint-tennis-club',           'Clearpoint Tennis Club',           'private', 'club',         'Pointe-Claire'),
  ('summerhill-tennis-club',           'Summerhill Tennis Club',           'private', 'club',         'Pointe-Claire')
) as o(slug, name, nature, type, city)
on conflict (id) do nothing;

-- 2. Per-facility config (single source of truth for facilities + courts + sport links)
create temporary table tmp_seed (
  fslug               text primary key,
  fname               text not null,
  org_slug            text not null,
  address             text,
  city                text not null,
  postal_code         text,
  lat                 numeric not null,
  lng                 numeric not null,
  surface             surface_type_enum not null,  -- tennis / multi-sport court surface
  pb_surface          surface_type_enum not null,  -- dedicated pickleball court surface
  n_tennis            int not null,                -- total physical (tennis) courts
  n_multi             int not null,                -- of those, how many also carry pickleball lines
  n_dedicated         int not null,                -- extra pickleball-only courts
  membership_required boolean not null,
  access              text not null,               -- public | club | residents_only
  description         text
) on commit drop;

insert into tmp_seed (fslug, fname, org_slug, address, city, postal_code, lat, lng, surface, pb_surface, n_tennis, n_multi, n_dedicated, membership_required, access, description) values
  -- Dollard-des-Ormeaux (all hard/acrylic, every court lined for pickleball)
  ('coolbrooke-park-dollard-des-ormeaux',          'Coolbrooke Park',         'ville-de-dollard-des-ormeaux', '260 Spring Garden St', 'Dollard-des-Ormeaux', 'H9B 1S6', 45.498057, -73.792333, 'hard', 'hard', 3, 3, 0, false, 'public', 'All 3 courts have pickleball lines.'),
  ('terry-fox-park-dollard-des-ormeaux',           'Terry Fox Park',          'ville-de-dollard-des-ormeaux', '100 Rue Fairview',     'Dollard-des-Ormeaux', 'H9A 1V9', 45.494489, -73.827163, 'hard', 'hard', 3, 3, 0, false, 'public', 'All 3 courts have pickleball lines.'),
  ('edward-janiszewski-park-dollard-des-ormeaux',  'Edward Janiszewski Park', 'ville-de-dollard-des-ormeaux', '264 Rue Ernest',       'Dollard-des-Ormeaux', 'H9A 3G6', 45.486576, -73.839765, 'hard', 'hard', 3, 3, 0, false, 'public', 'All 3 courts have pickleball lines.'),
  ('elm-park-dollard-des-ormeaux',                 'Elm Park',                'ville-de-dollard-des-ormeaux', '540 Rue Montcalm',     'Dollard-des-Ormeaux', 'H9G 1K7', 45.467147, -73.842553, 'hard', 'hard', 3, 3, 0, false, 'public', 'All 3 courts have pickleball lines.'),
  ('fairview-park-dollard-des-ormeaux',            'Fairview Park',           'ville-de-dollard-des-ormeaux', 'Blue Haven St',        'Dollard-des-Ormeaux', 'H9G 1N6', 45.471184, -73.832632, 'hard', 'hard', 3, 3, 0, false, 'public', 'All 3 courts have pickleball lines.'),
  ('lake-road-park-dollard-des-ormeaux',           'Lake Road Park',          'ville-de-dollard-des-ormeaux', '85 Rue Hemingway',     'Dollard-des-Ormeaux', 'H9G 2J2', 45.483697, -73.831606, 'hard', 'hard', 4, 4, 0, false, 'public', 'All 4 courts have pickleball lines.'),
  ('sunnybrooke-park-dollard-des-ormeaux',         'Sunnybrooke Park',        'ville-de-dollard-des-ormeaux', '7 Rue Cadman',         'Dollard-des-Ormeaux', 'H9B 1X5', 45.494650, -73.798829, 'hard', 'hard', 3, 3, 0, false, 'public', 'All 3 courts have pickleball lines.'),
  ('westminster-park-dollard-des-ormeaux',         'Westminster Park',        'ville-de-dollard-des-ormeaux', '535 Rue Westminster',  'Dollard-des-Ormeaux', 'H9G 1G3', 45.473059, -73.845043, 'hard', 'hard', 3, 3, 0, false, 'public', 'All 3 courts have pickleball lines.'),
  -- Pointe-Claire (public municipal parks)
  ('parc-alexandre-bourgeau-pointe-claire',        'Parc Alexandre-Bourgeau', 'ville-de-pointe-claire',       '2 Cartier Ave',              'Pointe-Claire', 'H9S 4R3', 45.427887, -73.822892, 'hard',    'hard',    2, 1, 0, false, 'public', null),
  ('parc-arthur-seguin-pointe-claire',             'Parc Arthur-Séguin',      'ville-de-pointe-claire',       '369 Saint-Louis Ave',        'Pointe-Claire', 'H9R 2A1', 45.453787, -73.810030, 'asphalt', 'asphalt', 2, 2, 0, false, 'public', null),
  ('parc-cedar-pointe-claire',                     'Parc Cedar',              'ville-de-pointe-claire',       '20 Robinsdale Ave',          'Pointe-Claire', 'H9R 2J5', 45.445593, -73.822705, 'hard',    'hard',    2, 1, 0, false, 'public', null),
  ('parc-northview-pointe-claire',                 'Parc Northview',          'ville-de-pointe-claire',       '11 Avenue Viking',           'Pointe-Claire', 'H9R 1K4', 45.462074, -73.811573, 'asphalt', 'asphalt', 2, 2, 0, false, 'public', null),
  ('parc-ovide-pointe-claire',                     'Parc Ovide',              'ville-de-pointe-claire',       '20 Av. Ovide',               'Pointe-Claire', 'H9S 4J1', 45.444549, -73.803301, 'asphalt', 'asphalt', 3, 1, 0, false, 'public', null),
  ('parc-valois-pointe-claire',                    'Parc Valois',             'ville-de-pointe-claire',       '40 Av. de la Baie de Valois','Pointe-Claire', 'H9R 4B3', 45.450964, -73.793856, 'hard',    'hard',    3, 2, 0, false, 'public', null),
  -- Pointe-Claire (private clubs, clay, no pickleball)
  ('clearpoint-tennis-club-pointe-claire',         'Clearpoint Tennis Club',  'clearpoint-tennis-club',       '40 Av. de Killarney Gardens','Pointe-Claire', 'H9S 4E2', 45.435092, -73.818903, 'clay',    'clay',    5, 0, 0, true,  'club',   'Private tennis club — 5 clay courts.'),
  ('summerhill-tennis-club-pointe-claire',         'Summerhill Tennis Club',  'summerhill-tennis-club',       '81 Av. Summerhill',          'Pointe-Claire', 'H9R 2L4', 45.457223, -73.791797, 'clay',    'clay',    5, 0, 0, true,  'club',   'Private tennis club — 5 clay courts.'),
  -- Sainte-Anne-de-Bellevue (residents only)
  ('parc-crevier-sainte-anne-de-bellevue',         'Parc Crevier',            'ville-de-sainte-anne-de-bellevue', '35 Rue Perrault',        'Sainte-Anne-de-Bellevue', 'H9X 2E1', 45.403672, -73.946220, 'hard', 'hard', 1, 1, 3, false, 'residents_only', 'Family clientele; residents only.'),
  ('parc-aumais-sainte-anne-de-bellevue',          'Parc Aumais',             'ville-de-sainte-anne-de-bellevue', '300 Rue Cypihot',        'Sainte-Anne-de-Bellevue', 'H9X 4A7', 45.438556, -73.928734, 'hard', 'hard', 3, 3, 0, false, 'residents_only', 'Family clientele; residents only; 3 tennis courts with pickleball lines.');

-- 3. Facilities
insert into facility (id, organization_id, name, slug, facility_type, address, city, postal_code, country,
                      latitude, longitude, location, membership_required, is_first_come_first_serve,
                      timezone, description, attributes, is_active)
select md5('rallia-seed:facility:' || s.fslug)::uuid,
       md5('rallia-seed:org:' || s.org_slug)::uuid,
       s.fname, s.fslug, 'park'::facility_type_enum, s.address, s.city, s.postal_code, 'Canada'::country_enum,
       s.lat, s.lng, ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326)::geography,
       s.membership_required, false, 'America/Toronto', s.description,
       jsonb_build_object('access', s.access, 'source', 'west_island_court_survey_2026_06'),
       true
from tmp_seed s
on conflict (id) do nothing;

-- 4. Courts (tennis/multi courts numbered 1..n_tennis, dedicated pickleball courts after)
with expanded as (
  select s.fslug, md5('rallia-seed:facility:' || s.fslug)::uuid as fid,
         g as court_number, s.surface as surface_type, (g <= s.n_multi) as is_multi
  from tmp_seed s, generate_series(1, s.n_tennis) g
  union all
  select s.fslug, md5('rallia-seed:facility:' || s.fslug)::uuid,
         s.n_tennis + g, s.pb_surface, false
  from tmp_seed s, generate_series(1, s.n_dedicated) g
)
insert into court (id, facility_id, court_number, name, surface_type,
                   lines_marked_for_multiple_sports, indoor, lighting, availability_status, is_active)
select md5('rallia-seed:court:' || e.fslug || ':' || e.court_number)::uuid,
       e.fid, e.court_number, 'Court ' || e.court_number, e.surface_type,
       e.is_multi, false, false, 'available'::availability_enum, true
from expanded e
on conflict (id) do nothing;

-- 5. Court ↔ sport links (tennis courts -> tennis; multi -> + pickleball; dedicated -> pickleball)
insert into court_sport (id, court_id, sport_id)
select md5('rallia-seed:cs:' || c.id::text || ':' || sp.slug)::uuid, c.id, sp.id
from court c
join tmp_seed s on c.facility_id = md5('rallia-seed:facility:' || s.fslug)::uuid
join lateral (
  select 'tennis'::text as slug     where c.court_number <= s.n_tennis
  union all
  select 'pickleball'::text          where c.court_number <= s.n_multi
  union all
  select 'pickleball'::text          where c.court_number >  s.n_tennis
) needs on true
join sport sp on sp.slug = needs.slug
on conflict (id) do nothing;

-- 6. Facility ↔ sport links
insert into facility_sport (id, facility_id, sport_id)
select md5('rallia-seed:fs:' || s.fslug || ':' || sp.slug)::uuid,
       md5('rallia-seed:facility:' || s.fslug)::uuid, sp.id
from tmp_seed s
join lateral (
  select 'tennis'::text as slug
  union all
  select 'pickleball'::text where (s.n_multi > 0 or s.n_dedicated > 0)
) needs on true
join sport sp on sp.slug = needs.slug
on conflict (id) do nothing;

commit;
