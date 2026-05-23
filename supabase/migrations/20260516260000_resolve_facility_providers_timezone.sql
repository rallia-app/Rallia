-- Surface facility.timezone in resolve_facility_providers so the refresh
-- worker can compute the date window in the facility's local timezone
-- instead of UTC. Without this, between ~8pm and midnight EDT the worker
-- treats UTC's "tomorrow" as "today" and silently drops the remaining
-- Montreal evening's slots. Equivalent issues will exist for facilities
-- in other zones (PST, etc.) once we expand outside Quebec.

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
    f.timezone::text,
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
