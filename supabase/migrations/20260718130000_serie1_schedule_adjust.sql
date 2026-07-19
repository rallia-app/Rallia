-- ============================================================================
-- Série 1 — schedule adjustment
-- ============================================================================
-- Registration now closes July 25 and play starts July 26 (seed set them to
-- close 28 / start 29). End date follows the 15-day cycle for a full 32 draw
-- (5 rounds x 3 days): July 26 + 15 = August 10. Registration still opens
-- July 21.
--
-- The seed migration (20260717120000) is already applied on local/staging, so
-- editing it in place would never re-run. This correction runs as its own step
-- instead: where the seed rows exist it moves the dates; where the seed no-oped
-- (no organizer account, e.g. fresh local/CI) it matches nothing. On prod the
-- chain applies seed-then-adjust back to back.
-- ============================================================================

UPDATE public.tournaments
   SET registration_closes_at = '2026-07-25 12:00:00+00',
       start_date             = '2026-07-26 12:00:00+00',
       end_date               = '2026-08-10 12:00:00+00',
       updated_at             = now()
 WHERE name LIKE 'Tournois Rallia — Série 1 ·%';
