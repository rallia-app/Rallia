-- ============================================================================
-- Série 1 — point the regional draws at the designer v3 banner artwork
-- ----------------------------------------------------------------------------
-- The v3 set is hand-designed (italic wordmark, Rallia mark, court motifs) and
-- replaces the generated v2 set. One programmatic retouch was applied before
-- upload: the "SÉRIE 1 · TENNIS · SIMPLE · ÉTÉ 2026" line sat at y 87-113,
-- exactly under the status pill the app draws over the top of every card, which
-- chopped it mid-word — and the line only duplicated what the scrim under the
-- artwork already says. It was patched out of the pixels; everything else is
-- untouched.
--
-- The -v2 → -v3 filename bump is what defeats React Native's by-URL image
-- cache. The v3 objects must exist in the environment's tournament-logos
-- bucket before this runs (scripts/tournaments/upload-serie1-banners.mjs).
--
-- logo_url is not a field notify_tournament_lifecycle watches; no push fires.
-- ============================================================================

UPDATE public.tournaments
   SET logo_url   = replace(logo_url, '-v2.webp', '-v3.webp'),
       updated_at = now()
 WHERE name LIKE 'Série 1 %'
   AND logo_url LIKE '%-v2.webp';
