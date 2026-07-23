-- Enrich Montreal-area facility data researched 2026-07-23 (follow-up to 20260723150000):
-- 1. add documented cancellation policies to attributes.official_info
-- 2. backfill facility_contact emails/phones from official_info (pipeline rows had none)
-- Scoped to facilities carrying attributes.official_info. Idempotent.

-- 1. Cancellation policies (only where an official page documents one) ----------
update facility set attributes = jsonb_set(attributes, '{official_info,cancellation}',
  to_jsonb('Cancel at least 3 hours ahead via the borough cancellation form; credit only, no refunds. Rain closures within the first 25 minutes are credited.'::text))
where slug in ('parc-jeanne-mance-montreal','parc-la-fontaine-montreal') and attributes ? 'official_info';

update facility set attributes = jsonb_set(attributes, '{official_info,cancellation}',
  to_jsonb('By email only (tenniscdn-ndg@montreal.ca), at least 4 hours before the reserved slot; no phone cancellations.'::text))
where slug in ('parc-martin-luther-king-montreal','parc-warren-allmand-montreal') and attributes ? 'official_info';

update facility set attributes = jsonb_set(attributes, '{official_info,cancellation}',
  to_jsonb('Cancel at least 2 hours before the reserved slot.'::text))
where slug = 'parc-beaubien-montreal' and attributes ? 'official_info';

update facility set attributes = jsonb_set(attributes, '{official_info,cancellation}',
  to_jsonb('Cancel at least 2 hours ahead; arriving more than 10 minutes late forfeits the reservation.'::text))
where slug = 'parc-f-x-garneau-montreal' and attributes ? 'official_info';

update facility set attributes = jsonb_set(attributes, '{official_info,cancellation}',
  to_jsonb('Self-serve cancellation on Loisirs Montreal; the court is forfeited 15 minutes after the slot starts.'::text))
where slug in ('parc-arthur-therrien-montreal','parc-dan-hanganu-elgar-montreal','parc-de-la-fontaine-montreal','parc-de-la-reine-elizabeth-montreal','parc-wilson-montreal')
  and attributes ? 'official_info';

update facility set attributes = jsonb_set(attributes, '{official_info,cancellation}',
  to_jsonb('Cancelled 24 hours or more ahead: full credit; under 24 hours: 50 percent credit; no-show: no credit.'::text))
where slug in ('parc-jarry-stade-iga-terrains-de-tennis-exterieurs-durs-montreal','parc-jarry-stade-iga-terrains-de-tennis-interieurs-durs-montreal','parc-jarry-stade-iga-terrains-de-tennis-interieurs-terre-battue-montreal')
  and attributes ? 'official_info';

update facility set attributes = jsonb_set(attributes, '{official_info,cancellation}',
  to_jsonb('Cancel online at least 24 hours ahead; unclaimed courts are released after 15 minutes, no refunds for no-shows.'::text))
where slug = 'parc-hampstead-montreal' and attributes ? 'official_info';

update facility set attributes = jsonb_set(attributes, '{official_info,cancellation}',
  to_jsonb('Cancel up to 2 hours before the reservation (Amilia or OPEN app).'::text))
where slug = 'parc-rembrandt-montreal' and attributes ? 'official_info';

update facility set attributes = jsonb_set(attributes, '{official_info,cancellation}',
  to_jsonb('No refunds for weather closures; the borough may cancel a reserved slot up to 3 times per season.'::text))
where slug = 'parc-lasalle-montreal' and attributes ? 'official_info';

update facility set attributes = jsonb_set(attributes, '{official_info,cancellation}',
  to_jsonb('Self-serve cancellation on Loisirs Montreal.'::text))
where slug in ('parc-alexis-nihon-montreal','parc-marcel-laurin-montreal') and attributes ? 'official_info';

-- 2. Contact backfill from official_info ----------------------------------------
-- Emails on the general contact row (screen reads general email first)
update facility_contact fc
set email = f.attributes#>>'{official_info,email}'
from facility f
where fc.facility_id = f.id
  and fc.contact_type = 'general'
  and fc.email is null
  and f.attributes#>>'{official_info,email}' is not null;

-- Phones on existing reservation rows (first NANP number only, tel:-safe)
update facility_contact fc
set phone = (regexp_match(f.attributes#>>'{official_info,phone}', '\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}'))[1]
from facility f
where fc.facility_id = f.id
  and fc.contact_type = 'reservation'
  and fc.phone is null
  and f.attributes#>>'{official_info,phone}' ~ '\d{3}[ .-]?\d{3}[ .-]?\d{4}';

-- Phones on the general row when the facility has no reservation-row phone
update facility_contact fc
set phone = (regexp_match(f.attributes#>>'{official_info,phone}', '\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}'))[1]
from facility f
where fc.facility_id = f.id
  and fc.contact_type = 'general'
  and fc.phone is null
  and f.attributes#>>'{official_info,phone}' ~ '\d{3}[ .-]?\d{3}[ .-]?\d{4}'
  and not exists (
    select 1 from facility_contact r
    where r.facility_id = f.id and r.contact_type = 'reservation' and r.phone is not null);

-- General rows for enriched facilities that have none (e.g. DDO-org parks)
insert into facility_contact (facility_id, contact_type, is_primary, email,
  phone, website)
select f.id, 'general', true,
  f.attributes#>>'{official_info,email}',
  (regexp_match(coalesce(f.attributes#>>'{official_info,phone}', ''), '\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}'))[1],
  coalesce(f.attributes#>>'{official_info,page_fr}', f.attributes#>>'{official_info,page_en}')
from facility f
where f.attributes ? 'official_info'
  and not exists (
    select 1 from facility_contact fc
    where fc.facility_id = f.id and fc.contact_type = 'general');
