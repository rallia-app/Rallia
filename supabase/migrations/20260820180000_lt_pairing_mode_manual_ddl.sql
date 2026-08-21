-- ============================================
-- Leagues — a manual pairing mode (DDL)
-- ============================================
-- From Jean's league test review, section 3.4: « dans les options de pairage,
-- l'organisateur doit toujours avoir le choix d'un pairage 100% manuel ».
--
-- The generator now leaves the sheet in draft (20260820170000) and
-- session_swap_player trades two players inside a round, and any arrangement
-- is reachable by repeated trades. What was missing is a way to tell the
-- system to stop arranging: every existing mode imposes an opinion (ranking,
-- shuffle, least-met) that the organizer then has to undo pairing by pairing.
--
-- 'manual' is that instruction. The companion migration teaches
-- lt_run_session_sheet what it means; the value lands alone here because a
-- freshly added enum value cannot be used in the same transaction.
-- ============================================

ALTER TYPE pairing_mode ADD VALUE IF NOT EXISTS 'manual';
