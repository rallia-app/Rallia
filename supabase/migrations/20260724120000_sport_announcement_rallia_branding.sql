-- =============================================================================
-- Brand the sport announcement channels as "Rallia" with the app icon
--
-- The channels were seeded per-sport titled "Tennis" / "Pickleball" with no
-- picture (20260720140000). Product wants them to read as a single Rallia voice:
-- title "Rallia" and the app icon as the conversation image.
--
-- The seed migration is already applied everywhere, so this is a follow-up
-- UPDATE. It runs after the seed on prod too, so prod ends in the same state.
--
-- The image is an environment-agnostic absolute URL (the app's apple-touch-icon
-- on the marketing site). A Supabase storage URL would be project-specific and
-- would break across local/staging/prod, so it is deliberately not used.
-- getStorageImageUrl passes non-supabase URLs through untouched.
-- =============================================================================

UPDATE public.conversation
SET
  title = 'Rallia',
  picture_url = 'https://www.rallia.app/apple-touch-icon.png',
  updated_at = now()
WHERE conversation_type = 'announcement'
  AND (title IS DISTINCT FROM 'Rallia'
       OR picture_url IS DISTINCT FROM 'https://www.rallia.app/apple-touch-icon.png');
