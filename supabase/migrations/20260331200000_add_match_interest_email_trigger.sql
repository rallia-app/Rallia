-- Trigger function to send a confirmation email when someone submits match interest
CREATE OR REPLACE FUNCTION public.notify_match_interest()
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
    RAISE WARNING 'Cannot send match interest email: supabase_functions_url secret not found in Vault';
    RETURN NEW;
  END IF;

  IF anon_key IS NULL THEN
    RAISE WARNING 'Cannot send match interest email: anon_key secret not found in Vault';
    RETURN NEW;
  END IF;

  BEGIN
    SELECT INTO request_id net.http_post(
      url := functions_url || '/functions/v1/send-email',
      body := jsonb_build_object(
        'emailType', 'match_interest',
        'id', NEW.id,
        'match_id', NEW.match_id,
        'email', NEW.email,
        'name', NEW.name,
        'created_at', NEW.created_at
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key
      ),
      timeout_milliseconds := 10000
    );

    RAISE NOTICE 'Edge function called for match interest % (email: %)', NEW.id, NEW.email;
  EXCEPTION
    WHEN OTHERS THEN
      error_msg := SQLERRM;
      RAISE WARNING 'Error calling edge function for match interest %: %', NEW.id, error_msg;
  END;

  RETURN NEW;
END;
$$;

-- Create trigger on match_interest table
DROP TRIGGER IF EXISTS on_match_interest_created ON match_interest;
CREATE TRIGGER on_match_interest_created
  AFTER INSERT ON match_interest
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_match_interest();
