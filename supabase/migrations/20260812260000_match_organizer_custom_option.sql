-- ============================================================================
-- Match Organizer: human-proposed custom time/place options (the funnel floor)
-- ============================================================================
-- Spec: specs/08-communications/match-organizer-live-suggestions.md
--   §Graceful degradation floor
--
-- The organizer card is the ONLY path from a pairing to a created game, so it
-- must never dead-end. Three states could strand a pair until now:
--   * zero mutual availability overlap  -> card posts with options = []
--   * no favourited/in-range facility   -> engine returns nothing
--   * the pair simply wants somewhere the engine does not know about
-- In all three the card offered an availability edit and nothing else.
--
-- This adds the missing tier-3 from the original design: any participant may
-- propose their own slot, with a facility, a free-text place, or no place at
-- all. It becomes a normal votable option, so everything downstream (mutual
-- agreement, create_casual_match, the pre-play bracket link, and effort
-- detection for deadline arbitration) works unchanged.
-- ============================================================================


-- =====================
-- 1. Propose a custom option
-- =====================

CREATE OR REPLACE FUNCTION public.match_organizer_add_custom_option(
    p_message_id  uuid,
    p_slot_start  timestamptz,
    p_facility_id uuid DEFAULT NULL,
    p_place_name  text DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_caller   uuid := auth.uid();
    v_conv     uuid;
    v_meta     jsonb;
    v_parts    uuid[];
    v_place    text := nullif(btrim(coalesce(p_place_name, '')), '');
    v_fac_name text;
    v_fac_tz   text;
    v_key      text;
    v_idx      int;
    v_opt      jsonb;
    v_local    timestamp;
    v_actor    text;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    -- Row-lock the card: two players proposing at once must not clobber each
    -- other's append (the whole options array is rewritten below).
    SELECT m.conversation_id, m.metadata INTO v_conv, v_meta
      FROM message m
     WHERE m.id = p_message_id
       AND m.message_type = 'match_organizer'
       AND m.deleted_at IS NULL
     FOR UPDATE;

    IF v_conv IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CARD_NOT_FOUND';
    END IF;

    SELECT array_agg(value::uuid) INTO v_parts
      FROM jsonb_array_elements_text(v_meta->'participant_ids');

    IF v_parts IS NULL OR NOT (v_caller = ANY(v_parts)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_A_PARTICIPANT';
    END IF;

    IF COALESCE(v_meta->>'created_match_id', '') <> ''
       OR COALESCE(v_meta->>'confirmed_option_index', '') <> '' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CARD_ALREADY_SETTLED';
    END IF;

    IF p_slot_start IS NULL OR p_slot_start <= now() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SLOT_IN_PAST';
    END IF;

    IF p_facility_id IS NOT NULL THEN
        SELECT f.name, f.timezone INTO v_fac_name, v_fac_tz
          FROM facility f WHERE f.id = p_facility_id;
        IF v_fac_name IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'FACILITY_NOT_FOUND';
        END IF;
    END IF;

    -- Same identity formula match_organizer_options uses, so proposing a slot
    -- the engine already offered at the same facility dedupes onto that option
    -- (and just records the vote) instead of listing it twice.
    v_key := md5(
        extract(epoch FROM p_slot_start)::text || '|' ||
        COALESCE(p_facility_id::text, v_place, 'none')
    );

    SELECT (ord - 1) INTO v_idx
      FROM jsonb_array_elements(COALESCE(v_meta->'options', '[]'::jsonb))
           WITH ORDINALITY AS x(o, ord)
     WHERE o->>'option_key' = v_key
     LIMIT 1;

    IF v_idx IS NULL THEN
        v_local := p_slot_start AT TIME ZONE COALESCE(v_fac_tz, 'America/Toronto');

        -- free_count stays NULL on purpose: the engine never vetted this slot,
        -- so the card must not claim "you are both free".
        v_opt := jsonb_build_object(
            'slot_start',      p_slot_start,
            'day_label',       lower(to_char(v_local, 'FMDay')),
            'hour_of_day',     extract(hour FROM v_local)::int,
            'facility_id',     p_facility_id,
            'facility_name',   COALESCE(v_fac_name, v_place),
            'court_name',      NULL,
            'court_count',     0,
            'price_cents',     NULL,
            'court_confirmed', false,
            'tier',            'custom',
            'distance_km',     NULL,
            'free_count',      NULL,
            'option_key',      v_key,
            'place_name',      v_place,
            'proposed_by',     v_caller
        );

        v_idx  := jsonb_array_length(COALESCE(v_meta->'options', '[]'::jsonb));
        v_meta := (v_meta - 'no_overlap')
                  || jsonb_build_object(
                       'options',
                       COALESCE(v_meta->'options', '[]'::jsonb) || jsonb_build_array(v_opt)
                     );

        UPDATE message
           SET metadata   = v_meta,
               content    = 'Suggestions d''heures pour jouer - Suggested times to play',
               updated_at = now()
         WHERE id = p_message_id;
    END IF;

    -- Proposing a slot IS a thumbs-up for it.
    INSERT INTO match_time_vote (message_id, player_id, option_index)
    VALUES (p_message_id, v_caller, v_idx)
    ON CONFLICT DO NOTHING;

    -- Deliberately NOT silent, unlike the ambient availability refresh: a human
    -- proposing a time is exactly the moment the opponent should be pinged.
    SELECT COALESCE(first_name, 'Un joueur') INTO v_actor
      FROM profile WHERE id = v_caller;

    INSERT INTO message (conversation_id, sender_id, content, status, message_type, metadata)
    VALUES (
        v_conv,
        COALESCE(
            (SELECT id FROM player WHERE id = 'a11a0000-0000-4000-8000-000000000001'::uuid),
            v_caller
        ),
        -- Plain-text fallback only; the client renders this from
        -- metadata.system_note + actor_name in the viewer's own locale.
        v_actor || ' a propose un autre moment',
        'sent', 'user',
        jsonb_build_object(
            'system_note', 'custom_option_added',
            'actor_name',  v_actor
        )
    );

    RETURN v_idx;
END;
$fn$;

GRANT EXECUTE ON FUNCTION
    public.match_organizer_add_custom_option(uuid, timestamptz, uuid, text)
    TO authenticated;

COMMENT ON FUNCTION public.match_organizer_add_custom_option(uuid, timestamptz, uuid, text) IS
    'Appends a participant-proposed time/place option (tier=custom, free_count NULL) to a match_organizer card and records the proposer''s vote on it. The degradation floor: works with a facility, a free-text place, or neither. Dedupes onto an existing option with the same (slot, place) identity.';


-- =====================
-- 2. Regeneration must never drop a human proposal
-- =====================
-- Body copied verbatim from 20260811120000 (its latest definition), with only
-- the pin block widened to cover custom options.

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
    'Re-runs the suggestion engine and rewrites a system Match Organizer card in place, re-anchoring votes by option_key. Voted-but-vanished options are pinned with stale=true; participant-proposed custom options are always pinned. Never touches a card that already produced a game.';


-- =====================
-- 3. create_casual_match carries a free-text place through to the game
-- =====================
-- Body from 20260730190000 (its latest definition) plus p_location_name. A
-- custom option with a place but no facility now lands as location_type
-- 'custom' with the name, instead of a bare 'tbd'.

CREATE OR REPLACE FUNCTION public.create_casual_match(
  p_sport_id          uuid,
  p_slot_start        timestamptz,
  p_player_ids        uuid[],
  p_format            match_format_enum default 'singles',
  p_facility_id       uuid default null,
  p_duration_minutes  int  default 60,
  p_source_message_id uuid default null,
  p_option_index      int  default null,
  p_location_name     text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_caller       uuid := auth.uid();
  v_match_id     uuid;
  v_existing     uuid;
  v_pid          uuid;
  v_tz           text;
  v_local_start  timestamp;
  v_conv_id      uuid;
  v_conv_tm_id   uuid;
  v_conv_sm_id   uuid;
  v_conv_match   uuid;
  v_place        text := nullif(btrim(coalesce(p_location_name, '')), '');
begin
  if v_caller is null then
    raise exception using errcode = 'P0001', message = 'NOT_AUTHENTICATED';
  end if;

  -- Idempotency: if this organizer card already produced a match, return it.
  if p_source_message_id is not null then
    perform 1 from public.message where id = p_source_message_id for update;
    select (metadata ->> 'created_match_id')::uuid into v_existing
    from public.message where id = p_source_message_id;
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  -- Resolve the facility's local wall-clock from the absolute instant.
  if p_facility_id is not null then
    select f.timezone into v_tz from public.facility f where f.id = p_facility_id;
  end if;
  v_tz := coalesce(v_tz, 'America/Toronto');
  v_local_start := p_slot_start at time zone v_tz;

  insert into public.match (
    sport_id, created_by, match_date, start_time, end_time, timezone,
    format, facility_id, location_type, location_name,
    join_mode, visibility, visible_in_groups, visible_in_communities
  ) values (
    p_sport_id, v_caller,
    v_local_start::date, v_local_start::time,
    (v_local_start + make_interval(mins => coalesce(p_duration_minutes, 60)))::time,
    v_tz, p_format, p_facility_id,
    case when p_facility_id is not null then 'facility'::location_type_enum
         when v_place is not null       then 'custom'::location_type_enum
         else 'tbd'::location_type_enum end,
    case when p_facility_id is null then v_place else null end,
    'direct', 'private', false, false
  )
  returning id into v_match_id;

  -- If posted from a tournament ROUND chat or a league session PAIRING chat,
  -- make that chat THE match chat (set match_id BEFORE the opponent join below,
  -- so sync_match_chat_participant reuses it rather than creating a second
  -- conversation) and attach the new match to the bracket round / pairing.
  if p_source_message_id is not null then
    select m.conversation_id, c.tournament_match_id, c.session_match_id, c.match_id
      into v_conv_id, v_conv_tm_id, v_conv_sm_id, v_conv_match
    from public.message m
    join public.conversation c on c.id = m.conversation_id
    where m.id = p_source_message_id;

    if v_conv_match is null and (v_conv_tm_id is not null or v_conv_sm_id is not null) then
      update public.conversation set match_id = v_match_id, updated_at = now()
      where id = v_conv_id;

      if v_conv_tm_id is not null then
        perform public.tournament_attach_match_pre_play(v_conv_tm_id, v_match_id);
      else
        perform public.session_attach_match_pre_play(v_conv_sm_id, v_match_id);
      end if;
    end if;
  end if;

  -- Host (caller) is added by the create_host_participant trigger; add the rest.
  foreach v_pid in array coalesce(p_player_ids, array[]::uuid[]) loop
    if v_pid <> v_caller then
      insert into public.match_participant (match_id, player_id, status)
      values (v_match_id, v_pid, 'joined')
      on conflict (match_id, player_id) do nothing;
    end if;
  end loop;

  -- Flip the organizer card to its "game created" state.
  if p_source_message_id is not null then
    update public.message
    set metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object('created_match_id', v_match_id, 'confirmed_option_index', p_option_index)
    where id = p_source_message_id;
  end if;

  return v_match_id;
end;
$fn$;

-- Retire the 8-arg signature so PostgREST cannot see two overloads (PGRST203).
-- Existing callers pass named args and resolve to this one, p_location_name
-- taking its default.
DROP FUNCTION IF EXISTS public.create_casual_match(
  uuid, timestamptz, uuid[], match_format_enum, uuid, int, uuid, int
);

GRANT EXECUTE ON FUNCTION public.create_casual_match(
  uuid, timestamptz, uuid[], match_format_enum, uuid, int, uuid, int, text
) TO authenticated;
