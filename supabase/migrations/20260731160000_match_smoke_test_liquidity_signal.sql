-- /find-a-match smoke test (Slice): the funnel now shows a SIMULATED liquidity
-- signal ("X compatible players, ~Y% chance") before the contact ask, disclosed
-- on the reveal screen. Store what each lead was shown so payment intent can be
-- analyzed against the numbers that induced it. Values are deterministic from
-- the visitor's inputs; null on leads captured before funnel v3.1.

ALTER TABLE match_smoke_test_lead
    ADD COLUMN IF NOT EXISTS liquidity_players_shown INTEGER,
    ADD COLUMN IF NOT EXISTS liquidity_pct_shown INTEGER;
