-- =============================================================================
-- Migration: Add Database Trigger for Admin Push Notifications
-- Version: 20260224000001
-- Description: Creates trigger to auto-send push notifications for critical alerts
-- =============================================================================

-- =============================================================================
-- FUNCTION: Notify Admin Push on Critical Alert
-- =============================================================================

CREATE OR REPLACE FUNCTION notify_admin_push_on_critical_alert()
RETURNS TRIGGER AS $$
DECLARE
  v_edge_function_url TEXT;
  v_request_body JSONB;
BEGIN
  -- Only trigger for critical or warning severity
  IF NEW.severity NOT IN ('critical', 'warning') THEN
    RETURN NEW;
  END IF;

  -- Build request body
  v_request_body := jsonb_build_object(
    'alertId', NEW.id,
    'alertType', NEW.alert_type,
    'title', NEW.title,
    'message', COALESCE(NEW.message, ''),
    'severity', NEW.severity,
    'data', jsonb_build_object(
      'action_url', NEW.action_url,
      'created_at', NEW.created_at
    )
  );

  -- Get edge function URL from app settings or use default
  v_edge_function_url := COALESCE(
    current_setting('app.edge_function_url', TRUE),
    current_setting('supabase.edge_function_url', TRUE),
    'https://your-project.supabase.co/functions/v1'
  );

  -- Call edge function asynchronously using pg_net extension if available
  -- Note: pg_net must be enabled in your Supabase project
  BEGIN
    PERFORM net.http_post(
      url := v_edge_function_url || '/send-admin-push',
      body := v_request_body::text,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', TRUE)
      )::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    -- Log error but don't fail the insert
    RAISE WARNING 'Failed to send admin push notification: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- TRIGGER: On Critical Admin Alert Insert
-- =============================================================================

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS on_critical_admin_alert_push ON admin_alert;

-- Create trigger for INSERT
CREATE TRIGGER on_critical_admin_alert_push
  AFTER INSERT ON admin_alert
  FOR EACH ROW
  EXECUTE FUNCTION notify_admin_push_on_critical_alert();

-- =============================================================================
-- HELPER: Manual Push Notification Function
-- For sending push notifications without creating an alert
-- =============================================================================

CREATE OR REPLACE FUNCTION send_admin_broadcast_push(
  p_title TEXT,
  p_message TEXT,
  p_severity TEXT DEFAULT 'info',
  p_alert_type TEXT DEFAULT 'broadcast',
  p_admin_ids UUID[] DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_edge_function_url TEXT;
  v_request_body JSONB;
  v_result JSONB;
BEGIN
  -- Build request body
  v_request_body := jsonb_build_object(
    'alertType', p_alert_type,
    'title', p_title,
    'message', p_message,
    'severity', p_severity
  );

  -- Add admin IDs if specified
  IF p_admin_ids IS NOT NULL THEN
    v_request_body := v_request_body || jsonb_build_object('adminIds', p_admin_ids);
  END IF;

  -- Get edge function URL
  v_edge_function_url := COALESCE(
    current_setting('app.edge_function_url', TRUE),
    current_setting('supabase.edge_function_url', TRUE),
    'https://your-project.supabase.co/functions/v1'
  );

  -- Call edge function
  BEGIN
    SELECT content::jsonb INTO v_result
    FROM net.http_post(
      url := v_edge_function_url || '/send-admin-push',
      body := v_request_body::text,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', TRUE)
      )::jsonb
    );
    
    RETURN v_result;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('error', SQLERRM);
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to service role only (for edge functions / server-side)
GRANT EXECUTE ON FUNCTION send_admin_broadcast_push(TEXT, TEXT, TEXT, TEXT, UUID[]) TO service_role;

-- =============================================================================
-- COMMENT
-- =============================================================================

COMMENT ON FUNCTION notify_admin_push_on_critical_alert() IS 
'Trigger function that sends push notifications to admin devices when critical or warning alerts are created';

COMMENT ON FUNCTION send_admin_broadcast_push(TEXT, TEXT, TEXT, TEXT, UUID[]) IS 
'Manual function to send broadcast push notifications to admins without creating an alert';
