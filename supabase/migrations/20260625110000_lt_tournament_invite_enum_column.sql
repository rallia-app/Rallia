-- ============================================================================
-- Intra-app tournament invite — enum value + invited_by marker
-- ============================================================================
-- DDL-only, kept in its own migration: a new enum value can't be USED in the
-- same transaction it's added, so the RPCs/trigger that reference
-- 'tournament_invitation' live in the next migration (applied after this
-- commits). invited_by marks an organizer-initiated invite (vs a self-request),
-- so the registration trigger and the organizer's approval list can tell them
-- apart, and the invitee gets an Accept CTA.
-- ============================================================================

ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'tournament_invitation';

ALTER TABLE public.tournament_registrations
  ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES public.player(id) ON DELETE SET NULL;
