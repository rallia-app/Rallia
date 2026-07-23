-- Follow-up to 20260723150000_montreal_facility_data_corrections.sql.
-- The three Dollard-des-Ormeaux facilities carry random slug suffixes that differ
-- between staging and prod, so slug matching no-ops in some environments.
-- Match them by (organization, name) instead. Idempotent; safe to run everywhere.

update facility f
set is_first_come_first_serve = true,
    city = 'Dollard-Des Ormeaux',
    timezone = coalesce(f.timezone, 'America/Toronto'),
    postal_code = nullif(trim(f.postal_code), '')
from organization o
where o.id = f.organization_id
  and o.name = 'Ville de Montreal'
  and f.name in ('Coolbrooke Park', 'Parc Terry Fox', 'Parc Westwood');

update facility f
set address = '260 Spring Garden St'
from organization o
where o.id = f.organization_id
  and o.name = 'Ville de Montreal'
  and f.name = 'Coolbrooke Park';

update facility f
set attributes = coalesce(f.attributes, '{}'::jsonb) || jsonb_build_object('official_info', jsonb_build_object(
  'borough', 'Dollard-des-Ormeaux (city)',
  'checked_at', '2026-07-23',
  'source', 'official website',
  'page_fr', 'https://ville.ddo.qc.ca/ma-municipalite/installations/parcs-et-terrains-de-jeux',
  'page_en', 'https://ville.ddo.qc.ca/en/play/sports-and-leisure/parks-and-playgrounds/',
  'phone', '514 684-1010',
  'email', 'ville@ddo.qc.ca',
  'booking', 'No reservation, first-come-first-served, 1h courtesy limit; DDO residents only (by-law 80-672)',
  'fees', 'Free',
  'season', 'Play 8:00-22:00',
  'operator', 'City of Dollard-des-Ormeaux'))
from organization o
where o.id = f.organization_id
  and o.name = 'Ville de Montreal'
  and f.name in ('Coolbrooke Park', 'Parc Terry Fox', 'Parc Westwood');
