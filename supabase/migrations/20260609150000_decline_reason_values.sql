-- Add invitee-decline-framed values to cancellation_reason_enum so we can capture
-- WHY a player declines a match invitation (today match_participant.cancellation_reason
-- is ~0.4% populated). The existing 'other' value is reused; these four are the
-- decline-specific reasons. Additive only — existing consumers (bookings, feedback,
-- programs) are unaffected.

ALTER TYPE cancellation_reason_enum ADD VALUE IF NOT EXISTS 'bad_timing';
ALTER TYPE cancellation_reason_enum ADD VALUE IF NOT EXISTS 'too_far';
ALTER TYPE cancellation_reason_enum ADD VALUE IF NOT EXISTS 'skill_mismatch';
ALTER TYPE cancellation_reason_enum ADD VALUE IF NOT EXISTS 'dont_know_player';
ALTER TYPE cancellation_reason_enum ADD VALUE IF NOT EXISTS 'cost';
ALTER TYPE cancellation_reason_enum ADD VALUE IF NOT EXISTS 'changed_mind';
