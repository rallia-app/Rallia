-- ============================================================================
-- The funnel's suggestions come from the phase snapshots, not the live grid.
-- ============================================================================
-- scheduling-funnel.md 5.2: "Suggestions come from the phase snapshots, never
-- from the live grid: the options are admissible evidence by construction."
--
-- Until now the card was built from player_availability, which a player can
-- edit at any moment, including after the deadline. That breaks the property
-- the whole arbitration model rests on: an option the app offered has to be a
-- slot both sides declared themselves free for INSIDE the phase, and the only
-- record of that is tournament_phase_availability.grid_snapshot.
--
-- Three pieces:
--   1. lt_phase_grid_avail(tournament_match) returns the pairing's snapshots
--      as [{player_id, day, hour}, ...], or NULL when the funnel is off for
--      that event or any participant has not answered the gate. NULL means
--      "no override", so every non-funnel event keeps today's behaviour to
--      the letter.
--   2. match_organizer_options gains p_avail_override. Its avail CTE is the
--      single place player_availability was read; with an override the same
--      shape is built from the snapshot instead and every downstream stage
--      (facilities, courts, scoring, the free_count = n overlap rule) is
--      untouched. Adding a parameter changes the signature, so the function
--      is dropped and recreated; the client passes named args and a defaulted
--      fifth parameter leaves it working.
--   3. Both card writers pass the override.
--
-- A side that answered by skipping contributes an empty grid, so a pairing
-- where nobody offered hours yields no mutual option and the card lands in
-- its no-overlap state. That is the honest result: the gate answer is the
-- acknowledgement, and hours are what make a slot bookable.
--
-- Bodies re-issued from their latest migrations (20260812270000 for the
-- engine, 20260813140000 for both writers), each verified byte-identical
-- against the live local definition before editing.
-- ============================================================================

-- ------------------------------------------------------- 1. the phase source
CREATE OR REPLACE FUNCTION public.lt_phase_grid_avail(p_tournament_match_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH pairing AS (
        SELECT m.tournament_id,
               m.bracket_side,
               m.player1_registration_id,
               m.player2_registration_id,
               CASE WHEN m.bracket_side = 'pool' THEN 0 ELSE m.round_number END AS phase_round
          FROM tournament_matches m
          JOIN tournaments t ON t.id = m.tournament_id
         WHERE m.id = p_tournament_match_id
           AND COALESCE(t.scheduling_funnel_enabled, false)
    ),
    members AS (
        SELECT DISTINCT u.uid
          FROM pairing p
          JOIN tournament_registrations r
            ON r.id IN (p.player1_registration_id, p.player2_registration_id)
          CROSS JOIN LATERAL unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) AS u(uid)
    ),
    answers AS (
        SELECT a.player_id, a.grid_snapshot
          FROM tournament_phase_availability a
          JOIN pairing p ON a.tournament_id = p.tournament_id
                        AND a.bracket_side  = p.bracket_side
                        AND a.round_number  = p.phase_round
         WHERE a.player_id IN (SELECT uid FROM members)
    )
    -- Every member must have answered: one missing grid and the overlap would
    -- be computed over a side that never declared anything.
    SELECT CASE
             WHEN (SELECT count(*) FROM members) = 0 THEN NULL
             WHEN (SELECT count(*) FROM answers) < (SELECT count(*) FROM members) THEN NULL
             ELSE COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                            'player_id', an.player_id,
                            'day',       c ->> 'day',
                            'hour',      (c ->> 'hour')::int))
                   FROM answers an
                   CROSS JOIN LATERAL jsonb_array_elements(an.grid_snapshot) c
             ), '[]'::jsonb)
           END;
$$;

COMMENT ON FUNCTION public.lt_phase_grid_avail(uuid) IS
'The pairing''s phase availability snapshots as [{player_id, day, hour}, ...],
for match_organizer_options'' p_avail_override. NULL when the tournament is not
on the scheduling funnel or a participant has not answered the gate, which
means "use the live grid". Spec: scheduling-funnel.md 5.2.';

REVOKE ALL ON FUNCTION public.lt_phase_grid_avail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lt_phase_grid_avail(uuid) TO authenticated;

-- ------------------------------------------- 2. the engine takes an override
DROP FUNCTION IF EXISTS public.match_organizer_options(uuid[], uuid, int, int);

CREATE OR REPLACE FUNCTION public.match_organizer_options(
  p_player_ids  uuid[],
  p_sport_id    uuid,
  p_window_days int DEFAULT 14,
  p_limit       int DEFAULT 8,
  -- When non-null, availability comes from here instead of the live grid:
  -- [{"player_id": uuid, "day": "monday", "hour": 18}, ...]. The scheduling
  -- funnel passes the phase snapshots so every option it offers is admissible
  -- evidence by construction (scheduling-funnel.md 5.2).
  p_avail_override jsonb DEFAULT NULL
)
RETURNS TABLE (
  slot_start      timestamptz,
  day_label       text,
  hour_of_day     smallint,
  facility_id     uuid,
  facility_name   text,
  fav_count       int,
  distance_km     double precision,
  court_name      text,
  court_count     int,
  price_cents     int,
  court_confirmed boolean,
  tier            text,
  score           double precision,
  free_count      int,
  option_key      text,
  court_state     text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH params AS (SELECT array_length(p_player_ids, 1) AS n),
-- per (day, hour): how many of the players are recurring-free (>=1 by construction)
avail AS (
  SELECT pa.day, pa.hour_of_day, count(DISTINCT pa.player_id) AS free_count
  FROM player_availability pa
  WHERE p_avail_override IS NULL
    AND pa.player_id = ANY(p_player_ids) AND pa.is_active
  GROUP BY pa.day, pa.hour_of_day
  UNION ALL
  SELECT (o ->> 'day')::day_enum, (o ->> 'hour')::smallint,
         count(DISTINCT (o ->> 'player_id'))
  FROM jsonb_array_elements(COALESCE(p_avail_override, '[]'::jsonb)) o
  WHERE p_avail_override IS NOT NULL
  GROUP BY 1, 2
),
fav AS (
  SELECT pff.facility_id, count(DISTINCT pff.player_id) AS fav_count
  FROM player_favorite_facility pff
  WHERE pff.player_id = ANY(p_player_ids) AND pff.sport_id = p_sport_id
  GROUP BY pff.facility_id
),
-- candidate facilities: favorited (bypasses travel cap) OR within EVERY located
-- player's max_travel (only when at least one player has a home location, so a
-- location-less pair doesn't open the whole facility table).
fac AS (
  SELECT f.id, f.name, f.timezone, COALESCE(fv.fav_count, 0) AS fav_count,
         (fv.facility_id IS NOT NULL) AS is_fav,
         (SELECT max(extensions.ST_Distance(f.location, p.location) / 1000.0)
            FROM player p WHERE p.id = ANY(p_player_ids) AND p.location IS NOT NULL) AS distance_km
  FROM facility f
  LEFT JOIN fav fv ON fv.facility_id = f.id
  WHERE f.is_active AND f.location IS NOT NULL
    AND (
      fv.facility_id IS NOT NULL
      OR (
        EXISTS (SELECT 1 FROM player p WHERE p.id = ANY(p_player_ids) AND p.location IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM player p
          WHERE p.id = ANY(p_player_ids) AND p.location IS NOT NULL
            AND extensions.ST_Distance(f.location, p.location) / 1000.0 > COALESCE(p.max_travel_distance, 25)
        )
      )
    )
),
dow(day, d) AS (VALUES
  ('sunday'::day_enum,0),('monday',1),('tuesday',2),('wednesday',3),
  ('thursday',4),('friday',5),('saturday',6)),
-- How far ahead each facility's feed reaches for this sport, measured from the
-- data itself rather than from a per-provider constant: the horizon is a
-- property of the facility (and changes without telling us), so a hardcoded
-- table would rot silently. A slot past this is not published yet; a slot inside
-- it with no open court is one we can actually see is taken.
--
-- last_refreshed guards the one way this inference lies: a feed that has stopped
-- updating also has a short max(slot_start), and calling that "coming soon" is
-- wrong. A stale feed degrades to 'untracked' instead.
fac_cover AS (
  SELECT s.facility_id,
         max(s.slot_start)   AS horizon_end,
         max(s.refreshed_at) AS last_refreshed
  FROM facility_availability_snapshot s
  WHERE s.sport_id = p_sport_id AND s.slot_start > now()
  GROUP BY s.facility_id
),
-- Every (facility, local date, hour) the feed says ANYTHING about, available or
-- not. This is the one thing that separates "not published yet" from "all taken".
slot_cover AS (
  SELECT fc.id AS facility_id,
         (s.slot_start AT TIME ZONE COALESCE(fc.timezone, 'America/Toronto'))::date AS slot_date,
         extract(hour FROM (s.slot_start AT TIME ZONE COALESCE(fc.timezone, 'America/Toronto')))::int AS hour_of_day
  FROM facility_availability_snapshot s
  JOIN fac fc ON fc.id = s.facility_id
  WHERE s.sport_id = p_sport_id
    AND s.slot_start > now()
    AND s.slot_start < now() + (p_window_days || ' days')::interval
  GROUP BY 1, 2, 3
),
-- SOURCE A: real open-court hours at candidate facilities (local date/hour)
court_hours AS (
  SELECT fc.id AS facility_id, fc.name AS facility_name, fc.timezone,
         fc.fav_count, fc.is_fav, fc.distance_km,
         (s.slot_start AT TIME ZONE COALESCE(fc.timezone, 'America/Toronto'))::date AS slot_date,
         extract(hour FROM (s.slot_start AT TIME ZONE COALESCE(fc.timezone, 'America/Toronto')))::int AS hour_of_day,
         count(DISTINCT s.external_court_id)::int AS court_count,
         min(s.price_cents)::int AS price_cents,
         (array_agg(s.court_name ORDER BY s.price_cents NULLS LAST))[1] AS court_name
  FROM facility_availability_snapshot s
  JOIN fac fc ON fc.id = s.facility_id
  WHERE s.sport_id = p_sport_id AND s.is_available
    AND s.slot_start > now()
    AND s.slot_start < now() + (p_window_days || ' days')::interval
  GROUP BY fc.id, fc.name, fc.timezone, fc.fav_count, fc.is_fav, fc.distance_km, slot_date, hour_of_day
),
source_a AS (
  SELECT ch.facility_id, ch.facility_name, ch.fav_count, ch.is_fav, ch.distance_km,
         ch.slot_date, dw.day AS day, ch.hour_of_day,
         ch.court_count, ch.price_cents, ch.court_name, true AS court_confirmed,
         'confirmed'::text AS court_state,
         av.free_count,
         ((ch.slot_date::text || ' ' || lpad(ch.hour_of_day::text, 2, '0') || ':00:00')::timestamp
            AT TIME ZONE COALESCE(ch.timezone, 'America/Toronto')) AS slot_start
  FROM court_hours ch
  JOIN dow dw ON dw.d = EXTRACT(DOW FROM ch.slot_date)::int
  JOIN avail av ON av.day = dw.day AND av.hour_of_day = ch.hour_of_day  -- >=1 player free
),
-- SOURCE B: speculative mutual-overlap hours x favorited facilities (no live court)
overlap AS (SELECT day, hour_of_day FROM avail WHERE free_count = (SELECT n FROM params)),
dates AS (
  SELECT g::date AS slot_date
  FROM generate_series(now()::date, (now() + (p_window_days || ' days')::interval)::date, interval '1 day') g
),
source_b AS (
  SELECT fc.id AS facility_id, fc.name AS facility_name, fc.fav_count, fc.is_fav, fc.distance_km,
         dt.slot_date, o.day AS day, o.hour_of_day,
         0::int AS court_count, NULL::int AS price_cents, NULL::text AS court_name, false AS court_confirmed,
         -- Source A already proved there is no OPEN court here, so the only
         -- question left is whether the feed knows about this hour at all.
         CASE
           WHEN EXISTS (
                  SELECT 1 FROM slot_cover sc
                   WHERE sc.facility_id = fc.id
                     AND sc.slot_date   = dt.slot_date
                     AND sc.hour_of_day = o.hour_of_day)
             THEN 'booked'
           WHEN NOT EXISTS (SELECT 1 FROM fac_cover fcv WHERE fcv.facility_id = fc.id)
             THEN 'untracked'
           WHEN ((dt.slot_date::text || ' ' || lpad(o.hour_of_day::text, 2, '0') || ':00:00')::timestamp
                   AT TIME ZONE COALESCE(fc.timezone, 'America/Toronto'))
                > (SELECT fcv.horizon_end FROM fac_cover fcv WHERE fcv.facility_id = fc.id)
            AND EXISTS (SELECT 1 FROM fac_cover fcv
                         WHERE fcv.facility_id = fc.id
                           AND fcv.last_refreshed > now() - interval '24 hours')
             THEN 'not_published_yet'
           -- Feed covers this date but never this hour: closed or not bookable.
           ELSE 'untracked'
         END::text AS court_state,
         (SELECT n FROM params) AS free_count,
         ((dt.slot_date::text || ' ' || lpad(o.hour_of_day::text, 2, '0') || ':00:00')::timestamp
            AT TIME ZONE COALESCE(fc.timezone, 'America/Toronto')) AS slot_start
  FROM dates dt
  JOIN dow dw ON dw.d = EXTRACT(DOW FROM dt.slot_date)::int
  JOIN overlap o ON o.day = dw.day
  JOIN fac fc ON fc.is_fav
  WHERE NOT EXISTS (
    SELECT 1 FROM source_a a
    WHERE a.facility_id = fc.id AND a.slot_date = dt.slot_date AND a.hour_of_day = o.hour_of_day
  )
),
cand AS (
  SELECT * FROM source_a
  UNION ALL
  SELECT * FROM source_b
),
scored AS (
  SELECT c.*,
    ( (CASE WHEN c.court_confirmed THEN 1000 ELSE 0 END)                      -- real courts first
      + (CASE WHEN c.free_count >= (SELECT n FROM params) THEN 200 ELSE 0 END) -- both free preferred
      + c.free_count * 20                                                      -- more free players better
      + (CASE WHEN c.is_fav THEN c.fav_count * 10 ELSE 0 END)                  -- favorite boost
      - (CASE WHEN c.court_state = 'booked' THEN 150 ELSE 0 END)               -- known taken ranks last
      - EXTRACT(EPOCH FROM (c.slot_start - now())) / 86400.0                   -- sooner ranks higher
      - COALESCE(c.distance_km, 0) * 0.5 )::float8 AS score                    -- nearer ranks higher
  FROM cand c
  WHERE c.slot_start > now()
),
ranked AS (
  SELECT *, row_number() OVER (PARTITION BY facility_id, slot_date ORDER BY score DESC) AS rn
  FROM scored
)
SELECT slot_start, day::text, hour_of_day::smallint, facility_id, facility_name, fav_count::int,
       round(distance_km::numeric, 1)::float8, court_name, court_count::int, price_cents, court_confirmed,
       CASE WHEN court_confirmed THEN 'bookable' ELSE 'usually_free' END AS tier,
       score,
       free_count::int,
       md5(extract(epoch FROM slot_start)::bigint::text || '|' || COALESCE(facility_id::text, 'none')) AS option_key,
       court_state
FROM ranked
WHERE rn = 1 AND array_length(p_player_ids, 1) >= 2
ORDER BY score DESC
LIMIT p_limit;
$$;

-- ------------------------------- 3. both card writers pass the snapshots
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

GRANT EXECUTE ON FUNCTION public.match_organizer_options(uuid[], uuid, int, int, jsonb)
    TO anon, authenticated, service_role;
