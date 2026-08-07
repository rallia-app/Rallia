-- ============================================================================
-- Turn off the play-rhythm gap nudge (momentum item 8)
--
-- Product decision 2026-08-07: the notification is not going out for now.
--
-- Nothing is deleted. The daily cron, the function and the enum value stay in
-- place, and the type-level gate trigger on `notification` suppresses every
-- write while `enabled` is false. Flipping this row back to true is the whole
-- re-enable, no deploy required.
--
-- The original row was seeded by 20260805180000 with ON CONFLICT DO NOTHING,
-- so this has to be an UPDATE rather than a re-INSERT.
-- ============================================================================

UPDATE public.admin_settings
   SET value = jsonb_set(value, '{enabled}', 'false'::jsonb),
       description = 'Momentum item 8: play-rhythm gap nudge. '
                     || 'DISABLED 2026-08-07 by product decision. '
                     || 'Set enabled back to true to resume.',
       updated_at = now()
 WHERE key = 'momentum_play_rhythm_nudge';
