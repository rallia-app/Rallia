-- ============================================================================
-- Leagues — Chat Match Organizer glue for session pairings
-- ============================================================================
-- The league twin of 20260626200000 (tournament round chats). Two players drawn
-- against each other on a session sheet get ONE shared chat that becomes the
-- match chat (no duplicate conversation), and the game they organize from it is
-- linked to their session pairing BEFORE it is played — so confirming its result
-- settles the pairing through the existing match_result -> session bridge
-- (lt_propagate_match_result_to_session) instead of needing a manual link.
--
--  * conversation.session_match_id tags a per-pairing "session chat".
--  * lt_get_or_create_session_pairing_chat_unchecked: idempotent chat for a
--    pairing (every player on both sides added). conversation_type='match' with
--    a NULL match_id until a game is created — it IS the future match chat.
--  * session_attach_match_pre_play: link a freshly created match to the pairing
--    (session_matches.match_id) BEFORE it's played, with the same guards as
--    session_attach_match minus the verified-result requirement.
--  * create_casual_match: gains a session branch mirroring the tournament one.
--
-- Also revokes the default PUBLIC execute on the tournament _unchecked helper,
-- which skips the caller check by design and was only ever meant to be called
-- by its wrapper.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Pairing-chat tag on conversation
-- ---------------------------------------------------------------------------
ALTER TABLE public.conversation
  ADD COLUMN IF NOT EXISTS session_match_id uuid
    REFERENCES public.session_matches(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.conversation.session_match_id IS
  'Per-pairing league session chat (mirror of conversation.tournament_match_id). The game organized here is attached to the pairing pre-play.';

-- One chat per pairing.
CREATE UNIQUE INDEX IF NOT EXISTS conversation_session_match_id_unique
  ON public.conversation(session_match_id)
  WHERE session_match_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 2. Pre-play pairing link (mirrors session_attach_match minus the result)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.session_attach_match_pre_play(
    p_session_match_id uuid,
    p_match_id         uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller    uuid := auth.uid();
    v_sm        session_matches;
    v_session   sessions;
    v_sport_id  uuid;
    v_match     match;
    v_players   uuid[];
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_sm FROM session_matches WHERE id = p_session_match_id FOR UPDATE;
    IF v_sm.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_MATCH_NOT_FOUND';
    END IF;
    IF v_sm.match_id IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_LINKED';
    END IF;
    IF v_sm.status <> 'pending' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_NOT_PENDING';
    END IF;
    IF v_sm.is_drill OR v_sm.is_three_player THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_LINKABLE';
    END IF;

    SELECT * INTO v_session FROM sessions WHERE id = v_sm.session_id;
    IF v_session.status NOT IN ('published', 'in_progress') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_NOT_ACTIVE';
    END IF;

    SELECT l.sport_id INTO v_sport_id
      FROM seasons se JOIN leagues l ON l.id = se.league_id
     WHERE se.id = v_session.season_id;

    -- Caller must be one of this pairing's players.
    v_players := v_sm.team_a_user_ids || v_sm.team_b_user_ids;
    IF NOT (v_caller = ANY (v_players)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_A_PARTICIPANT';
    END IF;

    SELECT * INTO v_match FROM match WHERE id = p_match_id;
    IF v_match.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_NOT_FOUND';
    END IF;
    IF v_match.created_by <> v_caller THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_MATCH_HOST';
    END IF;
    IF v_match.sport_id <> v_sport_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SPORT_MISMATCH';
    END IF;
    IF EXISTS (SELECT 1 FROM session_matches WHERE match_id = p_match_id)
       OR EXISTS (SELECT 1 FROM tournament_matches WHERE match_id = p_match_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_ALREADY_LINKED';
    END IF;

    UPDATE session_matches
       SET match_id   = p_match_id,
           version    = version + 1,
           updated_at = now()
     WHERE id = v_sm.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.session_attach_match_pre_play(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.session_attach_match_pre_play(uuid, uuid) TO authenticated;


-- ---------------------------------------------------------------------------
-- 3a. Pairing-chat get-or-create (no caller check — usable by the RPC and any
--     future proactive trigger). Idempotent on session_match_id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lt_get_or_create_session_pairing_chat_unchecked(
    p_session_match_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sm     session_matches;
    v_title  text;
    v_conv   uuid;
    v_player uuid;
BEGIN
    SELECT * INTO v_sm FROM session_matches WHERE id = p_session_match_id;
    IF v_sm.id IS NULL
       OR v_sm.is_drill
       OR v_sm.is_three_player
       OR coalesce(array_length(v_sm.team_a_user_ids, 1), 0) = 0
       OR coalesce(array_length(v_sm.team_b_user_ids, 1), 0) = 0 THEN
        RETURN NULL;
    END IF;

    -- Existing chat for this pairing?
    SELECT id INTO v_conv FROM public.conversation
     WHERE session_match_id = p_session_match_id;
    IF v_conv IS NOT NULL THEN
        RETURN v_conv;
    END IF;

    SELECT l.name INTO v_title
      FROM sessions s
      JOIN seasons se ON se.id = s.season_id
      JOIN leagues l  ON l.id = se.league_id
     WHERE s.id = v_sm.session_id;

    INSERT INTO public.conversation (conversation_type, session_match_id, title, created_by)
    VALUES ('match'::conversation_type, p_session_match_id, v_title, v_sm.team_a_user_ids[1])
    ON CONFLICT (session_match_id) WHERE session_match_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_conv;

    IF v_conv IS NULL THEN
        SELECT id INTO v_conv FROM public.conversation
         WHERE session_match_id = p_session_match_id;
    END IF;

    -- Add every player on both sides (2 for singles, 4 for doubles).
    FOREACH v_player IN ARRAY (v_sm.team_a_user_ids || v_sm.team_b_user_ids)
    LOOP
        INSERT INTO public.conversation_participant (conversation_id, player_id)
        VALUES (v_conv, v_player)
        ON CONFLICT DO NOTHING;
    END LOOP;

    RETURN v_conv;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lt_get_or_create_session_pairing_chat_unchecked(uuid)
    FROM public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3b. Public wrapper — caller must be one of the pairing's players.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_or_create_session_pairing_chat(
    p_session_match_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_sm     session_matches;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_sm FROM session_matches WHERE id = p_session_match_id;
    IF v_sm.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_MATCH_NOT_FOUND';
    END IF;

    IF NOT (v_caller = ANY (v_sm.team_a_user_ids || v_sm.team_b_user_ids)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_A_PARTICIPANT';
    END IF;

    RETURN public.lt_get_or_create_session_pairing_chat_unchecked(p_session_match_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_or_create_session_pairing_chat(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_session_pairing_chat(uuid) TO authenticated;


-- ---------------------------------------------------------------------------
-- 3c. Harden the tournament twin: it skips the caller check by design and is
--     only meant to be reached through get_or_create_tournament_round_chat,
--     but it kept the default PUBLIC execute from 20260626200000.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.lt_get_or_create_tournament_round_chat_unchecked(uuid)
    FROM public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. create_casual_match — link the pairing chat + attach to the session.
--    Same signature as 20260626200000; CREATE OR REPLACE keeps grants. The
--    tournament branch is unchanged; the session branch sits alongside it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_casual_match(
  p_sport_id          uuid,
  p_slot_start        timestamptz,
  p_player_ids        uuid[],
  p_format            match_format_enum default 'singles',
  p_facility_id       uuid default null,
  p_duration_minutes  int  default 60,
  p_source_message_id uuid default null,
  p_option_index      int  default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
    format, facility_id, location_type,
    join_mode, visibility, visible_in_groups, visible_in_communities
  ) values (
    p_sport_id, v_caller,
    v_local_start::date, v_local_start::time,
    (v_local_start + make_interval(mins => coalesce(p_duration_minutes, 60)))::time,
    v_tz, p_format, p_facility_id,
    case when p_facility_id is not null then 'facility'::location_type_enum
         else 'tbd'::location_type_enum end,
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
$$;

COMMIT;
