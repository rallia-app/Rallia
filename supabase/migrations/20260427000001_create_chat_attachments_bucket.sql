-- Migration: Create chat-attachments storage bucket
-- Private bucket for in-chat images, videos, and documents.
-- Path scheme: {conversation_id}/{message_id_or_temp}/{filename}
-- The first folder segment is the conversation UUID; RLS policies enforce
-- that only conversation participants can upload/read/delete.

-- =============================================================================
-- 1. Create bucket
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-attachments',
  'chat-attachments',
  false,                  -- Private; access via signed URLs
  262144000,              -- 250 MB hard cap (per-type caps enforced client-side)
  ARRAY[
    -- Images
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
    'image/heic', 'image/heif',
    -- Videos
    'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/3gpp',
    -- Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv', 'application/rtf'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- =============================================================================
-- 2. RLS policies
-- =============================================================================

DROP POLICY IF EXISTS "Participants can upload chat attachments" ON storage.objects;
DROP POLICY IF EXISTS "Participants can view chat attachments" ON storage.objects;
DROP POLICY IF EXISTS "Participants can update chat attachments" ON storage.objects;
DROP POLICY IF EXISTS "Uploaders can delete chat attachments" ON storage.objects;

-- INSERT: caller is a participant of the conversation in the path's first folder
CREATE POLICY "Participants can upload chat attachments"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'chat-attachments'
  AND (storage.foldername(name))[1]::uuid IN (
    SELECT get_user_conversation_ids(auth.uid())
  )
);

-- SELECT: same membership check (object is fetched via signed URL but the
-- signing call still needs SELECT permission)
CREATE POLICY "Participants can view chat attachments"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND (storage.foldername(name))[1]::uuid IN (
    SELECT get_user_conversation_ids(auth.uid())
  )
);

-- UPDATE: same membership check (allows resumable upload finalisation)
CREATE POLICY "Participants can update chat attachments"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND (storage.foldername(name))[1]::uuid IN (
    SELECT get_user_conversation_ids(auth.uid())
  )
)
WITH CHECK (
  bucket_id = 'chat-attachments'
  AND (storage.foldername(name))[1]::uuid IN (
    SELECT get_user_conversation_ids(auth.uid())
  )
);

-- DELETE: only the original uploader can delete
CREATE POLICY "Uploaders can delete chat attachments"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND owner = auth.uid()
);

-- =============================================================================
-- VERIFICATION
-- =============================================================================
DO $$
DECLARE
  bucket_exists boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'chat-attachments')
    INTO bucket_exists;
  IF NOT bucket_exists THEN
    RAISE WARNING 'chat-attachments bucket was not created';
  ELSE
    RAISE NOTICE 'chat-attachments bucket is ready';
  END IF;
END $$;
