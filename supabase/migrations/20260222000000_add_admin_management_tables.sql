-- Migration: Add Admin Management Tables
-- Created: 2026-02-22
-- Description: Creates player_ban and admin_audit_log tables for admin user management
-- Part of: Admin Interface Phase 2

-- ============================================
-- ENUM TYPES
-- ============================================

-- Ban type enum
CREATE TYPE ban_type_enum AS ENUM ('temporary', 'permanent');

-- Admin action types for audit log
CREATE TYPE admin_action_type_enum AS ENUM (
  'view',
  'create',
  'update',
  'delete',
  'ban',
  'unban',
  'export',
  'login',
  'logout',
  'settings_change'
);

-- Admin entity types for audit log
CREATE TYPE admin_entity_type_enum AS ENUM (
  'player',
  'profile',
  'match',
  'organization',
  'facility',
  'report',
  'conversation',
  'network',
  'admin',
  'system'
);

-- ============================================
-- PLAYER BAN TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS player_ban (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  banned_by_admin_id UUID NOT NULL REFERENCES admin(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  ban_type ban_type_enum NOT NULL DEFAULT 'permanent',
  banned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  lifted_at TIMESTAMPTZ,
  lifted_by_admin_id UUID REFERENCES admin(id) ON DELETE SET NULL,
  lift_reason TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT player_ban_pkey PRIMARY KEY (id),
  CONSTRAINT player_ban_expires_check CHECK (
    (ban_type = 'temporary' AND expires_at IS NOT NULL) OR
    (ban_type = 'permanent' AND expires_at IS NULL)
  )
);

-- Indexes for player_ban
CREATE INDEX idx_player_ban_player_id ON player_ban(player_id);
CREATE INDEX idx_player_ban_is_active ON player_ban(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_player_ban_banned_at ON player_ban(banned_at DESC);
CREATE INDEX idx_player_ban_banned_by ON player_ban(banned_by_admin_id);

-- Comments
COMMENT ON TABLE player_ban IS 'Tracks player bans issued by administrators';
COMMENT ON COLUMN player_ban.player_id IS 'The player being banned';
COMMENT ON COLUMN player_ban.banned_by_admin_id IS 'The admin who issued the ban';
COMMENT ON COLUMN player_ban.reason IS 'Reason for the ban (visible to user)';
COMMENT ON COLUMN player_ban.ban_type IS 'Whether the ban is temporary or permanent';
COMMENT ON COLUMN player_ban.expires_at IS 'When the ban expires (for temporary bans)';
COMMENT ON COLUMN player_ban.lifted_at IS 'When the ban was lifted (if unbanned)';
COMMENT ON COLUMN player_ban.lifted_by_admin_id IS 'The admin who lifted the ban';
COMMENT ON COLUMN player_ban.notes IS 'Internal admin notes (not visible to user)';
COMMENT ON COLUMN player_ban.is_active IS 'Whether the ban is currently in effect';

-- ============================================
-- ADMIN AUDIT LOG TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES admin(id) ON DELETE SET NULL,
  action_type admin_action_type_enum NOT NULL,
  entity_type admin_entity_type_enum NOT NULL,
  entity_id UUID,
  old_data JSONB,
  new_data JSONB,
  ip_address INET,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id)
);

-- Indexes for admin_audit_log
CREATE INDEX idx_admin_audit_log_admin_id ON admin_audit_log(admin_id);
CREATE INDEX idx_admin_audit_log_created_at ON admin_audit_log(created_at DESC);
CREATE INDEX idx_admin_audit_log_entity ON admin_audit_log(entity_type, entity_id);
CREATE INDEX idx_admin_audit_log_action ON admin_audit_log(action_type);

-- Comments
COMMENT ON TABLE admin_audit_log IS 'Tracks all admin actions for audit purposes';
COMMENT ON COLUMN admin_audit_log.admin_id IS 'The admin who performed the action';
COMMENT ON COLUMN admin_audit_log.action_type IS 'Type of action performed';
COMMENT ON COLUMN admin_audit_log.entity_type IS 'Type of entity affected';
COMMENT ON COLUMN admin_audit_log.entity_id IS 'ID of the affected entity';
COMMENT ON COLUMN admin_audit_log.old_data IS 'Previous state of the entity (for updates/deletes)';
COMMENT ON COLUMN admin_audit_log.new_data IS 'New state of the entity (for creates/updates)';
COMMENT ON COLUMN admin_audit_log.ip_address IS 'IP address of the admin';
COMMENT ON COLUMN admin_audit_log.user_agent IS 'Browser/app user agent';
COMMENT ON COLUMN admin_audit_log.metadata IS 'Additional context about the action';

-- ============================================
-- TRIGGER: Auto-update updated_at on player_ban
-- ============================================

CREATE OR REPLACE FUNCTION update_player_ban_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_player_ban_updated_at
  BEFORE UPDATE ON player_ban
  FOR EACH ROW
  EXECUTE FUNCTION update_player_ban_updated_at();

-- ============================================
-- TRIGGER: Auto-expire temporary bans
-- ============================================

CREATE OR REPLACE FUNCTION check_ban_expiration()
RETURNS TRIGGER AS $$
BEGIN
  -- If this is a temporary ban and it has expired, mark as inactive
  IF NEW.ban_type = 'temporary' 
     AND NEW.expires_at IS NOT NULL 
     AND NEW.expires_at <= NOW() 
     AND NEW.is_active = TRUE THEN
    NEW.is_active = FALSE;
    NEW.lifted_at = NEW.expires_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_check_ban_expiration
  BEFORE INSERT OR UPDATE ON player_ban
  FOR EACH ROW
  EXECUTE FUNCTION check_ban_expiration();

-- ============================================
-- FUNCTION: Get active ban for a player
-- ============================================

CREATE OR REPLACE FUNCTION get_active_player_ban(p_player_id UUID)
RETURNS TABLE (
  id UUID,
  reason TEXT,
  ban_type ban_type_enum,
  banned_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  banned_by_admin_id UUID
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pb.id,
    pb.reason,
    pb.ban_type,
    pb.banned_at,
    pb.expires_at,
    pb.banned_by_admin_id
  FROM player_ban pb
  WHERE pb.player_id = p_player_id
    AND pb.is_active = TRUE
    AND (pb.expires_at IS NULL OR pb.expires_at > NOW())
  ORDER BY pb.banned_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- FUNCTION: Check if player is banned
-- ============================================

CREATE OR REPLACE FUNCTION is_player_banned(p_player_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  ban_exists BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 
    FROM player_ban 
    WHERE player_id = p_player_id 
      AND is_active = TRUE
      AND (expires_at IS NULL OR expires_at > NOW())
  ) INTO ban_exists;
  
  RETURN ban_exists;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- FUNCTION: Log admin action
-- ============================================

CREATE OR REPLACE FUNCTION log_admin_action(
  p_admin_id UUID,
  p_action_type admin_action_type_enum,
  p_entity_type admin_entity_type_enum,
  p_entity_id UUID DEFAULT NULL,
  p_old_data JSONB DEFAULT NULL,
  p_new_data JSONB DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID AS $$
DECLARE
  log_id UUID;
BEGIN
  INSERT INTO admin_audit_log (
    admin_id,
    action_type,
    entity_type,
    entity_id,
    old_data,
    new_data,
    metadata
  ) VALUES (
    p_admin_id,
    p_action_type,
    p_entity_type,
    p_entity_id,
    p_old_data,
    p_new_data,
    p_metadata
  )
  RETURNING id INTO log_id;
  
  RETURN log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- RLS POLICIES
-- ============================================

-- Enable RLS on both tables
ALTER TABLE player_ban ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Player Ban Policies

-- Admins can view all bans
CREATE POLICY "Admins can view all bans"
  ON player_ban
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin WHERE id = auth.uid()
    )
  );

-- Moderators and above can create bans
CREATE POLICY "Moderators can create bans"
  ON player_ban
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin 
      WHERE id = auth.uid() 
        AND role IN ('super_admin', 'moderator')
    )
  );

-- Moderators and above can update bans (for lifting)
CREATE POLICY "Moderators can update bans"
  ON player_ban
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin 
      WHERE id = auth.uid() 
        AND role IN ('super_admin', 'moderator')
    )
  );

-- Players can view their own active ban (limited info)
CREATE POLICY "Players can view own ban"
  ON player_ban
  FOR SELECT
  TO authenticated
  USING (
    player_id = auth.uid() AND is_active = TRUE
  );

-- Admin Audit Log Policies

-- Admins can view audit logs
CREATE POLICY "Admins can view audit logs"
  ON admin_audit_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin WHERE id = auth.uid()
    )
  );

-- Only via RPC function (SECURITY DEFINER) can insert audit logs
CREATE POLICY "Audit logs are insert-only via function"
  ON admin_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin WHERE id = auth.uid()
    )
  );

-- ============================================
-- ADD 'analyst' TO admin_role_enum IF NOT EXISTS
-- ============================================

DO $$
BEGIN
  -- Check if 'analyst' value exists in admin_role_enum
  IF NOT EXISTS (
    SELECT 1 
    FROM pg_enum 
    WHERE enumtypid = 'admin_role_enum'::regtype 
      AND enumlabel = 'analyst'
  ) THEN
    ALTER TYPE admin_role_enum ADD VALUE 'analyst';
  END IF;
END
$$;

-- ============================================
-- GRANT PERMISSIONS
-- ============================================

GRANT SELECT, INSERT, UPDATE ON player_ban TO authenticated;
GRANT SELECT, INSERT ON admin_audit_log TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_player_ban(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION is_player_banned(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION log_admin_action(UUID, admin_action_type_enum, admin_entity_type_enum, UUID, JSONB, JSONB, JSONB) TO authenticated;
