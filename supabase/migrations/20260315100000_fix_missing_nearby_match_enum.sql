-- ============================================================================
-- Migration: Fix missing nearby_match_available notification type
-- Created: 2026-03-15
-- Description: Adds the nearby_match_available enum value that was missing
-- ============================================================================

ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'nearby_match_available';
