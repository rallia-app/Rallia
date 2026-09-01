-- ============================================================================
-- Checking in to a game that has no address.
-- ============================================================================
-- The no-show rung reads match_participant.checked_in_at: one side present and
-- the other absent is the clearest evidence the ladder ever gets, and it costs
-- the absent side a walkover and -50 reputation.
--
-- It could not fire on a large class of tournament games. Check-in required
-- the player within 500 m of the court, and a booked game often has no court:
-- lt_funnel_book_mutual_option passes through whatever facility the chosen
-- slot carried, which is nothing when none was nearby, and the counter-offer
-- sheet makes the place explicitly optional. On those games nobody could check
-- in at all, so the rung degraded silently into "neither showed up" and fell to
-- the gap rule. Two players who agreed on a time but not a place lost the one
-- piece of evidence that distinguishes them.
--
-- So: when the game has coordinates, the geofence applies exactly as before.
-- When it has none, presence is self-declared and recorded as such
-- (check_in_verified = false), because a claim you have to make yourself is
-- still worth more than the silence of someone who made none.
--
-- The check also MOVES to the server. It was computed in the client and
-- written straight to the row, which RLS allows any player to do on their own
-- participation: the field the ladder trusts for a -50 could be set from
-- anywhere. The trigger below closes that, so widening when check-in is
-- possible does not widen what can be forged.
-- ============================================================================

ALTER TABLE match_participant
    ADD COLUMN IF NOT EXISTS check_in_verified boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN match_participant.check_in_verified IS
'True when the check-in was confirmed against the game''s coordinates. False
when the game had no address to check against and presence was self-declared.';

-- ------------------------------------------------------------- the check-in
CREATE OR REPLACE FUNCTION public.check_in_to_match(
    p_match_id uuid,
    p_latitude  double precision DEFAULT NULL,
    p_longitude double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller   uuid := auth.uid();
    v_part     match_participant;
    v_m        match;
    v_lat      double precision;
    v_lng      double precision;
    v_dist     double precision;
    v_verified boolean := false;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_part FROM match_participant
     WHERE match_id = p_match_id AND player_id = v_caller AND status = 'joined';
    IF v_part.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'not_participant');
    END IF;
    IF v_part.checked_in_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'already_checked_in');
    END IF;

    SELECT * INTO v_m FROM match WHERE id = p_match_id;

    IF v_m.location_type = 'facility' AND v_m.facility_id IS NOT NULL THEN
        SELECT f.latitude, f.longitude INTO v_lat, v_lng
          FROM facility f WHERE f.id = v_m.facility_id;
    ELSIF v_m.location_type = 'custom' THEN
        v_lat := v_m.custom_latitude;
        v_lng := v_m.custom_longitude;
    END IF;

    IF v_lat IS NOT NULL AND v_lng IS NOT NULL THEN
        -- There is somewhere to be, so be there.
        IF p_latitude IS NULL OR p_longitude IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'no_location');
        END IF;
        -- Haversine inline rather than PostGIS: the extension lives in the
        -- `extensions` schema and this function pins search_path to public,
        -- which is the right setting for a SECURITY DEFINER. A 500 m radius
        -- does not need a spatial type.
        v_dist := 6371000 * 2 * asin(sqrt(
                    power(sin(radians(p_latitude - v_lat) / 2), 2)
                  + cos(radians(v_lat)) * cos(radians(p_latitude))
                  * power(sin(radians(p_longitude - v_lng) / 2), 2)));
        IF v_dist > 500 THEN
            RETURN jsonb_build_object('success', false, 'error', 'too_far',
                                      'distanceMeters', round(v_dist)::int);
        END IF;
        v_verified := true;
    END IF;
    -- ...and when there is nowhere named, the claim stands on its own.

    PERFORM set_config('rallia.check_in', 'on', true);
    UPDATE match_participant
       SET checked_in_at = now(), check_in_verified = v_verified
     WHERE id = v_part.id;
    PERFORM set_config('rallia.check_in', '', true);

    RETURN jsonb_build_object('success', true, 'verified', v_verified,
                              'distanceMeters', CASE WHEN v_dist IS NULL
                                                     THEN NULL ELSE round(v_dist)::int END);
END;
$$;

COMMENT ON FUNCTION public.check_in_to_match(uuid, double precision, double precision) IS
'Records presence at a game. Enforces the 500 m radius when the game has
coordinates, and accepts a self-declared check-in when it has none, so the
no-show rung is not blind on games agreed without a place. Spec:
unplayed-match-resolution.md § 6, R3.';

REVOKE ALL ON FUNCTION public.check_in_to_match(uuid, double precision, double precision)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in_to_match(uuid, double precision, double precision)
    TO authenticated;

-- ------------------------------------------- and only through that function
CREATE OR REPLACE FUNCTION public.match_participant_check_in_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.checked_in_at IS DISTINCT FROM OLD.checked_in_at
       AND COALESCE(current_setting('rallia.check_in', true), '') <> 'on' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CHECK_IN_VIA_RPC_ONLY';
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.match_participant_check_in_guard() IS
'Presence is what the ladder trusts for a walkover and a -50, so it may only be
written by check_in_to_match. RLS lets a player update their own participation,
which until now included stamping their own arrival from anywhere.';

DROP TRIGGER IF EXISTS match_participant_check_in_guard ON match_participant;
CREATE TRIGGER match_participant_check_in_guard
    BEFORE UPDATE OF checked_in_at ON match_participant
    FOR EACH ROW EXECUTE FUNCTION public.match_participant_check_in_guard();
