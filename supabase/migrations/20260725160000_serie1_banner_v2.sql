-- ============================================================================
-- Série 1 — point the regional draws at the v2 banner artwork
-- ----------------------------------------------------------------------------
-- The v1 banners shipped with 20260725150000 were redrawn: the artwork now uses
-- @rallia/design-system tokens rather than invented blues and purples, keeps the
-- category pill clear of the app's status badge, and gives each zone a motif
-- that actually differs (the v1 chevrons were symmetric about their own axis, so
-- Rive-Nord and Rive-Sud rendered identically).
--
-- Separate migration rather than an edit to 20260725150000: that one is already
-- applied on staging, and applied migrations are immutable.
--
-- The filename bump is what makes the change visible at all — React Native's
-- Image caches by URL, so overwriting the same object would leave stale art on
-- every device that had already loaded it.
--
-- logo_url is not one of the fields notify_tournament_lifecycle watches, so this
-- fires no push.
-- ============================================================================

UPDATE public.tournaments
   SET logo_url   = replace(logo_url, '-v1.webp', '-v2.webp'),
       updated_at = now()
 WHERE name LIKE 'Série 1 %'
   AND logo_url LIKE '%-v1.webp';
