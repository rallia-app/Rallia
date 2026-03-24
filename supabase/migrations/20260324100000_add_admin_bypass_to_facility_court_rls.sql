-- =============================================================================
-- Migration: Add admin bypass to facility & court RLS policies
-- Description: The facility, court, facility_sport, court_sport,
--              facility_contact, and facility_image RLS policies only allowed
--              org staff/admin. Site-wide admins (public.admin table) were
--              blocked. Add OR public.is_admin() to every write policy.
-- =============================================================================

-- ─── FACILITY ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Org staff can create facilities" ON public.facility;
CREATE POLICY "Org staff can create facilities"
  ON public.facility FOR INSERT
  TO authenticated
  WITH CHECK (
    is_org_staff(organization_id, auth.uid())
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Org staff can update facilities" ON public.facility;
CREATE POLICY "Org staff can update facilities"
  ON public.facility FOR UPDATE
  TO authenticated
  USING (
    is_org_staff(organization_id, auth.uid())
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Org admins can delete facilities" ON public.facility;
CREATE POLICY "Org admins can delete facilities"
  ON public.facility FOR DELETE
  TO authenticated
  USING (
    is_org_admin(organization_id, auth.uid())
    OR public.is_admin()
  );

-- ─── COURT ────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Org staff can create courts" ON public.court;
CREATE POLICY "Org staff can create courts"
  ON public.court FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.facility f
      WHERE f.id = facility_id
      AND is_org_staff(f.organization_id, auth.uid())
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Org staff can update courts" ON public.court;
CREATE POLICY "Org staff can update courts"
  ON public.court FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facility f
      WHERE f.id = facility_id
      AND is_org_staff(f.organization_id, auth.uid())
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Org admins can delete courts" ON public.court;
CREATE POLICY "Org admins can delete courts"
  ON public.court FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facility f
      WHERE f.id = facility_id
      AND is_org_admin(f.organization_id, auth.uid())
    )
    OR public.is_admin()
  );

-- ─── FACILITY_SPORT ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Org staff can create facility sports" ON public.facility_sport;
CREATE POLICY "Org staff can create facility sports"
  ON public.facility_sport FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.facility f
      WHERE f.id = facility_id
      AND is_org_staff(f.organization_id, auth.uid())
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Org staff can update facility sports" ON public.facility_sport;
CREATE POLICY "Org staff can update facility sports"
  ON public.facility_sport FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facility f
      WHERE f.id = facility_id
      AND is_org_staff(f.organization_id, auth.uid())
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Org admins can delete facility sports" ON public.facility_sport;
CREATE POLICY "Org admins can delete facility sports"
  ON public.facility_sport FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facility f
      WHERE f.id = facility_id
      AND is_org_admin(f.organization_id, auth.uid())
    )
    OR public.is_admin()
  );

-- ─── COURT_SPORT ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Org staff can create court sports" ON public.court_sport;
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
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Org staff can update court sports" ON public.court_sport;
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
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Org admins can delete court sports" ON public.court_sport;
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
    OR public.is_admin()
  );

-- ─── FACILITY_CONTACT ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Org staff can create facility contacts" ON public.facility_contact;
CREATE POLICY "Org staff can create facility contacts"
  ON public.facility_contact FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.facility f
      WHERE f.id = facility_id
      AND is_org_staff(f.organization_id, auth.uid())
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Org staff can update facility contacts" ON public.facility_contact;
CREATE POLICY "Org staff can update facility contacts"
  ON public.facility_contact FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facility f
      WHERE f.id = facility_id
      AND is_org_staff(f.organization_id, auth.uid())
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Org admins can delete facility contacts" ON public.facility_contact;
CREATE POLICY "Org admins can delete facility contacts"
  ON public.facility_contact FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facility f
      WHERE f.id = facility_id
      AND is_org_admin(f.organization_id, auth.uid())
    )
    OR public.is_admin()
  );

-- ─── FACILITY_IMAGE ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Org staff can create facility images" ON public.facility_image;
CREATE POLICY "Org staff can create facility images"
  ON public.facility_image FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.facility f
      WHERE f.id = facility_id
      AND is_org_staff(f.organization_id, auth.uid())
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Org staff can update facility images" ON public.facility_image;
CREATE POLICY "Org staff can update facility images"
  ON public.facility_image FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facility f
      WHERE f.id = facility_id
      AND is_org_staff(f.organization_id, auth.uid())
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Org admins can delete facility images" ON public.facility_image;
CREATE POLICY "Org admins can delete facility images"
  ON public.facility_image FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facility f
      WHERE f.id = facility_id
      AND is_org_admin(f.organization_id, auth.uid())
    )
    OR public.is_admin()
  );
