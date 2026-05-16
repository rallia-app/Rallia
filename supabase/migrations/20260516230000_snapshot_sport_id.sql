-- Add sport_id to facility_availability_snapshot so the read-side can filter
-- by an authoritative key instead of substring-matching court_name. The
-- refresh worker resolves sport once per row at ingestion using
-- facility_sport (with court_name substring as a tie-breaker for the handful
-- of multi-sport IC3 sites like Parc La Fontaine that share a siteId across
-- tennis and pickleball).

alter table public.facility_availability_snapshot
  add column sport_id uuid references public.sport(id);

create index if not exists idx_fas_facility_sport_window
  on public.facility_availability_snapshot (facility_id, sport_id, slot_start)
  where is_available = true;

-- Extend resolve_facility_providers to also return the facility's sport
-- associations so the worker can stamp sport_id per row without an extra
-- round trip per facility. Drop first because the return-type signature is
-- changing (Postgres won't allow OUT parameter changes via CREATE OR REPLACE).
drop function if exists public.resolve_facility_providers(uuid[]);

create function public.resolve_facility_providers(p_facility_ids uuid[])
returns table(
  facility_id uuid,
  external_provider_id text,
  provider_type text,
  api_base_url text,
  api_config jsonb,
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

-- Update snapshot_replace_facility_rows to persist sport_id from input rows.
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
