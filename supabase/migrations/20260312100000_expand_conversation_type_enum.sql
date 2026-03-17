-- =============================================================================
-- Migration: Add new conversation_type enum values
-- Must be in its own migration so values are committed before use.
-- =============================================================================

ALTER TYPE conversation_type ADD VALUE IF NOT EXISTS 'group_chat';
ALTER TYPE conversation_type ADD VALUE IF NOT EXISTS 'player_group';
ALTER TYPE conversation_type ADD VALUE IF NOT EXISTS 'community';
ALTER TYPE conversation_type ADD VALUE IF NOT EXISTS 'club';
