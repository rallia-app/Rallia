-- ============================================================================
-- Chat Match Organizer — create_casual_match
-- ============================================================================
-- Atomically create a match from a mutually-agreed chat-organizer option and
-- drop every chosen player straight into it as a joined participant (no invite
-- dance — they already agreed in chat).
--
--  * Takes the option's absolute slot_start (timestamptz) + facility and derives
--    the stored match_date / start_time / timezone from the facility's local
--    wall-clock, so the caller never has to do timezone math. No facility (TBD
--    location) falls back to America/Toronto.
--  * created_by = caller; the host participant is added by the existing
--    create_host_participant trigger (20260112000000).
--  * visibility=private + visible_in_groups/communities=false so the nearby- and
--    group-notification triggers stay quiet (these players were hand-picked in a
--    DM; this is not a public listing).
--  * Idempotent on the source organizer message: the first confirmation stamps
--    metadata.created_match_id; concurrent/repeat confirmations return that id
--    instead of creating a duplicate (row-locked to serialize).
-- ============================================================================

-- Drop any earlier signature so rpc() never resolves to an ambiguous overload.
drop function if exists public.create_casual_match(
  uuid, date, time, time, text, uuid[], match_format_enum, uuid, uuid, int
);
drop function if exists public.create_casual_match(
  uuid, timestamptz, uuid[], match_format_enum, uuid, int, uuid, int
);

create or replace function public.create_casual_match(
  p_sport_id          uuid,
  p_slot_start        timestamptz,
  p_player_ids        uuid[],
  p_format            match_format_enum default 'singles',
  p_facility_id       uuid default null,
  p_duration_minutes  int  default 60,
  p_source_message_id uuid default null,
  p_option_index      int  default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller      uuid := auth.uid();
  v_match_id    uuid;
  v_existing    uuid;
  v_pid         uuid;
  v_tz          text;
  v_local_start timestamp;
begin
  if v_caller is null then
    raise exception using errcode = 'P0001', message = 'NOT_AUTHENTICATED';
  end if;

  -- Idempotency: if this organizer card already produced a match, return it.
  if p_source_message_id is not null then
    -- Row-lock so two simultaneous confirmations serialize.
    perform 1 from public.message where id = p_source_message_id for update;

    select (metadata ->> 'created_match_id')::uuid
      into v_existing
    from public.message
    where id = p_source_message_id;

    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  -- Resolve the facility's local wall-clock from the absolute instant.
  if p_facility_id is not null then
    select f.timezone into v_tz from public.facility f where f.id = p_facility_id;
  end if;
  v_tz := coalesce(v_tz, 'America/Toronto');
  v_local_start := p_slot_start at time zone v_tz;

  insert into public.match (
    sport_id, created_by, match_date, start_time, end_time, timezone,
    format, facility_id, location_type,
    join_mode, visibility, visible_in_groups, visible_in_communities
  ) values (
    p_sport_id, v_caller,
    v_local_start::date,
    v_local_start::time,
    (v_local_start + make_interval(mins => coalesce(p_duration_minutes, 60)))::time,
    v_tz,
    p_format, p_facility_id,
    case when p_facility_id is not null then 'facility'::location_type_enum
         else 'tbd'::location_type_enum end,
    'direct', 'private', false, false
  )
  returning id into v_match_id;

  -- Host (caller) is added by the create_host_participant trigger; add the rest.
  foreach v_pid in array coalesce(p_player_ids, array[]::uuid[]) loop
    if v_pid <> v_caller then
      insert into public.match_participant (match_id, player_id, status)
      values (v_match_id, v_pid, 'joined')
      on conflict (match_id, player_id) do nothing;
    end if;
  end loop;

  -- Flip the organizer card to its "game created" state.
  if p_source_message_id is not null then
    update public.message
    set metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object(
           'created_match_id', v_match_id,
           'confirmed_option_index', p_option_index
         )
    where id = p_source_message_id;
  end if;

  return v_match_id;
end;
$$;

grant execute on function public.create_casual_match(
  uuid, timestamptz, uuid[], match_format_enum, uuid, int, uuid, int
) to authenticated;

comment on function public.create_casual_match(
  uuid, timestamptz, uuid[], match_format_enum, uuid, int, uuid, int
) is 'Atomically create a private casual match (all chosen players pre-joined) from a chat Match Organizer option. Derives local date/time/tz from the facility. Idempotent on the source organizer message.';
