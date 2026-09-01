-- ============================================================================
-- The card records whether it was generated under the funnel.
-- ============================================================================
-- The client has to know whether a mutual slot books in one tap (the funnel)
-- or still collects two thumbs, and it could not find out: a round chat is
-- conversation_type 'match' with tournament_id NULL, carrying only
-- tournament_match_id, so there was no cheap path from the card to its event's
-- flag. Found by opening a funnel pairing's card in the simulator and getting
-- thumbs where the one tap belonged.
--
-- Rather than have the client walk pairing -> tournament on every card, the
-- writers stamp 'funnel' into the metadata. That is the honest home for it:
-- the card is a snapshot of what the engine offered, and whether those options
-- came from the phase snapshots is a fact about that snapshot. An old card
-- keeps its meaning if the event's flag is flipped afterwards.
--
-- Both bodies re-issued from 20260829180000, verified byte-identical against
-- the live local definitions before editing; the only change is the added key.
-- ============================================================================

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

    -- Snapshot is CHRONOLOGICAL. A player scans this like a calendar, so a
    -- bookable court on the 18th must not jump above free hours on the 14th;
    -- the court chip already makes the bookable one stand out where it belongs.
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
               'court_state',     o.court_state,
               'fav_count',       o.fav_count,
               'tier',            CASE WHEN o.tier = 'bookable' THEN 'bookable' ELSE 'usually_free' END,
               'distance_km',     o.distance_km,
               'free_count',      o.free_count,
               'option_key',      o.option_key
           ) ORDER BY o.slot_start),
           bool_or(o.free_count >= v_n)
      INTO v_options, v_has_mutual
      FROM public.match_organizer_options(v_participants, v_t.sport_id, 14, 10,
                                         public.lt_phase_grid_avail(v_tm.id)) o;

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
        -- Whether these options came from the phase snapshots. It is a property
        -- of the snapshot, not of the event's flag today: an old card keeps its
        -- meaning if the flag is flipped later, and the client needs no second
        -- read to know whether a mutual slot books in one tap.
        'funnel',                 COALESCE(v_t.scheduling_funnel_enabled, false),
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

CREATE OR REPLACE FUNCTION public.lt_regenerate_system_organizer_card(
    p_tournament_match_id uuid,
    p_actor_id            uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tm            tournament_matches;
    v_t             tournaments;
    v_conv          uuid;
    v_msg           uuid;
    v_meta          jsonb;
    v_participants  uuid[];
    v_n             int;
    v_old_keys      text[];
    v_new_options   jsonb;
    v_final         jsonb;
    v_pinned        jsonb;
    v_has_mutual    boolean;
    v_actor_name    text;
    v_changed       boolean;
    v_vote_snapshot jsonb;
BEGIN
    SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tournament_match_id;
    IF v_tm.id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT c.id INTO v_conv FROM conversation c
     WHERE c.tournament_match_id = p_tournament_match_id;
    IF v_conv IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT m.id, m.metadata INTO v_msg, v_meta
      FROM message m
     WHERE m.conversation_id = v_conv
       AND m.message_type = 'match_organizer'
       AND m.metadata->>'posted_by' = 'system'
       AND m.deleted_at IS NULL
     LIMIT 1;
    IF v_msg IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT array_agg(value::uuid) INTO v_participants
      FROM jsonb_array_elements_text(v_meta->'participant_ids');
    v_n := COALESCE(array_length(v_participants, 1), 0);
    IF v_n < 2 THEN
        RETURN v_msg;
    END IF;

    -- Authorization before anything else: a non-participant must be rejected
    -- outright, not silently no-op'd by a later early return.
    IF p_actor_id IS NOT NULL AND NOT (p_actor_id = ANY(v_participants)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_A_PARTICIPANT';
    END IF;

    -- Never rewrite a card that already produced a game.
    IF COALESCE(v_meta->>'created_match_id', '') <> ''
       OR COALESCE(v_meta->>'confirmed_option_index', '') <> '' THEN
        RETURN v_msg;
    END IF;

    SELECT * INTO v_t FROM tournaments WHERE id = v_tm.tournament_id;

    -- option_key by old positional index (1-based array, 0-based option_index).
    SELECT array_agg(o->>'option_key' ORDER BY ord)
      INTO v_old_keys
      FROM jsonb_array_elements(v_meta->'options') WITH ORDINALITY AS x(o, ord);

    -- Fresh engine run, same shape and chronological order as the poster.
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
               'court_state',     o.court_state,
               'fav_count',       o.fav_count,
               'tier',            CASE WHEN o.tier = 'bookable' THEN 'bookable' ELSE 'usually_free' END,
               'distance_km',     o.distance_km,
               'free_count',      o.free_count,
               'option_key',      o.option_key
           ) ORDER BY o.slot_start),
           bool_or(o.free_count >= v_n)
      INTO v_new_options, v_has_mutual
      FROM public.match_organizer_options(v_participants, v_t.sport_id, 14, 10,
                                         public.lt_phase_grid_avail(v_tm.id)) o;

    IF v_new_options IS NULL OR v_has_mutual IS NOT TRUE THEN
        v_new_options := '[]'::jsonb;
    END IF;

    -- Pin the two kinds of option a fresh engine run cannot reproduce:
    --   * a VOTED option the engine no longer returns, flagged stale, so
    --     nobody's agreement silently disappears (someone booked that court);
    --   * every CUSTOM option, which a human proposed and the engine never
    --     emits, voted or not. Without this a refresh deletes the one option a
    --     zero-overlap pair actually agreed on.
    SELECT COALESCE(jsonb_agg(pinned ORDER BY ord), '[]'::jsonb)
      INTO v_pinned
      FROM (
        SELECT DISTINCT ON (o->>'option_key')
               CASE WHEN o->>'tier' = 'custom'
                      THEN o
                    ELSE o || jsonb_build_object('stale', true)
               END AS pinned,
               ord
          FROM jsonb_array_elements(v_meta->'options') WITH ORDINALITY AS x(o, ord)
         WHERE (
                 o->>'tier' = 'custom'
                 OR EXISTS (
                      SELECT 1 FROM match_time_vote v
                       WHERE v.message_id = v_msg
                         AND v.option_index = (ord - 1)
                    )
               )
           AND NOT EXISTS (
                 SELECT 1 FROM jsonb_array_elements(v_new_options) n
                  WHERE n->>'option_key' = o->>'option_key'
               )
         ORDER BY o->>'option_key', ord
      ) s;

    -- Merge pinned options in by DATE rather than appending them, or a custom
    -- proposal for tomorrow sits under engine slots two weeks out. Safe to
    -- reorder here because the vote re-anchoring below maps option_key onto
    -- whatever index each option ends up at.
    SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'slot_start')::timestamptz), '[]'::jsonb)
      INTO v_final
      FROM jsonb_array_elements(v_new_options || v_pinned) e;

    -- Re-anchor votes: capture (player, option_key), wipe, re-insert at the new
    -- index for the same key. Keys absent from v_final cannot occur (voted keys
    -- are pinned above), but the join drops them defensively rather than
    -- re-pointing them at an unrelated slot.
    --
    -- Three separate statements on purpose. Doing the DELETE as a data-modifying
    -- CTE of the INSERT loses every vote: both see the same snapshot, so
    -- re-inserting (message, player, index) collides with the row being deleted
    -- in that same command and ON CONFLICT DO NOTHING silently drops it.
    SELECT COALESCE(
             jsonb_agg(jsonb_build_object('p', v.player_id,
                                          'k', v_old_keys[v.option_index + 1])),
             '[]'::jsonb)
      INTO v_vote_snapshot
      FROM match_time_vote v
     WHERE v.message_id = v_msg;

    DELETE FROM match_time_vote WHERE message_id = v_msg;

    INSERT INTO match_time_vote (message_id, player_id, option_index)
    SELECT DISTINCT v_msg, (e->>'p')::uuid, ni.idx
      FROM jsonb_array_elements(v_vote_snapshot) e
      JOIN (
            SELECT n->>'option_key' AS okey, (ord - 1)::smallint AS idx
              FROM jsonb_array_elements(v_final) WITH ORDINALITY AS y(n, ord)
           ) ni ON ni.okey = e->>'k'
     WHERE e->>'k' IS NOT NULL
    ON CONFLICT DO NOTHING;

    v_changed := (COALESCE(v_meta->'options', '[]'::jsonb) <> v_final);

    v_meta := v_meta
            - 'no_overlap'
            || jsonb_build_object(
                 'options',              v_final,
                 'options_generated_at', to_jsonb(now()),
                 'funnel',               COALESCE(v_t.scheduling_funnel_enabled, false)
               );
    IF jsonb_array_length(v_final) = 0 THEN
        v_meta := v_meta || jsonb_build_object('no_overlap', true);
    END IF;

    UPDATE message
       SET metadata   = v_meta,
           content    = CASE WHEN jsonb_array_length(v_final) = 0
                          THEN 'Aucune plage commune · No shared times yet'
                          ELSE 'Suggestions d''heures pour jouer · Suggested times to play'
                        END,
           updated_at = now()
     WHERE id = v_msg;

    -- Tell the thread why the card changed. A silent swap reads as a bug to the
    -- player who did not do the editing.
    IF v_changed AND p_actor_id IS NOT NULL THEN
        SELECT COALESCE(first_name, 'Un joueur') INTO v_actor_name
          FROM profile WHERE id = p_actor_id;

        INSERT INTO message (conversation_id, sender_id, content, status, message_type, metadata)
        VALUES (
            v_conv,
            COALESCE(
                (SELECT id FROM player WHERE id = 'a11a0000-0000-4000-8000-000000000001'::uuid),
                p_actor_id
            ),
            -- Plain-text fallback only. The client renders this from
            -- metadata.system_note + actor_name in the viewer's own locale.
            v_actor_name || ' a mis à jour ses disponibilités',
            'sent', 'user',
            jsonb_build_object(
                'silent',      true,
                'system_note', 'availability_updated',
                'actor_name',  v_actor_name
            )
        );
    END IF;

    RETURN v_msg;
END;
$$;
