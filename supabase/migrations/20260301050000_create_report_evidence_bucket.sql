-- Migration: Create Report Evidence Storage Bucket
-- Created: 2026-03-01  
-- Description: Creates storage bucket and RLS policies for report evidence images
-- This migration is idempotent and can be run multiple times safely

-- ============================================================================
-- 1. CREATE STORAGE BUCKET
-- ============================================================================

-- Create report-evidence bucket (public for admin read access)
-- Note: Supabase manages the storage.buckets table, so we use INSERT with ON CONFLICT
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'report-evidence',
  'report-evidence',
  true, -- Public read access (admins need to view without additional auth)
  10485760, -- 10MB limit (10 * 1024 * 1024) - larger for screenshots
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================================
-- 2. CREATE RLS POLICIES FOR report-evidence BUCKET
-- ============================================================================

-- Drop existing policies if they exist (to allow re-running migration)
DROP POLICY IF EXISTS "Users can upload report evidence" ON storage.objects;
DROP POLICY IF EXISTS "Report evidence is publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own report evidence" ON storage.objects;

-- Allow authenticated users to upload report evidence
-- Files must be in a folder named with their user ID: {user_id}/filename.jpg
CREATE POLICY "Users can upload report evidence"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'report-evidence' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow public read access to report evidence (for admin review)
CREATE POLICY "Report evidence is publicly accessible"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'report-evidence');

-- Allow users to delete their own report evidence (cleanup after submission)
CREATE POLICY "Users can delete own report evidence"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'report-evidence' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- ============================================================================
-- 3. VERIFICATION QUERY (for debugging)
-- ============================================================================

-- Run this to verify bucket was created:
-- SELECT * FROM storage.buckets WHERE id = 'report-evidence';
