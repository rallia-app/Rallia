-- ============================================================================
-- Série 1 — restore the original schedule
-- ----------------------------------------------------------------------------
-- 20260725150000 pushed registration to 2026-07-31 23:59 and play to Aug 1-14,
-- to give the six new regional draws a week to fill. That extension is being
-- reverted: registration closes tonight and play runs on the dates the players
-- originally signed up for.
--
--   registration closes  2026-07-27 23:59 EDT  (2026-07-28 03:59Z)
--   play                 2026-07-28 -> 2026-08-10
--
-- These are byte-for-byte the values the three draws carried before the split,
-- so from a player's point of view no date ever changed. Nothing had been
-- communicated about the extension, so there is nothing to walk back.
--
-- The dates are edited while the rows sit in 'draft', for the same reason the
-- split did it: notify_tournament_lifecycle pushes a generic "dates or venue
-- changed" notice on any live tournament whose start_date or end_date moves,
-- and that would land before the real announcement. 'draft' matches none of its
-- branches. Only the draws that were actually open are put back to open, so a
-- draw deliberately parked in draft stays there.
--
-- Once registration_closes_at is in the past, lt-close-tournament-registration
-- (every 15 min) closes them on its own. No manual step tonight.
-- ============================================================================

DO $$
DECLARE
    v_closes timestamptz := '2026-07-28 03:59:00+00';
    v_start  timestamptz := '2026-07-28 04:00:00+00';
    v_end    timestamptz := '2026-08-10 12:00:00+00';
    v_n      int;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.tournaments WHERE name LIKE 'Série 1 %') THEN
        RAISE NOTICE 'Série 1 regional draws absent here; nothing to reschedule.';
        RETURN;
    END IF;

    CREATE TEMP TABLE _reopen ON COMMIT DROP AS
    SELECT id FROM public.tournaments
     WHERE name LIKE 'Série 1 %' AND status = 'registration_open';

    UPDATE public.tournaments SET status = 'draft' WHERE id IN (SELECT id FROM _reopen);

    UPDATE public.tournaments
       SET registration_closes_at = v_closes,
           start_date             = v_start,
           end_date               = v_end,
           updated_at             = now()
     WHERE name LIKE 'Série 1 %';
    GET DIAGNOSTICS v_n = ROW_COUNT;

    UPDATE public.tournaments
       SET status = 'registration_open'
     WHERE id IN (SELECT id FROM _reopen);

    RAISE NOTICE 'Série 1 schedule restored on % draws.', v_n;
END $$;
