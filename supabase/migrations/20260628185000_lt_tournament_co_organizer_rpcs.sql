-- ============================================
-- Leagues & Tournaments — co-organizer management RPCs
-- ============================================
-- The data model + access plumbing for co-organizers already exists:
--   * tournament_co_organizers table
--   * is_tournament_organizer() returns true for co-organizers (full rights)
--   * sync_tournament_chat_co_organizer trigger adds/removes them from the
--     tournament chat on INSERT/DELETE (keeping registered participants)
--   * notify_tournament_registration_change already CCs co-organizers
--
-- Missing was a way to actually add/remove them. These three RPCs close that:
-- add/remove are restricted to the PRIMARY organizer (tournaments.organizer_id)
-- or an admin — co-organizers can act AS organizers everywhere else, but only
-- the owner manages the organizer roster. get is readable by any organizer.
-- ============================================

CREATE OR REPLACE FUNCTION public.tournament_add_co_organizer(
    p_tournament_id uuid,
    p_user_id       uuid
)
RETURNS SETOF tournament_co_organizers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_tournament tournaments;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id;
    IF v_tournament.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;
    IF v_tournament.organizer_id <> v_caller AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;
    IF p_user_id = v_tournament.organizer_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_PRIMARY_ORGANIZER';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM profile WHERE id = p_user_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PLAYER_NOT_FOUND';
    END IF;

    INSERT INTO tournament_co_organizers (tournament_id, user_id, added_by)
    VALUES (p_tournament_id, p_user_id, v_caller)
    ON CONFLICT (tournament_id, user_id) DO NOTHING;

    RETURN QUERY
        SELECT * FROM tournament_co_organizers
         WHERE tournament_id = p_tournament_id
         ORDER BY added_at ASC;
END;
$$;


CREATE OR REPLACE FUNCTION public.tournament_remove_co_organizer(
    p_tournament_id uuid,
    p_user_id       uuid
)
RETURNS SETOF tournament_co_organizers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_tournament tournaments;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id;
    IF v_tournament.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;
    IF v_tournament.organizer_id <> v_caller AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    DELETE FROM tournament_co_organizers
     WHERE tournament_id = p_tournament_id AND user_id = p_user_id;

    RETURN QUERY
        SELECT * FROM tournament_co_organizers
         WHERE tournament_id = p_tournament_id
         ORDER BY added_at ASC;
END;
$$;


CREATE OR REPLACE FUNCTION public.get_tournament_co_organizers(
    p_tournament_id uuid
)
RETURNS SETOF tournament_co_organizers
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;
    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    RETURN QUERY
        SELECT * FROM tournament_co_organizers
         WHERE tournament_id = p_tournament_id
         ORDER BY added_at ASC;
END;
$$;


GRANT EXECUTE ON FUNCTION public.tournament_add_co_organizer(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_remove_co_organizer(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tournament_co_organizers(uuid) TO authenticated;
