-- ============================================================================
-- Série 1 — split each category into 3 regional draws, and enforce the band
-- ----------------------------------------------------------------------------
-- The three metro-wide draws seeded in 20260717120000 covered all of Greater
-- Montréal. Registration density showed the Intermédiaire draw splitting into a
-- Laval cluster and a South Shore cluster ~30-38 km apart, which makes games
-- painful to schedule. Each category now becomes three draws: Montréal (the
-- island), Rive-Nord (Laval + the north crown) and Rive-Sud.
--
-- The three existing tournaments are REPURPOSED as the Montréal draws rather
-- than replaced: links already shared publicly keep resolving, most entries
-- never move, and the existing chats stay intact. Six new tournaments are
-- created for the two other zones.
--
-- Second concern handled here: max_rating became a real gate in 20260725120000,
-- but entries made before that migration were only ever checked against the
-- floor. Out-of-band entries are corrected first (promoted to the draw matching
-- their rating, or withdrawn if they already hold a valid entry there), then
-- everyone is routed to their region.
--
-- Environment-specific references resolve by stable keys (sport name, organizer
-- email), so the block NO-OPs on a fresh local/CI database. Idempotent: once the
-- 'Série 1 ' names exist, re-running does nothing.
-- ============================================================================

DO $$
DECLARE
    v_org      uuid;
    v_coorg    uuid;
    v_sport    uuid;
    v_prefix   text;      -- storage URL up to and including /tournament-logos/
    v_status   tournament_status;
    v_statuses int;

    -- Registration closes Jul 31 23:59 EDT, play runs Aug 1 to Aug 14 EDT.
    -- Same 03:59Z / 04:00Z boundary pair the previous schedule used.
    v_closes timestamptz := '2026-08-01 03:59:00+00';
    v_start  timestamptz := '2026-08-01 04:00:00+00';
    v_end    timestamptz := '2026-08-15 03:59:00+00';

    v_moved    int := 0;
    v_pulled   int := 0;
    v_orphan   int := 0;
    v_bad      int;
    v_over     text;
    -- Not named r: that would shadow the `r` alias this block uses for
    -- tournament_registrations, and plpgsql resolves the variable first.
    v_conv     record;
BEGIN
    SELECT id INTO v_sport FROM public.sport WHERE name = 'tennis';

    SELECT p.id INTO v_org
      FROM public.player p
      JOIN public.profile pr ON pr.id = p.id
     WHERE lower(pr.email) = 'jdl.sonkin@gmail.com';

    IF v_org IS NULL OR v_sport IS NULL THEN
        RAISE NOTICE 'Série 1 split skipped: tennis or organizer jdl.sonkin@gmail.com absent here.';
        RETURN;
    END IF;

    IF EXISTS (SELECT 1 FROM public.tournaments WHERE name LIKE 'Série 1 %') THEN
        RAISE NOTICE 'Série 1 regional draws already present; skipping.';
        RETURN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.tournaments WHERE name LIKE 'Tournois Rallia — Série 1 ·%') THEN
        RAISE NOTICE 'Série 1 seed absent here; nothing to split.';
        RETURN;
    END IF;

    -- The three originals must share a status, since the six new draws inherit
    -- it (prod is registration_open, staging is registration_closed).
    SELECT count(DISTINCT status) INTO v_statuses
      FROM public.tournaments WHERE name LIKE 'Tournois Rallia — Série 1 ·%';
    IF v_statuses <> 1 THEN
        RAISE EXCEPTION 'Série 1 originals have % distinct statuses; refusing to guess.', v_statuses;
    END IF;
    SELECT status INTO v_status
      FROM public.tournaments WHERE name LIKE 'Tournois Rallia — Série 1 ·%' LIMIT 1;

    -- Banners are uploaded out of band (storage doesn't travel by migration).
    -- Derive the bucket URL from an existing row so this works on any project;
    -- leave logo_url alone if the originals never had one.
    SELECT substring(logo_url from '^(.*/tournament-logos/)') INTO v_prefix
      FROM public.tournaments
     WHERE name LIKE 'Tournois Rallia — Série 1 ·%' AND logo_url IS NOT NULL
     LIMIT 1;

    -- ------------------------------------------------------------------ specs
    -- One row per draw. Carried through the whole block so every step (create,
    -- reroute, reconcile, assert) reads the same definition.
    CREATE TEMP TABLE _s1 (
        cat        text,      -- debutant | intermediaire | avance
        zone       text,      -- montreal | rive-nord | rive-sud
        name       text,
        level      text,
        zone_label text,
        city       text,
        towns      text,
        min_rating numeric,
        max_rating numeric,
        max_part   smallint,
        id         uuid
    ) ON COMMIT DROP;

    INSERT INTO _s1 (cat, zone, name, level, zone_label, city, towns, min_rating, max_rating, max_part)
    SELECT c.cat, z.zone,
           'Série 1 ' || z.zone_label || ' · ' || c.level,
           c.level, z.zone_label, z.city, z.towns,
           c.min_rating, c.max_rating,
           -- Montréal Intermédiaire and Avancé stay at 32: the island carries
           -- most of the demand, and Avancé already holds 16 entries, which a
           -- 16-draw would lock shut on creation.
           CASE WHEN z.zone = 'montreal' AND c.cat IN ('intermediaire', 'avance')
                THEN 32::smallint ELSE 16::smallint END
      FROM (VALUES
              ('debutant',      'Débutant',      1.5, 2.5),
              ('intermediaire', 'Intermédiaire', 3.0, 3.5),
              ('avance',        'Avancé',        4.0, NULL)
           ) AS c(cat, level, min_rating, max_rating)
      CROSS JOIN (VALUES
              ('montreal',  'Montréal',  'Île de Montréal',
               'Île de Montréal seulement, incluant l''Ouest-de-l''Île, Verdun, LaSalle, Lachine et Côte-Saint-Luc.'),
              ('rive-nord', 'Rive-Nord', 'Laval & Rive-Nord',
               'Laval, Saint-Eustache, Deux-Montagnes, Terrebonne, Repentigny, Blainville et Boisbriand.'),
              ('rive-sud',  'Rive-Sud',  'Rive-Sud',
               'Longueuil, Brossard, Saint-Hubert, Greenfield Park, La Prairie, Candiac, Chambly et Saint-Lambert.')
           ) AS z(zone, zone_label, city, towns);

    -- ------------------------------------------------- repurpose the originals
    -- Three separate statements on purpose. notify_tournament_lifecycle branch D
    -- pushes a generic "dates or venue changed" notice, but only when the status
    -- is unchanged AND live. Parking the row in 'draft' for the duration of the
    -- edit means no branch matches, so the chat message we send by hand stays
    -- the only communication players get.
    UPDATE public.tournaments SET status = 'draft'
     WHERE name LIKE 'Tournois Rallia — Série 1 ·%';

    UPDATE public.tournaments t SET
        name        = s.name,
        city        = s.city,
        max_participants = s.max_part,
        description = 'Catégorie ' || s.level || ' (cote ' ||
                      CASE WHEN s.max_rating IS NULL
                           THEN to_char(s.min_rating, 'FM9.0') || ' et plus'
                           ELSE to_char(s.min_rating, 'FM9.0') || ' à ' || to_char(s.max_rating, 'FM9.0')
                      END || '). Zone couverte : ' || s.towns ||
                      ' Tournoi gratuit, géré sur Rallia.',
        registration_closes_at = v_closes,
        start_date  = v_start,
        end_date    = v_end,
        logo_url    = COALESCE(v_prefix || v_org || '/serie1-' || s.zone || '-' || s.cat || '-v1.webp', t.logo_url),
        updated_at  = now()
      FROM _s1 s
     WHERE s.zone = 'montreal'
       AND t.name = 'Tournois Rallia — Série 1 · ' || s.level;

    UPDATE public.tournaments SET status = v_status
     WHERE name LIKE 'Série 1 Montréal ·%';

    UPDATE _s1 s SET id = t.id
      FROM public.tournaments t
     WHERE s.zone = 'montreal' AND t.name = s.name;

    -- ------------------------------------------------------ create the six new
    -- Direct INSERT rather than tournament_create: that RPC can't set level,
    -- categories, city, games_per_set, final_set_tiebreak, seeding_enabled or
    -- max_seeds, and it authorizes against auth.uid(), which is NULL here.
    INSERT INTO public.tournaments (
        name, description, rules, sport_id, organizer_id, organizer_display_name,
        visibility, registration_mode, status,
        level, categories, min_rating, max_rating, city,
        max_participants, bracket_type, match_format, games_per_set,
        final_set_tiebreak, entry_format, seeding_enabled, max_seeds,
        registration_opens_at, registration_closes_at, start_date, end_date, logo_url
    )
    SELECT
        s.name,
        'Catégorie ' || s.level || ' (cote ' ||
        CASE WHEN s.max_rating IS NULL
             THEN to_char(s.min_rating, 'FM9.0') || ' et plus'
             ELSE to_char(s.min_rating, 'FM9.0') || ' à ' || to_char(s.max_rating, 'FM9.0')
        END || '). Zone couverte : ' || s.towns || ' Tournoi gratuit, géré sur Rallia.',
        (SELECT rules FROM public.tournaments WHERE name = 'Série 1 Montréal · ' || s.level),
        v_sport, v_org, 'Rallia',
        'public', 'open', v_status,
        s.level, ARRAY[s.level], s.min_rating, s.max_rating, s.city,
        s.max_part, 'single_elimination', 'one_set', 8,
        'super_tb_10pt', 'singles', false, 0,
        (SELECT registration_opens_at FROM public.tournaments WHERE name = 'Série 1 Montréal · ' || s.level),
        v_closes, v_start, v_end,
        v_prefix || v_org || '/serie1-' || s.zone || '-' || s.cat || '-v1.webp'
      FROM _s1 s
     WHERE s.zone <> 'montreal';

    UPDATE _s1 s SET id = t.id
      FROM public.tournaments t
     WHERE s.id IS NULL AND t.name = s.name;

    SELECT p.id INTO v_coorg
      FROM public.player p JOIN public.profile pr ON pr.id = p.id
     WHERE lower(pr.email) = 'lefrancmathis@gmail.com';

    IF v_coorg IS NOT NULL THEN
        INSERT INTO public.tournament_co_organizers (tournament_id, user_id, added_by)
        SELECT s.id, v_coorg, v_org FROM _s1 s
        ON CONFLICT (tournament_id, user_id) DO NOTHING;
    END IF;

    -- ------------------------------------------------------- routing decisions
    -- One pass computing, for every live entry, the draw it belongs in: category
    -- from the player's active rating, zone from their postal code.
    --
    -- Zone rule (unambiguous for the current cohort; H1-H4/H8/H9 island, H7
    -- Laval, J4/J5 south shore, J7 north crown). Anything unrecognised or
    -- missing falls back to Montréal so the mapping is total and nobody is
    -- stranded outside a draw.
    CREATE TEMP TABLE _route ON COMMIT DROP AS
    SELECT r.id            AS reg_id,
           r.user_id,
           r.tournament_id AS src_id,
           r.registered_at,
           rs.value        AS rating,
           CASE
               WHEN rs.value IS NULL             THEN NULL
               WHEN rs.value >= 4.0              THEN 'avance'
               WHEN rs.value BETWEEN 3.0 AND 3.5 THEN 'intermediaire'
               WHEN rs.value BETWEEN 1.5 AND 2.5 THEN 'debutant'
               ELSE NULL
           END AS want_cat,
           CASE
               WHEN p.postal_code IS NULL                              THEN 'montreal'
               WHEN upper(left(p.postal_code, 2)) = 'H7'               THEN 'rive-nord'
               WHEN upper(left(p.postal_code, 1)) = 'H'                THEN 'montreal'
               WHEN upper(left(p.postal_code, 2)) IN ('J6', 'J7')      THEN 'rive-nord'
               WHEN upper(left(p.postal_code, 2)) IN ('J3','J4','J5')  THEN 'rive-sud'
               ELSE 'montreal'
           END AS want_zone
      FROM public.tournament_registrations r
      JOIN _s1 src                       ON src.id = r.tournament_id
      JOIN public.player p               ON p.id = r.user_id
      LEFT JOIN public.player_sport ps   ON ps.player_id = r.user_id AND ps.sport_id = v_sport
      LEFT JOIN public.player_rating_score prs ON prs.id = ps.active_rating_score_id
      LEFT JOIN public.rating_score rs   ON rs.id = prs.rating_score_id
     WHERE r.status = 'registered';

    -- Every entry a player holds resolves to the SAME draw (category comes from
    -- their rating, zone from their address), so someone signed up in two
    -- categories produces two rows aiming at one destination. Rank them and keep
    -- one: the entry already sitting in the destination wins, otherwise the
    -- oldest. UNIQUE (tournament_id, user_id) makes this mandatory, not tidiness.
    CREATE TEMP TABLE _plan ON COMMIT DROP AS
    SELECT x.reg_id, x.user_id, x.src_id, x.want_cat, dst.id AS dst_id,
           row_number() OVER (
               PARTITION BY x.user_id, dst.id
               ORDER BY (x.src_id = dst.id) DESC, x.registered_at, x.reg_id
           ) AS rn
      FROM _route x
      JOIN _s1 dst ON dst.cat = x.want_cat AND dst.zone = x.want_zone;

    -- A) No draw matches this rating (unrated, or below the Débutant floor).
    --    Withdraw rather than disqualify: 'disqualified' is terminal and would
    --    block them from ever re-entering once their rating is sorted out.
    UPDATE public.tournament_registrations r
       SET status = 'withdrawn', withdrawn_at = now(), version = version + 1, updated_at = now()
      FROM _route x
     WHERE r.id = x.reg_id AND x.want_cat IS NULL;
    GET DIAGNOSTICS v_orphan = ROW_COUNT;

    -- B) The runners-up: a player's surplus entries in other categories.
    UPDATE public.tournament_registrations r
       SET status = 'withdrawn', withdrawn_at = now(), version = version + 1, updated_at = now()
      FROM _plan p
     WHERE r.id = p.reg_id AND p.rn > 1;
    GET DIAGNOSTICS v_pulled = ROW_COUNT;

    -- A non-'registered' live row in the destination would collide with the
    -- move below. It shouldn't exist (these draws are free and open-mode), so
    -- stop rather than guess which entry the player meant to keep.
    IF EXISTS (
        SELECT 1 FROM _plan p
         JOIN public.tournament_registrations o
           ON o.tournament_id = p.dst_id AND o.user_id = p.user_id
        WHERE p.rn = 1 AND p.dst_id <> p.src_id
          AND o.status IN ('pending', 'payment_pending', 'waitlisted', 'disqualified')
    ) THEN
        RAISE EXCEPTION 'Série 1 split: a destination draw already holds a non-registered entry for a player being moved.';
    END IF;

    -- C) The keeper lands in its draw. Covers the category promotion and the
    --    regional reroute in one move. seed_rank / bracket_position are
    --    per-tournament exclusion constraints, so they reset.
    UPDATE public.tournament_registrations r
       SET tournament_id = p.dst_id, seed_rank = NULL, bracket_position = NULL, updated_at = now()
      FROM _plan p
     WHERE r.id = p.reg_id AND p.rn = 1 AND p.dst_id <> p.src_id;
    GET DIAGNOSTICS v_moved = ROW_COUNT;

    -- ------------------------------------------------------ chat reconciliation
    -- tournament_chat_sync_registration_iud watches status and partner_user_id,
    -- NOT tournament_id, so a move leaves the player in the old conversation and
    -- absent from the new one, silently. Rebuild membership for all nine from
    -- the source of truth instead of patching each move.
    IF (SELECT count(*) FROM _s1 s
         WHERE NOT EXISTS (SELECT 1 FROM public.conversation c WHERE c.tournament_id = s.id)) > 0 THEN
        RAISE EXCEPTION 'Série 1 split: a draw has no conversation; the chat trigger did not fire.';
    END IF;

    FOR v_conv IN SELECT s.id, c.id AS conv_id FROM _s1 s JOIN public.conversation c ON c.tournament_id = s.id
    LOOP
        -- NOT EXISTS rather than NOT IN: a single NULL in the member set would
        -- make NOT IN delete nothing at all, silently.
        DELETE FROM public.conversation_participant cp
         WHERE cp.conversation_id = v_conv.conv_id
           AND NOT EXISTS (
               SELECT 1 FROM (
                   SELECT t.organizer_id AS pid FROM public.tournaments t WHERE t.id = v_conv.id
                   UNION SELECT co.user_id FROM public.tournament_co_organizers co WHERE co.tournament_id = v_conv.id
                   UNION SELECT m FROM public.tournament_registrations tr
                         CROSS JOIN LATERAL unnest(array_remove(ARRAY[tr.user_id, tr.partner_user_id], NULL)) m
                         WHERE tr.tournament_id = v_conv.id AND tr.status = 'registered'
               ) keep
               WHERE keep.pid = cp.player_id
           );

        INSERT INTO public.conversation_participant (conversation_id, player_id)
        SELECT v_conv.conv_id, x.pid FROM (
               SELECT t.organizer_id AS pid FROM public.tournaments t WHERE t.id = v_conv.id
               UNION SELECT co.user_id FROM public.tournament_co_organizers co WHERE co.tournament_id = v_conv.id
               UNION SELECT m FROM public.tournament_registrations tr
                     CROSS JOIN LATERAL unnest(array_remove(ARRAY[tr.user_id, tr.partner_user_id], NULL)) m
                     WHERE tr.tournament_id = v_conv.id AND tr.status = 'registered'
        ) x
        WHERE x.pid IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM public.conversation_participant cp2
               WHERE cp2.conversation_id = v_conv.conv_id AND cp2.player_id = x.pid
          );
    END LOOP;

    -- ------------------------------------------------------------- assertions
    SELECT count(*) INTO v_bad
      FROM public.tournament_registrations r
      JOIN _s1 s ON s.id = r.tournament_id
      LEFT JOIN public.player_sport ps ON ps.player_id = r.user_id AND ps.sport_id = v_sport
      LEFT JOIN public.player_rating_score prs ON prs.id = ps.active_rating_score_id
      LEFT JOIN public.rating_score rs ON rs.id = prs.rating_score_id
     WHERE r.status = 'registered'
       AND (rs.value IS NULL
            OR (s.min_rating IS NOT NULL AND rs.value < s.min_rating)
            OR (s.max_rating IS NOT NULL AND rs.value > s.max_rating));
    IF v_bad > 0 THEN
        RAISE EXCEPTION 'Série 1 split: % registered entries still out of band.', v_bad;
    END IF;

    SELECT string_agg(x.name || ' (' || x.n || '/' || x.max_part || ')', ', ') INTO v_over
      FROM (
        SELECT s.name, s.max_part,
               (SELECT count(*) FROM public.tournament_registrations r
                 WHERE r.tournament_id = s.id AND r.status IN ('registered', 'pending')) AS n
          FROM _s1 s
      ) x
     WHERE x.n > x.max_part;
    IF v_over IS NOT NULL THEN
        RAISE EXCEPTION 'Série 1 split: draw over capacity: %', v_over;
    END IF;

    IF (SELECT count(*) FROM _s1 WHERE id IS NULL) > 0 THEN
        RAISE EXCEPTION 'Série 1 split: some draws were not created.';
    END IF;

    RAISE NOTICE 'Série 1 split done: 9 draws, % entries rerouted, % duplicates withdrawn, % unrated withdrawn.',
        v_moved, v_pulled, v_orphan;
END $$;
