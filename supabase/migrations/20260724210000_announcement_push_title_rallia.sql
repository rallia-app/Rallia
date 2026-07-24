-- =============================================================================
-- Announcement push title: "📢 Rallia"
--
-- 20260720140000 titled announcement pushes "<channel> announcement" /
-- "Annonce <channel>". Since 20260724120000 every announcement channel is
-- titled "Rallia", which made that read "Rallia announcement" / "Annonce
-- Rallia". Product wants a single locale-neutral sender-style title instead:
-- "📢 Rallia". Everything else is unchanged from 20260720140000.
-- =============================================================================

create or replace function notify_new_message()
returns trigger as $$
declare
  v_sender_name text;
  v_preview     text;
  v_is_announcement boolean;
  v_max_len     constant int := 178;
begin
  select coalesce(p.first_name || ' ' || coalesce(p.last_name, ''), p.first_name, 'Someone')
    into v_sender_name
    from profile p where p.id = NEW.sender_id;

  select c.conversation_type = 'announcement'
    into v_is_announcement
    from conversation c where c.id = NEW.conversation_id;

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
      WHEN v_is_announcement
        THEN '📢 Rallia'
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
