-- Drop and recreate temp table for debug output
DROP TABLE IF EXISTS _debug_output;
CREATE TEMP TABLE _debug_output(step text, detail text);

DO $$
DECLARE
  functions_url TEXT;
  anon_key TEXT;
  request_id bigint;
  player_name TEXT;
  player_email TEXT;
  payload JSONB;
BEGIN
  INSERT INTO _debug_output VALUES ('start', 'begin');

  SELECT decrypted_secret INTO functions_url
  FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1;

  SELECT decrypted_secret INTO anon_key
  FROM vault.decrypted_secrets WHERE name = 'anon_key' LIMIT 1;

  INSERT INTO _debug_output VALUES ('vault', 'url=' || COALESCE(LEFT(functions_url, 30), 'NULL') || ' key_len=' || COALESCE(length(anon_key)::text, 'NULL'));

  IF functions_url IS NULL OR anon_key IS NULL THEN
    INSERT INTO _debug_output VALUES ('abort', 'vault secrets missing');
    RETURN;
  END IF;

  SELECT
    COALESCE(p.first_name || ' ' || p.last_name, p.first_name, 'Unknown'),
    u.email
  INTO player_name, player_email
  FROM public.player p
  LEFT JOIN auth.users u ON u.id = p.id
  WHERE p.id = '882074a5-3984-49c3-81ef-3d50a5bfc78e';

  INSERT INTO _debug_output VALUES ('player', COALESCE(player_name, 'NULL') || ' / ' || COALESCE(player_email, 'NULL'));

  payload := jsonb_build_object(
    'feedback_id', 'debug-test',
    'category', 'bug',
    'subject', 'DO block debug test',
    'message', 'Testing',
    'player_id', '882074a5-3984-49c3-81ef-3d50a5bfc78e',
    'player_name', player_name,
    'player_email', player_email,
    'created_at', NOW()::text
  );

  INSERT INTO _debug_output VALUES ('payload', payload::text);

  SELECT INTO request_id net.http_post(
    url := functions_url || '/functions/v1/send-feedback-notification',
    body := payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key
    ),
    timeout_milliseconds := 5000
  );

  INSERT INTO _debug_output VALUES ('success', 'request_id=' || request_id::text);
EXCEPTION
  WHEN others THEN
    INSERT INTO _debug_output VALUES ('error', SQLERRM || ' [' || SQLSTATE || ']');
END;
$$;

SELECT * FROM _debug_output;
