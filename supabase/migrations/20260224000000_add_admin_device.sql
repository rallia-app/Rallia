-- =============================================================================
-- Migration: Add Admin Device Token Table for Push Notifications
-- Version: 20260224000000
-- Description: Creates admin_device table for storing push notification tokens
-- =============================================================================

-- =============================================================================
-- TABLE: admin_device
-- Stores push notification tokens for admin devices
-- =============================================================================

CREATE TABLE IF NOT EXISTS admin_device (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES admin(id) ON DELETE CASCADE,
  push_token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  device_name TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  last_active TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(admin_id, push_token)
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_admin_device_admin_id ON admin_device(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_device_active ON admin_device(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_admin_device_push_token ON admin_device(push_token);

-- Add comment
COMMENT ON TABLE admin_device IS 'Stores push notification tokens for admin devices';

-- =============================================================================
-- TRIGGER: Update updated_at timestamp
-- =============================================================================

CREATE OR REPLACE FUNCTION update_admin_device_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER admin_device_updated_at
  BEFORE UPDATE ON admin_device
  FOR EACH ROW
  EXECUTE FUNCTION update_admin_device_updated_at();

-- =============================================================================
-- RLS POLICIES
-- =============================================================================

ALTER TABLE admin_device ENABLE ROW LEVEL SECURITY;

-- Admins can manage their own device tokens
CREATE POLICY "Admins can view own devices"
  ON admin_device
  FOR SELECT
  USING (
    admin_id IN (SELECT id FROM admin WHERE id = auth.uid())
  );

CREATE POLICY "Admins can insert own devices"
  ON admin_device
  FOR INSERT
  WITH CHECK (
    admin_id IN (SELECT id FROM admin WHERE id = auth.uid())
  );

CREATE POLICY "Admins can update own devices"
  ON admin_device
  FOR UPDATE
  USING (
    admin_id IN (SELECT id FROM admin WHERE id = auth.uid())
  );

CREATE POLICY "Admins can delete own devices"
  ON admin_device
  FOR DELETE
  USING (
    admin_id IN (SELECT id FROM admin WHERE id = auth.uid())
  );

-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================

-- Function to register or update a device token
CREATE OR REPLACE FUNCTION register_admin_device(
  p_admin_id UUID,
  p_push_token TEXT,
  p_platform TEXT,
  p_device_name TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_device_id UUID;
BEGIN
  INSERT INTO admin_device (admin_id, push_token, platform, device_name, last_active)
  VALUES (p_admin_id, p_push_token, p_platform, p_device_name, NOW())
  ON CONFLICT (admin_id, push_token)
  DO UPDATE SET
    is_active = TRUE,
    last_active = NOW(),
    device_name = COALESCE(EXCLUDED.device_name, admin_device.device_name)
  RETURNING id INTO v_device_id;
  
  RETURN v_device_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to unregister a device token
CREATE OR REPLACE FUNCTION unregister_admin_device(
  p_admin_id UUID,
  p_push_token TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE admin_device
  SET is_active = FALSE
  WHERE admin_id = p_admin_id AND push_token = p_push_token;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get active device tokens for admins with specific alert preferences
CREATE OR REPLACE FUNCTION get_admin_push_tokens(
  p_alert_type TEXT,
  p_severity TEXT DEFAULT 'info'
)
RETURNS TABLE (
  admin_id UUID,
  push_token TEXT,
  platform TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    d.admin_id,
    d.push_token,
    d.platform
  FROM admin_device d
  INNER JOIN admin_alert_preference p ON d.admin_id = p.admin_id
  WHERE d.is_active = TRUE
    AND p.alert_type = p_alert_type
    AND p.push_enabled = TRUE
    AND (
      p_severity = 'critical' OR
      p_severity = 'warning' OR
      p_severity = 'info'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION register_admin_device(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION unregister_admin_device(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_admin_push_tokens(TEXT, TEXT) TO service_role;

-- =============================================================================
-- ADD PUSH_ENABLED TO ALERT PREFERENCES IF NOT EXISTS
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'admin_alert_preference' 
    AND column_name = 'push_enabled'
  ) THEN
    ALTER TABLE admin_alert_preference ADD COLUMN push_enabled BOOLEAN DEFAULT TRUE;
  END IF;
END $$;
