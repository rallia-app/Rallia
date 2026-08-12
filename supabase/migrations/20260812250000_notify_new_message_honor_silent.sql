-- ============================================================================
-- notify_new_message: honour metadata.silent
-- ============================================================================
-- The system-posted Match Organizer card (20260809160100) and the
-- "availability updated" system note (20260811120000) both write
-- metadata.silent = true, on the stated grounds that the pairing already gets
-- a tournament_match_ready / tournament_bracket_published push and must not be
-- notified twice. Nothing ever read the flag: notify_new_message only honours
-- suppress_notification_for, mutes and the 60s active-conversation window, so
-- the card's sender being the Rallia system player made BOTH participants
-- match the fan-out predicate.
--
-- Measured on staging 2026-08-12: 33 of the auto-posted cards produced 66
-- 'new_message' notifications ("Message de Rallia · Suggestions d'heures pour
-- jouer"), landing in the same instant as the tournament push they were meant
-- to stay quiet behind.
--
-- suppress_notification_for holds a single uuid, so it cannot carry both
-- participants; the flag the posters already write becomes the real switch.
-- Checked before the announcement branch, so silent means silent everywhere:
-- an enqueued fan-out job would notify from the cron worker instead.
--
-- Body copied from 20260728150000 (latest definition); the guard is the only
-- change.
-- ============================================================================

create or replace function notify_new_message()
returns trigger as $$
declare
  v_sender_name text;
  v_preview     text;
  v_is_announcement boolean;
  v_max_len     constant int := 178;
begin
  -- System cards that ride along with their own push.
  if NEW.metadata->>'silent' = 'true' then
    return NEW;
  end if;

  select c.conversation_type = 'announcement'
    into v_is_announcement
    from conversation c where c.id = NEW.conversation_id;

  -- Announcements fan out to every player; defer to the cron worker.
  if v_is_announcement then
    insert into announcement_fanout_job (message_id, conversation_id, sender_id)
    values (NEW.id, NEW.conversation_id, NEW.sender_id)
    on conflict (message_id) do nothing;
    return NEW;
  end if;

  select coalesce(p.first_name || ' ' || coalesce(p.last_name, ''), p.first_name, 'Someone')
    into v_sender_name
    from profile p where p.id = NEW.sender_id;

  v_preview := CASE
    WHEN char_length(NEW.content) > v_max_len
      THEN rtrim(left(NEW.content, v_max_len), E' \t\n\r') || '…'
    ELSE NEW.content
  END;

  insert into notification (user_id, type, target_id, title, body, payload, priority, read_at)
  select
    cp.player_id,
    'new_message'::notification_type_enum,
    NEW.conversation_id,
    CASE
      WHEN public.lt_user_is_fr(cp.player_id)
        THEN 'Message de ' || v_sender_name
      ELSE 'Message from ' || v_sender_name
    END,
    v_preview,
    jsonb_build_object(
      'conversationId', NEW.conversation_id,
      'senderName', v_sender_name,
      'messagePreview', v_preview,
      'messageType', NEW.message_type,
      'facilityName', NEW.metadata->>'facility_name',
      'courtLabel', NEW.metadata->>'court_label'
    ),
    'normal'::notification_priority_enum,
    now()
  from conversation_participant cp
  left join active_conversation ac on ac.player_id = cp.player_id
  where cp.conversation_id = NEW.conversation_id
    and cp.player_id != NEW.sender_id
    and cp.player_id is distinct from (NEW.metadata->>'suppress_notification_for')::uuid
    and cp.is_muted = false
    and (
      ac.player_id is null
      or ac.conversation_id is distinct from NEW.conversation_id
      or ac.active_at <= now() - interval '60 seconds'
    );

  return NEW;
end;
$$ language plpgsql security definer;

COMMENT ON FUNCTION public.notify_new_message() IS
  'Fans a new chat message out to notification rows. Skips the sender, muted participants, anyone actively viewing the conversation within 60s, and the single player named by metadata.suppress_notification_for. Messages carrying metadata.silent = true (system-posted Match Organizer cards and their system notes) notify nobody: they arrive alongside their own tournament push.';
