-- Graduated cancellation penalties & match_left_late event type
-- Part 1: Add enum value (must be in its own transaction)

-- 1. Add match_left_late to the enum
ALTER TYPE reputation_event_type ADD VALUE IF NOT EXISTS 'match_left_late';
