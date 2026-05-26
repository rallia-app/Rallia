-- Migration: Suppress new-message notifications for the conversation a user is
-- actively viewing.
--
-- Tracks each user's currently-open conversation in active_conversation (one row
-- per user, short-lived, refreshed by a client heartbeat). notify_new_message
-- then skips participants who are actively viewing the conversation a message was
-- sent to, so they get neither an in-app notification row nor a push.
--
-- active_conversation is intentionally NOT added to the supabase_realtime
-- publication: the client heartbeats into it and we don't want those writes to
-- wake the inbox subscription (subscribeToConversations).
--
-- It is accessed ONLY through SECURITY DEFINER RPCs (which run as the table owner
-- and bypass RLS). RLS is enabled with no policies and no Data API grants, so the
-- table is intentionally inaccessible via PostgREST -- this is deliberate, not an
-- omission.

create table if not exists public.active_conversation (
  player_id       uuid primary key references public.player(id) on delete cascade,
  conversation_id uuid not null references public.conversation(id) on delete cascade,
  active_at       timestamptz not null default now()
);

alter table public.active_conversation enable row level security;

-- RPC: mark the caller as actively viewing a conversation.
-- Called on screen focus and periodically as a heartbeat.
create or replace function public.set_active_conversation(p_conversation_id uuid)
returns void
security definer
set search_path = public
language plpgsql
as $$
begin
  insert into public.active_conversation (player_id, conversation_id, active_at)
  values (auth.uid(), p_conversation_id, now())
  on conflict (player_id)
  do update set conversation_id = excluded.conversation_id,
                active_at       = now();
end;
$$;

-- RPC: clear the caller's active conversation (called on blur / app background).
-- Conditioned on conversation_id so navigating A -> B (which sets B before A's
-- blur fires) does not accidentally clear B.
create or replace function public.clear_active_conversation(p_conversation_id uuid)
returns void
security definer
set search_path = public
language plpgsql
as $$
begin
  delete from public.active_conversation
  where player_id = auth.uid()
    and conversation_id = p_conversation_id;
end;
$$;

grant execute on function public.set_active_conversation(uuid) to authenticated;
grant execute on function public.clear_active_conversation(uuid) to authenticated;

-- Recreate notify_new_message to skip active viewers. A participant is "actively
-- viewing" when their active_conversation points at THIS conversation and was
-- refreshed within the last 60 seconds (client heartbeats every ~30s).
create or replace function notify_new_message()
returns trigger as $$
declare
  v_sender_name text;
  v_preview     text;
begin
  -- Get sender's display name
  select coalesce(p.first_name || ' ' || coalesce(p.last_name, ''), p.first_name, 'Someone')
    into v_sender_name
    from profile p where p.id = NEW.sender_id;

  -- Truncate message for preview
  v_preview := left(NEW.content, 100);

  -- Insert a notification for every non-muted participant except the sender,
  -- skipping anyone actively viewing this conversation.
  insert into notification (user_id, type, target_id, title, body, payload, priority, read_at)
  select
    cp.player_id,
    'new_message'::notification_type_enum,
    NEW.conversation_id,
    'Message from ' || v_sender_name,
    v_preview,
    jsonb_build_object(
      'conversationId', NEW.conversation_id,
      'senderName', v_sender_name,
      'messagePreview', v_preview
    ),
    'normal'::notification_priority_enum,
    now()
  from conversation_participant cp
  left join active_conversation ac on ac.player_id = cp.player_id
  where cp.conversation_id = NEW.conversation_id
    and cp.player_id != NEW.sender_id
    and cp.is_muted = false
    and (
      ac.player_id is null
      or ac.conversation_id is distinct from NEW.conversation_id
      or ac.active_at <= now() - interval '60 seconds'
    );

  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists trigger_notify_new_message on message;
create trigger trigger_notify_new_message
  after insert on message
  for each row
  execute function notify_new_message();
