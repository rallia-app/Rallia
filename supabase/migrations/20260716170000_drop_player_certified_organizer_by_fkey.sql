-- Hotfix: restore a single player -> profile relationship for PostgREST.
--
-- 20260715120000 added player.certified_organizer_by -> profile(id), giving the
-- player table a SECOND foreign key into profile (alongside player_id_fkey).
-- That makes every unhinted `player ( profile ( ... ) )` embed ambiguous, so
-- PostgREST returns PGRST201 instead of rows and crashes chat, groups,
-- communities, programs, and feedback on any JS bundle that predates the
-- profile!player_id_fkey disambiguation (commit b000abd0). The OTA carrying that
-- fix rolls out gradually, so users on the old bundle stay broken until then.
--
-- Drop the FK (keep the column) so player -> profile has a single path again and
-- old bundles resolve embeds. The new bundle's profile!player_id_fkey hints keep
-- working — player_id_fkey is untouched. certified_organizer_by stays a plain
-- uuid audit field; admin_certify_organizer only writes it, nothing embeds on it.

DO $$
DECLARE
  v_constraint text;
BEGIN
  SELECT c.conname
    INTO v_constraint
  FROM pg_constraint c
  WHERE c.conrelid = 'public.player'::regclass
    AND c.contype = 'f'
    AND c.confrelid = 'public.profile'::regclass
    AND c.conkey = ARRAY[(
      SELECT a.attnum
      FROM pg_attribute a
      WHERE a.attrelid = 'public.player'::regclass
        AND a.attname = 'certified_organizer_by'
    )];

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.player DROP CONSTRAINT %I', v_constraint);
  END IF;
END $$;

-- Nudge PostgREST to reload its schema cache immediately (Supabase also does this
-- on DDL, but be explicit for the incident).
NOTIFY pgrst, 'reload schema';
