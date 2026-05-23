-- Fix the Laval-AM wiring that silently no-op'd in
-- 20260516240000_snapshot_booking_url_and_laval_am.sql. That migration
-- hardcoded organization_id = '286a04e5-cc04-4f91-ab57-da743f1ab7b7' for
-- "Ville de Laval", but prod's actual Ville-de-Laval org is
-- '30c879d6-4ce5-4af6-a4a2-b9242c010637'. The UPDATE matched 0 rows there
-- (and likely in staging too), so all 26 Laval city-park facilities are
-- still unwired from AM Tennis Laval in production — the snapshot worker
-- has nothing to fetch, and the app shows no upcoming availability for
-- e.g. Parc St-Victor even though AM has dozens of bookable slots.
--
-- Fix: re-run the wiring, but resolve the org via org.name instead of a
-- hardcoded id so the migration is stable across environments. The UPDATE
-- only touches facilities whose external_provider_id is still NULL, so
-- this is safe to run even on environments where the original migration
-- happened to match (idempotent no-op there).

with am_laval as (
  select id from public.data_provider where name = 'ActivityMessenger - Tennis Laval'
),
laval_org as (
  select id from public.organization where name = 'Ville de Laval'
),
mapping(facility_name, package_id) as (
  values
    ('Parc Bigras',                  '246'),
    ('Parc Bon-Pasteur',             '673'),
    ('Parc Boutillier',              '243'),
    ('Parc Champfleury',             '292'),
    ('Parc Curé-Cursol',             '257'),
    ('Parc des Chênes',              '260'),
    ('Parc des Nénuphars',           '245'),
    ('Parc du Moulin',               '255'),
    ('Parc du Sablon',               '242'),
    ('Parc Goupil',                  '251'),
    ('Parc Isabelle',                '249'),
    ('Parc Jean-XXIII',              '261'),
    ('Parc Louis-Durocher',          '252'),
    ('Parc Marc-Aurèle-Fortin',      '750'),
    ('Parc de Montceau',             '258'),
    ('Parc Notre-Dame-Du-Sourire',   '674'),
    ('Parc Prévost',                 '669'),
    ('Parc Raymond-Millar',          '250'),
    ('Parc Rosaire-Gauthier',        '259'),
    ('Parc St-Édouard',              '248'),
    ('Parc St-Martin',               '244'),
    ('Parc St-Norbert',              '672'),
    ('Parc St-Victor',               '264'),
    ('Parc Sainte-Béatrice',         '671'),
    ('Parc Val-des-Arbres',          '253'),
    ('Parc Wilfrid-Pelletier',       '670')
)
update public.facility f
   set data_provider_id     = am_laval.id,
       external_provider_id = mapping.package_id
  from am_laval, laval_org, mapping
 where f.name = mapping.facility_name
   and f.organization_id = laval_org.id
   and f.external_provider_id is null;
