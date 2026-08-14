-- Targeted reset for Jean's receipt/breakdown retest (staging, 2026-08-09).
-- Ran via MCP execute_sql on ahbaeewecdeguxtxtvhr after his Phase 2 pass.
--
-- Scope: ONLY the two fixtures his retest re-pays. Everything else from the
-- full protocol stays as his pass left it: Stripe onboarding, the published
-- draft, the cancelled [PAYE2E] 6, the league section he hasn't started.
--
--   [PAYUI-JDL] LIVE register + pay     his 4.1 payment + 4.3 refund erased
--                                        -> "pas inscrit"
--   [PAYUI] Organizer absorbs — pay      he played 4.2 on the DEMO tester's
--   entry only (the demo mirror)         mirror by mistake; evicted so Alex's
--                                        start state is whole again. His own
--                                        [PAYUI-JDL] absorbs was never touched.
--
-- The sandbox charges stay at Stripe, which nothing reads.

SET session_replication_role = replica;

DO $$
DECLARE
  v_jdl    uuid := '82928ca5-7406-4cf2-984f-957fce8a2d96';
  v_live   uuid := 'bbbb0000-0000-0000-0000-0000000000b6';
  v_mirror uuid;
  v_n int;
BEGIN
  SELECT id INTO v_mirror FROM tournaments WHERE name = '[PAYUI] Organizer absorbs — pay entry only';
  IF v_mirror IS NULL THEN
    RAISE EXCEPTION 'mirror fixture not found by name';
  END IF;

  -- Sanity: his own absorbs fixture must be untouched (no row of his).
  SELECT count(*) INTO v_n FROM tournament_registrations r
  JOIN tournaments t ON t.id = r.tournament_id
  WHERE t.name = '[PAYUI-JDL] Organizer absorbs (pay entry only)' AND r.user_id = v_jdl;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'unexpected registration on his own absorbs fixture: %', v_n;
  END IF;

  DELETE FROM lt_registration_payment
  WHERE tournament_registration_id IN (
    SELECT id FROM tournament_registrations WHERE tournament_id = v_live AND user_id = v_jdl
  );
  DELETE FROM tournament_registrations WHERE tournament_id = v_live AND user_id = v_jdl;

  DELETE FROM lt_registration_payment
  WHERE tournament_registration_id IN (
    SELECT id FROM tournament_registrations WHERE tournament_id = v_mirror AND user_id = v_jdl
  );
  DELETE FROM tournament_registrations WHERE tournament_id = v_mirror AND user_id = v_jdl;
END $$;

SET session_replication_role = DEFAULT;
