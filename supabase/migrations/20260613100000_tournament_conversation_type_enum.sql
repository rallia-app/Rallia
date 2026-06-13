-- Tournament chat: new conversation_type enum value.
-- Enum-only migration: ADD VALUE cannot be used in the same transaction
-- that references the new value (same pattern as 20260312100000).

ALTER TYPE public.conversation_type ADD VALUE IF NOT EXISTS 'tournament';
