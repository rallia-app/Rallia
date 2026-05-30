-- Reduce write I/O (disk IO budget) from the facility availability refresh.
--
-- The previous snapshot_replace_facility_rows() did a blanket
--   DELETE all future slots  +  INSERT (upsert) all payload slots
-- on every refresh. Because the DELETE removed the rows first, the
-- ON CONFLICT path almost never fired, so each refresh rewrote every
-- slot even when the external availability was unchanged. On prod this
-- produced ~2.06M inserts + ~2.06M deletes on a table holding only ~6k
-- live rows (~340x write amplification), which dominated WAL volume,
-- checkpoint flushing, and autovacuum churn.
--
-- This rewrite makes it a true diff:
--   1. Upsert payload rows, but SKIP the write when nothing material
--      changed (WHERE ... IS DISTINCT FROM on DO UPDATE). Unchanged rows
--      produce zero new tuple versions -> no WAL, no page dirtying, no
--      dead tuples for vacuum to reclaim.
--   2. Delete ONLY future slots that vanished from the new payload
--      (anti-join), instead of deleting everything.
--
-- refreshed_at is intentionally excluded from the change comparison and
-- is NOT bumped on unchanged rows (bumping it would mark every row as
-- changed and defeat the optimization). Facility-level freshness is
-- already tracked in facility_refresh_log, which is always upserted.
--
-- Signature, security, and lock/gate semantics are unchanged.
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

  -- 1. Upsert payload rows, writing only the ones that actually changed.
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
        refreshed_at     = excluded.refreshed_at
    where (
            facility_availability_snapshot.slot_end,
            facility_availability_snapshot.is_available,
            facility_availability_snapshot.source,
            facility_availability_snapshot.external_slot_id,
            facility_availability_snapshot.court_name,
            facility_availability_snapshot.court_number,
            facility_availability_snapshot.price_cents,
            facility_availability_snapshot.currency,
            facility_availability_snapshot.sport_id,
            facility_availability_snapshot.booking_url
          ) is distinct from (
            excluded.slot_end,
            excluded.is_available,
            excluded.source,
            excluded.external_slot_id,
            excluded.court_name,
            excluded.court_number,
            excluded.price_cents,
            excluded.currency,
            excluded.sport_id,
            excluded.booking_url
          );

  -- row_count here = rows actually inserted or updated (changed rows only).
  get diagnostics v_written = row_count;

  -- 2. Remove future slots that are no longer present in the payload.
  delete from public.facility_availability_snapshot s
   where s.facility_id = p_facility_id
     and s.slot_start >= now()
     and not exists (
       select 1
         from jsonb_array_elements(p_rows) as e
        where (e->>'slot_start')::timestamptz = s.slot_start
          and (e->>'external_court_id') is not distinct from s.external_court_id
     );

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
