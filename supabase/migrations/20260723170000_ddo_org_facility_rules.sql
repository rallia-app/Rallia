-- DDO city-wide court rules for the canonical "Ville de Dollard-des-Ormeaux" org
-- facilities (present in both staging and prod via the 2026-07 expansion import).
-- Same source data as 20260723150000: by-law 80-672 signage + ville.ddo.qc.ca.
-- All DDO public courts share one access model. Idempotent.

update facility f
set is_first_come_first_serve = true,
    timezone = coalesce(f.timezone, 'America/Toronto'),
    attributes = coalesce(f.attributes, '{}'::jsonb) || jsonb_build_object('official_info', jsonb_build_object(
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
  and o.name = 'Ville de Dollard-des-Ormeaux';
