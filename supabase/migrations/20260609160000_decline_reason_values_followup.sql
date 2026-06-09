-- Follow-up to 20260609150000_decline_reason_values.sql.
-- That migration was extended (bad_timing, dont_know_player, cost added) AFTER it
-- had already been applied in some environments, so re-running `migration up` skips
-- it and those values never land — declines with them hit an invalid-enum error.
-- This additive, idempotent migration converges every environment to the full set.
-- (Never edit an already-applied migration; add a new one — this is that fix.)

ALTER TYPE cancellation_reason_enum ADD VALUE IF NOT EXISTS 'bad_timing';
ALTER TYPE cancellation_reason_enum ADD VALUE IF NOT EXISTS 'too_far';
ALTER TYPE cancellation_reason_enum ADD VALUE IF NOT EXISTS 'skill_mismatch';
ALTER TYPE cancellation_reason_enum ADD VALUE IF NOT EXISTS 'dont_know_player';
ALTER TYPE cancellation_reason_enum ADD VALUE IF NOT EXISTS 'cost';
ALTER TYPE cancellation_reason_enum ADD VALUE IF NOT EXISTS 'changed_mind';
