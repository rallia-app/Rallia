-- ============================================================================
-- A prize that scales with the field has to say so where the player looks
-- ----------------------------------------------------------------------------
-- 20260814160000 made the Série 2 bourse explicitly pro-rata in the rules and
-- the description, but `prize_money_cents` is a single number and the app
-- renders it three times with no nuance: the gold pill on every discovery
-- card, the same pill on the detail hero, and the "Bourse" row in the spec
-- sheet. A player can register off the pill alone, having never opened the
-- rules, and reasonably believe 250 $ is guaranteed. It is not: the pool
-- follows paid entries, and pool_knockout will run a field of 8.
--
-- `prize_money_cents` stays the CEILING (a full 32-player draw), which is what
-- it has always meant and what the pro-rata formula is expressed against.
-- This flag only changes how it is READ: false renders "250 $", true renders
-- "jusqu'à 250 $". Nothing computes payouts from either column — settlement is
-- manual — so this is presentation, deliberately.
--
-- Default false: every existing tournament advertised a flat prize and keeps
-- doing so. Only the Série 2 draws flip.
-- ============================================================================

ALTER TABLE public.tournaments
    ADD COLUMN IF NOT EXISTS prize_is_prorated boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tournaments.prize_is_prorated IS
  'True when prize_money_cents is a ceiling that scales with the number of '
  'paid entries rather than a guaranteed amount. Presentation only: the client '
  'prefixes the figure with "up to" / "jusqu''à". Payout settlement is manual.';

UPDATE public.tournaments
   SET prize_is_prorated = true,
       updated_at        = now()
 WHERE name LIKE 'Série 2 Montréal · Tennis ·%'
   AND prize_is_prorated = false;
