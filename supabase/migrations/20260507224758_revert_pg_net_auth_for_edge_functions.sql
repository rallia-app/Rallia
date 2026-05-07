-- Reverts 20260507222534_fix_pg_net_auth_for_edge_functions.sql.
--
-- That migration tried to fix 401s coming from edge functions by changing the
-- pg_net call shape (adding an `apikey:` header, swapping anon_key -> service_role_key).
-- The 401s were actually coming from the FUNCTION code, not the gateway, due to a
-- brittle strict-equality check against `Deno.env.get('SUPABASE_ANON_KEY')` whose
-- value diverged from what cron sends when Supabase disabled the legacy anon JWT.
--
-- The doc-canonical cron pattern (https://supabase.com/docs/guides/functions/schedule-functions)
-- is `Authorization: Bearer <vault.anon_key>` only. The real fix lives in the
-- function code (switch the env var read to `SB_PUBLISHABLE_KEY` per
-- https://supabase.com/docs/guides/functions/auth) and is shipped separately.

-- 1. Cron jobs — restore Authorization-only header, vault name 'anon_key'
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'close-matches-hourly'),
  command := $cmd$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1) || '/functions/v1/close-matches',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cmd$
);

SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'send-feedback-reminders-hourly'),
  command := $cmd$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1) || '/functions/v1/send-feedback-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cmd$
);

SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'recalculate-reputation-decay-weekly'),
  command := $cmd$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1) || '/functions/v1/recalculate-reputation-decay',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cmd$
);

SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'send-match-reminders'),
  command := $cmd$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1) || '/functions/v1/send-match-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cmd$
);

SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'send-check-in-reminders'),
  command := $cmd$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1) || '/functions/v1/send-check-in-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cmd$
);

SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'send-morning-digest-daily'),
  command := $cmd$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1) || '/functions/v1/send-morning-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key' LIMIT 1)
    ),
    body := jsonb_build_object('triggered_at', now()::text),
    timeout_milliseconds := 300000
  );
  $cmd$
);

-- 2. Trigger / RPC functions — restore vault.anon_key + Authorization-only header
CREATE OR REPLACE FUNCTION public.notify_new_invitation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  request_id bigint;
  functions_url TEXT;
  anon_key TEXT;
  error_msg TEXT;
BEGIN
  IF NEW.email IS NULL THEN
    RAISE NOTICE 'Skipping email trigger for invitation %: no email address', NEW.id;
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO functions_url
  FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1;

  SELECT decrypted_secret INTO anon_key
  FROM vault.decrypted_secrets WHERE name = 'anon_key' LIMIT 1;

  IF functions_url IS NULL THEN
    RAISE WARNING 'Cannot send invitation email: supabase_functions_url secret not found in Vault';
    RETURN NEW;
  END IF;

  IF anon_key IS NULL THEN
    RAISE WARNING 'Cannot send invitation email: anon_key secret not found in Vault';
    RETURN NEW;
  END IF;

  RAISE NOTICE 'Triggering email for invitation % to % (org: %)', NEW.id, NEW.email, COALESCE(NEW.organization_id::text, 'none');

  BEGIN
    SELECT INTO request_id net.http_post(
      url := functions_url || '/functions/v1/send-email',
      body := jsonb_build_object(
        'id', NEW.id,
        'email', NEW.email,
        'phone', NEW.phone,
        'role', NEW.role,
        'admin_role', NEW.admin_role,
        'token', NEW.token,
        'status', NEW.status,
        'inviter_id', NEW.inviter_id,
        'invited_user_id', NEW.invited_user_id,
        'organization_id', NEW.organization_id,
        'source', NEW.source,
        'expires_at', NEW.expires_at,
        'metadata', NEW.metadata,
        'emailType', 'invitation'
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key
      ),
      timeout_milliseconds := 10000
    );

    RAISE NOTICE 'Edge function called successfully with request_id: % for invitation %', request_id, NEW.id;
  EXCEPTION
    WHEN OTHERS THEN
      error_msg := SQLERRM;
      RAISE WARNING 'Error calling edge function for invitation %: %', NEW.id, error_msg;
  END;

  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public.notify_send_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  request_id bigint;
  functions_url TEXT;
  anon_key TEXT;
BEGIN
  SELECT decrypted_secret INTO functions_url
  FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1;

  SELECT decrypted_secret INTO anon_key
  FROM vault.decrypted_secrets WHERE name = 'anon_key' LIMIT 1;

  IF functions_url IS NULL OR anon_key IS NULL THEN
    RAISE WARNING 'Cannot dispatch notification: Vault secrets not configured (functions_url: %, anon_key: %)',
      CASE WHEN functions_url IS NULL THEN 'missing' ELSE 'ok' END,
      CASE WHEN anon_key IS NULL THEN 'missing' ELSE 'ok' END;
    RETURN NEW;
  END IF;

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
    RAISE WARNING 'Failed to trigger notification dispatch: %', SQLERRM;
    RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public.notify_admin_new_feedback()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  functions_url TEXT;
  anon_key TEXT;
  request_id bigint;
  player_name TEXT;
  player_email TEXT;
  payload JSONB;
BEGIN
  SELECT decrypted_secret INTO functions_url
  FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1;

  SELECT decrypted_secret INTO anon_key
  FROM vault.decrypted_secrets WHERE name = 'anon_key' LIMIT 1;

  IF functions_url IS NULL OR anon_key IS NULL THEN
    RAISE WARNING '[notify_admin_new_feedback] Vault secrets not configured (functions_url: %, anon_key: %)',
      CASE WHEN functions_url IS NULL THEN 'missing' ELSE 'ok' END,
      CASE WHEN anon_key IS NULL THEN 'missing' ELSE 'ok' END;
    RETURN NEW;
  END IF;

  IF NEW.player_id IS NOT NULL THEN
    SELECT
      COALESCE(pr.first_name || ' ' || pr.last_name, pr.display_name, 'Unknown') AS full_name,
      pr.email
    INTO player_name, player_email
    FROM public.profile pr
    WHERE pr.id = NEW.player_id;
  END IF;

  payload := jsonb_build_object(
    'feedback_id',     NEW.id,
    'category',        NEW.category,
    'module',          NEW.module,
    'subject',         NEW.subject,
    'message',         NEW.message,
    'metadata',        NEW.metadata,
    'player_id',       NEW.player_id,
    'player_name',     COALESCE(player_name, NULL),
    'player_email',    COALESCE(player_email, NULL),
    'app_version',     NEW.app_version,
    'device_info',     NEW.device_info,
    'screenshot_urls', NEW.screenshot_urls,
    'created_at',      NEW.created_at
  );

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
    RAISE WARNING '[notify_admin_new_feedback] Failed to dispatch email: %', SQLERRM;
    RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public.notify_match_interest()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1;

  SELECT decrypted_secret INTO anon_key
  FROM vault.decrypted_secrets WHERE name = 'anon_key' LIMIT 1;

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
        'locale', NEW.locale,
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
$function$;


CREATE OR REPLACE FUNCTION public.notify_welcome_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  request_id bigint;
  functions_url TEXT;
  anon_key TEXT;
  error_msg TEXT;
BEGIN
  IF NOT (NEW.onboarding_completed = TRUE
          AND (OLD.onboarding_completed IS DISTINCT FROM TRUE)) THEN
    RETURN NEW;
  END IF;

  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO functions_url
  FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1;

  SELECT decrypted_secret INTO anon_key
  FROM vault.decrypted_secrets WHERE name = 'anon_key' LIMIT 1;

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
$function$;


-- These two now use vault.anon_key consistently with the others (previously used
-- unset current_setting() GUCs which silently fell back to a placeholder URL).
CREATE OR REPLACE FUNCTION public.notify_admin_push_on_critical_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  functions_url TEXT;
  anon_key TEXT;
  v_request_body JSONB;
BEGIN
  IF NEW.severity NOT IN ('critical', 'warning') THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO functions_url
  FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1;

  SELECT decrypted_secret INTO anon_key
  FROM vault.decrypted_secrets WHERE name = 'anon_key' LIMIT 1;

  IF functions_url IS NULL OR anon_key IS NULL THEN
    RAISE WARNING '[notify_admin_push_on_critical_alert] Vault secrets not configured';
    RETURN NEW;
  END IF;

  v_request_body := jsonb_build_object(
    'alertId',   NEW.id,
    'alertType', NEW.alert_type,
    'title',     NEW.title,
    'message',   COALESCE(NEW.message, ''),
    'severity',  NEW.severity,
    'data',      jsonb_build_object(
      'action_url', NEW.action_url,
      'created_at', NEW.created_at
    )
  );

  BEGIN
    PERFORM net.http_post(
      url := functions_url || '/functions/v1/send-admin-push',
      body := v_request_body,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to send admin push notification: %', SQLERRM;
  END;

  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public.send_admin_broadcast_push(
  p_title text,
  p_message text,
  p_severity text DEFAULT 'info'::text,
  p_alert_type text DEFAULT 'broadcast'::text,
  p_admin_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  functions_url TEXT;
  anon_key TEXT;
  request_id bigint;
  v_request_body JSONB;
BEGIN
  SELECT decrypted_secret INTO functions_url
  FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1;

  SELECT decrypted_secret INTO anon_key
  FROM vault.decrypted_secrets WHERE name = 'anon_key' LIMIT 1;

  IF functions_url IS NULL OR anon_key IS NULL THEN
    RETURN jsonb_build_object('error', 'Vault secrets not configured');
  END IF;

  v_request_body := jsonb_build_object(
    'alertType', p_alert_type,
    'title',     p_title,
    'message',   p_message,
    'severity',  p_severity
  );

  IF p_admin_ids IS NOT NULL THEN
    v_request_body := v_request_body || jsonb_build_object('adminIds', p_admin_ids);
  END IF;

  BEGIN
    SELECT INTO request_id net.http_post(
      url := functions_url || '/functions/v1/send-admin-push',
      body := v_request_body,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key
      )
    );

    RETURN jsonb_build_object('request_id', request_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('error', SQLERRM);
  END;
END;
$function$;
