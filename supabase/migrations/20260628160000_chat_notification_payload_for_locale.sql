-- Migration: carry the chat message's type + court metadata in the new_message
-- notification payload so the push channel can localize system messages.
--
-- notify_new_message writes an English fallback title/body (the raw message
-- content) for every chat message. That's correct for human-typed messages, but
-- the DB-generated system messages (court_booking_prompt, court_booked) are
-- always English. Following the nearby_match_available precedent, the push
-- handler re-renders those in the recipient's locale from the payload — it just
-- needs the message_type and the relevant metadata fields to do so.
--
-- This only adds payload keys; title/body/recipient logic is unchanged from
-- 20260625090000_suppress_self_notification_on_system_messages.sql.

BEGIN;

create or replace function notify_new_message()
returns trigger as $$
declare
  v_sender_name text;
  v_preview     text;
begin
  select coalesce(p.first_name || ' ' || coalesce(p.last_name, ''), p.first_name, 'Someone')
    into v_sender_name
    from profile p where p.id = NEW.sender_id;

  v_preview := left(NEW.content, 100);

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

COMMIT;
