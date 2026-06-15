-- ============================================
-- Doubles tournaments — partner notification types
-- ============================================
-- New enum values only (used by 20260612160200 partner registration and the
-- slice-2 withdraw notice). Separate migration so the values are committed
-- before any function body references them.
-- ============================================

ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'tournament_partner_registered';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'tournament_partner_withdrew';
