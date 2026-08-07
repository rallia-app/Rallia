-- ============================================================================
-- Turn off the last-minute open-spots push (momentum item 6)
--
-- Product decision 2026-08-07: the notification is not going out for now. Its
-- reachable audience was very small once both gates applied, since a recipient
-- has to be inside a 5 km cap AND hold the exact same rating as the game's
-- gate rating, and it also shares the 3-per-7-days discovery budget with the
-- existing nearby-game pushes, so it competed with them for the same slots.
--
-- Nothing is deleted. The cron, the function and the enum value stay in place,
-- and the type-level gate trigger on `notification` suppresses every write
-- while `enabled` is false. Flipping this row back to true is the whole
-- re-enable, no deploy required. That is what the gate was built for.
--
-- The original row was seeded by 20260805180000 with ON CONFLICT DO NOTHING,
-- so this has to be an UPDATE rather than a re-INSERT.
-- ============================================================================

UPDATE public.admin_settings
   SET value = jsonb_set(value, '{enabled}', 'false'::jsonb),
       description = 'Momentum item 6: last-minute open-spots push. '
                     || 'DISABLED 2026-08-07 by product decision (audience too '
                     || 'narrow, competed with nearby pushes for the shared '
                     || 'discovery budget). Set enabled back to true to resume.',
       updated_at = now()
 WHERE key = 'momentum_match_last_minute_spots';
