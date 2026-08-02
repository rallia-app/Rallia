-- ---------------------------------------------------------------------------
-- lt_event_earnings: what a paid event has collected, for its organizer.
--
-- Until now an organizer had NO view of an event's money inside the app: the
-- ledger is per-registration, the Stripe balance is account-wide, and nothing
-- ties either back to one tournament or season. The only way to know what an
-- event earned was to open the Stripe dashboard and guess. Surfaced during the
-- 2026-08 payments test protocol as a product gap; this RPC is the read model
-- that fills it.
--
-- One function for both event kinds (exactly one of the two ids), because the
-- ledger already is: lt_registration_payment rows carry either a
-- tournament_registration_id or a season_user_id/season_id leg.
--
-- Aggregates, not rows: the client renders a summary card and the cancel
-- confirmation. Per-payment detail stays on the existing RLS-guarded table
-- (organizers can already SELECT their own ledger rows if a drill-down is
-- ever needed).
--
-- succeeded/refunded are payment-status counts over the payments the event
-- still owes an outcome for; refunded_cents is what has actually gone back.
-- pending is deliberately included so the organizer can see an in-flight
-- checkout, and net_to_organizer_cents is the sum the settle cron will (or
-- did) release: organizer_amount of succeeded, minus refunds already issued
-- against those payments.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.lt_event_earnings(
    p_tournament_id uuid DEFAULT NULL,
    p_season_id     uuid DEFAULT NULL
)
RETURNS TABLE (
    paid_count             integer,
    pending_count          integer,
    refunded_count         integer,
    entry_cents            bigint,
    service_fee_cents      bigint,
    fee_tax_cents          bigint,
    charged_cents          bigint,
    refunded_cents         bigint,
    net_to_organizer_cents bigint,
    released_count         integer,
    currency               varchar(3)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org uuid;
BEGIN
    IF (p_tournament_id IS NULL) = (p_season_id IS NULL) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ONE_EVENT_ID_REQUIRED';
    END IF;

    IF p_tournament_id IS NOT NULL THEN
        SELECT t.organizer_id INTO v_org FROM tournaments t WHERE t.id = p_tournament_id;
        IF v_org IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
        END IF;
    ELSE
        SELECT l.organizer_id INTO v_org
          FROM seasons s JOIN leagues l ON l.id = s.league_id
         WHERE s.id = p_season_id;
        IF v_org IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_FOUND';
        END IF;
    END IF;

    -- The money view is the organizer's (or an admin's). Participants have
    -- their own RLS-scoped ledger rows; this aggregate is not for them.
    IF v_org IS DISTINCT FROM auth.uid() AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    RETURN QUERY
    SELECT
        COUNT(*) FILTER (WHERE p.status = 'succeeded')::integer,
        COUNT(*) FILTER (WHERE p.status = 'pending')::integer,
        COUNT(*) FILTER (WHERE p.status = 'refunded')::integer,
        COALESCE(SUM(p.entry_cents)          FILTER (WHERE p.status = 'succeeded'), 0)::bigint,
        COALESCE(SUM(p.service_fee_cents)    FILTER (WHERE p.status = 'succeeded'), 0)::bigint,
        COALESCE(SUM(p.fee_tax_cents)        FILTER (WHERE p.status = 'succeeded'), 0)::bigint,
        COALESCE(SUM(p.amount_charged_cents) FILTER (WHERE p.status = 'succeeded'), 0)::bigint,
        COALESCE(SUM(p.refund_amount_cents), 0)::bigint,
        (COALESCE(SUM(p.organizer_amount_cents) FILTER (WHERE p.status = 'succeeded'), 0)
         - COALESCE(SUM(p.refund_amount_cents) FILTER (WHERE p.status = 'succeeded'), 0))::bigint,
        COUNT(*) FILTER (WHERE p.released_at IS NOT NULL)::integer,
        MAX(p.currency)::varchar(3)
    FROM lt_registration_payment p
    LEFT JOIN tournament_registrations r ON r.id = p.tournament_registration_id
    WHERE (p_tournament_id IS NOT NULL AND r.tournament_id = p_tournament_id)
       OR (p_season_id IS NOT NULL AND p.season_id = p_season_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.lt_event_earnings(uuid, uuid) TO authenticated;
