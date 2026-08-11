-- Reputation event type for deadline walkover losers (F4b). Enum-only
-- migration; config row and emission live in the follow-up.

ALTER TYPE reputation_event_type ADD VALUE IF NOT EXISTS 'tournament_unresponsive';
