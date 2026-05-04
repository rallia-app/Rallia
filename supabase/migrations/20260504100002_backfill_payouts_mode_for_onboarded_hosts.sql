-- Migration: Backfill player.payouts_mode for hosts who already onboarded with Stripe
--
-- Hosts who completed Stripe Connect Express onboarding before the JIT flow
-- shipped have already implicitly chosen "Stripe". Without this backfill they'd
-- be marked 'undecided' (the default) and would see the "How do you want to
-- handle reimbursements?" prompt unnecessarily on their next match.
-- ============================================================================

UPDATE player
   SET payouts_mode = 'auto'
 WHERE payouts_mode = 'undecided'
   AND id IN (
     SELECT player_id
       FROM player_stripe_account
      WHERE onboarding_completed = true
   );
