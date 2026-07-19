-- ============================================================================
-- Série 1 — registration opens July 20
-- ============================================================================
-- Advertised open date brought forward one day (seed/adjust had July 21).
-- registration_opens_at is informational — status gates registration, not this
-- timestamp — so this only changes what the card shows. Correction over the
-- consumed seed; no-ops where the seed found no organizer.
-- ============================================================================

UPDATE public.tournaments
   SET registration_opens_at = '2026-07-20 12:00:00+00',
       updated_at            = now()
 WHERE name LIKE 'Tournois Rallia — Série 1 ·%';
