-- Pool + knockout tournaments (F1 of the pool_knockout format).
-- Enum-only migration: a value added to an enum cannot be referenced in the
-- same transaction, so every consumer lives in the follow-up migration.

ALTER TYPE bracket_type ADD VALUE IF NOT EXISTS 'pool_knockout';
