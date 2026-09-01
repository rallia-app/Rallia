-- ============================================================================
-- [JDL v5] fixture spec — one assertion per thing the guide asks Jean to do
-- ============================================================================
-- Written from the merged commits, not from the seed, so it can disagree with
-- the seed. Every guide instruction that depends on seeded state has a check
-- here; a green run means the guide is walkable, not merely that the seed ran.
--
-- Deliberately NOT covered, because SQL cannot see it:
--   * whether a price on a button matches the price on the sheet (A5)
--   * whether copy reads well (most "à valider" questions)
--   * the part B items that need no fixture (chips, share cards, takeover)
--
-- Run against whichever database holds the fixtures:
--   psql "$STAGING_DB_URL" -v tester_email=jdl.sonkin@gmail.com \
--     -f scripts/verify-jdl-v5-fixtures.sql
-- ============================================================================

\set ON_ERROR_STOP on

\if :{?tester_email}
\else
\set tester_email 'jdl.sonkin@gmail.com'
\endif

SELECT set_config('rallia.tester_email', :'tester_email', false);

DO $$
DECLARE
    v_jdl   uuid;
    v_t     uuid;
    v_n     integer;
    v_txt   text;
    v_tm    uuid;
    v_fee   integer;
    v_avail integer;
    v_ok    integer := 0;

    PROCEDURE_placeholder boolean;
BEGIN
    SELECT id INTO v_jdl FROM auth.users
     WHERE email = current_setting('rallia.tester_email');
    IF v_jdl IS NULL THEN
        RAISE EXCEPTION 'tester % not found', current_setting('rallia.tester_email');
    END IF;

    -- =====================================================================
    -- A1. Participant score entry            commits 5cfff979, df34c93c
    -- Guide: open the opponent chat, a banner offers to enter the score; the
    -- already-scored pairing shows no banner.
    -- =====================================================================
    SELECT id INTO v_t FROM tournaments WHERE name = '[JDL v5] Mon score';
    IF v_t IS NULL THEN RAISE EXCEPTION 'A1: [JDL v5] Mon score missing'; END IF;

    SELECT status::text INTO v_txt FROM tournaments WHERE id = v_t;
    IF v_txt <> 'in_progress' THEN
        RAISE EXCEPTION 'A1: the participant contract is live-event-only, status is %', v_txt;
    END IF;

    IF EXISTS (SELECT 1 FROM tournaments WHERE id = v_t AND organizer_id = v_jdl) THEN
        RAISE EXCEPTION 'A1: the tester organizes this event, so the guards under test are bypassed';
    END IF;

    -- Exactly one pairing that is pending, unlinked, has a chat, and that the
    -- server itself says he may score. lt_pairing_score_context is what the
    -- banner asks, so this is the real gate, not a proxy for it.
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_jdl::text)::text, true);
    SELECT count(*) INTO v_n
      FROM tournament_matches tm
      JOIN tournament_registrations r1 ON r1.id = tm.player1_registration_id
      JOIN tournament_registrations r2 ON r2.id = tm.player2_registration_id
     WHERE tm.tournament_id = v_t
       AND v_jdl IN (r1.user_id, r2.user_id)
       AND tm.status = 'pending' AND tm.match_id IS NULL
       AND EXISTS (SELECT 1 FROM conversation c WHERE c.tournament_match_id = tm.id)
       AND (public.lt_pairing_score_context(tm.id) ->> 'can_self_score')::boolean;
    IF v_n < 1 THEN
        RAISE EXCEPTION 'A1: no pairing where the banner can appear (chat + can_self_score)';
    END IF;

    -- The negative control, with a chat so its emptiness is visible.
    SELECT count(*) INTO v_n
      FROM tournament_matches tm
      JOIN tournament_registrations r1 ON r1.id = tm.player1_registration_id
      JOIN tournament_registrations r2 ON r2.id = tm.player2_registration_id
     WHERE tm.tournament_id = v_t
       AND v_jdl IN (r1.user_id, r2.user_id)
       AND tm.status = 'completed' AND tm.score IS NOT NULL
       AND EXISTS (SELECT 1 FROM conversation c WHERE c.tournament_match_id = tm.id)
       AND NOT (public.lt_pairing_score_context(tm.id) ->> 'can_self_score')::boolean;
    IF v_n < 1 THEN
        RAISE EXCEPTION 'A1: no scored control pairing with a chat';
    END IF;

    -- A chat he is not a member of never reaches his inbox, and the guide
    -- opens with "va dans Messages".
    SELECT count(*) INTO v_n
      FROM conversation c
      JOIN tournament_matches tm ON tm.id = c.tournament_match_id
     WHERE tm.tournament_id = v_t
       AND NOT EXISTS (SELECT 1 FROM conversation_participant cp
                        WHERE cp.conversation_id = c.id AND cp.player_id = v_jdl);
    IF v_n > 0 THEN
        RAISE EXCEPTION 'A1: % seeded chat(s) do not have the tester as a member', v_n;
    END IF;
    v_ok := v_ok + 1;

    -- =====================================================================
    -- A2. The doubles reputation carve-out                commit 77776ec2
    -- Guide: the pair loses, and the tester carries NO penalty from it.
    -- =====================================================================
    SELECT id INTO v_t FROM tournaments WHERE name = '[JDL v5] Le double';
    IF v_t IS NULL THEN RAISE EXCEPTION 'A2: [JDL v5] Le double missing'; END IF;

    SELECT entry_format::text INTO v_txt FROM tournaments WHERE id = v_t;
    IF v_txt <> 'doubles' THEN
        RAISE EXCEPTION 'A2: the point is doubles, entry_format is %', v_txt;
    END IF;

    -- The tester's side actually lost something, or there is nothing to mark.
    SELECT count(*) INTO v_n
      FROM tournament_matches tm
      JOIN tournament_registrations r1 ON r1.id = tm.player1_registration_id
      JOIN tournament_registrations r2 ON r2.id = tm.player2_registration_id
     WHERE tm.tournament_id = v_t AND tm.status = 'walkover'
       AND v_jdl IN (r1.user_id, r1.partner_user_id, r2.user_id, r2.partner_user_id);
    -- The guide says "tes trois confrontations", so three is the contract, not
    -- "at least one".
    IF v_n <> 3 THEN
        RAISE EXCEPTION 'A2: the guide states three lost pairings, the ladder produced %', v_n;
    END IF;

    -- Somebody was marked...
    SELECT count(*) INTO v_n FROM reputation_event
     WHERE (metadata ->> 'tournamentId')::uuid = v_t;
    IF v_n = 0 THEN
        RAISE EXCEPTION 'A2: no reputation mark at all, so the carve-out is untested';
    END IF;

    -- ...and it was not him.
    SELECT count(*) INTO v_n FROM reputation_event
     WHERE (metadata ->> 'tournamentId')::uuid = v_t AND player_id = v_jdl;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'A2: the tester took % marks for his partner''s silence', v_n;
    END IF;

    -- The mark has to reach the store the profile reads, not just the event
    -- log: replica mode suppresses the roll-up trigger, so the seed has to
    -- recalculate explicitly. Probed on total_events rather than updated_at,
    -- which is itself trigger-maintained and therefore also frozen here.
    SELECT count(*) INTO v_n
      FROM (SELECT re.player_id, count(*) AS logged
              FROM reputation_event re
             WHERE re.player_id IN (SELECT player_id FROM reputation_event
                                     WHERE (metadata ->> 'tournamentId')::uuid = v_t)
             GROUP BY re.player_id) l
      JOIN player_reputation pr ON pr.player_id = l.player_id
     WHERE pr.total_events <> l.logged;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'A2: player_reputation is stale for % marked player(s), so the profile shows the old score', v_n;
    END IF;
    v_ok := v_ok + 1;

    -- =====================================================================
    -- A3. Check-in without a court                        commit 2e205bbe
    -- Guide: three games, window OPEN, one of each location kind.
    -- The app offers check-in only when the game is full, the window is open,
    -- and location_type is facility or custom (MatchDetailSheet).
    -- =====================================================================
    SELECT count(*) INTO v_n FROM match WHERE notes LIKE '[JDL v5] présence%';
    IF v_n <> 3 THEN RAISE EXCEPTION 'A3: expected 3 présence games, found %', v_n; END IF;

    FOR v_txt IN SELECT location_type::text FROM match
                  WHERE notes LIKE '[JDL v5] présence%' LOOP
        NULL;
    END LOOP;
    SELECT count(DISTINCT location_type) INTO v_n FROM match
     WHERE notes LIKE '[JDL v5] présence%';
    IF v_n <> 3 THEN
        RAISE EXCEPTION 'A3: the three games must be facility / custom / tbd, found % kinds', v_n;
    END IF;

    -- Every one of them must be inside the check-in window RIGHT NOW, full,
    -- and have the tester joined. This is the check that would have caught the
    -- first version, where the games started 75 minutes out and no button ever
    -- appeared.
    SELECT count(*) INTO v_n
      FROM match m
     WHERE m.notes LIKE '[JDL v5] présence%'
       AND ((m.match_date + m.start_time) AT TIME ZONE m.timezone) - now() <= interval '10 minutes'
       AND ((m.match_date + m.end_time)   AT TIME ZONE m.timezone) > now()
       AND (SELECT count(*) FROM match_participant mp
             WHERE mp.match_id = m.id AND mp.status = 'joined') = 2
       AND EXISTS (SELECT 1 FROM match_participant mp
                    WHERE mp.match_id = m.id AND mp.player_id = v_jdl AND mp.status = 'joined');
    IF v_n <> 3 THEN
        RAISE EXCEPTION 'A3: only % of 3 games are full, joined and inside the check-in window (same-day fixture: reseed)', v_n;
    END IF;

    -- The 'custom' one is the reachable no-coordinates case, so it must have
    -- no coordinates, or it is just another geofenced game.
    IF NOT EXISTS (SELECT 1 FROM match
                    WHERE notes LIKE '[JDL v5] présence%'
                      AND location_type = 'custom'
                      AND custom_latitude IS NULL AND custom_longitude IS NULL) THEN
        RAISE EXCEPTION 'A3: the custom game has coordinates, so it does not exercise self-declared presence';
    END IF;
    v_ok := v_ok + 1;

    -- =====================================================================
    -- A4. Recurring games      commits a2af7f09, dab5a2c8, 3dc720d5, d805c6f8
    -- Guide: next occurrence already exists unbooked with him alone in it, a
    -- court-open alert arrived for it, and a second series is live to stop.
    -- =====================================================================
    SELECT m.id INTO v_tm
      FROM match m
      JOIN match_recurrence r ON r.id = m.recurrence_id
     WHERE m.notes LIKE '[JDL v5] récurrente · la suivante%'
       AND m.id <> r.template_match_id
     ORDER BY m.match_date DESC LIMIT 1;
    IF v_tm IS NULL THEN
        RAISE EXCEPTION 'A4: the generator produced no next occurrence';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM match WHERE id = v_tm
                    AND court_status IS DISTINCT FROM 'reserved'::court_status_enum
                    AND ((match_date + start_time) AT TIME ZONE timezone) > now()) THEN
        RAISE EXCEPTION 'A4: the next occurrence is booked or already in the past';
    END IF;

    SELECT count(*) INTO v_n FROM match_participant WHERE match_id = v_tm;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'A4: the occurrence should be an open shell with the host alone, found % participants', v_n;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM notification
                    WHERE user_id = v_jdl AND type = 'recurring_court_opened'
                      AND target_id = v_tm) THEN
        RAISE EXCEPTION 'A4: no court-open alert for the generated occurrence';
    END IF;

    -- The second series must still be running, or there is nothing to stop.
    IF NOT EXISTS (
        SELECT 1 FROM match m
          JOIN match_recurrence r ON r.id = m.recurrence_id
         WHERE m.notes LIKE '[JDL v5] récurrente · à arrêter%'
           AND r.stopped_at IS NULL
           AND ((m.match_date + m.start_time) AT TIME ZONE m.timezone) > now()) THEN
        RAISE EXCEPTION 'A4: no live future series for the cancel dialog to offer stopping';
    END IF;
    v_ok := v_ok + 1;

    -- =====================================================================
    -- A5. The referral credit                       the referral commit set
    -- Guide: one event the credit covers exactly, one it covers partly.
    -- =====================================================================
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_jdl::text)::text, true);
    v_avail := public.player_credit_available_cents(v_jdl);
    IF v_avail <= 0 THEN RAISE EXCEPTION 'A5: the tester holds no spendable credit'; END IF;

    SELECT entry_fee_cents INTO v_fee FROM tournaments WHERE name = '[JDL v5] Crédit · couvert';
    IF v_fee IS NULL THEN RAISE EXCEPTION 'A5: the fully-covered event is missing'; END IF;
    IF v_fee <> v_avail THEN
        RAISE EXCEPTION 'A5: fully-covered event costs % but the credit is %, so it is not fully covered',
                        v_fee, v_avail;
    END IF;

    SELECT entry_fee_cents INTO v_fee FROM tournaments WHERE name = '[JDL v5] Crédit · partiel';
    IF v_fee IS NULL THEN RAISE EXCEPTION 'A5: the partially-covered event is missing'; END IF;
    IF v_fee <= v_avail THEN
        RAISE EXCEPTION 'A5: partial event costs % but the credit is %, so a card is never needed',
                        v_fee, v_avail;
    END IF;

    -- Both must be house events, or a redemption tops up an organizer payout
    -- instead of discounting Rallia's own revenue.
    SELECT count(*) INTO v_n
      FROM tournaments t JOIN profile p ON p.id = t.organizer_id
     WHERE t.name LIKE '[JDL v5] Crédit%' AND p.is_house_organizer
       AND t.status = 'registration_open';
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'A5: expected 2 open house events, found %', v_n;
    END IF;
    v_ok := v_ok + 1;

    -- =====================================================================
    -- A6. The invite reminder                             commit f7134033
    -- Every clause of send_pending_invite_reminders, restated here so the
    -- fixture is checked against the sender rather than against itself.
    -- =====================================================================
    SELECT count(*) INTO v_n
      FROM match_participant mp
      JOIN match mt ON mt.id = mp.match_id
      LEFT JOIN facility f ON f.id = mt.facility_id
     WHERE mt.notes LIKE '[JDL v5] invitation%'
       AND mp.player_id = v_jdl
       AND mp.status = 'pending'
       AND mp.is_host = false
       AND mp.requested_at IS NULL
       AND mp.expired_at IS NULL
       AND mt.cancelled_at IS NULL
       AND COALESCE(mt.is_auto_generated, false) = false
       AND mp.created_at < now() - interval '1 hour'
       AND ((mt.match_date + COALESCE(mt.start_time, '23:59'::time))
              AT TIME ZONE COALESCE(f.timezone, mt.timezone, 'America/Toronto'))
           BETWEEN now() + interval '2 hours' AND now() + interval '6 hours';
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'A6: the invite does not satisfy the reminder predicate (same-day fixture: reseed)';
    END IF;

    -- The reminder fires once ever. Having fired is SUCCESS, not staleness, so
    -- this reports which side of it we are on rather than failing: the cron
    -- runs every 15 minutes and would otherwise turn a working fixture red.
    IF EXISTS (SELECT 1 FROM notification n
                JOIN match mt ON mt.id = n.target_id
               WHERE mt.notes LIKE '[JDL v5] invitation%'
                 AND n.user_id = v_jdl AND n.type = 'match_invitation'
                 AND n.payload ->> 'isReminder' = 'true') THEN
        RAISE NOTICE 'A6: the reminder has already been sent, look for it in his notifications';
    ELSE
        RAISE NOTICE 'A6: the reminder has not fired yet, it is due within 15 minutes';
    END IF;
    v_ok := v_ok + 1;

    -- =====================================================================
    -- B2. The "Pour toi" preset                           commit 2b9f6723
    -- Exact rating + an open spot + (travel range OR favourite facility).
    -- =====================================================================
    IF NOT EXISTS (
        SELECT 1 FROM match m
          JOIN player_sport ps ON ps.player_id = v_jdl AND ps.sport_id = m.sport_id
         WHERE m.notes LIKE '[JDL v5] pour toi%'
           AND m.visibility = 'public'
           AND m.cancelled_at IS NULL
           AND m.min_rating_score_id = ps.active_rating_score_id
           AND EXISTS (SELECT 1 FROM player_favorite_facility f
                        WHERE f.player_id = v_jdl AND f.facility_id = m.facility_id)
           AND (SELECT count(*) FROM match_participant mp
                 WHERE mp.match_id = m.id AND mp.status = 'joined') < 2) THEN
        RAISE EXCEPTION 'B2: no public game matches the preset, so the filter can only be judged on an empty feed';
    END IF;
    v_ok := v_ok + 1;

    -- =====================================================================
    -- Part B items that depend on the [JDL v4] set being present
    -- B6 (cancel releases the pairing), B7 (reopen the gate), B8 (pool rooms)
    -- =====================================================================
    IF NOT EXISTS (SELECT 1 FROM tournaments WHERE name LIKE '[JDL v4]%') THEN
        RAISE EXCEPTION 'B: sections 6, 7 and 8 walk the [JDL v4] set, which is not seeded here';
    END IF;

    -- B6 needs a booked, linked game to cancel.
    IF NOT EXISTS (
        SELECT 1 FROM tournament_matches tm
          JOIN tournaments t ON t.id = tm.tournament_id AND t.name LIKE '[JDL v4] L%entente%'
          JOIN lt_pairing_booking b ON b.tournament_match_id = tm.id
         WHERE tm.match_id IS NOT NULL) THEN
        RAISE EXCEPTION 'B6: no booked linked game in L''entente to cancel';
    END IF;

    -- B7 needs an existing gate answer whose phase window is still open, and
    -- the guide names the event. Le parcours is deliberately the one he has NOT
    -- answered, so this must be checked on the event the guide actually sends
    -- him to, not on "any [JDL v4] event".
    IF NOT EXISTS (
        SELECT 1 FROM tournament_phase_availability a
          JOIN tournaments t ON t.id = a.tournament_id AND t.name LIKE '[JDL v4] L%entente%'
          JOIN tournament_round_deadlines d
            ON d.tournament_id = a.tournament_id AND d.bracket_side = a.bracket_side
           AND d.round_number = a.round_number
         WHERE a.player_id = v_jdl AND d.deadline_at > now()) THEN
        RAISE EXCEPTION 'B7: the tester has no open-phase gate answer in L''entente, so "Modifier mes dispos" cannot appear there';
    END IF;

    -- B8 needs a tournament with at least two pool rooms.
    SELECT count(*) INTO v_n FROM (
        SELECT c.tournament_id FROM conversation c
          JOIN tournaments t ON t.id = c.tournament_id AND t.name LIKE '[JDL v4]%'
         WHERE c.tournament_pool_number IS NOT NULL
         GROUP BY c.tournament_id HAVING count(*) >= 2) s;
    IF v_n = 0 THEN
        RAISE EXCEPTION 'B8: no [JDL v4] tournament has two pool rooms to tell apart';
    END IF;
    v_ok := v_ok + 1;

    -- B4 (his own pool row reads as an action), B5 (the whole slate, not one
    -- game) and B9 (the events rail on Home) all rest on one precondition: he
    -- is a registered player with more than one unplayed pool pairing in a live
    -- event. Asserted once rather than three times.
    SELECT count(*) INTO v_n
      FROM tournament_matches tm
      JOIN tournaments t ON t.id = tm.tournament_id
                        AND t.name = '[JDL v5] Mon score' AND t.status = 'in_progress'
      JOIN tournament_registrations r1 ON r1.id = tm.player1_registration_id
      JOIN tournament_registrations r2 ON r2.id = tm.player2_registration_id
     WHERE tm.bracket_side = 'pool' AND tm.status = 'pending'
       AND v_jdl IN (r1.user_id, r2.user_id);
    IF v_n < 2 THEN
        RAISE EXCEPTION 'B4/B5/B9: the tester has only % unplayed pool pairing(s); the slate and the CTA need more than one', v_n;
    END IF;
    v_ok := v_ok + 1;

    -- B10 walks four league states (paused, open season with no session, with a
    -- draft session, an unanswered published one). They belong to the [JDL v3]
    -- set, not to this one, so their absence is reported rather than fatal.
    IF NOT EXISTS (SELECT 1 FROM leagues WHERE name LIKE '[JDL v3]%') THEN
        RAISE WARNING 'B10: no [JDL v3] leagues here, so the docked-CTA league states cannot be walked';
    END IF;

    RAISE NOTICE 'ALL % FIXTURE GROUPS VERIFIED for %', v_ok, current_setting('rallia.tester_email');
END;
$$;
