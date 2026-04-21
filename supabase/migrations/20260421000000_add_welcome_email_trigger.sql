-- Migration: Send welcome email when a user completes onboarding
-- Fires once per profile when onboarding_completed transitions from FALSE/NULL to TRUE
-- Dispatches to the send-email edge function with emailType = 'welcome'.
-- Created: 2026-04-21

CREATE OR REPLACE FUNCTION public.notify_welcome_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  request_id bigint;
  functions_url TEXT;
  anon_key TEXT;
  error_msg TEXT;
BEGIN
  -- Only fire on transition to TRUE
  IF NOT (NEW.onboarding_completed = TRUE
          AND (OLD.onboarding_completed IS DISTINCT FROM TRUE)) THEN
    RETURN NEW;
  END IF;

  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO functions_url
  FROM vault.decrypted_secrets
  WHERE name = 'supabase_functions_url'
  LIMIT 1;

  SELECT decrypted_secret INTO anon_key
  FROM vault.decrypted_secrets
  WHERE name = 'anon_key'
  LIMIT 1;

  IF functions_url IS NULL THEN
    RAISE WARNING 'Cannot send welcome email: supabase_functions_url secret not found in Vault';
    RETURN NEW;
  END IF;

  IF anon_key IS NULL THEN
    RAISE WARNING 'Cannot send welcome email: anon_key secret not found in Vault';
    RETURN NEW;
  END IF;

  BEGIN
    SELECT INTO request_id net.http_post(
      url := functions_url || '/functions/v1/send-email',
      body := jsonb_build_object(
        'emailType', 'welcome',
        'user_id', NEW.id,
        'email', NEW.email,
        'display_name', NEW.display_name,
        'first_name', NEW.first_name,
        'preferred_locale', NEW.preferred_locale
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key
      ),
      timeout_milliseconds := 10000
    );

    RAISE NOTICE 'Welcome email dispatched for user % (email: %)', NEW.id, NEW.email;
  EXCEPTION
    WHEN OTHERS THEN
      error_msg := SQLERRM;
      RAISE WARNING 'Error dispatching welcome email for user %: %', NEW.id, error_msg;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_send_welcome_email ON profile;

CREATE TRIGGER trigger_send_welcome_email
  AFTER UPDATE OF onboarding_completed ON profile
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_welcome_email();

COMMENT ON FUNCTION public.notify_welcome_email IS
'Trigger function that dispatches a welcome email via the send-email edge function when a user completes onboarding (onboarding_completed: FALSE/NULL -> TRUE).';

COMMENT ON TRIGGER trigger_send_welcome_email ON profile IS
'Fires when onboarding_completed transitions to TRUE, sending a localized welcome email.';
