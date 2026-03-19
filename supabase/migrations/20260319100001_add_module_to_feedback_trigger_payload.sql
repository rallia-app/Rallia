-- ============================================================================
-- Add module field to the feedback notification trigger payload
-- ============================================================================
-- The notify_admin_new_feedback() trigger was missing the module column
-- from the payload sent to the send-feedback-notification Edge Function.
-- This adds NEW.module so the email includes which app section the
-- feedback relates to (e.g. Match Features, Messaging, etc.).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_admin_new_feedback()
RETURNS TRIGGER AS $$
DECLARE
  functions_url TEXT;
  anon_key TEXT;
  request_id bigint;
  player_name TEXT;
  player_email TEXT;
  payload JSONB;
BEGIN
  -- Retrieve Vault secrets
  SELECT decrypted_secret INTO functions_url
  FROM vault.decrypted_secrets
  WHERE name = 'supabase_functions_url'
  LIMIT 1;

  SELECT decrypted_secret INTO anon_key
  FROM vault.decrypted_secrets
  WHERE name = 'anon_key'
  LIMIT 1;

  IF functions_url IS NULL OR anon_key IS NULL THEN
    RAISE WARNING '[notify_admin_new_feedback] Vault secrets not configured (functions_url: %, anon_key: %)',
      CASE WHEN functions_url IS NULL THEN 'missing' ELSE 'ok' END,
      CASE WHEN anon_key IS NULL THEN 'missing' ELSE 'ok' END;
    RETURN NEW;
  END IF;

  -- Look up the player's name and email (if player_id is provided)
  IF NEW.player_id IS NOT NULL THEN
    SELECT
      COALESCE(pr.first_name || ' ' || pr.last_name, pr.display_name, 'Unknown') AS full_name,
      pr.email
    INTO player_name, player_email
    FROM public.profile pr
    WHERE pr.id = NEW.player_id;
  END IF;

  -- Build the payload expected by the send-feedback-notification Edge Function
  payload := jsonb_build_object(
    'feedback_id',    NEW.id,
    'category',       NEW.category,
    'module',         NEW.module,
    'subject',        NEW.subject,
    'message',        NEW.message,
    'player_id',      NEW.player_id,
    'player_name',    COALESCE(player_name, NULL),
    'player_email',   COALESCE(player_email, NULL),
    'app_version',    NEW.app_version,
    'device_info',    NEW.device_info,
    'screenshot_urls', NEW.screenshot_urls,
    'created_at',     NEW.created_at
  );

  -- Call the Edge Function asynchronously via pg_net
  SELECT INTO request_id net.http_post(
    url := functions_url || '/functions/v1/send-feedback-notification',
    body := payload,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || anon_key
    ),
    timeout_milliseconds := 5000
  );

  RAISE NOTICE '[notify_admin_new_feedback] Dispatched email for feedback % with request_id %', NEW.id, request_id;
  RETURN NEW;

EXCEPTION
  WHEN others THEN
    -- Never block the INSERT — just warn
    RAISE WARNING '[notify_admin_new_feedback] Failed to dispatch email: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
