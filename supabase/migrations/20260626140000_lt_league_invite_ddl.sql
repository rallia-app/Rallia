-- ============================================================================
-- Intra-app league invite — enum values + invited_by marker (DDL only)
-- ============================================================================
-- Mirrors the tournament invite DDL (20260625110000). New enum values can't be
-- USED in the same transaction they're added, so the trigger + RPCs that
-- reference them live in the next migration. `invited_by` marks an
-- organizer-initiated invite (vs a self-request), so the membership trigger and
-- the organizer's pending list can tell them apart and the invitee gets an
-- Accept CTA.
-- ============================================================================

ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'league_invitation';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'league_member_request';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'league_member_approved';

ALTER TABLE public.league_members
  ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES public.player(id) ON DELETE SET NULL;
