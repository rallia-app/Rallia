-- =============================================================================
-- Migration: Add tournament-logos storage bucket
-- Description: Public bucket for tournament poster / logo images, mirroring the
--              group-images bucket (20260116000002).
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tournament-logos',
  'tournament-logos',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- ----- RLS policies -----

DROP POLICY IF EXISTS "Authenticated users can upload tournament logos" ON storage.objects;
CREATE POLICY "Authenticated users can upload tournament logos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'tournament-logos');

DROP POLICY IF EXISTS "Anyone can view tournament logos" ON storage.objects;
CREATE POLICY "Anyone can view tournament logos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'tournament-logos');

DROP POLICY IF EXISTS "Authenticated users can update tournament logos" ON storage.objects;
CREATE POLICY "Authenticated users can update tournament logos"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'tournament-logos')
WITH CHECK (bucket_id = 'tournament-logos');

DROP POLICY IF EXISTS "Authenticated users can delete tournament logos" ON storage.objects;
CREATE POLICY "Authenticated users can delete tournament logos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'tournament-logos');
