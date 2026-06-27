-- ============================================================================
-- Chat Match Organizer — Phase 2: tournament glue
-- ============================================================================
-- Connects the generic organizer to tournament brackets so two round opponents
-- get ONE shared chat that becomes the match chat (no duplicate conversation),
-- and the game they create is linked to the bracket round (so confirming its
-- result advances the bracket via the existing match_result -> bracket bridge).
--
--  * conversation.tournament_match_id tags a per-pairing "round chat".
--  * lt_get_or_create_tournament_round_chat: idempotent round chat for a pairing
--    (both opponents added as participants). conversation_type='match' with a
--    NULL match_id until a game is created — it IS the future match chat.
--  * tournament_attach_match_pre_play: link a freshly created match to the round
--    (tournament_matches.match_id) BEFORE it's played, with the same guards as
--    tournament_attach_match minus the result requirement.
--  * create_casual_match: when posted from a round chat, set conversation.match_id
--    on that chat BEFORE the opponent joins — so sync_match_chat_participant
--    reuses it instead of spawning a second 'match' conversation — and attach the
--    new match to the bracket round.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Round-chat tag on conversation
-- ---------------------------------------------------------------------------
alter table public.conversation
  add column if not exists tournament_match_id uuid
    references public.tournament_matches(id) on delete set null;

-- One chat per pairing.
create unique index if not exists conversation_tournament_match_id_unique
  on public.conversation(tournament_match_id)
  where tournament_match_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Pre-play bracket link (mirrors tournament_attach_match minus the result)
-- ---------------------------------------------------------------------------
create or replace function public.tournament_attach_match_pre_play(
  p_tournament_match_id uuid,
  p_match_id            uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_tm     tournament_matches;
  v_t      tournaments;
  v_match  match;
  v_is_player boolean;
begin
  if v_caller is null then
    raise exception using errcode = 'P0001', message = 'NOT_AUTHENTICATED';
  end if;

  select * into v_tm from tournament_matches where id = p_tournament_match_id for update;
  if v_tm.id is null then
    raise exception using errcode = 'P0001', message = 'TOURNAMENT_MATCH_NOT_FOUND';
  end if;
  if v_tm.match_id is not null then
    raise exception using errcode = 'P0001', message = 'ALREADY_LINKED';
  end if;
  if v_tm.status <> 'pending'
     or v_tm.player1_is_bye or v_tm.player2_is_bye
     or v_tm.player1_registration_id is null
     or v_tm.player2_registration_id is null then
    raise exception using errcode = 'P0001', message = 'MATCH_NOT_PENDING';
  end if;

  select * into v_t from tournaments where id = v_tm.tournament_id;
  if v_t.status not in ('in_progress', 'registration_closed') then
    raise exception using errcode = 'P0001', message = 'TOURNAMENT_NOT_IN_PROGRESS';
  end if;

  -- Caller must be one of the two pairings' players.
  select exists (
    select 1 from tournament_registrations r
    where r.id in (v_tm.player1_registration_id, v_tm.player2_registration_id)
      and (r.user_id = v_caller or r.partner_user_id = v_caller)
  ) into v_is_player;
  if not v_is_player then
    raise exception using errcode = 'P0001', message = 'NOT_A_PARTICIPANT';
  end if;

  select * into v_match from match where id = p_match_id;
  if v_match.id is null then
    raise exception using errcode = 'P0001', message = 'MATCH_NOT_FOUND';
  end if;
  if v_match.created_by <> v_caller then
    raise exception using errcode = 'P0001', message = 'NOT_MATCH_HOST';
  end if;
  if v_match.sport_id <> v_t.sport_id then
    raise exception using errcode = 'P0001', message = 'SPORT_MISMATCH';
  end if;

  update tournament_matches
     set match_id   = p_match_id,
         version    = version + 1,
         updated_at = now()
   where id = v_tm.id;
end;
$$;

grant execute on function public.tournament_attach_match_pre_play(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3a. Round-chat get-or-create (no caller check — usable by the RPC and any
--     future proactive trigger). Idempotent on tournament_match_id.
-- ---------------------------------------------------------------------------
create or replace function public.lt_get_or_create_tournament_round_chat_unchecked(
  p_tournament_match_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tm     tournament_matches;
  v_title  text;
  v_conv   uuid;
  v_player uuid;
begin
  select * into v_tm from tournament_matches where id = p_tournament_match_id;
  if v_tm.id is null
     or v_tm.player1_registration_id is null
     or v_tm.player2_registration_id is null
     or v_tm.player1_is_bye or v_tm.player2_is_bye then
    return null;
  end if;

  -- Existing chat for this pairing?
  select id into v_conv from public.conversation
  where tournament_match_id = p_tournament_match_id;
  if v_conv is not null then
    return v_conv;
  end if;

  select name into v_title from public.tournaments where id = v_tm.tournament_id;

  insert into public.conversation (conversation_type, tournament_match_id, title, created_by)
  values ('match'::conversation_type, p_tournament_match_id, v_title,
          (select r.user_id from tournament_registrations r where r.id = v_tm.player1_registration_id))
  on conflict (tournament_match_id) where tournament_match_id is not null do nothing
  returning id into v_conv;

  if v_conv is null then
    select id into v_conv from public.conversation where tournament_match_id = p_tournament_match_id;
  end if;

  -- Add both pairings' players (and partners, for doubles).
  for v_player in
    select unnest(array_remove(array[
      (select user_id         from tournament_registrations where id = v_tm.player1_registration_id),
      (select partner_user_id from tournament_registrations where id = v_tm.player1_registration_id),
      (select user_id         from tournament_registrations where id = v_tm.player2_registration_id),
      (select partner_user_id from tournament_registrations where id = v_tm.player2_registration_id)
    ], null))
  loop
    insert into public.conversation_participant (conversation_id, player_id)
    values (v_conv, v_player)
    on conflict do nothing;
  end loop;

  return v_conv;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3b. Public wrapper — caller must be one of the round's players.
-- ---------------------------------------------------------------------------
create or replace function public.get_or_create_tournament_round_chat(
  p_tournament_match_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_tm     tournament_matches;
  v_is_player boolean;
begin
  if v_caller is null then
    raise exception using errcode = 'P0001', message = 'NOT_AUTHENTICATED';
  end if;

  select * into v_tm from tournament_matches where id = p_tournament_match_id;
  if v_tm.id is null then
    raise exception using errcode = 'P0001', message = 'TOURNAMENT_MATCH_NOT_FOUND';
  end if;

  select exists (
    select 1 from tournament_registrations r
    where r.id in (v_tm.player1_registration_id, v_tm.player2_registration_id)
      and (r.user_id = v_caller or r.partner_user_id = v_caller)
  ) into v_is_player;
  if not v_is_player then
    raise exception using errcode = 'P0001', message = 'NOT_A_PARTICIPANT';
  end if;

  return public.lt_get_or_create_tournament_round_chat_unchecked(p_tournament_match_id);
end;
$$;

grant execute on function public.get_or_create_tournament_round_chat(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. create_casual_match — link the round chat + attach to bracket.
--    Same signature as 20260626170000; CREATE OR REPLACE keeps grants.
-- ---------------------------------------------------------------------------
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
  v_caller       uuid := auth.uid();
  v_match_id     uuid;
  v_existing     uuid;
  v_pid          uuid;
  v_tz           text;
  v_local_start  timestamp;
  v_conv_id      uuid;
  v_conv_tm_id   uuid;
  v_conv_match   uuid;
begin
  if v_caller is null then
    raise exception using errcode = 'P0001', message = 'NOT_AUTHENTICATED';
  end if;

  -- Idempotency: if this organizer card already produced a match, return it.
  if p_source_message_id is not null then
    perform 1 from public.message where id = p_source_message_id for update;
    select (metadata ->> 'created_match_id')::uuid into v_existing
    from public.message where id = p_source_message_id;
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
    v_local_start::date, v_local_start::time,
    (v_local_start + make_interval(mins => coalesce(p_duration_minutes, 60)))::time,
    v_tz, p_format, p_facility_id,
    case when p_facility_id is not null then 'facility'::location_type_enum
         else 'tbd'::location_type_enum end,
    'direct', 'private', false, false
  )
  returning id into v_match_id;

  -- If posted from a tournament ROUND chat, make that chat THE match chat
  -- (set match_id BEFORE the opponent join below, so sync_match_chat_participant
  -- reuses it rather than creating a second conversation) and attach to bracket.
  if p_source_message_id is not null then
    select m.conversation_id, c.tournament_match_id, c.match_id
      into v_conv_id, v_conv_tm_id, v_conv_match
    from public.message m
    join public.conversation c on c.id = m.conversation_id
    where m.id = p_source_message_id;

    if v_conv_tm_id is not null and v_conv_match is null then
      update public.conversation set match_id = v_match_id, updated_at = now()
      where id = v_conv_id;
      perform public.tournament_attach_match_pre_play(v_conv_tm_id, v_match_id);
    end if;
  end if;

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
      || jsonb_build_object('created_match_id', v_match_id, 'confirmed_option_index', p_option_index)
    where id = p_source_message_id;
  end if;

  return v_match_id;
end;
$$;
