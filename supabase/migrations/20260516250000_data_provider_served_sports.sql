-- Some external providers only serve a subset of the sports their linked
-- facilities are tagged with. Example: Parc Le Boutillier has both tennis
-- and pickleball in facility_sport, but the AM "Tennis Laval" provider
-- only emits tennis events (pickleball lives on pickleballenligne.com).
-- The worker's court-name substring fallback can't disambiguate those rows
-- because AM court names ("Le Boutillier - Terrain 1") don't mention the
-- sport at all — so it writes sport_id = NULL and the row is invisible to
-- the sport filter.
--
-- Fix: each data_provider declares which sports it actually serves. The
-- worker intersects facility_sport with served_sport_ids: if the
-- intersection is a single sport, stamp it; otherwise fall back to the
-- court-name substring.

alter table public.data_provider
  add column served_sport_ids uuid[];

-- AM providers (Stade IGA, Tennis Laval): tennis only.
update public.data_provider
   set served_sport_ids = array[(select id from public.sport where name = 'tennis')]
 where provider_type = 'activity_messenger';

-- IC3/Otium providers (Montréal, Boucherville, Blainville): both tennis
-- and pickleball — multi-sport sites like Parc La Fontaine return courts
-- for both, distinguished by court_name substring.
update public.data_provider
   set served_sport_ids = (
     select array_agg(id) from public.sport where name in ('tennis', 'pickleball')
   )
 where provider_type = 'ic3_otium';

-- Expose served_sport_ids via resolve_facility_providers so the worker has
-- it inline. Drop+recreate to extend the OUT signature.
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
    dp.served_sport_ids,
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
