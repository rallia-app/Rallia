-- Migration: Chat realtime via Broadcast-from-Database
-- Description:
--   Replaces postgres_changes for IN-CONVERSATION message + reaction events with
--   realtime.broadcast_changes() on private, RLS-authorized topics:
--     'chat:<conversation_id>'      -> message INSERT / UPDATE / DELETE
--     'reactions:<conversation_id>' -> message_reaction INSERT / DELETE
--   postgres_changes scales poorly because every change is RLS-checked once PER
--   subscribed client on a single thread. Broadcasting from the database fans out
--   over Realtime instead, which scales to far more concurrent clients.
--
--   The inbox/unread-badge subscription (subscribeToConversations) intentionally
--   stays on postgres_changes for now, so the public.message table remains in the
--   supabase_realtime publication. message_reaction stays in the publication too
--   but no longer has any postgres_changes subscribers (harmless without one).

-- ---------------------------------------------------------------------------
-- 1. Message broadcast trigger
-- ---------------------------------------------------------------------------
create or replace function public.broadcast_message_changes()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
begin
  perform realtime.broadcast_changes(
    'chat:' || coalesce(NEW.conversation_id, OLD.conversation_id)::text, -- topic
    TG_OP,            -- event: client listens on 'INSERT' | 'UPDATE' | 'DELETE'
    TG_OP,            -- operation
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    NEW,
    OLD
  );
  return null;
end;
$$;

drop trigger if exists broadcast_message_changes on public.message;
create trigger broadcast_message_changes
  after insert or update or delete on public.message
  for each row execute function public.broadcast_message_changes();

-- ---------------------------------------------------------------------------
-- 2. Reaction broadcast trigger
--    message_reaction has no conversation_id, so resolve it via the message.
-- ---------------------------------------------------------------------------
create or replace function public.broadcast_reaction_changes()
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
    'reactions:' || v_conversation_id::text, -- topic
    TG_OP,                                   -- event: 'INSERT' | 'DELETE'
    TG_OP,
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    NEW,
    OLD
  );
  return null;
end;
$$;

drop trigger if exists broadcast_reaction_changes on public.message_reaction;
create trigger broadcast_reaction_changes
  after insert or delete on public.message_reaction
  for each row execute function public.broadcast_reaction_changes();

-- ---------------------------------------------------------------------------
-- 3. Authorization: who may RECEIVE these broadcasts
--    Realtime checks realtime.messages RLS when a client joins a PRIVATE channel.
--    Clients only ever RECEIVE here (the database is the sender), so a single
--    SELECT policy is sufficient -- no INSERT (send) policy needed.
--
--    The topic format is always '<family>:<conversation_uuid>', so the second
--    colon-segment is the conversation id. The regex guard ensures the ::uuid
--    cast is only attempted for our own well-formed chat/reactions topics.
-- ---------------------------------------------------------------------------
drop policy if exists "chat receive own conversations" on realtime.messages;
create policy "chat receive own conversations"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() ~ '^(chat|reactions):[0-9a-fA-F-]{36}$'
    and exists (
      select 1
      from public.conversation_participant cp
      where cp.conversation_id = split_part(realtime.topic(), ':', 2)::uuid
        and cp.player_id = auth.uid()
    )
  );
