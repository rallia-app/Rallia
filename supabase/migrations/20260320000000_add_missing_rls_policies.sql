-- =============================================================================
-- Migration: Add RLS to 10 unprotected tables
-- Description: Enable Row Level Security and create policies for tables that
--              were missing RLS: organization, organization_member, facility,
--              court, court_slot, conversation, report, match_result,
--              player_review, network_type
-- =============================================================================

-- =============================================================================
-- HELPER FUNCTIONS (SECURITY DEFINER to avoid RLS recursion)
-- =============================================================================

-- Check if user is a member of an organization (any active role)
CREATE OR REPLACE FUNCTION is_org_member(org_id_param UUID, user_id_param UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_member
    WHERE organization_id = org_id_param
    AND user_id = user_id_param
    AND left_at IS NULL
  );
$$;

-- Check if user is an admin of an organization (owner or admin role)
CREATE OR REPLACE FUNCTION is_org_admin(org_id_param UUID, user_id_param UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_member
    WHERE organization_id = org_id_param
    AND user_id = user_id_param
    AND left_at IS NULL
    AND role IN ('owner', 'admin')
  );
$$;

-- Check if user is staff of an organization (owner, admin, manager, or staff)
CREATE OR REPLACE FUNCTION is_org_staff(org_id_param UUID, user_id_param UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_member
    WHERE organization_id = org_id_param
    AND user_id = user_id_param
    AND left_at IS NULL
    AND role IN ('owner', 'admin', 'manager', 'staff')
  );
$$;

-- Check if user is a participant in a conversation (SECURITY DEFINER to bypass
-- conversation_participant RLS and avoid recursion)
CREATE OR REPLACE FUNCTION is_conversation_participant(conversation_id_param UUID, user_id_param UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_participant
    WHERE conversation_id = conversation_id_param
    AND player_id = user_id_param
  );
$$;

-- Grant execute on helper functions
GRANT EXECUTE ON FUNCTION is_org_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION is_org_member(UUID, UUID) TO anon;
GRANT EXECUTE ON FUNCTION is_org_admin(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION is_org_staff(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION is_conversation_participant(UUID, UUID) TO authenticated;

-- =============================================================================
-- 1. ORGANIZATION
-- =============================================================================

ALTER TABLE public.organization ENABLE ROW LEVEL SECURITY;

-- Public listing: anyone can browse organizations
CREATE POLICY "Anyone can view organizations"
  ON public.organization FOR SELECT
  TO anon, authenticated
  USING (true);

-- Authenticated users can create organizations
CREATE POLICY "Authenticated users can create organizations"
  ON public.organization FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Only org admins can update their organization
CREATE POLICY "Org admins can update their organization"
  ON public.organization FOR UPDATE
  TO authenticated
  USING (is_org_admin(id, auth.uid()));

-- Only org admins can delete their organization
CREATE POLICY "Org admins can delete their organization"
  ON public.organization FOR DELETE
  TO authenticated
  USING (is_org_admin(id, auth.uid()));

-- =============================================================================
-- 2. ORGANIZATION_MEMBER
-- =============================================================================

ALTER TABLE public.organization_member ENABLE ROW LEVEL SECURITY;

-- Members can view other members of their org, or users can see their own membership
CREATE POLICY "Members can view org members"
  ON public.organization_member FOR SELECT
  TO authenticated
  USING (
    is_org_member(organization_id, auth.uid())
    OR user_id = auth.uid()
  );

-- Org admins can add members, or users can join (self-insert)
CREATE POLICY "Org admins or self can insert membership"
  ON public.organization_member FOR INSERT
  TO authenticated
  WITH CHECK (
    is_org_admin(organization_id, auth.uid())
    OR user_id = auth.uid()
  );

-- Org admins can update members, or users can update their own membership
CREATE POLICY "Org admins or self can update membership"
  ON public.organization_member FOR UPDATE
  TO authenticated
  USING (
    is_org_admin(organization_id, auth.uid())
    OR user_id = auth.uid()
  );

-- Org admins can remove members, or users can leave (self-delete)
CREATE POLICY "Org admins or self can delete membership"
  ON public.organization_member FOR DELETE
  TO authenticated
  USING (
    is_org_admin(organization_id, auth.uid())
    OR user_id = auth.uid()
  );

-- =============================================================================
-- 3. FACILITY
-- =============================================================================

ALTER TABLE public.facility ENABLE ROW LEVEL SECURITY;

-- Public listing: anyone can browse facilities
CREATE POLICY "Anyone can view facilities"
  ON public.facility FOR SELECT
  TO anon, authenticated
  USING (true);

-- Org staff can create facilities
CREATE POLICY "Org staff can create facilities"
  ON public.facility FOR INSERT
  TO authenticated
  WITH CHECK (is_org_staff(organization_id, auth.uid()));

-- Org staff can update facilities
CREATE POLICY "Org staff can update facilities"
  ON public.facility FOR UPDATE
  TO authenticated
  USING (is_org_staff(organization_id, auth.uid()));

-- Only org admins can delete facilities
CREATE POLICY "Org admins can delete facilities"
  ON public.facility FOR DELETE
  TO authenticated
  USING (is_org_admin(organization_id, auth.uid()));

-- =============================================================================
-- 4. COURT
-- =============================================================================

ALTER TABLE public.court ENABLE ROW LEVEL SECURITY;

-- Public listing: anyone can browse courts
CREATE POLICY "Anyone can view courts"
  ON public.court FOR SELECT
  TO anon, authenticated
  USING (true);

-- Org staff can create courts (via facility JOIN)
CREATE POLICY "Org staff can create courts"
  ON public.court FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.facility f
      WHERE f.id = facility_id
      AND is_org_staff(f.organization_id, auth.uid())
    )
  );

-- Org staff can update courts
CREATE POLICY "Org staff can update courts"
  ON public.court FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facility f
      WHERE f.id = facility_id
      AND is_org_staff(f.organization_id, auth.uid())
    )
  );

-- Only org admins can delete courts
CREATE POLICY "Org admins can delete courts"
  ON public.court FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facility f
      WHERE f.id = facility_id
      AND is_org_admin(f.organization_id, auth.uid())
    )
  );

-- =============================================================================
-- 5. COURT_SLOT
-- =============================================================================

ALTER TABLE public.court_slot ENABLE ROW LEVEL SECURITY;

-- Public listing: anyone can browse court slots (for booking/search)
CREATE POLICY "Anyone can view court slots"
  ON public.court_slot FOR SELECT
  TO anon, authenticated
  USING (true);

-- Org staff can create court slots (via court → facility JOIN)
CREATE POLICY "Org staff can create court slots"
  ON public.court_slot FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.court c
      JOIN public.facility f ON f.id = c.facility_id
      WHERE c.id = court_id
      AND is_org_staff(f.organization_id, auth.uid())
    )
  );

-- Org staff can update court slots
CREATE POLICY "Org staff can update court slots"
  ON public.court_slot FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.court c
      JOIN public.facility f ON f.id = c.facility_id
      WHERE c.id = court_id
      AND is_org_staff(f.organization_id, auth.uid())
    )
  );

-- Only org admins can delete court slots
CREATE POLICY "Org admins can delete court slots"
  ON public.court_slot FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.court c
      JOIN public.facility f ON f.id = c.facility_id
      WHERE c.id = court_id
      AND is_org_admin(f.organization_id, auth.uid())
    )
  );

-- =============================================================================
-- 6. CONVERSATION
-- =============================================================================

ALTER TABLE public.conversation ENABLE ROW LEVEL SECURITY;

-- Participants can view conversations they're in, or the creator can view
CREATE POLICY "Participants can view conversations"
  ON public.conversation FOR SELECT
  TO authenticated
  USING (
    created_by = auth.uid()
    OR is_conversation_participant(id, auth.uid())
  );

-- Authenticated users can create conversations
CREATE POLICY "Authenticated users can create conversations"
  ON public.conversation FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Only the creator can update the conversation
CREATE POLICY "Creator can update conversation"
  ON public.conversation FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid());

-- Only the creator can delete the conversation
CREATE POLICY "Creator can delete conversation"
  ON public.conversation FOR DELETE
  TO authenticated
  USING (created_by = auth.uid());

-- =============================================================================
-- 7. REPORT
-- =============================================================================

ALTER TABLE public.report ENABLE ROW LEVEL SECURITY;

-- Reporters can view their own reports, admins can view all
CREATE POLICY "Reporter or admin can view reports"
  ON public.report FOR SELECT
  TO authenticated
  USING (
    reporter_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

-- Authenticated users can create reports (must be the reporter)
CREATE POLICY "Authenticated users can create reports"
  ON public.report FOR INSERT
  TO authenticated
  WITH CHECK (reporter_id = auth.uid());

-- Only admins can update reports
CREATE POLICY "Admins can update reports"
  ON public.report FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

-- Only admins can delete reports
CREATE POLICY "Admins can delete reports"
  ON public.report FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

-- =============================================================================
-- 8. MATCH_RESULT
-- =============================================================================

ALTER TABLE public.match_result ENABLE ROW LEVEL SECURITY;

-- Match participants or the match creator can view results
CREATE POLICY "Match participants can view results"
  ON public.match_result FOR SELECT
  TO authenticated
  USING (
    match_id IN (
      SELECT mp.match_id FROM public.match_participant mp
      WHERE mp.player_id = auth.uid()
    )
    OR match_id IN (
      SELECT m.id FROM public.match m
      WHERE m.created_by = auth.uid()
    )
  );

-- Match creator can insert results
CREATE POLICY "Match creator can insert results"
  ON public.match_result FOR INSERT
  TO authenticated
  WITH CHECK (
    match_id IN (
      SELECT m.id FROM public.match m
      WHERE m.created_by = auth.uid()
    )
  );

-- Match creator can update results
CREATE POLICY "Match creator can update results"
  ON public.match_result FOR UPDATE
  TO authenticated
  USING (
    match_id IN (
      SELECT m.id FROM public.match m
      WHERE m.created_by = auth.uid()
    )
  );

-- Only admins can delete results
CREATE POLICY "Admins can delete match results"
  ON public.match_result FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

-- =============================================================================
-- 9. PLAYER_REVIEW
-- =============================================================================

ALTER TABLE public.player_review ENABLE ROW LEVEL SECURITY;

-- Reviewer, reviewed player, or admin can view reviews
CREATE POLICY "Reviewer reviewed or admin can view reviews"
  ON public.player_review FOR SELECT
  TO authenticated
  USING (
    reviewer_id = auth.uid()
    OR reviewed_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

-- Authenticated users can create reviews (must be the reviewer)
CREATE POLICY "Reviewer can create reviews"
  ON public.player_review FOR INSERT
  TO authenticated
  WITH CHECK (reviewer_id = auth.uid());

-- Only the reviewer can update their review
CREATE POLICY "Reviewer can update their review"
  ON public.player_review FOR UPDATE
  TO authenticated
  USING (reviewer_id = auth.uid());

-- Reviewer or admin can delete reviews
CREATE POLICY "Reviewer or admin can delete reviews"
  ON public.player_review FOR DELETE
  TO authenticated
  USING (
    reviewer_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

-- =============================================================================
-- 10. NETWORK_TYPE
-- =============================================================================

ALTER TABLE public.network_type ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view network types (reference data)
CREATE POLICY "Authenticated users can view network types"
  ON public.network_type FOR SELECT
  TO authenticated
  USING (true);

-- Only admins can insert network types
CREATE POLICY "Admins can insert network types"
  ON public.network_type FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

-- Only admins can update network types
CREATE POLICY "Admins can update network types"
  ON public.network_type FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

-- Only admins can delete network types
CREATE POLICY "Admins can delete network types"
  ON public.network_type FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

-- =============================================================================
-- 11. FACILITY_CONTACT
-- =============================================================================

ALTER TABLE public.facility_contact ENABLE ROW LEVEL SECURITY;

-- Public listing: anyone can view facility contacts
CREATE POLICY "Anyone can view facility contacts"
  ON public.facility_contact FOR SELECT
  TO anon, authenticated
  USING (true);

-- Org staff can create facility contacts (via facility JOIN)
CREATE POLICY "Org staff can create facility contacts"
  ON public.facility_contact FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.facility f
      WHERE f.id = facility_id
      AND is_org_staff(f.organization_id, auth.uid())
    )
  );

-- Org staff can update facility contacts
CREATE POLICY "Org staff can update facility contacts"
  ON public.facility_contact FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facility f
      WHERE f.id = facility_id
      AND is_org_staff(f.organization_id, auth.uid())
    )
  );

-- Org admins can delete facility contacts
CREATE POLICY "Org admins can delete facility contacts"
  ON public.facility_contact FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facility f
      WHERE f.id = facility_id
      AND is_org_admin(f.organization_id, auth.uid())
    )
  );

-- =============================================================================
-- 12. FACILITY_IMAGE
-- =============================================================================

ALTER TABLE public.facility_image ENABLE ROW LEVEL SECURITY;

-- Public listing: anyone can view facility images
CREATE POLICY "Anyone can view facility images"
  ON public.facility_image FOR SELECT
  TO anon, authenticated
  USING (true);

-- Org staff can create facility images (via facility JOIN)
CREATE POLICY "Org staff can create facility images"
  ON public.facility_image FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.facility f
      WHERE f.id = facility_id
      AND is_org_staff(f.organization_id, auth.uid())
    )
  );

-- Org staff can update facility images
CREATE POLICY "Org staff can update facility images"
  ON public.facility_image FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facility f
      WHERE f.id = facility_id
      AND is_org_staff(f.organization_id, auth.uid())
    )
  );

-- Org admins can delete facility images
CREATE POLICY "Org admins can delete facility images"
  ON public.facility_image FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facility f
      WHERE f.id = facility_id
      AND is_org_admin(f.organization_id, auth.uid())
    )
  );

-- =============================================================================
-- 13. FACILITY_SPORT (junction table)
-- =============================================================================

ALTER TABLE public.facility_sport ENABLE ROW LEVEL SECURITY;

-- Public listing: anyone can view facility-sport associations
CREATE POLICY "Anyone can view facility sports"
  ON public.facility_sport FOR SELECT
  TO anon, authenticated
  USING (true);

-- Org staff can create facility-sport associations
CREATE POLICY "Org staff can create facility sports"
  ON public.facility_sport FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.facility f
      WHERE f.id = facility_id
      AND is_org_staff(f.organization_id, auth.uid())
    )
  );

-- Org staff can update facility-sport associations
CREATE POLICY "Org staff can update facility sports"
  ON public.facility_sport FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facility f
      WHERE f.id = facility_id
      AND is_org_staff(f.organization_id, auth.uid())
    )
  );

-- Org admins can delete facility-sport associations
CREATE POLICY "Org admins can delete facility sports"
  ON public.facility_sport FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facility f
      WHERE f.id = facility_id
      AND is_org_admin(f.organization_id, auth.uid())
    )
  );

-- =============================================================================
-- 14. COURT_SPORT (junction table)
-- =============================================================================

ALTER TABLE public.court_sport ENABLE ROW LEVEL SECURITY;

-- Public listing: anyone can view court-sport associations
CREATE POLICY "Anyone can view court sports"
  ON public.court_sport FOR SELECT
  TO anon, authenticated
  USING (true);

-- Org staff can create court-sport associations (via court → facility JOIN)
CREATE POLICY "Org staff can create court sports"
  ON public.court_sport FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.court c
      JOIN public.facility f ON f.id = c.facility_id
      WHERE c.id = court_id
      AND is_org_staff(f.organization_id, auth.uid())
    )
  );

-- Org staff can update court-sport associations
CREATE POLICY "Org staff can update court sports"
  ON public.court_sport FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.court c
      JOIN public.facility f ON f.id = c.facility_id
      WHERE c.id = court_id
      AND is_org_staff(f.organization_id, auth.uid())
    )
  );

-- Org admins can delete court-sport associations
CREATE POLICY "Org admins can delete court sports"
  ON public.court_sport FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.court c
      JOIN public.facility f ON f.id = c.facility_id
      WHERE c.id = court_id
      AND is_org_admin(f.organization_id, auth.uid())
    )
  );

-- =============================================================================
-- 15. INVITATION
-- =============================================================================

ALTER TABLE public.invitation ENABLE ROW LEVEL SECURITY;

-- Users can view invitations they sent or were invited to
CREATE POLICY "Users can view their invitations"
  ON public.invitation FOR SELECT
  TO authenticated
  USING (
    inviter_id = auth.uid()
    OR invited_user_id = auth.uid()
  );

-- Authenticated users can create invitations (must be the inviter)
CREATE POLICY "Users can create invitations"
  ON public.invitation FOR INSERT
  TO authenticated
  WITH CHECK (inviter_id = auth.uid());

-- Inviter can update their invitations (e.g. revoke)
CREATE POLICY "Inviter can update invitations"
  ON public.invitation FOR UPDATE
  TO authenticated
  USING (inviter_id = auth.uid());

-- Inviter or admin can delete invitations
CREATE POLICY "Inviter or admin can delete invitations"
  ON public.invitation FOR DELETE
  TO authenticated
  USING (
    inviter_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

-- =============================================================================
-- 16. PEER_RATING_REQUEST
-- =============================================================================

ALTER TABLE public.peer_rating_request ENABLE ROW LEVEL SECURITY;

-- Requester or evaluator can view the request
CREATE POLICY "Requester or evaluator can view rating requests"
  ON public.peer_rating_request FOR SELECT
  TO authenticated
  USING (
    requester_id = auth.uid()
    OR evaluator_id = auth.uid()
  );

-- Authenticated users can create rating requests (must be the requester)
CREATE POLICY "Users can create rating requests"
  ON public.peer_rating_request FOR INSERT
  TO authenticated
  WITH CHECK (requester_id = auth.uid());

-- Evaluator can update the request (to respond), requester can update (to cancel)
CREATE POLICY "Requester or evaluator can update rating requests"
  ON public.peer_rating_request FOR UPDATE
  TO authenticated
  USING (
    requester_id = auth.uid()
    OR evaluator_id = auth.uid()
  );

-- Requester can delete their own request
CREATE POLICY "Requester can delete rating requests"
  ON public.peer_rating_request FOR DELETE
  TO authenticated
  USING (requester_id = auth.uid());

-- =============================================================================
-- 17. RATING_PROOF
-- =============================================================================

ALTER TABLE public.rating_proof ENABLE ROW LEVEL SECURITY;

-- Owner of the rating score can view their proofs, admins can view all
CREATE POLICY "Rating owner or admin can view proofs"
  ON public.rating_proof FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.player_rating_score prs
      WHERE prs.id = player_rating_score_id
      AND prs.player_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

-- Owner of the rating score can create proofs
CREATE POLICY "Rating owner can create proofs"
  ON public.rating_proof FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.player_rating_score prs
      WHERE prs.id = player_rating_score_id
      AND prs.player_id = auth.uid()
    )
  );

-- Owner can update their proofs, admins can update (for review)
CREATE POLICY "Rating owner or admin can update proofs"
  ON public.rating_proof FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.player_rating_score prs
      WHERE prs.id = player_rating_score_id
      AND prs.player_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

-- Owner or admin can delete proofs
CREATE POLICY "Rating owner or admin can delete proofs"
  ON public.rating_proof FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.player_rating_score prs
      WHERE prs.id = player_rating_score_id
      AND prs.player_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

-- =============================================================================
-- 18. PLAY_STYLE (reference data)
-- =============================================================================

ALTER TABLE public.play_style ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view play styles
CREATE POLICY "Authenticated users can view play styles"
  ON public.play_style FOR SELECT
  TO authenticated
  USING (true);

-- Only admins can insert play styles
CREATE POLICY "Admins can insert play styles"
  ON public.play_style FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

-- Only admins can update play styles
CREATE POLICY "Admins can update play styles"
  ON public.play_style FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

-- Only admins can delete play styles
CREATE POLICY "Admins can delete play styles"
  ON public.play_style FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

-- =============================================================================
-- 19. PLAY_ATTRIBUTE (reference data)
-- =============================================================================

ALTER TABLE public.play_attribute ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view play attributes
CREATE POLICY "Authenticated users can view play attributes"
  ON public.play_attribute FOR SELECT
  TO authenticated
  USING (true);

-- Only admins can insert play attributes
CREATE POLICY "Admins can insert play attributes"
  ON public.play_attribute FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

-- Only admins can update play attributes
CREATE POLICY "Admins can update play attributes"
  ON public.play_attribute FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

-- Only admins can delete play attributes
CREATE POLICY "Admins can delete play attributes"
  ON public.play_attribute FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

-- =============================================================================
-- 20. DELIVERY_ATTEMPT (system/internal table)
-- =============================================================================

ALTER TABLE public.delivery_attempt ENABLE ROW LEVEL SECURITY;

-- Users can view delivery attempts for their own notifications
CREATE POLICY "Users can view own delivery attempts"
  ON public.delivery_attempt FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.notification n
      WHERE n.id = notification_id
      AND n.user_id = auth.uid()
    )
  );

-- Only service role / triggers create delivery attempts (no user INSERT policy)
-- Admins can view all delivery attempts
CREATE POLICY "Admins can view all delivery attempts"
  ON public.delivery_attempt FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );
