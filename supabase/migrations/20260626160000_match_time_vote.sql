-- ============================================================================
-- Chat Match Organizer — vote table + realtime
-- ============================================================================
-- A `match_organizer` chat card snapshots a set of time/place options into its
-- message.metadata. Players thumbs-up the options they'd be good with; a vote is
-- a (message, player, option_index) row. Mirrors message_reaction (per-user,
-- per-message, toggled by insert/delete) but keyed on an option index instead of
-- an emoji. When every participant has voted for the same option it's "mutual"
-- and the game can be created.
--
-- Realtime: votes broadcast on a private 'votes:<conversation_id>' topic, exactly
-- like reactions (see 20260526120000_chat_broadcast_from_database), so both
-- players see each other's votes live without polling.
-- ============================================================================

create table if not exists public.match_time_vote (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.message(id) on delete cascade,
  player_id    uuid not null references public.player(id) on delete cascade,
  option_index smallint not null,
  created_at   timestamptz not null default now(),
  unique (message_id, player_id, option_index)
);

create index if not exists match_time_vote_message_id_idx on public.match_time_vote(message_id);

alter table public.match_time_vote enable row level security;

-- Idempotent: safe to re-run (e.g. when staging is later caught up via migration up).
drop policy if exists "view votes in own conversations" on public.match_time_vote;
drop policy if exists "add own votes in own conversations" on public.match_time_vote;
drop policy if exists "remove own votes" on public.match_time_vote;

-- SELECT: any participant of the message's conversation
create policy "view votes in own conversations" on public.match_time_vote
  for select to authenticated
  using (
    exists (
      select 1
      from public.message m
      join public.conversation_participant cp on cp.conversation_id = m.conversation_id
      where m.id = match_time_vote.message_id
        and cp.player_id = auth.uid()
    )
  );

-- INSERT: only your own vote, and only in a conversation you're part of
create policy "add own votes in own conversations" on public.match_time_vote
  for insert to authenticated
  with check (
    player_id = auth.uid()
    and exists (
      select 1
      from public.message m
      join public.conversation_participant cp on cp.conversation_id = m.conversation_id
      where m.id = match_time_vote.message_id
        and cp.player_id = auth.uid()
    )
  );

-- DELETE: only your own votes (toggle off)
create policy "remove own votes" on public.match_time_vote
  for delete to authenticated
  using (player_id = auth.uid());

-- Supabase is removing default Data API grants; grant explicitly.
grant select, insert, delete on public.match_time_vote to authenticated;
grant all on public.match_time_vote to service_role;

-- ---------------------------------------------------------------------------
-- Broadcast vote changes on 'votes:<conversation_id>' (resolve via the message)
-- ---------------------------------------------------------------------------
create or replace function public.broadcast_match_vote_changes()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
declare
  v_conversation_id uuid;
begin
  select m.conversation_id
    into v_conversation_id
  from public.message m
  where m.id = coalesce(NEW.message_id, OLD.message_id);

  -- Message already gone (e.g. cascade delete) -- nothing to broadcast.
  if v_conversation_id is null then
    return null;
  end if;

  perform realtime.broadcast_changes(
    'votes:' || v_conversation_id::text, -- topic
    TG_OP,                               -- event: 'INSERT' | 'DELETE'
    TG_OP,
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    NEW,
    OLD
  );
  return null;
end;
$$;

drop trigger if exists broadcast_match_vote_changes on public.match_time_vote;
create trigger broadcast_match_vote_changes
  after insert or delete on public.match_time_vote
  for each row execute function public.broadcast_match_vote_changes();

-- ---------------------------------------------------------------------------
-- Extend the realtime receive policy to authorize the new 'votes:' topic family
-- (same shape as 20260526120000; just adds 'votes' to the alternation).
-- ---------------------------------------------------------------------------
drop policy if exists "chat receive own conversations" on realtime.messages;
create policy "chat receive own conversations"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() ~ '^(chat|reactions|votes):[0-9a-fA-F-]{36}$'
    and exists (
      select 1
      from public.conversation_participant cp
      where cp.conversation_id = split_part(realtime.topic(), ':', 2)::uuid
        and cp.player_id = auth.uid()
    )
  );
