-- ============================================================================
-- Leagues & Tournaments — tournaments enforce a rating BAND, not just a floor
-- ============================================================================
-- tournaments.max_rating has existed since the original schema
-- (20260510165900) and is displayed on the card + detail as a range, but it was
-- never settable and never enforced: tournament_create had no p_max_rating, and
-- every registration path only ever compared against min_rating. A draw meant
-- for 3.0–3.5 therefore admitted a 4.5, and the ceiling was decoration.
--
-- This makes the ceiling real:
--   * tournament_create takes p_max_rating and validates min <= max.
--   * max_rating locks at 'draft' like min_rating (it was editable through
--     'registration_open'). A ceiling that can be lowered after entries would
--     strand a player who joined legitimately.
--   * All FOUR entry paths enforce the band: tournament_register,
--     tournament_begin_paid_registration, tournament_accept_invite (which had
--     no rating gate at all — an organizer invite bypassed even the floor) and
--     the invite-accept branch inside tournament_register.
--
-- The gate itself moves into one helper, lt_assert_rating_band. Duplicating it
-- per RPC is what let the paid path drift for a month (fixed in 20260721130200)
-- and what left accept_invite ungated; there is now a single body to change.
--
-- Semantics carried over from the min_rating hard gate (20260716210000):
--   * unrated is REJECTED (RATING_REQUIRED) whenever either bound is set — an
--     unverifiable entrant breaks the band the same way an out-of-band one does
--   * both members of a doubles entry are checked, PARTNER_-prefixed errors
--   * organizers are NOT exempt; admins bypass as a support override
--
-- New error codes: RATING_TOO_HIGH / PARTNER_RATING_TOO_HIGH.
--
-- All bodies below are their latest definitions verbatim (create/update from
-- 20260716210000 + 20260708120000, register from 20260716210000, paid from
-- 20260721130200, accept_invite from 20260629150000) with only the changes
-- described above.
-- ============================================================================


-- ---------------------------------------------------------------- helper
-- Raises if the player is out of band. Both bounds NULL → no-op, so callers
-- can call it unconditionally. p_partner prefixes the error so the client can
-- tell "you" from "your partner".
CREATE OR REPLACE FUNCTION public.lt_assert_rating_band(
    p_user_id  uuid,
    p_sport_id uuid,
    p_min      numeric,
    p_max      numeric,
    p_partner  boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
    v_prefix text := CASE WHEN p_partner THEN 'PARTNER_' ELSE '' END;
    v_rating double precision;
BEGIN
    IF p_min IS NULL AND p_max IS NULL THEN
        RETURN;
    END IF;

    -- active_rating_score_id is the canonical rating path.
    SELECT rs.value INTO v_rating
      FROM player_sport ps
      JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
      JOIN rating_score rs ON rs.id = prs.rating_score_id
     WHERE ps.player_id = p_user_id
       AND ps.sport_id  = p_sport_id;

    IF v_rating IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = v_prefix || 'RATING_REQUIRED';
    END IF;
    IF p_min IS NOT NULL AND v_rating < p_min THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = v_prefix || 'RATING_TOO_LOW';
    END IF;
    IF p_max IS NOT NULL AND v_rating > p_max THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = v_prefix || 'RATING_TOO_HIGH';
    END IF;
END;
$$;

-- Only the SECURITY DEFINER RPCs below need it; it's not a client entry point.
REVOKE EXECUTE ON FUNCTION public.lt_assert_rating_band(uuid, uuid, numeric, numeric, boolean) FROM PUBLIC;


-- ---------------------------------------------------------------- create
-- Same body as 20260708120000 plus p_max_rating (appended, so existing
-- named-arg callers are unaffected) and a min <= max check. Adding a param
-- changes the signature → drop the 23-arg overload first, re-grant after.
DROP FUNCTION IF EXISTS public.tournament_create(
    text, uuid, smallint, timestamptz, timestamptz,
    text, tournament_visibility, tournament_registration_mode,
    bracket_type, match_format, entry_format,
    uuid, text, uuid, timestamptz, timestamptz, text, text, numeric, jsonb,
    text, text, integer
);

CREATE OR REPLACE FUNCTION public.tournament_create(
    p_name              text,
    p_sport_id          uuid,
    p_max_participants  smallint,
    p_start_date        timestamptz,
    p_end_date          timestamptz,
    p_description       text                          DEFAULT NULL,
    p_visibility        tournament_visibility         DEFAULT 'private',
    p_registration_mode tournament_registration_mode  DEFAULT 'open',
    p_bracket_type      bracket_type                  DEFAULT 'single_elimination',
    p_match_format      match_format                  DEFAULT NULL,
    p_entry_format      entry_format                  DEFAULT 'singles',
    p_facility_id       uuid                          DEFAULT NULL,
    p_venue_name        text                          DEFAULT NULL,
    p_network_id        uuid                          DEFAULT NULL,
    p_registration_opens_at  timestamptz              DEFAULT NULL,
    p_registration_closes_at timestamptz              DEFAULT NULL,
    p_rules             text                          DEFAULT NULL,
    p_logo_url          text                          DEFAULT NULL,
    p_min_rating        numeric                       DEFAULT NULL,
    p_fee               jsonb                         DEFAULT NULL,
    p_venue_address     text                          DEFAULT NULL,
    p_city              text                          DEFAULT NULL,
    p_prize_money_cents integer                       DEFAULT NULL,
    p_max_rating        numeric                       DEFAULT NULL
)
RETURNS tournaments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id     uuid := auth.uid();
    v_sport_name    text;
    v_match_format  match_format;
    v_recent_count  integer;
    v_closes_at     timestamptz;
    v_row           tournaments;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    PERFORM public.assert_caller_plays_sport(p_sport_id);

    -- Explicit, before the table CHECK fires: check_violation below is mapped
    -- to INVALID_FEE_SETTINGS, which would be a lie here.
    IF p_min_rating IS NOT NULL AND p_max_rating IS NOT NULL
       AND p_max_rating < p_min_rating THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RATING_RANGE';
    END IF;

    IF p_network_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1
              FROM network n
              JOIN network_type nt ON nt.id = n.network_type_id
             WHERE n.id = p_network_id
               AND nt.name = 'community'
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NETWORK_NOT_COMMUNITY';
        END IF;
    END IF;

    IF NOT public.is_admin() THEN
        SELECT count(*) INTO v_recent_count
          FROM tournaments
         WHERE organizer_id = v_caller_id
           AND created_at  > now() - interval '24 hours';

        IF v_recent_count >= 5 THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RATE_LIMITED';
        END IF;
    END IF;

    IF p_match_format IS NULL THEN
        SELECT name INTO v_sport_name FROM sport WHERE id = p_sport_id;
        v_match_format := CASE v_sport_name
            WHEN 'pickleball' THEN 'pickleball_to_11'::match_format
            ELSE 'two_of_three'::match_format
        END;
    ELSE
        v_match_format := p_match_format;
    END IF;

    v_closes_at := COALESCE(
        p_registration_closes_at,
        GREATEST(p_start_date - interval '24 hours', now())
    );

    INSERT INTO tournaments (
        name, sport_id, max_participants, start_date, end_date,
        description, rules, logo_url, min_rating, max_rating, visibility, registration_mode,
        bracket_type, match_format, entry_format,
        facility_id, venue_name, venue_address, city, network_id,
        registration_opens_at, registration_closes_at,
        organizer_id, prize_money_cents,
        entry_fee_cents, currency, fee_payer, payout_timing,
        refund_policy_kind, refund_partial_bps, refund_cutoff_at
    )
    VALUES (
        p_name, p_sport_id, p_max_participants, p_start_date, p_end_date,
        p_description, p_rules, p_logo_url, p_min_rating, p_max_rating, p_visibility, p_registration_mode,
        p_bracket_type, v_match_format, p_entry_format,
        p_facility_id, p_venue_name, p_venue_address, p_city, p_network_id,
        p_registration_opens_at, v_closes_at,
        v_caller_id, p_prize_money_cents,
        COALESCE((p_fee->>'entry_fee_cents')::integer, 0),
        COALESCE(p_fee->>'currency', 'CAD'),
        COALESCE((p_fee->>'fee_payer')::fee_payer_enum, 'player_pays'),
        COALESCE((p_fee->>'payout_timing')::payout_timing_enum, 'hold_until_event_end'),
        COALESCE((p_fee->>'refund_policy_kind')::refund_policy_kind_enum, 'none'),
        (p_fee->>'refund_partial_bps')::integer,
        NULLIF(p_fee->>'refund_cutoff_at', '')::timestamptz
    )
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament', v_row.id, 'create', v_caller_id,
        jsonb_build_object(
            'name', v_row.name,
            'sport_id', v_row.sport_id,
            'max_participants', v_row.max_participants,
            'start_date', v_row.start_date,
            'end_date', v_row.end_date,
            'visibility', v_row.visibility,
            'registration_mode', v_row.registration_mode,
            'entry_fee_cents', v_row.entry_fee_cents,
            'fee_payer', v_row.fee_payer
        )
    );

    RETURN v_row;
EXCEPTION
    WHEN invalid_text_representation THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_FEE_SETTINGS';
    WHEN check_violation THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_FEE_SETTINGS';
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_create(
    text, uuid, smallint, timestamptz, timestamptz,
    text, tournament_visibility, tournament_registration_mode,
    bracket_type, match_format, entry_format,
    uuid, text, uuid, timestamptz, timestamptz, text, text, numeric, jsonb,
    text, text, integer, numeric
) TO authenticated;


-- ---------------------------------------------------------------- update
-- Same body as 20260716210000 with two changes: max_rating joins min_rating in
-- the draft-only lock, and the resulting band is validated.
CREATE OR REPLACE FUNCTION public.tournament_update(
    p_tournament_id uuid,
    p_version_was   integer,
    p_patch         jsonb
)
RETURNS tournaments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id   uuid := auth.uid();
    v_before      tournaments;
    v_row         tournaments;
    v_key         text;
    v_allowed     text[];
    v_sport_name  text;
    v_new_start   timestamptz;
    v_new_end     timestamptz;
    v_new_format  match_format;
    v_new_min     numeric;
    v_new_max     numeric;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'EMPTY_PATCH';
    END IF;

    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    SELECT * INTO v_before FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
    IF v_before.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;

    IF v_before.version <> p_version_was THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;

    IF v_before.status IN ('cancelled', 'archived') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_TERMINAL';
    END IF;

    FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
        v_allowed := CASE v_key
            WHEN 'name'        THEN ARRAY['draft','registration_open','registration_closed','in_progress','completed']
            WHEN 'description' THEN ARRAY['draft','registration_open','registration_closed','in_progress','completed']
            WHEN 'rules'       THEN ARRAY['draft','registration_open','registration_closed','in_progress','completed']
            WHEN 'logo_url'    THEN ARRAY['draft','registration_open','registration_closed','in_progress','completed']
            WHEN 'visibility'  THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'surface'     THEN ARRAY['draft','registration_open','registration_closed']
            WHEN 'level'       THEN ARRAY['draft','registration_open','registration_closed']
            WHEN 'categories'  THEN ARRAY['draft','registration_open','registration_closed']
            WHEN 'registration_mode'      THEN ARRAY['draft','registration_open']
            WHEN 'registration_opens_at'  THEN ARRAY['draft','registration_open']
            WHEN 'registration_closes_at' THEN ARRAY['draft','registration_open']
            WHEN 'start_date'  THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'end_date'    THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            -- The rating band locks at draft: it is a competitive fact about
            -- the field (and min_rating is a scoring input), so neither bound
            -- can move once players have entered on the strength of it.
            WHEN 'min_rating'     THEN ARRAY['draft']
            WHEN 'max_rating'     THEN ARRAY['draft']
            WHEN 'min_reputation' THEN ARRAY['draft','registration_open']
            WHEN 'facility_id'   THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'venue_name'    THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'venue_address' THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'city'          THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'prize_money_cents' THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'max_participants'   THEN ARRAY['draft']
            WHEN 'bracket_type'       THEN ARRAY['draft']
            WHEN 'match_format'       THEN ARRAY['draft']
            WHEN 'games_per_set'      THEN ARRAY['draft']
            WHEN 'final_set_tiebreak' THEN ARRAY['draft']
            WHEN 'entry_format'       THEN ARRAY['draft']
            -- Fee settings: lockable only before registration opens.
            WHEN 'entry_fee_cents'    THEN ARRAY['draft']
            WHEN 'currency'           THEN ARRAY['draft']
            WHEN 'fee_payer'          THEN ARRAY['draft']
            WHEN 'payout_timing'      THEN ARRAY['draft']
            WHEN 'refund_policy_kind' THEN ARRAY['draft']
            WHEN 'refund_partial_bps' THEN ARRAY['draft']
            WHEN 'refund_cutoff_at'   THEN ARRAY['draft']
            ELSE NULL
        END;

        IF v_allowed IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'UNKNOWN_FIELD:' || v_key;
        END IF;
        IF NOT (v_before.status::text = ANY (v_allowed)) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'FIELD_NOT_EDITABLE:' || v_key;
        END IF;
    END LOOP;

    IF p_patch ? 'name' AND (p_patch->>'name' IS NULL
        OR char_length(trim(p_patch->>'name')) NOT BETWEEN 1 AND 100) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_NAME';
    END IF;

    IF p_patch ? 'max_participants'
        AND (p_patch->>'max_participants')::smallint NOT IN (4, 8, 16, 32, 64, 128) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_MAX_PARTICIPANTS';
    END IF;

    IF p_patch ? 'entry_format' AND p_patch->>'entry_format' <> 'singles' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DOUBLES_NOT_SUPPORTED';
    END IF;

    -- Band validity is checked against the merged result: a patch touching only
    -- one bound still has to sit right against the stored other one.
    IF p_patch ? 'min_rating' OR p_patch ? 'max_rating' THEN
        v_new_min := CASE WHEN p_patch ? 'min_rating' THEN (p_patch->>'min_rating')::numeric ELSE v_before.min_rating END;
        v_new_max := CASE WHEN p_patch ? 'max_rating' THEN (p_patch->>'max_rating')::numeric ELSE v_before.max_rating END;
        IF v_new_min IS NOT NULL AND v_new_max IS NOT NULL AND v_new_max < v_new_min THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RATING_RANGE';
        END IF;
    END IF;

    v_new_start := CASE WHEN p_patch ? 'start_date' THEN (p_patch->>'start_date')::timestamptz ELSE v_before.start_date END;
    v_new_end   := CASE WHEN p_patch ? 'end_date'   THEN (p_patch->>'end_date')::timestamptz   ELSE v_before.end_date   END;
    IF v_new_start IS NULL OR v_new_end IS NULL OR v_new_end < v_new_start THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DATES';
    END IF;

    IF p_patch ? 'match_format' THEN
        v_new_format := (p_patch->>'match_format')::match_format;
        SELECT name INTO v_sport_name FROM sport WHERE id = v_before.sport_id;
        IF (v_sport_name = 'pickleball') <> (v_new_format::text LIKE 'pickleball%') THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_FORMAT_SPORT_MISMATCH';
        END IF;
    END IF;

    UPDATE tournaments SET
        name        = CASE WHEN p_patch ? 'name'        THEN trim(p_patch->>'name')   ELSE name        END,
        description = CASE WHEN p_patch ? 'description' THEN p_patch->>'description'  ELSE description END,
        rules       = CASE WHEN p_patch ? 'rules'       THEN p_patch->>'rules'        ELSE rules       END,
        logo_url    = CASE WHEN p_patch ? 'logo_url'    THEN p_patch->>'logo_url'     ELSE logo_url    END,
        visibility  = CASE WHEN p_patch ? 'visibility'  THEN (p_patch->>'visibility')::tournament_visibility ELSE visibility END,
        surface     = CASE WHEN p_patch ? 'surface'     THEN p_patch->>'surface'      ELSE surface     END,
        level       = CASE WHEN p_patch ? 'level'       THEN p_patch->>'level'        ELSE level       END,
        categories  = CASE WHEN p_patch ? 'categories'
                           THEN COALESCE((SELECT array_agg(value) FROM jsonb_array_elements_text(p_patch->'categories')), '{}')
                           ELSE categories END,
        registration_mode      = CASE WHEN p_patch ? 'registration_mode'      THEN (p_patch->>'registration_mode')::tournament_registration_mode ELSE registration_mode END,
        registration_opens_at  = CASE WHEN p_patch ? 'registration_opens_at'  THEN (p_patch->>'registration_opens_at')::timestamptz  ELSE registration_opens_at  END,
        registration_closes_at = CASE WHEN p_patch ? 'registration_closes_at' THEN (p_patch->>'registration_closes_at')::timestamptz ELSE registration_closes_at END,
        start_date  = v_new_start,
        end_date    = v_new_end,
        min_rating     = CASE WHEN p_patch ? 'min_rating'     THEN (p_patch->>'min_rating')::numeric      ELSE min_rating     END,
        max_rating     = CASE WHEN p_patch ? 'max_rating'     THEN (p_patch->>'max_rating')::numeric      ELSE max_rating     END,
        min_reputation = CASE WHEN p_patch ? 'min_reputation' THEN (p_patch->>'min_reputation')::smallint ELSE min_reputation END,
        facility_id   = CASE WHEN p_patch ? 'facility_id'   THEN (p_patch->>'facility_id')::uuid ELSE facility_id   END,
        venue_name    = CASE WHEN p_patch ? 'venue_name'    THEN p_patch->>'venue_name'          ELSE venue_name    END,
        venue_address = CASE WHEN p_patch ? 'venue_address' THEN p_patch->>'venue_address'       ELSE venue_address END,
        city          = CASE WHEN p_patch ? 'city'          THEN p_patch->>'city'                ELSE city          END,
        prize_money_cents = CASE WHEN p_patch ? 'prize_money_cents' THEN (p_patch->>'prize_money_cents')::integer ELSE prize_money_cents END,
        max_participants   = CASE WHEN p_patch ? 'max_participants'   THEN (p_patch->>'max_participants')::smallint ELSE max_participants END,
        bracket_type       = CASE WHEN p_patch ? 'bracket_type'       THEN (p_patch->>'bracket_type')::bracket_type ELSE bracket_type END,
        match_format       = CASE WHEN p_patch ? 'match_format'       THEN v_new_format ELSE match_format END,
        games_per_set      = CASE WHEN p_patch ? 'games_per_set'      THEN (p_patch->>'games_per_set')::smallint ELSE games_per_set END,
        final_set_tiebreak = CASE WHEN p_patch ? 'final_set_tiebreak' THEN (p_patch->>'final_set_tiebreak')::final_set_tiebreak ELSE final_set_tiebreak END,
        entry_format       = CASE WHEN p_patch ? 'entry_format'       THEN (p_patch->>'entry_format')::entry_format ELSE entry_format END,
        entry_fee_cents    = CASE WHEN p_patch ? 'entry_fee_cents'    THEN (p_patch->>'entry_fee_cents')::integer ELSE entry_fee_cents END,
        currency           = CASE WHEN p_patch ? 'currency'           THEN p_patch->>'currency' ELSE currency END,
        fee_payer          = CASE WHEN p_patch ? 'fee_payer'          THEN (p_patch->>'fee_payer')::fee_payer_enum ELSE fee_payer END,
        payout_timing      = CASE WHEN p_patch ? 'payout_timing'      THEN (p_patch->>'payout_timing')::payout_timing_enum ELSE payout_timing END,
        refund_policy_kind = CASE WHEN p_patch ? 'refund_policy_kind' THEN (p_patch->>'refund_policy_kind')::refund_policy_kind_enum ELSE refund_policy_kind END,
        refund_partial_bps = CASE WHEN p_patch ? 'refund_partial_bps' THEN (p_patch->>'refund_partial_bps')::integer ELSE refund_partial_bps END,
        refund_cutoff_at   = CASE WHEN p_patch ? 'refund_cutoff_at'   THEN NULLIF(p_patch->>'refund_cutoff_at', '')::timestamptz ELSE refund_cutoff_at END,
        version    = version + 1,
        updated_at = now()
    WHERE id = p_tournament_id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_before, payload_after)
    SELECT 'tournament', v_row.id, 'update', v_caller_id,
           jsonb_object_agg(t.k, to_jsonb(v_before) -> t.k),
           jsonb_object_agg(t.k, to_jsonb(v_row) -> t.k)
      FROM jsonb_object_keys(p_patch) AS t(k);

    RETURN v_row;

EXCEPTION
    WHEN invalid_text_representation THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_FIELD_VALUE';
    WHEN check_violation THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_FIELD_VALUE';
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_update(uuid, integer, jsonb) TO authenticated;


-- ---------------------------------------------------------------- register
-- Same body as 20260716210000; the inline min_rating gate becomes two
-- lt_assert_rating_band calls, which also enforce the ceiling.
CREATE OR REPLACE FUNCTION public.tournament_register(p_tournament_id uuid, p_partner_id uuid DEFAULT NULL::uuid)
 RETURNS tournament_registrations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_caller_id      uuid := auth.uid();
    v_tournament     tournaments;
    v_is_doubles     boolean;
    v_active_count   integer;
    v_initial_status registration_status;
    v_is_privileged  boolean;
    v_is_admin       boolean;
    v_existing       tournament_registrations;
    v_row            tournament_registrations;
    v_captain_name   text;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    -- Row-lock the tournament so concurrent registrations serialize and the
    -- capacity count + insert below can't race past max_participants.
    SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
    IF v_tournament.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;

    -- Sport scope: caller must play this sport
    PERFORM public.assert_caller_plays_sport(v_tournament.sport_id);

    -- Status must allow registration
    IF v_tournament.status <> 'registration_open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_REG_CLOSED';
    END IF;

    -- Partner validation, all modes. Entry format decides whether a partner
    -- is required (doubles/mixed_doubles) or forbidden (singles).
    v_is_doubles := v_tournament.entry_format <> 'singles';

    IF NOT v_is_doubles AND p_partner_id IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_NOT_ALLOWED';
    END IF;

    IF v_is_doubles THEN
        IF p_partner_id IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_REQUIRED';
        END IF;
        IF p_partner_id = v_caller_id
           OR NOT EXISTS (SELECT 1 FROM player WHERE id = p_partner_id) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_INVALID';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM player_sport ps
             WHERE ps.player_id = p_partner_id
               AND ps.sport_id  = v_tournament.sport_id
               AND ps.is_active = true
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_SPORT_MISMATCH';
        END IF;
        -- Partner can't already be in an active entry, as captain or partner.
        IF EXISTS (
            SELECT 1 FROM tournament_registrations r
             WHERE r.tournament_id = p_tournament_id
               AND r.status IN ('registered', 'pending', 'waitlisted')
               AND (r.user_id = p_partner_id OR r.partner_user_id = p_partner_id)
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_ALREADY_REGISTERED';
        END IF;
        -- Caller can't already be someone else's active partner: the
        -- UNIQUE(tournament_id, user_id) constraint only covers captains.
        IF EXISTS (
            SELECT 1 FROM tournament_registrations r
             WHERE r.tournament_id  = p_tournament_id
               AND r.status IN ('registered', 'pending', 'waitlisted')
               AND r.partner_user_id = v_caller_id
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_REGISTERED';
        END IF;
    END IF;

    -- Organizers/admins own the tournament: they always register directly as
    -- 'registered', bypassing the approval/invite gates a regular player hits.
    v_is_admin      := public.is_admin();
    v_is_privileged := public.is_tournament_organizer(p_tournament_id) OR v_is_admin;

    -- Hard rating-band gate. Runs before the mode branch so it covers open,
    -- approval AND invite_only (which returns early), and it checks both
    -- members of a doubles entry. Organizers are not exempt — they live by the
    -- band they set. Admins bypass as a support override.
    IF NOT v_is_admin THEN
        PERFORM public.lt_assert_rating_band(
            v_caller_id, v_tournament.sport_id,
            v_tournament.min_rating, v_tournament.max_rating, false);
        IF v_is_doubles THEN
            PERFORM public.lt_assert_rating_band(
                p_partner_id, v_tournament.sport_id,
                v_tournament.min_rating, v_tournament.max_rating, true);
        END IF;
    END IF;

    -- Mode-dependent initial status. The band gate above already rejected any
    -- out-of-band entrant, so 'open' now always lands on 'registered' — the
    -- soft gate's pending-for-organizer-review branch is gone.
    IF v_is_privileged OR v_tournament.registration_mode = 'open' THEN
        v_initial_status := 'registered';
    ELSIF v_tournament.registration_mode = 'approval' THEN
        v_initial_status := 'pending';
    ELSIF v_tournament.registration_mode = 'invite_only' THEN
        SELECT * INTO v_existing
          FROM tournament_registrations
         WHERE tournament_id = p_tournament_id
           AND user_id       = v_caller_id;

        -- Organizer-removed players are blocked permanently.
        IF v_existing.id IS NOT NULL AND v_existing.status = 'disqualified' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REGISTRATION_REMOVED';
        END IF;

        IF v_existing.id IS NULL OR v_existing.status <> 'pending' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_INVITED';
        END IF;

        -- Accept the existing invite row by flipping pending → registered.
        -- For doubles the invited captain supplies the partner at accept time.
        UPDATE tournament_registrations
           SET status          = 'registered',
               partner_user_id = COALESCE(p_partner_id, partner_user_id),
               approved_at     = now(),
               version         = version + 1,
               updated_at      = now()
         WHERE id = v_existing.id
        RETURNING * INTO v_row;

        INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
        VALUES (
            'registration', v_row.id, 'accept_invite', v_caller_id,
            jsonb_build_object(
                'tournament_id', p_tournament_id,
                'status', v_row.status,
                'partner_user_id', v_row.partner_user_id
            )
        );

        IF v_is_doubles THEN
            SELECT first_name INTO v_captain_name FROM profile WHERE id = v_caller_id;
            PERFORM insert_notification(
                p_partner_id,
                'tournament_partner_registered',
                v_tournament.id,
                CASE WHEN public.lt_user_is_fr(p_partner_id) THEN 'Inscrit comme partenaire' ELSE 'Tournament partner' END,
                CASE WHEN public.lt_user_is_fr(p_partner_id) THEN COALESCE(v_captain_name, 'Un joueur') || ' t''a inscrit comme partenaire pour ' || v_tournament.name || '.' ELSE COALESCE(v_captain_name, 'A player') || ' registered you as their partner for ' || v_tournament.name || '.' END,
                jsonb_build_object('tournamentId', v_tournament.id, 'captainId', v_caller_id),
                'normal'
            );
        END IF;
        RETURN v_row;
    ELSE
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_REG_CLOSED';
    END IF;

    -- Look for any existing row for this (tournament, user). The UNIQUE
    -- constraint on (tournament_id, user_id) means there's at most one.
    SELECT * INTO v_existing
      FROM tournament_registrations
     WHERE tournament_id = p_tournament_id
       AND user_id       = v_caller_id;

    -- Already actively registered → block
    IF v_existing.id IS NOT NULL
       AND v_existing.status IN ('registered', 'pending', 'waitlisted') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_REGISTERED';
    END IF;

    -- Organizer-removed players are blocked permanently (checked before
    -- capacity so they get REGISTRATION_REMOVED, not TOURNAMENT_FULL).
    IF v_existing.id IS NOT NULL AND v_existing.status = 'disqualified' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REGISTRATION_REMOVED';
    END IF;

    -- Capacity check (open + approval + organizer flows). Counts active
    -- registrations only — one row per entry, so for doubles this counts teams.
    SELECT count(*) INTO v_active_count
      FROM tournament_registrations
     WHERE tournament_id = p_tournament_id
       AND status IN ('registered', 'pending');

    IF v_active_count >= v_tournament.max_participants THEN
        -- Waitlist isn't implemented in V2; surface TOURNAMENT_FULL.
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_FULL';
    END IF;

    IF v_existing.id IS NOT NULL THEN
        -- Reactivate a previously withdrawn row. partner_user_id is
        -- overwritten: re-registering with a different partner is allowed.
        UPDATE tournament_registrations
           SET status          = v_initial_status,
               partner_user_id = p_partner_id,
               withdrawn_at    = NULL,
               approved_at     = CASE
                                   WHEN v_initial_status = 'registered' THEN now()
                                   ELSE NULL
                                 END,
               version         = version + 1,
               updated_at      = now()
         WHERE id = v_existing.id
        RETURNING * INTO v_row;

        INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
        VALUES (
            'registration', v_row.id, 're_register', v_caller_id,
            jsonb_build_object(
                'tournament_id', p_tournament_id,
                'previous_status', v_existing.status,
                'status', v_row.status,
                'partner_user_id', v_row.partner_user_id
            )
        );
    ELSE
        -- Fresh insert. UNIQUE handles the concurrent-double-tap race.
        BEGIN
            INSERT INTO tournament_registrations (tournament_id, user_id, partner_user_id, status)
            VALUES (p_tournament_id, v_caller_id, p_partner_id, v_initial_status)
            RETURNING * INTO v_row;
        EXCEPTION WHEN unique_violation THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_REGISTERED';
        END;

        INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
        VALUES (
            'registration', v_row.id, 'register', v_caller_id,
            jsonb_build_object(
                'tournament_id', p_tournament_id,
                'status', v_row.status,
                'partner_user_id', v_row.partner_user_id
            )
        );
    END IF;

    IF v_is_doubles THEN
        SELECT first_name INTO v_captain_name FROM profile WHERE id = v_caller_id;
        PERFORM insert_notification(
            p_partner_id,
            'tournament_partner_registered',
            v_tournament.id,
            CASE WHEN public.lt_user_is_fr(p_partner_id) THEN 'Inscrit comme partenaire' ELSE 'Tournament partner' END,
            CASE WHEN public.lt_user_is_fr(p_partner_id) THEN COALESCE(v_captain_name, 'Un joueur') || ' t''a inscrit comme partenaire pour ' || v_tournament.name || '.' ELSE COALESCE(v_captain_name, 'A player') || ' registered you as their partner for ' || v_tournament.name || '.' END,
            jsonb_build_object('tournamentId', v_tournament.id, 'captainId', v_caller_id),
            'normal'
        );
    END IF;

    RETURN v_row;
END;
$function$;


-- ------------------------------------------------------- accept_invite
-- Same body as 20260629150000 plus the rating-band gate. An organizer invite
-- previously skipped the rating check entirely: tournament_register's gate
-- covers its own invite_only branch, but this RPC is the path the detail screen
-- actually calls for an organizer-sent invite, so a 4.5 invited into a 3.0–3.5
-- draw walked straight in. Invites are a shortcut past approval, not past the
-- band.
CREATE OR REPLACE FUNCTION public.tournament_accept_invite(
    p_tournament_id uuid,
    p_partner_id    uuid DEFAULT NULL
)
RETURNS tournament_registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id    uuid := auth.uid();
    v_tournament   tournaments;
    v_is_doubles   boolean;
    v_existing     tournament_registrations;
    v_row          tournament_registrations;
    v_captain_name text;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
    IF v_tournament.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;

    IF v_tournament.status <> 'registration_open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_REG_CLOSED';
    END IF;

    SELECT * INTO v_existing
      FROM tournament_registrations
     WHERE tournament_id = p_tournament_id
       AND user_id       = v_caller_id
       AND status        = 'pending'
       AND invited_by IS NOT NULL;
    IF v_existing.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_INVITED';
    END IF;

    -- Paid tournaments: claiming the invite must go through Stripe
    -- (tournament_begin_paid_registration). Don't grant a free confirmed spot.
    IF COALESCE(v_tournament.entry_fee_cents, 0) > 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAYMENT_REQUIRED';
    END IF;

    v_is_doubles := v_tournament.entry_format <> 'singles';

    IF NOT v_is_doubles AND p_partner_id IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_NOT_ALLOWED';
    END IF;

    IF v_is_doubles THEN
        IF p_partner_id IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_REQUIRED';
        END IF;
        IF p_partner_id = v_caller_id
           OR NOT EXISTS (SELECT 1 FROM player WHERE id = p_partner_id) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_INVALID';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM player_sport ps
             WHERE ps.player_id = p_partner_id
               AND ps.sport_id  = v_tournament.sport_id
               AND ps.is_active = true
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_SPORT_MISMATCH';
        END IF;
        IF EXISTS (
            SELECT 1 FROM tournament_registrations r
             WHERE r.tournament_id = p_tournament_id
               AND r.id <> v_existing.id
               AND r.status IN ('registered', 'pending', 'waitlisted')
               AND (r.user_id = p_partner_id OR r.partner_user_id = p_partner_id)
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_ALREADY_REGISTERED';
        END IF;
    END IF;

    -- Rating band, same rule and same admin override as the other entry paths.
    IF NOT public.is_admin() THEN
        PERFORM public.lt_assert_rating_band(
            v_caller_id, v_tournament.sport_id,
            v_tournament.min_rating, v_tournament.max_rating, false);
        IF v_is_doubles THEN
            PERFORM public.lt_assert_rating_band(
                p_partner_id, v_tournament.sport_id,
                v_tournament.min_rating, v_tournament.max_rating, true);
        END IF;
    END IF;

    UPDATE tournament_registrations
       SET status          = 'registered',
           partner_user_id = CASE WHEN v_is_doubles THEN p_partner_id ELSE partner_user_id END,
           approved_at     = now(),
           version         = version + 1,
           updated_at      = now()
     WHERE id = v_existing.id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('registration', v_row.id, 'accept_invite', v_caller_id,
            jsonb_build_object('tournament_id', p_tournament_id, 'status', v_row.status, 'partner_user_id', v_row.partner_user_id));

    IF v_is_doubles AND p_partner_id IS NOT NULL THEN
        SELECT first_name INTO v_captain_name FROM profile WHERE id = v_caller_id;
        PERFORM insert_notification(
            p_partner_id,
            'tournament_partner_registered',
            v_tournament.id,
            CASE WHEN public.lt_user_is_fr(p_partner_id) THEN 'Inscrit comme partenaire' ELSE 'Tournament partner' END,
            CASE WHEN public.lt_user_is_fr(p_partner_id) THEN COALESCE(v_captain_name, 'Un joueur') || ' t''a inscrit comme partenaire pour ' || v_tournament.name || '.' ELSE COALESCE(v_captain_name, 'A player') || ' registered you as their partner for ' || v_tournament.name || '.' END,
            jsonb_build_object('tournamentId', v_tournament.id, 'captainId', v_caller_id),
            'normal'
        );
    END IF;

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_accept_invite(uuid, uuid) TO authenticated;


-- --------------------------------------------------- begin_paid_registration
-- Same body as 20260721130200; the inline min_rating gate becomes the same two
-- lt_assert_rating_band calls. Still runs before any row is written or ledger
-- entry created, so a rejected entrant is never charged.
CREATE OR REPLACE FUNCTION public.tournament_begin_paid_registration(
    p_tournament_id   uuid,
    p_partner_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
    payment_id                  uuid,
    registration_id             uuid,
    entry_cents                 integer,
    service_fee_cents           integer,
    fee_tax_cents               integer,
    amount_charged_cents        integer,
    organizer_amount_cents      integer,
    fee_payer                   fee_payer_enum,
    payout_timing               payout_timing_enum,
    currency                    varchar,
    organizer_id                uuid,
    organizer_stripe_account_id text,
    organizer_onboarded         boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller   uuid := auth.uid();
    v_t        tournaments;
    v_pol      record;
    v_fee      integer;
    v_fee_tax  integer;
    v_total    integer;
    v_org      integer;
    v_active   integer;
    v_existing tournament_registrations;
    v_reg      tournament_registrations;
    v_psa      player_stripe_account;
    v_pay_id   uuid;
    v_is_invite_accept boolean := false;
    v_is_doubles     boolean;
    v_is_admin       boolean;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    -- Row-lock so the capacity count below and the reservation can't race.
    SELECT * INTO v_t FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
    IF v_t.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;

    PERFORM public.assert_caller_plays_sport(v_t.sport_id);

    IF v_t.status <> 'registration_open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_REG_CLOSED';
    END IF;
    IF v_t.entry_fee_cents <= 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_PAID';
    END IF;

    -- ---------------------------------------------- partner / entry format
    v_is_doubles := v_t.entry_format <> 'singles';

    IF NOT v_is_doubles AND p_partner_user_id IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_NOT_ALLOWED';
    END IF;

    IF v_is_doubles THEN
        IF p_partner_user_id IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_REQUIRED';
        END IF;
        IF p_partner_user_id = v_caller
           OR NOT EXISTS (SELECT 1 FROM player WHERE id = p_partner_user_id) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_INVALID';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM player_sport ps
             WHERE ps.player_id = p_partner_user_id
               AND ps.sport_id  = v_t.sport_id
               AND ps.is_active = true
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_SPORT_MISMATCH';
        END IF;
        -- Already in a live entry, as captain or partner. 'Live' includes a
        -- payment still in its window, matching the capacity rule below: an
        -- expired reservation frees the player once the reaper clears it.
        IF EXISTS (
            SELECT 1 FROM tournament_registrations r
             LEFT JOIN lt_registration_payment p
               ON p.tournament_registration_id = r.id AND p.status = 'pending'
             WHERE r.tournament_id = p_tournament_id
               AND (r.user_id = p_partner_user_id OR r.partner_user_id = p_partner_user_id)
               AND (
                    r.status IN ('registered', 'pending', 'waitlisted')
                    OR (r.status = 'payment_pending' AND p.id IS NOT NULL AND p.expires_at > now())
               )
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_ALREADY_REGISTERED';
        END IF;
        -- UNIQUE(tournament_id, user_id) only covers captains, so check the
        -- caller isn't already somebody else's partner.
        IF EXISTS (
            SELECT 1 FROM tournament_registrations r
             LEFT JOIN lt_registration_payment p
               ON p.tournament_registration_id = r.id AND p.status = 'pending'
             WHERE r.tournament_id   = p_tournament_id
               AND r.partner_user_id = v_caller
               AND (
                    r.status IN ('registered', 'pending', 'waitlisted')
                    OR (r.status = 'payment_pending' AND p.id IS NOT NULL AND p.expires_at > now())
               )
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_REGISTERED';
        END IF;
    END IF;

    -- ------------------------------------------------- hard rating-band gate
    -- Same rule as tournament_register: organizers live by the band they set,
    -- admins bypass as a support override, and both members of a doubles entry
    -- are checked. Runs before any row is written so nobody pays to be refused.
    v_is_admin := public.is_admin();

    IF NOT v_is_admin THEN
        PERFORM public.lt_assert_rating_band(
            v_caller, v_t.sport_id, v_t.min_rating, v_t.max_rating, false);
        IF v_is_doubles THEN
            PERFORM public.lt_assert_rating_band(
                p_partner_user_id, v_t.sport_id, v_t.min_rating, v_t.max_rating, true);
        END IF;
    END IF;

    -- The caller's existing row. An outstanding organizer invite (pending +
    -- invited_by) lets them pay to claim the reserved slot even when the
    -- tournament isn't in 'open' registration mode.
    SELECT * INTO v_existing
      FROM tournament_registrations
     WHERE tournament_id = p_tournament_id AND user_id = v_caller;
    v_is_invite_accept := v_existing.id IS NOT NULL
                          AND v_existing.status = 'pending'
                          AND v_existing.invited_by IS NOT NULL;

    -- Organizer-removed players are blocked permanently, as in the free path.
    -- Checked before capacity so they get REGISTRATION_REMOVED, not
    -- TOURNAMENT_FULL.
    IF v_existing.id IS NOT NULL AND v_existing.status = 'disqualified' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REGISTRATION_REMOVED';
    END IF;

    -- Paid approval flows (pay vs. approval ordering) are a later slice; the one
    -- non-open path supported here is claiming an organizer invite.
    IF v_t.registration_mode <> 'open' AND NOT v_is_invite_accept THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAID_REG_MODE_UNSUPPORTED';
    END IF;

    -- Capacity: count everyone else's live slots (active or a non-expired
    -- pending payment). The caller's own row never blocks them.
    SELECT count(*) INTO v_active
      FROM tournament_registrations tr
      LEFT JOIN lt_registration_payment p
        ON p.tournament_registration_id = tr.id AND p.status = 'pending'
     WHERE tr.tournament_id = p_tournament_id
       AND tr.user_id <> v_caller
       AND (
            tr.status IN ('registered', 'pending')
            OR (tr.status = 'payment_pending' AND p.id IS NOT NULL AND p.expires_at > now())
       );
    IF v_active >= v_t.max_participants THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_FULL';
    END IF;

    -- Reuse the caller's existing row if present; block if already confirmed or a
    -- non-invite pending (e.g. approval-mode self-register awaiting the organizer).
    IF v_existing.id IS NOT NULL THEN
        IF v_existing.status = 'registered'
           OR (v_existing.status = 'pending' AND NOT v_is_invite_accept) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_REGISTERED';
        END IF;
        UPDATE tournament_registrations
           SET status          = 'payment_pending',
               partner_user_id = p_partner_user_id,
               withdrawn_at    = NULL,
               version         = version + 1,
               updated_at      = now()
         WHERE id = v_existing.id
        RETURNING * INTO v_reg;

        -- Supersede any still-open pending payment for this registration.
        UPDATE lt_registration_payment
           SET status = 'cancelled', updated_at = now()
         WHERE tournament_registration_id = v_reg.id AND status = 'pending';
    ELSE
        INSERT INTO tournament_registrations (tournament_id, user_id, partner_user_id, status)
        VALUES (p_tournament_id, v_caller, p_partner_user_id, 'payment_pending')
        RETURNING * INTO v_reg;
    END IF;

    -- Resolve the effective fee (+ tax on it) and snapshot the breakdown.
    SELECT * INTO v_pol FROM public.resolve_service_fee_policy(
        v_t.organizer_id, v_t.fee_pct_bps_override, v_t.fee_flat_cents_override, v_t.fee_cap_cents_override);
    v_fee     := public.compute_service_fee_cents(v_t.entry_fee_cents, v_pol.pct_bps, v_pol.flat_cents, v_pol.cap_cents);
    v_fee_tax := public.compute_fee_tax_cents(v_fee);

    IF v_t.fee_payer = 'player_pays' THEN
        v_total := v_t.entry_fee_cents + v_fee + v_fee_tax;
        v_org   := v_t.entry_fee_cents;
    ELSE
        v_total := v_t.entry_fee_cents;
        v_org   := GREATEST(v_t.entry_fee_cents - v_fee - v_fee_tax, 0);
    END IF;

    INSERT INTO lt_registration_payment (
        tournament_registration_id, payer_user_id, organizer_id,
        entry_cents, service_fee_cents, fee_tax_cents, fee_payer,
        amount_charged_cents, organizer_amount_cents, currency,
        payout_timing, status, expires_at
    ) VALUES (
        v_reg.id, v_caller, v_t.organizer_id,
        v_t.entry_fee_cents, v_fee, v_fee_tax, v_t.fee_payer,
        v_total, v_org, v_t.currency,
        v_t.payout_timing, 'pending', now() + interval '15 minutes'
    ) RETURNING id INTO v_pay_id;

    SELECT * INTO v_psa FROM player_stripe_account WHERE player_id = v_t.organizer_id;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('registration', v_reg.id, 'begin_paid_registration', v_caller,
            jsonb_build_object('payment_id', v_pay_id, 'amount_charged_cents', v_total, 'invite_accept', v_is_invite_accept));

    payment_id                  := v_pay_id;
    registration_id             := v_reg.id;
    entry_cents                 := v_t.entry_fee_cents;
    service_fee_cents           := v_fee;
    fee_tax_cents               := v_fee_tax;
    amount_charged_cents        := v_total;
    organizer_amount_cents      := v_org;
    fee_payer                   := v_t.fee_payer;
    payout_timing               := v_t.payout_timing;
    currency                    := v_t.currency;
    organizer_id                := v_t.organizer_id;
    organizer_stripe_account_id := v_psa.stripe_account_id;
    organizer_onboarded         := COALESCE(v_psa.onboarding_completed, false);
    RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_begin_paid_registration(uuid, uuid) TO authenticated;
