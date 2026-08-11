-- ============================================================================
-- Regenerate a system Match Organizer card, re-anchoring votes by option_key
-- ============================================================================
-- Spec: specs/08-communications/match-organizer-live-suggestions.md
--   §Blocking prerequisite (re-anchoring rule), §Availability escape hatch
--
-- Called after a player edits their availability from a pairing context (the
-- round chat's suggestion card). Re-runs the engine and rewrites the card in
-- place so the player who just widened their hours immediately sees real
-- options instead of the same stale "no shared times" card.
--
-- The whole reason slice 1 put a stable `option_key` on every option: votes in
-- `match_time_vote` are keyed by POSITIONAL option_index into the snapshotted
-- array. Regenerating naively would silently re-point an existing vote at a
-- different time slot, and two players could "mutually agree" to a slot neither
-- chose. So:
--
--   * options that survive (same option_key) carry their votes across
--   * options that vanish but HAVE votes are pinned into the new array with
--     stale=true — a voted option is never silently removed
--   * options that vanish with no votes are dropped
--
-- Votes are deleted and re-inserted (rather than UPDATEd) because
-- match_time_vote has UNIQUE (message_id, player_id, option_index) and an
-- in-place reindex can transiently collide.
--
-- Terminal cards (a game was already created) are never regenerated.
-- ============================================================================

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

    -- Fresh engine run, same shape/order as the poster.
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
      INTO v_new_options, v_has_mutual
      FROM public.match_organizer_options(v_participants, v_t.sport_id, 14, 10) o;

    IF v_new_options IS NULL OR v_has_mutual IS NOT TRUE THEN
        v_new_options := '[]'::jsonb;
    END IF;

    -- Pin voted options the engine no longer returns, flagged stale, so nobody's
    -- agreement silently disappears (e.g. someone else booked that court).
    SELECT COALESCE(jsonb_agg(old_o || jsonb_build_object('stale', true)), '[]'::jsonb)
      INTO v_pinned
      FROM (
        SELECT DISTINCT ON (o->>'option_key') o AS old_o
          FROM jsonb_array_elements(v_meta->'options') WITH ORDINALITY AS x(o, ord)
         WHERE EXISTS (
                 SELECT 1 FROM match_time_vote v
                  WHERE v.message_id = v_msg
                    AND v.option_index = (ord - 1)
               )
           AND NOT EXISTS (
                 SELECT 1 FROM jsonb_array_elements(v_new_options) n
                  WHERE n->>'option_key' = o->>'option_key'
               )
      ) s;

    v_final := v_new_options || v_pinned;

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
                 'options_generated_at', to_jsonb(now())
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

GRANT EXECUTE ON FUNCTION public.lt_regenerate_system_organizer_card(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.lt_regenerate_system_organizer_card(uuid, uuid) IS
    'Re-runs the options engine for a pairing''s system organizer card and rewrites it in place, re-anchoring votes on option_key (voted options that vanish are pinned with stale=true, never silently dropped). Skips terminal cards. Posts a silent system note naming the actor. Spec: specs/08-communications/match-organizer-live-suggestions.md.';
