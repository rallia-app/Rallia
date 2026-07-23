-- Wire the four Sud-Ouest borough parks managed by ATSOM (Académie de tennis
-- Sud-Ouest de Montréal) to ActivityMessenger org 4866.
--
-- The parks exist as facilities under the "Ville de Montreal" org (org-level
-- provider = IC3/Otium) but are NOT bookable through Loisirs Montréal — the
-- borough delegated court booking to ATSOM, which runs it on AM. Same
-- facility-level override pattern as Stade IGA (20260415000000).
--
-- ATSOM specifics the config encodes:
--   * Booking is membership-gated ("Abonnement Adulte/Junior Tennis 2026").
--     AM therefore returns every slot with disabled=true for anonymous
--     sessions even when courts are free (hint_availability still lists the
--     free courts). `includeDisabledSlots` makes the refresh worker keep
--     those slots; `membership_required` is set on the facilities so the
--     client can surface the gate.
--   * Two parks run separate tennis and pickleball packages on the same
--     courts, so external_provider_id holds a comma-separated package list
--     (worker support added alongside this migration — deploy the
--     refresh-facility-availability function first, or ATSOM snapshots come
--     back empty until it ships).
--   * Only the 1h packages are wired. The 2h packages (2435/2588/2589/2591/
--     2593/2595) cover the same courts at the same times — a court free
--     17:00–19:00 already shows as free 17:00–18:00 and 18:00–19:00 in the
--     1h feed — so adding them would only duplicate rows. The free
--     ball-machine package (2288) is not court booking and is skipped.
--   * Like Stade IGA (20260613140000), ATSOM may rotate package IDs when
--     seasons change. If ATSOM availability goes blank, re-enumerate via
--     https://activitymessenger.com/org/4866/packages/{514,515,516,517}.
--
-- Package map (verified against the live API 2026-07-22):
--   Parc de la Vérendrye    cat 514: 2434 tennis 1h (terrains 1-9)
--   Parc Roland Proulx      cat 515: 2590 tennis 1h (terrains 1-2)
--   Parc Jacques Viger      cat 516: 2592 tennis 1h, 2594 pickleball 1h
--   Parc Saint Jean de Matha cat 517: 2440 tennis 1h, 2441 pickleball 1h

insert into public.data_provider
  (id, name, provider_type, api_base_url, api_config, booking_url_template, is_active, served_sport_ids)
select
  gen_random_uuid(),
  'ActivityMessenger - ATSOM',
  'activity_messenger',
  'https://activitymessenger.com',
  '{"orgId": "4866", "includeDisabledSlots": true}'::jsonb,
  'https://activitymessenger.com/org/{orgId}/package/{packageId}',
  true,
  (select array_agg(id) from public.sport where name in ('tennis', 'pickleball'))
where not exists (
  select 1 from public.data_provider where name = 'ActivityMessenger - ATSOM'
);

-- Resolve by name (not hardcoded ids) so the migration is stable across
-- environments — see 20260518240100_fix_laval_am_wiring.sql for why. Only
-- touches facilities that are still unwired, so it is idempotent.
with atsom as (
  select id from public.data_provider where name = 'ActivityMessenger - ATSOM'
),
mtl_org as (
  select id from public.organization where name = 'Ville de Montreal'
),
mapping(facility_name, package_ids) as (
  values
    ('ParcDe La Vérendrye',      '2434'),
    ('Place Roland-Proulx',      '2590'),
    ('Parc Jacques-Viger',       '2592,2594'),
    ('Parc Saint-Jean-de-Matha', '2440,2441')
)
update public.facility f
   set data_provider_id     = atsom.id,
       external_provider_id = mapping.package_ids,
       membership_required  = true
  from atsom, mtl_org, mapping
 where f.name = mapping.facility_name
   and f.organization_id = mtl_org.id
   and f.external_provider_id is null;
