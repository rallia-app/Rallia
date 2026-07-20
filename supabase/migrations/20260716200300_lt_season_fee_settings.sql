-- Paid seasons: let an organizer actually set a price, and cancel a paid season.
--
-- season_create gains optional fee args (defaulted, so every existing 5-arg call
-- site keeps working — this is an overload-compatible signature extension via
-- new trailing DEFAULTs, not a breaking change).
--
-- season_update is new: seasons had no edit RPC at all, and fees must be
-- changeable while the season is still a draft. Fees lock at 'open' — the same
-- rule tournaments apply, and for the same reason: once someone has paid, the
-- price they agreed to is history.
--
-- season_cancel is new and is what makes refunds reachable:
-- lt_cancel_refund_candidates selects paid rows whose event is cancelled, so
-- without a cancelled season there is no way to give money back.

-- ---------------------------------------------------------------------------
-- season_create + fee args
--
-- The old 5-arg signature must be dropped, not just replaced: adding trailing
-- DEFAULTs creates a second overload rather than superseding the first, and then
-- the existing named-parameter call (p_league_id, p_name, p_start_date,
-- p_end_date, p_rules_override) matches both and fails outright with
-- "could not choose a best candidate function".
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.season_create(uuid, text, date, date, jsonb);

CREATE OR REPLACE FUNCTION public.season_create(
    p_league_id        uuid,
    p_name             text,
    p_start_date       date,
    p_end_date         date,
    p_rules_override   jsonb DEFAULT NULL::jsonb,
    p_entry_fee_cents  integer DEFAULT 0,
    p_fee_payer        fee_payer_enum DEFAULT 'player_pays',
    p_payout_timing    payout_timing_enum DEFAULT 'hold_until_event_end',
    p_refund_policy_kind refund_policy_kind_enum DEFAULT 'none',
    p_refund_partial_bps integer DEFAULT NULL,
    p_refund_cutoff_at   timestamptz DEFAULT NULL
)
RETURNS seasons
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_league    leagues;
    v_rules     jsonb;
    v_row       seasons;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_league FROM leagues WHERE id = p_league_id;
    IF v_league.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_FOUND';
    END IF;

    IF NOT (public.is_league_organizer(p_league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    IF v_league.status <> 'active' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_ACTIVE';
    END IF;

    IF p_end_date < p_start_date THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DATE_RANGE';
    END IF;

    IF COALESCE(p_entry_fee_cents, 0) < 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_ENTRY_FEE';
    END IF;

    v_rules := v_league.default_rules;
    IF p_rules_override IS NOT NULL THEN
        v_rules := v_rules || p_rules_override;
    END IF;

    INSERT INTO seasons (
        league_id, name, start_date, end_date, rules, status,
        entry_fee_cents, fee_payer, payout_timing,
        refund_policy_kind, refund_partial_bps, refund_cutoff_at
    )
    VALUES (
        p_league_id, p_name, p_start_date, p_end_date, v_rules, 'draft',
        COALESCE(p_entry_fee_cents, 0), p_fee_payer, p_payout_timing,
        p_refund_policy_kind,
        CASE WHEN p_refund_policy_kind = 'partial' THEN p_refund_partial_bps ELSE NULL END,
        CASE WHEN p_refund_policy_kind <> 'none' THEN p_refund_cutoff_at ELSE NULL END
    )
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'season', v_row.id, 'create', v_caller_id,
        jsonb_build_object(
            'league_id', p_league_id,
            'name', v_row.name,
            'start_date', v_row.start_date,
            'end_date', v_row.end_date,
            'entry_fee_cents', v_row.entry_fee_cents
        )
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.season_create(
    uuid, text, date, date, jsonb, integer, fee_payer_enum, payout_timing_enum,
    refund_policy_kind_enum, integer, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- season_update — jsonb patch, mirrors league_update/tournament_update.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.season_update(
    p_season_id   uuid,
    p_version_was integer,
    p_patch       jsonb
)
RETURNS seasons
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_before    seasons;
    v_row       seasons;
    v_key       text;
    v_allowed   text[];
    v_new_start date;
    v_new_end   date;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'EMPTY_PATCH';
    END IF;

    SELECT * INTO v_before FROM seasons WHERE id = p_season_id FOR UPDATE;
    IF v_before.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_FOUND';
    END IF;

    IF NOT (public.is_league_organizer(v_before.league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    IF v_before.version <> p_version_was THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;

    IF v_before.status IN ('closed', 'cancelled') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_TERMINAL';
    END IF;

    FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
        v_allowed := CASE v_key
            WHEN 'name'       THEN ARRAY['draft','open']
            WHEN 'start_date' THEN ARRAY['draft','open']
            WHEN 'end_date'   THEN ARRAY['draft','open']
            -- Rules freeze at open (rules_locked_at); fees freeze with them,
            -- because by then someone may have paid the advertised price.
            WHEN 'rules'              THEN ARRAY['draft']
            WHEN 'entry_fee_cents'    THEN ARRAY['draft']
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
        OR char_length(trim(p_patch->>'name')) = 0) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_NAME';
    END IF;

    IF p_patch ? 'entry_fee_cents' AND (p_patch->>'entry_fee_cents')::integer < 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_ENTRY_FEE';
    END IF;

    v_new_start := CASE WHEN p_patch ? 'start_date' THEN (p_patch->>'start_date')::date ELSE v_before.start_date END;
    v_new_end   := CASE WHEN p_patch ? 'end_date'   THEN (p_patch->>'end_date')::date   ELSE v_before.end_date   END;
    IF v_new_end < v_new_start THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DATE_RANGE';
    END IF;

    UPDATE seasons SET
        name       = CASE WHEN p_patch ? 'name' THEN trim(p_patch->>'name') ELSE name END,
        start_date = v_new_start,
        end_date   = v_new_end,
        rules      = CASE WHEN p_patch ? 'rules' THEN p_patch->'rules' ELSE rules END,
        entry_fee_cents    = CASE WHEN p_patch ? 'entry_fee_cents' THEN (p_patch->>'entry_fee_cents')::integer ELSE entry_fee_cents END,
        fee_payer          = CASE WHEN p_patch ? 'fee_payer' THEN (p_patch->>'fee_payer')::fee_payer_enum ELSE fee_payer END,
        payout_timing      = CASE WHEN p_patch ? 'payout_timing' THEN (p_patch->>'payout_timing')::payout_timing_enum ELSE payout_timing END,
        refund_policy_kind = CASE WHEN p_patch ? 'refund_policy_kind' THEN (p_patch->>'refund_policy_kind')::refund_policy_kind_enum ELSE refund_policy_kind END,
        refund_partial_bps = CASE WHEN p_patch ? 'refund_partial_bps' THEN NULLIF(p_patch->>'refund_partial_bps','')::integer ELSE refund_partial_bps END,
        refund_cutoff_at   = CASE WHEN p_patch ? 'refund_cutoff_at' THEN NULLIF(p_patch->>'refund_cutoff_at','')::timestamptz ELSE refund_cutoff_at END,
        version    = version + 1,
        updated_at = now()
    WHERE id = p_season_id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_before, payload_after)
    SELECT 'season', v_row.id, 'update', v_caller_id,
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

GRANT EXECUTE ON FUNCTION public.season_update(uuid, integer, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- season_cancel — the state refunds hang off.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.season_cancel(
    p_season_id   uuid,
    p_reason      text,
    p_version_was integer
)
RETURNS seasons
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id  uuid := auth.uid();
    v_before     seasons;
    v_row        seasons;
    v_sessions   integer;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_before FROM seasons WHERE id = p_season_id;
    IF v_before.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_FOUND';
    END IF;

    IF NOT (public.is_league_organizer(v_before.league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    UPDATE seasons
       SET status           = 'cancelled',
           cancelled_at     = now(),
           cancelled_reason = p_reason,
           version          = version + 1,
           updated_at       = now()
     WHERE id      = p_season_id
       AND version = p_version_was
       AND status IN ('draft', 'open')
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (SELECT 1 FROM seasons WHERE id = p_season_id AND version <> p_version_was) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_CANCELLABLE';
    END IF;

    -- Unlike league_close this does cascade: cancelling is the abort path, so
    -- pending sessions die with it. lt_cancel_refund_candidates picks the paid
    -- enrolments up from here and the settle cron refunds them.
    UPDATE sessions
       SET status = 'cancelled', updated_at = now()
     WHERE season_id = p_season_id
       AND status IN ('draft', 'published', 'in_progress');
    GET DIAGNOSTICS v_sessions = ROW_COUNT;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('season', v_row.id, 'cancel', v_caller_id,
            jsonb_build_object('reason', p_reason, 'sessions_cancelled', v_sessions));

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.season_cancel(uuid, text, integer) TO authenticated;
