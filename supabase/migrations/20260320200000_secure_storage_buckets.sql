-- Migration: Secure Storage Buckets
-- Created: 2026-03-20
-- Description: Makes sensitive buckets private, tightens facility write policies
--
-- Changes:
-- 1. Make report-evidence and feedback-screenshots buckets private
-- 2. Make rating-proof-* buckets private
-- 3. Tighten facility-images write policies (org membership check)
-- 4. Tighten facility-files write policies (org membership check)

-- ============================================================================
-- 1A. Make report-evidence bucket PRIVATE
-- ============================================================================

UPDATE storage.buckets SET public = false WHERE id = 'report-evidence';

-- Replace the public SELECT policy with authenticated-only
DROP POLICY IF EXISTS "Report evidence is publicly accessible" ON storage.objects;

CREATE POLICY "Authenticated users can view report evidence"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'report-evidence');

-- ============================================================================
-- 1B. Make feedback-screenshots bucket PRIVATE
-- ============================================================================

UPDATE storage.buckets SET public = false WHERE id = 'feedback-screenshots';

-- Replace the public SELECT policy with authenticated-only
DROP POLICY IF EXISTS "Feedback screenshots are publicly accessible" ON storage.objects;

CREATE POLICY "Authenticated users can view feedback screenshots"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'feedback-screenshots');

-- ============================================================================
-- 2. Make rating-proof-* buckets PRIVATE
-- ============================================================================

UPDATE storage.buckets SET public = false
WHERE id IN ('rating-proof-images', 'rating-proof-documents', 'rating-proof-videos');

-- Replace public SELECT policies with authenticated-only
DROP POLICY IF EXISTS "Anyone can view proof images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view proof documents" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view proof videos" ON storage.objects;

CREATE POLICY "Authenticated users can view proof images"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'rating-proof-images');

CREATE POLICY "Authenticated users can view proof documents"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'rating-proof-documents');

CREATE POLICY "Authenticated users can view proof videos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'rating-proof-videos');

-- ============================================================================
-- 3. Tighten facility-images WRITE policies (org membership check)
-- Storage path is: {facilityId}/{timestamp}-{randomId}.{ext}
-- ============================================================================

-- Drop overly broad write policies
DROP POLICY IF EXISTS "Authenticated users can upload facility images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update facility images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete facility images" ON storage.objects;

-- Recreate with org membership check
CREATE POLICY "Org members can upload facility images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'facility-images' AND
  EXISTS (
    SELECT 1 FROM facility f
    JOIN organization_member om ON om.organization_id = f.organization_id
    WHERE f.id = (storage.foldername(name))[1]::uuid
      AND om.user_id = auth.uid()
      AND om.left_at IS NULL
  )
);

CREATE POLICY "Org members can update facility images"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'facility-images' AND
  EXISTS (
    SELECT 1 FROM facility f
    JOIN organization_member om ON om.organization_id = f.organization_id
    WHERE f.id = (storage.foldername(name))[1]::uuid
      AND om.user_id = auth.uid()
      AND om.left_at IS NULL
  )
)
WITH CHECK (
  bucket_id = 'facility-images' AND
  EXISTS (
    SELECT 1 FROM facility f
    JOIN organization_member om ON om.organization_id = f.organization_id
    WHERE f.id = (storage.foldername(name))[1]::uuid
      AND om.user_id = auth.uid()
      AND om.left_at IS NULL
  )
);

CREATE POLICY "Org members can delete facility images"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'facility-images' AND
  EXISTS (
    SELECT 1 FROM facility f
    JOIN organization_member om ON om.organization_id = f.organization_id
    WHERE f.id = (storage.foldername(name))[1]::uuid
      AND om.user_id = auth.uid()
      AND om.left_at IS NULL
  )
);

-- ============================================================================
-- 4. Tighten facility-files WRITE policies (org membership check)
-- Storage path is: {facilityId}/{filename} (same structure as facility-images)
-- ============================================================================

-- Drop overly broad write policies
DROP POLICY IF EXISTS "Authenticated users can upload facility files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update facility files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete facility files" ON storage.objects;

-- Recreate with org membership check
CREATE POLICY "Org members can upload facility files storage"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'facility-files' AND
  EXISTS (
    SELECT 1 FROM facility f
    JOIN organization_member om ON om.organization_id = f.organization_id
    WHERE f.id = (storage.foldername(name))[1]::uuid
      AND om.user_id = auth.uid()
      AND om.left_at IS NULL
  )
);

CREATE POLICY "Org members can update facility files storage"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'facility-files' AND
  EXISTS (
    SELECT 1 FROM facility f
    JOIN organization_member om ON om.organization_id = f.organization_id
    WHERE f.id = (storage.foldername(name))[1]::uuid
      AND om.user_id = auth.uid()
      AND om.left_at IS NULL
  )
)
WITH CHECK (
  bucket_id = 'facility-files' AND
  EXISTS (
    SELECT 1 FROM facility f
    JOIN organization_member om ON om.organization_id = f.organization_id
    WHERE f.id = (storage.foldername(name))[1]::uuid
      AND om.user_id = auth.uid()
      AND om.left_at IS NULL
  )
);

CREATE POLICY "Org members can delete facility files storage"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'facility-files' AND
  EXISTS (
    SELECT 1 FROM facility f
    JOIN organization_member om ON om.organization_id = f.organization_id
    WHERE f.id = (storage.foldername(name))[1]::uuid
      AND om.user_id = auth.uid()
      AND om.left_at IS NULL
  )
);

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
  private_count integer;
BEGIN
  SELECT COUNT(*) INTO private_count
  FROM storage.buckets
  WHERE id IN (
    'report-evidence', 'feedback-screenshots',
    'rating-proof-images', 'rating-proof-documents', 'rating-proof-videos'
  ) AND public = false;

  IF private_count = 5 THEN
    RAISE NOTICE 'All 5 sensitive buckets are now private';
  ELSE
    RAISE WARNING 'Expected 5 private buckets, found %', private_count;
  END IF;
END $$;
