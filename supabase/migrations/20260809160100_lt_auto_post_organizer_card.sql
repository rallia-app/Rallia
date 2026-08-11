-- ============================================================================
-- Tournament round chats: auto-post the Match Organizer card
-- ============================================================================
-- Spec: specs/08-communications/match-organizer-live-suggestions.md §Auto-post
--
-- Measured on prod 2026-08-07: 11 playable round-3 matches stalled across the
-- five live Série 1 draws, ZERO organizer cards ever posted in their round
-- chats, while match_organizer_options returned 10 valid options for every
-- pairing (all-mutual for 9 of 11). The engine is fine; the card simply never
-- reaches players (its only entry point is a manually-opened sheet).
--
-- This migration makes the card arrive unprompted the moment a pairing becomes
-- real:
--   * lt_post_system_match_organizer_card(p_tm_id) — server-side poster.
--     Ensures the round chat exists (reuses the _unchecked helper built for
--     exactly this), snapshots engine options into a 'match_organizer' message,
--     one system card per chat (partial unique index), no pre-votes,
--     metadata.silent=true (the pairing already gets tournament_match_ready /
--     bracket_published pushes — no double notification).
--     Zero-overlap guard: if no option is free for ALL participants, the card
--     posts with options=[] and no_overlap=true instead of one-sided times.
--   * Hook rounds 2+: appended to lt_notify_tournament_match_ready (fires at
--     the moment a next-round pairing becomes determinate).
--   * Hook round 1: new trigger on tournaments registration_closed ->
--     in_progress (bracket publish), covering every playable pending match.
--   * Backfill: posts cards for playable pending matches of in_progress
--     tournaments — i.e. the 11 currently stalled prod pairs on deploy.
--
-- Tournament-only for this slice; league session pairing chats follow the same
-- pattern later. Card posting must never break bracket advancement: every hook
-- swallows poster errors with a WARNING.
-- ============================================================================


-- =====================
-- 1. One system card per conversation
-- =====================

CREATE UNIQUE INDEX IF NOT EXISTS message_system_organizer_card_unique
  ON message(conversation_id)
  WHERE message_type = 'match_organizer'
    AND (metadata->>'posted_by') = 'system'
    AND deleted_at IS NULL;


-- =====================
-- 2. Server-side poster
-- =====================

CREATE OR REPLACE FUNCTION public.lt_post_system_match_organizer_card(
    p_tournament_match_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tm           tournament_matches;
    v_t            tournaments;
    v_conv         uuid;
    v_existing     uuid;
    v_participants uuid[];
    v_n            int;
    v_sport_name   text;
    v_sender       uuid;
    v_options      jsonb;
    v_has_mutual   boolean;
    v_metadata     jsonb;
    v_content      text;
    v_msg          uuid;
BEGIN
    SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tournament_match_id;

    -- Only playable, still-unorganized pairings get a card.
    IF v_tm.id IS NULL
       OR v_tm.status <> 'pending'
       OR v_tm.player1_is_bye OR v_tm.player2_is_bye
       OR v_tm.player1_registration_id IS NULL
       OR v_tm.player2_registration_id IS NULL
       OR v_tm.match_id IS NOT NULL THEN
        RETURN NULL;
    END IF;

    v_conv := public.lt_get_or_create_tournament_round_chat_unchecked(p_tournament_match_id);
    IF v_conv IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT id INTO v_existing
      FROM message
     WHERE conversation_id = v_conv
       AND message_type = 'match_organizer'
       AND metadata->>'posted_by' = 'system'
       AND deleted_at IS NULL
     LIMIT 1;
    IF v_existing IS NOT NULL THEN
        RETURN v_existing;
    END IF;

    SELECT * INTO v_t FROM tournaments WHERE id = v_tm.tournament_id;
    -- Display casing ('Tennis'), matching what the client sheet snapshots.
    SELECT COALESCE(display_name, initcap(name)) INTO v_sport_name
      FROM sport WHERE id = v_t.sport_id;

    SELECT array_agg(DISTINCT u.uid) INTO v_participants
    FROM (
        SELECT unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) AS uid
        FROM tournament_registrations r
        WHERE r.id IN (v_tm.player1_registration_id, v_tm.player2_registration_id)
    ) u;
    v_n := COALESCE(array_length(v_participants, 1), 0);
    IF v_n < 2 THEN
        RETURN NULL;
    END IF;

    -- Snapshot mirrors the client poster's ordering: confirmed courts first,
    -- then chronological.
    SELECT jsonb_agg(jsonb_build_object(
               'slot_start',      o.slot_start,
               'day_label',       o.day_label,
               'hour_of_day',     o.hour_of_day,
               'facility_id',     o.facility_id,
               'facility_name',   o.facility_name,
               'court_name',      o.court_name,
               'court_count',     COALESCE(o.court_count, 0),
               'price_cents',     o.price_cents,
               'court_confirmed', o.court_confirmed,
               'tier',            CASE WHEN o.tier = 'bookable' THEN 'bookable' ELSE 'usually_free' END,
               'distance_km',     o.distance_km,
               'free_count',      o.free_count,
               'option_key',      o.option_key
           ) ORDER BY o.court_confirmed DESC, o.slot_start),
           bool_or(o.free_count >= v_n)
      INTO v_options, v_has_mutual
      FROM public.match_organizer_options(v_participants, v_t.sport_id, 14, 10) o;

    -- Zero-overlap guard: never post options only one side can make.
    IF v_options IS NULL OR v_has_mutual IS NOT TRUE THEN
        v_options := '[]'::jsonb;
    END IF;

    v_metadata := jsonb_build_object(
        'kind',                   'match_organizer',
        'tournament_match_id',    v_tm.id,
        'sport_id',               v_t.sport_id,
        'sport_name',             v_sport_name,
        'format',                 CASE WHEN v_t.entry_format = 'singles' THEN 'singles' ELSE 'doubles' END,
        'participant_ids',        to_jsonb(v_participants),
        'organizer_id',           NULL,
        'posted_by',              'system',
        'silent',                 true,
        'options',                v_options,
        'created_match_id',       NULL,
        'confirmed_option_index', NULL
    );
    -- Inbox preview text only (the card itself renders from metadata, and the
    -- card is silent so this never reaches a push). Bilingual because a single
    -- message row is shared by recipients who may differ in locale; a per-locale
    -- preview needs last_message_type on the inbox RPC (follow-up).
    IF v_options = '[]'::jsonb THEN
        v_metadata := v_metadata || jsonb_build_object('no_overlap', true);
        v_content  := 'Aucune plage commune · No shared times yet';
    ELSE
        v_content  := 'Suggestions d''heures pour jouer · Suggested times to play';
    END IF;

    -- Same system sender the court-booking prompt card uses ("Rallia"), so the
    -- inbox preview reads "Rallia: ..." instead of falsely attributing the card
    -- to whichever player happens to sit in slot 1. Falls back to player 1's
    -- user if the system player is absent (sender_id is NOT NULL).
    SELECT id INTO v_sender FROM player
     WHERE id = 'a11a0000-0000-4000-8000-000000000001'::uuid;
    IF v_sender IS NULL THEN
        SELECT user_id INTO v_sender
          FROM tournament_registrations WHERE id = v_tm.player1_registration_id;
    END IF;

    INSERT INTO message (conversation_id, sender_id, content, status, message_type, metadata)
    VALUES (v_conv, v_sender, v_content, 'sent', 'match_organizer', v_metadata)
    ON CONFLICT (conversation_id)
      WHERE message_type = 'match_organizer'
        AND (metadata->>'posted_by') = 'system'
        AND deleted_at IS NULL
      DO NOTHING
    RETURNING id INTO v_msg;

    IF v_msg IS NULL THEN
        SELECT id INTO v_msg
          FROM message
         WHERE conversation_id = v_conv
           AND message_type = 'match_organizer'
           AND metadata->>'posted_by' = 'system'
           AND deleted_at IS NULL
         LIMIT 1;
    END IF;

    RETURN v_msg;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lt_post_system_match_organizer_card(uuid) FROM anon, authenticated;

COMMENT ON FUNCTION public.lt_post_system_match_organizer_card(uuid) IS
    'Auto-posts the votable Match Organizer card into a tournament round chat (creating the chat if needed) when a pairing is playable. One system card per chat; no pre-votes; silent (no push). Zero-overlap pairs get an empty-options card with no_overlap=true. Spec: specs/08-communications/match-organizer-live-suggestions.md §Auto-post.';


-- =====================
-- 3. Rounds 2+: append to lt_notify_tournament_match_ready
-- =====================
-- Body verbatim from 20260628190100 with the guarded poster call appended.

CREATE OR REPLACE FUNCTION public.lt_notify_tournament_match_ready(p_tm_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tm     tournament_matches;
    v_t      tournaments;
    v_p1     text;
    v_p2     text;
    v_rows   jsonb;
BEGIN
    SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tm_id;
    -- Only when both sides are real, determinate players.
    IF v_tm.id IS NULL
       OR v_tm.player1_registration_id IS NULL
       OR v_tm.player2_registration_id IS NULL
       OR v_tm.player1_is_bye
       OR v_tm.player2_is_bye THEN
        RETURN;
    END IF;

    SELECT * INTO v_t FROM tournaments WHERE id = v_tm.tournament_id;
    v_p1 := public.lt_registration_display_name(v_tm.player1_registration_id);
    v_p2 := public.lt_registration_display_name(v_tm.player2_registration_id);

    SELECT jsonb_agg(jsonb_build_object(
        'user_id', mb.uid,
        'type', 'tournament_match_ready',
        'target_id', v_t.id,
        'title', CASE WHEN public.lt_user_is_fr(mb.uid)
                   THEN 'Ton prochain match est prêt' ELSE 'Your next match is set' END,
        'body', CASE WHEN public.lt_user_is_fr(mb.uid)
                  THEN v_t.name || ' : tour ' || v_tm.round_number || ' contre ' || mb.opp_name || '.'
                  ELSE v_t.name || ': round ' || v_tm.round_number || ' vs ' || mb.opp_name || '.'
                END,
        'payload', jsonb_build_object(
            'tournamentId', v_t.id,
            'tournamentName', v_t.name,
            'round', v_tm.round_number,
            'tournamentMatchId', v_tm.id
        ),
        'priority', 'normal'
    ))
    INTO v_rows
    FROM (
        SELECT unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) AS uid, v_p2 AS opp_name
        FROM tournament_registrations r WHERE r.id = v_tm.player1_registration_id
        UNION ALL
        SELECT unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) AS uid, v_p1 AS opp_name
        FROM tournament_registrations r WHERE r.id = v_tm.player2_registration_id
    ) mb;

    IF v_rows IS NOT NULL THEN
        PERFORM insert_notifications(v_rows);
    END IF;

    -- Auto-post the organizer card for the fresh pairing. Never let card
    -- posting break bracket advancement.
    BEGIN
        PERFORM public.lt_post_system_match_organizer_card(p_tm_id);
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'organizer card auto-post failed for tournament_match %: %', p_tm_id, SQLERRM;
    END;
END;
$$;


-- =====================
-- 4. Round 1: trigger on bracket publish
-- =====================

CREATE OR REPLACE FUNCTION public.lt_tournaments_post_organizer_cards_tg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tm_id uuid;
BEGIN
    FOR v_tm_id IN
        SELECT tm.id
          FROM tournament_matches tm
         WHERE tm.tournament_id = NEW.id
           AND tm.status = 'pending'
           AND NOT tm.player1_is_bye AND NOT tm.player2_is_bye
           AND tm.player1_registration_id IS NOT NULL
           AND tm.player2_registration_id IS NOT NULL
           AND tm.match_id IS NULL
    LOOP
        BEGIN
            PERFORM public.lt_post_system_match_organizer_card(v_tm_id);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'organizer card auto-post failed for tournament_match %: %', v_tm_id, SQLERRM;
        END;
    END LOOP;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tournaments_post_organizer_cards ON tournaments;
CREATE TRIGGER tournaments_post_organizer_cards
AFTER UPDATE OF status ON tournaments
FOR EACH ROW
WHEN (OLD.status = 'registration_closed' AND NEW.status = 'in_progress')
EXECUTE FUNCTION public.lt_tournaments_post_organizer_cards_tg();


-- =====================
-- 5. Backfill: currently stalled pairings of in-progress tournaments
-- =====================

DO $$
DECLARE
    v_tm_id uuid;
BEGIN
    FOR v_tm_id IN
        SELECT tm.id
          FROM tournament_matches tm
          JOIN tournaments t ON t.id = tm.tournament_id
         WHERE t.status = 'in_progress'
           AND tm.status = 'pending'
           AND NOT tm.player1_is_bye AND NOT tm.player2_is_bye
           AND tm.player1_registration_id IS NOT NULL
           AND tm.player2_registration_id IS NOT NULL
           AND tm.match_id IS NULL
    LOOP
        BEGIN
            PERFORM public.lt_post_system_match_organizer_card(v_tm_id);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'organizer card backfill failed for tournament_match %: %', v_tm_id, SQLERRM;
        END;
    END LOOP;
END;
$$;
