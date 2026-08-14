-- ============================================================================
-- The pill is a promise to ONE player, so it must show one player's ceiling
-- ----------------------------------------------------------------------------
-- 20260814170000 qualified the prize pill as "jusqu'à 250 $". That is worse
-- than the bare number it replaced: 250 $ is the POOL, split 60/28/12, and no
-- single player can ever win it. A bare "250 $" beside a trophy was ambiguous;
-- "jusqu'à 250 $" actively states a ceiling that is off by 100 $.
--
-- The champion's ceiling on the Série 2 grid is 60 % of the pool = 150 $.
--
-- prize_top_share_bps is the champion's cut in basis points. NULL keeps the
-- old meaning — winner takes all, so the champion's ceiling IS the pool — so
-- every existing tournament renders exactly as before. It is a share rather
-- than a second amount so the pool stays the single source of truth: when the
-- pool prorates with the field, the champion's figure follows automatically
-- instead of drifting out of sync.
--
-- Where each number belongs:
--   * the pill (trophy icon, no label) answers "what could I win" -> champion
--   * the spec sheet's "Bourse" row is labelled as the pool -> pool
-- The rules already spell out the 60/28/12 split, so the two reconcile.
-- ============================================================================

ALTER TABLE public.tournaments
    ADD COLUMN IF NOT EXISTS prize_top_share_bps integer
        CHECK (prize_top_share_bps IS NULL
               OR (prize_top_share_bps > 0 AND prize_top_share_bps <= 10000));

COMMENT ON COLUMN public.tournaments.prize_top_share_bps IS
  'Champion''s cut of prize_money_cents, in basis points (6000 = 60%). NULL '
  'means winner-takes-all, so the champion''s ceiling is the whole pool. Used '
  'to render what a single player can win; payout settlement is manual.';

-- Série 2 grid, from the plan doc: 60 % champion, 28 % finalist, 12 % split
-- between the two semi-finalists.
UPDATE public.tournaments
   SET prize_top_share_bps = 6000,
       updated_at          = now()
 WHERE name LIKE 'Série 2 Montréal · Tennis ·%'
   AND prize_top_share_bps IS DISTINCT FROM 6000;
