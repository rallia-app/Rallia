-- ============================================================================
-- Remove debug instrumentation from notify_send_notification trigger
-- Restores the original function without RAISE NOTICE debug statements
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_send_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  request_id bigint;
  functions_url TEXT;
  anon_key TEXT;
BEGIN
  -- Get the functions URL from vault
  SELECT decrypted_secret INTO functions_url 
  FROM vault.decrypted_secrets 
  WHERE name = 'supabase_functions_url' 
  LIMIT 1;
  
  -- Get the anon (publishable) key from vault
  SELECT decrypted_secret INTO anon_key 
  FROM vault.decrypted_secrets 
  WHERE name = 'anon_key' 
  LIMIT 1;
  
  -- Check if secrets are available
  IF functions_url IS NULL OR anon_key IS NULL THEN
    RAISE WARNING 'Cannot dispatch notification: Vault secrets not configured (functions_url: %, anon_key: %)',
      CASE WHEN functions_url IS NULL THEN 'missing' ELSE 'ok' END,
      CASE WHEN anon_key IS NULL THEN 'missing' ELSE 'ok' END;
    RETURN NEW;
  END IF;

  -- Call the Edge Function using pg_net with Bearer auth (publishable key)
  SELECT INTO request_id net.http_post(
    url := functions_url || '/functions/v1/send-notification',
    body := jsonb_build_object('type', 'INSERT', 'table', 'notification', 'record', row_to_json(NEW)::jsonb),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key
    ),
    timeout_milliseconds := 5000
  );
  
  RAISE NOTICE 'Triggered notification dispatch for % with request_id %', NEW.id, request_id;
  RETURN NEW;
EXCEPTION
  WHEN others THEN
    -- Log error but don't fail the insert
    RAISE WARNING 'Failed to trigger notification dispatch: %', SQLERRM;
    RETURN NEW;
END;
$$;
