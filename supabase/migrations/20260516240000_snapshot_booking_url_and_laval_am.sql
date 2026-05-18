-- Move booking-URL building from the client into the refresh worker.
-- Store the resolved URL per snapshot row so the hook can read it as-is
-- without provider-specific string interpolation. As part of this we
-- generalize the AM booking template with an `{orgId}` placeholder so
-- additional AM orgs (Tennis Laval, etc.) can share one template shape.
--
-- Then provision the new Tennis Laval AM provider and link the 25 city
-- park facilities whose package IDs we discovered via the Tennis Laval
-- microsite scan.

alter table public.facility_availability_snapshot
  add column booking_url text;

-- Extend resolve_facility_providers to expose booking_url_template so the
-- worker can build the URL server-side. Drop+recreate because the OUT
-- parameters change.
drop function if exists public.resolve_facility_providers(uuid[]);

create function public.resolve_facility_providers(p_facility_ids uuid[])
returns table(
  facility_id uuid,
  external_provider_id text,
  provider_type text,
  api_base_url text,
  api_config jsonb,
  booking_url_template text,
  sports jsonb
)
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    f.id                                                    as facility_id,
    f.external_provider_id,
    dp.provider_type::text,
    dp.api_base_url::text,
    dp.api_config,
    dp.booking_url_template::text,
    coalesce(
      (
        select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name)
        from public.facility_sport fs
        join public.sport s on s.id = fs.sport_id
        where fs.facility_id = f.id
      ),
      '[]'::jsonb
    ) as sports
  from public.facility f
  left join public.organization  o  on o.id  = f.organization_id
  left join public.data_provider dp on dp.id = coalesce(f.data_provider_id, o.data_provider_id)
                                   and dp.is_active = true
  where f.id = any(p_facility_ids);
$function$;

-- Existing data has booking_url = NULL; the next refresh of each facility
-- will populate it. The hook tolerates NULL (button is disabled, same as
-- it already does for unbuildable URLs).

-- Generalize Stade IGA's template — replace the hardcoded orgId with the
-- {orgId} placeholder. End result is identical (worker resolves it from
-- api_config.orgId = "2904"), but the template now matches what Tennis
-- Laval will use.
update public.data_provider
   set booking_url_template = 'https://activitymessenger.com/org/{orgId}/package/{packageId}'
 where name = 'ActivityMessenger - Stade IGA';

-- New provider row for Tennis Laval (orgId 1407 on AM). Same template
-- shape, different orgId.
insert into public.data_provider (
  name, provider_type, api_base_url, api_config, booking_url_template, is_active
) values (
  'ActivityMessenger - Tennis Laval',
  'activity_messenger',
  'https://activitymessenger.com',
  '{"orgId":"1407"}'::jsonb,
  'https://activitymessenger.com/org/{orgId}/package/{packageId}',
  true
);

-- Persist sport_id + booking_url on snapshot rows by extending the
-- write RPC. The signature stays the same; only the column list changes.
create or replace function public.snapshot_replace_facility_rows(
  p_facility_id uuid,
  p_source text,
  p_rows jsonb
)
returns table(status text, rows_written integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lock_key bigint;
  v_lock_ok  boolean;
  v_needed   boolean;
  v_written  int;
begin
  v_lock_key := hashtextextended('snapshot_refresh:' || p_facility_id::text, 0);
  v_lock_ok  := pg_try_advisory_xact_lock(v_lock_key);
  if not v_lock_ok then
    status := 'locked'; rows_written := 0;
    return next; return;
  end if;

  v_needed := public.snapshot_needs_refresh(p_facility_id);
  if not v_needed then
    delete from public.facility_refresh_lease where facility_id = p_facility_id;
    status := 'already_fresh'; rows_written := 0;
    return next; return;
  end if;

  delete from public.facility_availability_snapshot
   where facility_id = p_facility_id
     and slot_start >= now();

  insert into public.facility_availability_snapshot (
    facility_id,
    external_court_id,
    slot_start,
    slot_end,
    is_available,
    source,
    external_slot_id,
    court_name,
    court_number,
    price_cents,
    currency,
    sport_id,
    booking_url,
    refreshed_at
  )
  select
    p_facility_id,
    elem->>'external_court_id',
    (elem->>'slot_start')::timestamptz,
    (elem->>'slot_end')::timestamptz,
    coalesce((elem->>'is_available')::boolean, true),
    p_source,
    nullif(elem->>'external_slot_id', ''),
    nullif(elem->>'court_name', ''),
    nullif(elem->>'court_number', '')::int,
    nullif(elem->>'price_cents', '')::int,
    nullif(elem->>'currency', ''),
    nullif(elem->>'sport_id', '')::uuid,
    nullif(elem->>'booking_url', ''),
    now()
  from jsonb_array_elements(p_rows) as elem
  on conflict (facility_id, external_court_id, slot_start) do update
    set slot_end         = excluded.slot_end,
        is_available     = excluded.is_available,
        source           = excluded.source,
        external_slot_id = excluded.external_slot_id,
        court_name       = excluded.court_name,
        court_number     = excluded.court_number,
        price_cents      = excluded.price_cents,
        currency         = excluded.currency,
        sport_id         = excluded.sport_id,
        booking_url      = excluded.booking_url,
        refreshed_at     = excluded.refreshed_at;

  get diagnostics v_written = row_count;

  insert into public.facility_refresh_log (
    facility_id, refreshed_at, source, last_error, consecutive_errors
  )
  values (p_facility_id, now(), p_source, null, 0)
  on conflict (facility_id) do update
    set refreshed_at       = excluded.refreshed_at,
        source             = excluded.source,
        last_error         = null,
        consecutive_errors = 0;

  delete from public.facility_refresh_lease where facility_id = p_facility_id;

  status := 'wrote'; rows_written := v_written;
  return next;
end;
$function$;

-- Link 25 Ville de Laval city park facilities to Tennis Laval AM packages.
-- Package IDs sourced from a scan of Tennis Laval's public availability
-- endpoint; we use the higher pkg ID per resident/non-resident pair (the
-- one that matches what the public iframe surfaces by default).
with am_laval as (
  select id from public.data_provider where name = 'ActivityMessenger - Tennis Laval'
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
  from am_laval, mapping
 where f.name = mapping.facility_name
   and f.organization_id = '286a04e5-cc04-4f91-ab57-da743f1ab7b7';  -- Ville de Laval
