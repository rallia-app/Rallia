-- Create the feedback-screenshots storage bucket
-- This bucket stores screenshots attached to bug reports

-- Insert the bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'feedback-screenshots',
  'feedback-screenshots',
  true,  -- Public bucket so images can be viewed in emails
  5242880,  -- 5MB max file size
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage policies for feedback-screenshots bucket

-- Allow authenticated users to upload screenshots
DO $$ BEGIN
  CREATE POLICY "Users can upload feedback screenshots"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'feedback-screenshots'
  );
EXCEPTION WHEN insufficient_privilege OR duplicate_object THEN NULL;
END $$;

-- Allow public read access (needed for email display)
DO $$ BEGIN
  CREATE POLICY "Feedback screenshots are publicly accessible"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'feedback-screenshots');
EXCEPTION WHEN insufficient_privilege OR duplicate_object THEN NULL;
END $$;

-- Allow users to update their own uploaded screenshots
DO $$ BEGIN
  CREATE POLICY "Users can update their own feedback screenshots"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'feedback-screenshots' 
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'feedback-screenshots'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
EXCEPTION WHEN insufficient_privilege OR duplicate_object THEN NULL;
END $$;

-- Allow users to delete their own uploaded screenshots
DO $$ BEGIN
  CREATE POLICY "Users can delete their own feedback screenshots"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'feedback-screenshots'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
EXCEPTION WHEN insufficient_privilege OR duplicate_object THEN NULL;
END $$;
