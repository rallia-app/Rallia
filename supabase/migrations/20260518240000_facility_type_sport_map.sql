-- IC3/Otium snapshot rows arrive with a deterministic `facility.facilityType`
-- object (`{id, name}`) that identifies the sport per court — far more
-- reliable than the court-name substring fallback the worker uses today.
-- Generic IC3 court names like "Terrain 1, MLK" carry no sport hint, so
-- multi-sport sites end up with sport_id = NULL for any court whose name
-- doesn't literally contain a candidate sport word, and the row becomes
-- invisible to the client's sport filter (Parc Martin-Luther-King is the
-- canonical case: 92/119 tennis rows hidden).
--
-- This migration adds a per-provider `external_facility_type_id → sport_id`
-- mapping table and seeds the mappings discovered by probing the three IC3
-- tenants (Montreal, Boucherville, Blainville) directly. The worker reads
-- this table via resolve_facility_providers and uses it as the primary
-- sport-resolution signal; existing name-substring logic stays as the
-- fallback for any facilityType we haven't mapped yet.

create table public.data_provider_facility_type (
  data_provider_id uuid not null references public.data_provider(id) on delete cascade,
  external_facility_type_id text not null,
  external_facility_type_name text,
  sport_id uuid not null references public.sport(id),
  created_at timestamptz not null default now(),
  primary key (data_provider_id, external_facility_type_id)
);

comment on table public.data_provider_facility_type is
  'Per-provider mapping from the provider''s facilityType identifier to our sport_id. Used by the refresh worker to stamp sport_id on snapshot rows without relying on court-name substring matching.';

-- Read-only from Data API. Worker reads via SECURITY DEFINER RPC.
grant select on public.data_provider_facility_type to anon, authenticated;
grant all    on public.data_provider_facility_type to service_role;

alter table public.data_provider_facility_type enable row level security;

create policy "data_provider_facility_type readable to all"
  on public.data_provider_facility_type
  for select using (true);

-- ============================================================================
-- Seed the three IC3 tenants. Mappings were verified by probing each tenant's
-- /public/search endpoint and inspecting facility.facilityType across all
-- siteIds.
-- ============================================================================

with
  m_sports as (
    select id, name from public.sport where name in ('tennis', 'pickleball')
  ),
  m_montreal as (
    select id from public.data_provider
     where api_base_url = 'https://loisirs.montreal.ca/IC3/api/U6510'
  ),
  m_boucherville as (
    select id from public.data_provider
     where api_base_url = 'https://inscriptions.boucherville.ca/Bouchervilleprod/api/U6510'
  ),
  m_blainville as (
    select id from public.data_provider
     where api_base_url = 'https://inscriptions.blainville.ca/IC3.WebSite/api/U6510'
  )
insert into public.data_provider_facility_type
  (data_provider_id, external_facility_type_id, external_facility_type_name, sport_id)
-- Montreal (loisirs.montreal.ca)
select (select id from m_montreal),     '175', 'Terrain tennis ext',         (select id from m_sports where name = 'tennis')     where exists (select 1 from m_montreal)
union all
select (select id from m_montreal),     '203', 'Terrain de pickleball',      (select id from m_sports where name = 'pickleball') where exists (select 1 from m_montreal)
-- Boucherville (inscriptions.boucherville.ca) — two facilityType ids for tennis (clay + hard).
union all
select (select id from m_boucherville), '14',  'Terrain tennis terre battue', (select id from m_sports where name = 'tennis')     where exists (select 1 from m_boucherville)
union all
select (select id from m_boucherville), '64',  'Terrain tennis dur',          (select id from m_sports where name = 'tennis')     where exists (select 1 from m_boucherville)
union all
select (select id from m_boucherville), '86',  'Terrain pickleball',          (select id from m_sports where name = 'pickleball') where exists (select 1 from m_boucherville)
-- Blainville (inscriptions.blainville.ca)
union all
select (select id from m_blainville),   '22',  'Terrain de tennis',           (select id from m_sports where name = 'tennis')     where exists (select 1 from m_blainville)
union all
select (select id from m_blainville),   '73',  'Terrain pickleball',          (select id from m_sports where name = 'pickleball') where exists (select 1 from m_blainville);

-- ============================================================================
-- Surface the mapping through resolve_facility_providers so the worker has
-- it inline alongside the rest of the provider config. Drop+recreate because
-- the OUT signature changes.
-- ============================================================================

drop function if exists public.resolve_facility_providers(uuid[]);

create function public.resolve_facility_providers(p_facility_ids uuid[])
returns table(
  facility_id uuid,
  external_provider_id text,
  provider_type text,
  api_base_url text,
  api_config jsonb,
  booking_url_template text,
  served_sport_ids uuid[],
  timezone text,
  sports jsonb,
  facility_type_sport_map jsonb
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
    dp.served_sport_ids,
    f.timezone::text,
    coalesce(
      (
        select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name)
        from public.facility_sport fs
        join public.sport s on s.id = fs.sport_id
        where fs.facility_id = f.id
      ),
      '[]'::jsonb
    ) as sports,
    coalesce(
      (
        select jsonb_object_agg(dpft.external_facility_type_id, dpft.sport_id)
        from public.data_provider_facility_type dpft
        where dpft.data_provider_id = dp.id
      ),
      '{}'::jsonb
    ) as facility_type_sport_map
  from public.facility f
  left join public.organization  o  on o.id  = f.organization_id
  left join public.data_provider dp on dp.id = coalesce(f.data_provider_id, o.data_provider_id)
                                   and dp.is_active = true
  where f.id = any(p_facility_ids);
$function$;

grant execute on function public.resolve_facility_providers(uuid[]) to service_role;
