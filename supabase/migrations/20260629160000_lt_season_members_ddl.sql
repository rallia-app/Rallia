-- ============================================================================
-- Leagues — season enrollment roster (season_members)  [free phase]
-- ============================================================================
-- Establishes the missing season-level roster. Until now, "who is in a season"
-- had no representation: participation gated only on is_active_league_member()
-- (see session_confirm_presence), and season_rankings is computed standings,
-- not enrollment.
--
-- season_members is:
--   1. the explicit per-season roster, and
--   2. the row paid leagues will attach to in Phase 4 — the existing payment
--      ledger already reserves lt_registration_payment.season_id and
--      .season_user_id for exactly this (season_user_id -> season_members.id).
--
-- This migration ships only the storage layer + the participation helper:
--   - season_member_status enum
--   - season_members table, indexes, updated_at trigger
--   - RLS (select + no_direct_write) mirroring season_rankings
--   - explicit GRANT SELECT (Data API defaults are being removed 2026-10-30)
--   - is_enrolled_season_member() — the future paid participation gate
--
-- Enrollment RPCs ship in 20260629160100; the backfill in 20260629160200.
--
-- The status enum is intentionally registration-shaped. Phase 4 adds a
-- 'payment_pending' value (a plain ALTER TYPE ADD VALUE) so paid is additive:
--   (none) --begin-paid--> payment_pending --webhook ok--> enrolled
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE season_member_status AS ENUM ('pending', 'enrolled', 'withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


CREATE TABLE IF NOT EXISTS season_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES player(id) ON DELETE RESTRICT,

    status season_member_status NOT NULL DEFAULT 'enrolled',

    -- Reserved for a future invite-to-season flow (parity with league invites).
    invited_by uuid REFERENCES player(id),

    enrolled_at timestamptz NOT NULL DEFAULT now(),
    approved_at timestamptz,
    approved_by uuid REFERENCES player(id),
    withdrawn_at timestamptz,

    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE (season_id, user_id)
);

CREATE INDEX IF NOT EXISTS season_members_season_status_idx ON season_members(season_id, status);
CREATE INDEX IF NOT EXISTS season_members_user_idx ON season_members(user_id);


DROP TRIGGER IF EXISTS update_season_members_updated_at ON season_members;
CREATE TRIGGER update_season_members_updated_at BEFORE UPDATE ON season_members
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================
-- RLS — mirrors season_rankings (season-scoped: organizer / active member /
-- public league), plus a self-row read so a member always sees their own
-- enrollment. Writes go exclusively through the SECURITY DEFINER RPCs.
-- ============================================

ALTER TABLE season_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS season_members_select ON season_members;
CREATE POLICY season_members_select ON season_members FOR SELECT
USING (
    public.is_admin()
    OR user_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM seasons s
          JOIN leagues l ON l.id = s.league_id
         WHERE s.id = season_members.season_id
           AND (
               l.visibility = 'public'
               OR public.is_league_organizer(l.id)
               OR public.is_active_league_member(l.id)
           )
    )
);

DROP POLICY IF EXISTS season_members_no_direct_write ON season_members;
CREATE POLICY season_members_no_direct_write ON season_members FOR ALL
USING (false) WITH CHECK (false);


-- Reads go through PostgREST as `authenticated`, gated by the SELECT policy.
-- service_role bypasses RLS but still needs table privileges for edge-function
-- / admin read paths (e.g. Phase 4 settlement).
GRANT SELECT ON public.season_members TO authenticated, service_role;


-- ============================================
-- Participation helper — the season analogue of is_active_league_member().
-- Free phase: nothing gates on it yet. Phase 4: session_confirm_presence (and
-- score entry) for a *paid* season will require this instead of mere league
-- membership.
-- ============================================

CREATE OR REPLACE FUNCTION public.is_enrolled_season_member(p_season_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM season_members sm
         WHERE sm.season_id = p_season_id
           AND sm.user_id   = auth.uid()
           AND sm.status    = 'enrolled'
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_enrolled_season_member(uuid) TO authenticated;


COMMENT ON TABLE season_members IS 'Per-season enrollment roster. One row per (season, player). The row paid leagues attach payment to in Phase 4 (lt_registration_payment.season_user_id -> season_members.id).';
COMMENT ON FUNCTION public.is_enrolled_season_member(uuid) IS 'True if the caller has an enrolled season_members row. Phase 4 paid-season participation gate.';
