-- Trigger: create push notifications for new chat messages
-- Inserts a notification for each non-muted conversation participant (excluding sender).
-- The existing `on_notification_insert` trigger then fires the send-notification Edge Function.

CREATE OR REPLACE FUNCTION notify_new_message()
RETURNS TRIGGER AS $$
DECLARE
  v_sender_name TEXT;
  v_preview TEXT;
BEGIN
  -- Get sender's display name
  SELECT COALESCE(p.first_name || ' ' || COALESCE(p.last_name, ''), p.first_name, 'Someone')
    INTO v_sender_name
    FROM profile p WHERE p.id = NEW.sender_id;

  -- Truncate message for preview
  v_preview := LEFT(NEW.content, 100);

  -- Insert a notification for every non-muted participant except the sender
  INSERT INTO notification (user_id, type, target_id, title, body, payload, priority, read_at)
  SELECT
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
    NOW()
  FROM conversation_participant cp
  WHERE cp.conversation_id = NEW.conversation_id
    AND cp.player_id != NEW.sender_id
    AND cp.is_muted = FALSE;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_notify_new_message ON message;
CREATE TRIGGER trigger_notify_new_message
  AFTER INSERT ON message
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_message();
