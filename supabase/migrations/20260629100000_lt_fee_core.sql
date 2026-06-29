-- ============================================
-- Leagues & Tournaments — service-fee + entry-fee CORE (Phase 1)
-- ============================================
-- Adds the adjustable service-fee model and per-event fee settings, with NO
-- payment wiring yet (that lands in Phase 2). Everything here is verifiable by
-- SQL alone.
--
-- Service fee = round(entry * pct_bps/10000) + flat_cents, capped at cap_cents.
-- Free events (entry 0) are charged nothing. Defaults 6% + $1.50, $20 cap, but
-- the rate/flat/cap are resolved per event → per organizer → global default so
-- they can be tuned later without code changes.
--
-- Authoritative fee math lives here in SQL; the TS mirror in shared-utils is for
-- display only and the server always recomputes at charge time.
-- ============================================


-- ============================================
-- ENUMS
-- ============================================

DO $$ BEGIN
    CREATE TYPE fee_payer_enum AS ENUM ('player_pays', 'organizer_absorbs');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE payout_timing_enum AS ENUM ('hold_until_event_end', 'pay_as_you_go');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE refund_policy_kind_enum AS ENUM ('full', 'partial', 'none');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ============================================
-- GLOBAL DEFAULT CONFIG (single row)
-- ============================================
-- Boolean-PK singleton: only one row (id = true) can ever exist.

CREATE TABLE IF NOT EXISTS public.platform_service_fee_default (
    id          boolean     PRIMARY KEY DEFAULT true,
    pct_bps     integer     NOT NULL DEFAULT 600,    -- 6.00%
    flat_cents  integer     NOT NULL DEFAULT 150,    -- $1.50
    cap_cents   integer     NOT NULL DEFAULT 2000,   -- $20.00
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT platform_service_fee_default_singleton CHECK (id),
    CONSTRAINT platform_service_fee_default_pct_range  CHECK (pct_bps BETWEEN 0 AND 10000),
    CONSTRAINT platform_service_fee_default_flat_pos   CHECK (flat_cents >= 0),
    CONSTRAINT platform_service_fee_default_cap_pos    CHECK (cap_cents >= 0)
);

COMMENT ON TABLE public.platform_service_fee_default IS 'Single-row global default service-fee parameters (6% + $1.50, $20 cap). Adjust to retune the platform-wide default.';

INSERT INTO public.platform_service_fee_default (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_service_fee_default ENABLE ROW LEVEL SECURITY;

-- Defaults are non-sensitive; any signed-in user may read them. Writes are
-- restricted to service_role / admin tooling (no write policy here).
DROP POLICY IF EXISTS psfd_read ON public.platform_service_fee_default;
CREATE POLICY psfd_read ON public.platform_service_fee_default
    FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.platform_service_fee_default FROM anon, authenticated;
GRANT SELECT ON public.platform_service_fee_default TO authenticated;


-- ============================================
-- PER-ORGANIZER OVERRIDE
-- ============================================
-- NULL column = fall through to the global default for that parameter.

CREATE TABLE IF NOT EXISTS public.organizer_fee_override (
    organizer_id uuid        PRIMARY KEY REFERENCES public.player(id) ON DELETE CASCADE,
    pct_bps      integer,
    flat_cents   integer,
    cap_cents    integer,
    note         text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT organizer_fee_override_pct_range CHECK (pct_bps IS NULL OR pct_bps BETWEEN 0 AND 10000),
    CONSTRAINT organizer_fee_override_flat_pos  CHECK (flat_cents IS NULL OR flat_cents >= 0),
    CONSTRAINT organizer_fee_override_cap_pos   CHECK (cap_cents IS NULL OR cap_cents >= 0)
);

COMMENT ON TABLE public.organizer_fee_override IS 'Optional per-organizer service-fee overrides. NULL parameter falls through to platform_service_fee_default. Managed by admin/ops; reads happen only via SECURITY DEFINER resolver, so the table is not exposed to authenticated.';

ALTER TABLE public.organizer_fee_override ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies and no grants to anon/authenticated: special deals
-- stay private. The resolver below reads it as SECURITY DEFINER.
REVOKE ALL ON public.organizer_fee_override FROM anon, authenticated;


-- ============================================
-- PER-EVENT FEE SETTINGS — tournaments
-- ============================================
ALTER TABLE public.tournaments
    ADD COLUMN IF NOT EXISTS entry_fee_cents         integer                 NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS currency                varchar(3)              NOT NULL DEFAULT 'CAD',
    ADD COLUMN IF NOT EXISTS fee_payer               fee_payer_enum          NOT NULL DEFAULT 'player_pays',
    ADD COLUMN IF NOT EXISTS payout_timing           payout_timing_enum      NOT NULL DEFAULT 'hold_until_event_end',
    ADD COLUMN IF NOT EXISTS refund_policy_kind      refund_policy_kind_enum NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS refund_partial_bps      integer,
    ADD COLUMN IF NOT EXISTS refund_cutoff_at        timestamptz,
    ADD COLUMN IF NOT EXISTS fee_pct_bps_override    integer,
    ADD COLUMN IF NOT EXISTS fee_flat_cents_override integer,
    ADD COLUMN IF NOT EXISTS fee_cap_cents_override  integer;

COMMENT ON COLUMN public.tournaments.entry_fee_cents IS 'Organizer-set entry price in cents (0 = free event, no service fee, no payment step). Currency in tournaments.currency.';
COMMENT ON COLUMN public.tournaments.fee_payer IS 'Who covers the service fee: player_pays (added on top) or organizer_absorbs (netted from earnings).';
COMMENT ON COLUMN public.tournaments.payout_timing IS 'hold_until_event_end (default; protects against cancellation clawback) or pay_as_you_go.';
COMMENT ON COLUMN public.tournaments.refund_partial_bps IS 'Percentage (basis points) of the entry price refunded when refund_policy_kind = partial.';
COMMENT ON COLUMN public.tournaments.fee_pct_bps_override IS 'Optional per-event service-fee override; NULL falls through to organizer/global default.';

-- Validity constraints (idempotent guards so re-application on a shadow DB is safe).
DO $$ BEGIN
    ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_entry_fee_pos CHECK (entry_fee_cents >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_refund_partial_range
        CHECK (refund_partial_bps IS NULL OR refund_partial_bps BETWEEN 0 AND 10000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A partial policy must specify a percentage; full/none must not.
DO $$ BEGIN
    ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_refund_partial_requires_bps
        CHECK (
            (refund_policy_kind = 'partial' AND refund_partial_bps IS NOT NULL)
            OR (refund_policy_kind <> 'partial' AND refund_partial_bps IS NULL)
        );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_fee_overrides_range CHECK (
        (fee_pct_bps_override   IS NULL OR fee_pct_bps_override   BETWEEN 0 AND 10000)
        AND (fee_flat_cents_override IS NULL OR fee_flat_cents_override >= 0)
        AND (fee_cap_cents_override  IS NULL OR fee_cap_cents_override  >= 0)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ============================================
-- FEE MATH — single source of truth
-- ============================================

-- Pure: service fee for an entry price given resolved parameters.
-- Free events (entry <= 0) pay nothing; otherwise 6%-style + flat, capped.
-- ROUND on numeric rounds half away from zero (= half-up for positive cents).
CREATE OR REPLACE FUNCTION public.compute_service_fee_cents(
    p_entry_cents integer,
    p_pct_bps     integer,
    p_flat_cents  integer,
    p_cap_cents   integer
) RETURNS integer
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE
        WHEN COALESCE(p_entry_cents, 0) <= 0 THEN 0
        ELSE LEAST(
            p_cap_cents,
            CAST(ROUND((p_entry_cents::numeric * p_pct_bps) / 10000.0) AS integer) + p_flat_cents
        )
    END;
$$;

COMMENT ON FUNCTION public.compute_service_fee_cents(integer, integer, integer, integer)
    IS 'Authoritative service-fee math: free → 0; else min(cap, round(entry*pct_bps/10000) + flat). The TS mirror is display-only.';

-- Resolve effective (pct_bps, flat_cents, cap_cents) for an organizer, allowing
-- per-event overrides to win, then per-organizer, then the global default.
-- SECURITY DEFINER so it can read organizer_fee_override (which has no
-- authenticated grants / RLS policies).
CREATE OR REPLACE FUNCTION public.resolve_service_fee_policy(
    p_organizer_id     uuid,
    p_event_pct_bps    integer DEFAULT NULL,
    p_event_flat_cents integer DEFAULT NULL,
    p_event_cap_cents  integer DEFAULT NULL
) RETURNS TABLE (pct_bps integer, flat_cents integer, cap_cents integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT
        COALESCE(p_event_pct_bps,    ofo.pct_bps,    d.pct_bps),
        COALESCE(p_event_flat_cents, ofo.flat_cents, d.flat_cents),
        COALESCE(p_event_cap_cents,  ofo.cap_cents,  d.cap_cents)
    FROM public.platform_service_fee_default d
    LEFT JOIN public.organizer_fee_override ofo ON ofo.organizer_id = p_organizer_id;
$$;

COMMENT ON FUNCTION public.resolve_service_fee_policy(uuid, integer, integer, integer)
    IS 'Effective fee parameters via COALESCE(event override, organizer override, global default).';

-- Player-facing quote for a tournament: the all-in numbers shown before paying.
CREATE OR REPLACE FUNCTION public.tournament_fee_quote(p_tournament_id uuid)
RETURNS TABLE (
    entry_cents              integer,
    service_fee_cents        integer,
    total_cents              integer,   -- what the player is charged
    organizer_receives_cents integer,
    fee_payer                fee_payer_enum,
    currency                 varchar,
    refund_policy_kind       refund_policy_kind_enum,
    refund_partial_bps       integer,
    refund_cutoff_at         timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    t   public.tournaments;
    pol record;
    fee integer;
BEGIN
    SELECT * INTO t FROM public.tournaments WHERE id = p_tournament_id;
    IF t.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;

    SELECT * INTO pol FROM public.resolve_service_fee_policy(
        t.organizer_id, t.fee_pct_bps_override, t.fee_flat_cents_override, t.fee_cap_cents_override
    );

    fee := public.compute_service_fee_cents(t.entry_fee_cents, pol.pct_bps, pol.flat_cents, pol.cap_cents);

    entry_cents       := t.entry_fee_cents;
    service_fee_cents := fee;
    IF t.fee_payer = 'player_pays' THEN
        total_cents              := t.entry_fee_cents + fee;
        organizer_receives_cents := t.entry_fee_cents;
    ELSE
        total_cents              := t.entry_fee_cents;
        organizer_receives_cents := GREATEST(t.entry_fee_cents - fee, 0);
    END IF;
    fee_payer          := t.fee_payer;
    currency           := t.currency;
    refund_policy_kind := t.refund_policy_kind;
    refund_partial_bps := t.refund_partial_bps;
    refund_cutoff_at   := t.refund_cutoff_at;
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.tournament_fee_quote(uuid)
    IS 'All-in price breakdown for a tournament registration (entry, service fee, total, organizer take, refund policy).';

GRANT EXECUTE ON FUNCTION public.compute_service_fee_cents(integer, integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_service_fee_policy(uuid, integer, integer, integer)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_fee_quote(uuid)                                     TO authenticated;
