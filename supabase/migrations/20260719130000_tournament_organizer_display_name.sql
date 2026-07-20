-- ============================================================================
-- Tournaments — organizer display name (brand override)
-- ============================================================================
-- The detail hero renders "Organized by {name}" from the organizer's profile,
-- so a Rallia-run event advertises whichever team member happens to own the
-- row. Official events should carry the brand, not a person — and that has to
-- survive a change of primary organizer or the addition of co-organizers.
--
-- organizer_display_name is an optional override: when set, the UI shows it
-- instead of the organizer's personal name. NULL (the default, and every
-- existing row) keeps today's behaviour for player-run tournaments.
--
-- Deliberately a plain text column, not a link to an organizations table:
-- there is no organization concept wired to tournaments, and inventing one for
-- a display string would be a much larger change than the problem warrants.
-- ============================================================================

ALTER TABLE public.tournaments
    ADD COLUMN IF NOT EXISTS organizer_display_name text
        CHECK (organizer_display_name IS NULL
               OR char_length(organizer_display_name) BETWEEN 1 AND 60);

COMMENT ON COLUMN public.tournaments.organizer_display_name IS
  'Optional brand shown in place of the organizer''s personal name (e.g. '
  '"Rallia" for official events). NULL falls back to the organizer profile.';


-- The Série 1 draws are official Rallia events.
UPDATE public.tournaments
   SET organizer_display_name = 'Rallia',
       updated_at             = now()
 WHERE name LIKE 'Tournois Rallia — Série 1 ·%';
