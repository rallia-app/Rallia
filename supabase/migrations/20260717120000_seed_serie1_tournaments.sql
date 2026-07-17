-- ============================================================================
-- Seed — Tournois Rallia · Série 1 (Débutant / Intermédiaire / Avancé)
-- ----------------------------------------------------------------------------
-- Committed migration, so it runs on every environment. It resolves the two
-- environment-specific references by STABLE keys rather than UUIDs (which
-- differ per environment):
--   * sport      -> by name = 'tennis'
--   * organizer  -> by profile email = 'jdl.sonkin@gmail.com'
-- If either isn't present (e.g. a fresh local/CI database with no players), the
-- block NO-OPs, keeping those environments green. It only materialises where
-- the organizer account actually exists (staging + prod). Idempotent: once the
-- Série 1 tournaments exist, re-running does nothing.
--
-- Category gating uses min_rating ONLY (the tournament hard gate). max_rating is
-- stored purely for the advertised "1.5–2.5" style range shown in the app; it is
-- NOT enforced at registration by design.
--
-- Format (Série 1): single elimination, 1 set to 8 games (win by 2, TB at 8-8),
-- final best-of-3 sets with a 10-point super tie-break. Draw of 32. Free entry.
-- Seeding is off (max_seeds = 0) — the Série 1 draw is meant to be random, and
-- random seeding isn't built yet, so no seeds are pre-assigned.
-- ============================================================================

DO $$
DECLARE
    v_org    uuid;
    v_sport  uuid;
    v_city   text := 'Grand Montréal';  -- shown on discovery cards; venue itself is player-chosen

    -- One-week signup window; 15-day play cycle for a full 32-draw
    -- (5 rounds x 3 days). Tournaments are seeded as 'draft': the organizer
    -- opens registration from the app when ready, so these dates are the plan.
    v_opens  timestamptz := '2026-07-21 12:00:00+00';  -- inscriptions ouvertes
    v_closes timestamptz := '2026-07-28 12:00:00+00';  -- limite d'inscription (1 semaine)
    v_start  timestamptz := '2026-07-29 12:00:00+00';  -- tirage / tour 1
    v_end    timestamptz := '2026-08-13 12:00:00+00';  -- +15 jours

    v_rules  text := concat_ws(E'\n',
        'Format : simple, tableau à élimination directe (jusqu''à 32 joueurs).',
        'Sets : 1 set en 8 jeux gagnants, écart de 2 jeux, tie-break à 8-8. Finale en 2 sets gagnants avec super tie-break à 10 points si un set partout.',
        'Délai : 3 jours maximum pour jouer chaque tour et entrer le score. Le vainqueur entre le score, le perdant l''approuve.',
        'Lieu et terrain : à convenir entre les 2 joueurs, à leur charge.',
        'Balles : chaque joueur apporte une boîte neuve, un tirage au pile ou face détermine laquelle est ouverte.',
        'Météo : si les conditions deviennent défavorables, arrêtez la partie et reprenez plus tard, mais le délai de 3 jours reste applicable.',
        'Forfait automatique : litige insoluble sur le vainqueur (les 2 forfait), partie non jouée dans les 3 jours, joueur injoignable ou indisponible, retrait pour blessure ou raison personnelle.',
        'Communication : utilisez le chat du tournoi. Contactez l''équipe Rallia en cas de problème majeur.'
    );
BEGIN
    SELECT id INTO v_sport FROM public.sport WHERE name = 'tennis';

    SELECT p.id INTO v_org
      FROM public.player p
      JOIN public.profile pr ON pr.id = p.id
     WHERE lower(pr.email) = 'jdl.sonkin@gmail.com';

    IF v_org IS NULL OR v_sport IS NULL THEN
        RAISE NOTICE 'Série 1 seed skipped: tennis sport or organizer jdl.sonkin@gmail.com not present in this environment.';
        RETURN;
    END IF;

    -- Points Rallia only accrue for certified organizers. Certify the official
    -- Série 1 host so completed brackets award ranking points.
    UPDATE public.player
       SET is_certified_organizer = true,
           certified_organizer_at = COALESCE(certified_organizer_at, now())
     WHERE id = v_org
       AND is_certified_organizer = false;

    -- Idempotency: skip if the Série 1 set was already seeded.
    IF EXISTS (
        SELECT 1 FROM public.tournaments
         WHERE name LIKE 'Tournois Rallia — Série 1 ·%'
    ) THEN
        RAISE NOTICE 'Série 1 tournaments already present; skipping seed.';
        RETURN;
    END IF;

    INSERT INTO public.tournaments (
        name, description, rules, sport_id, organizer_id,
        visibility, registration_mode, status,
        level, categories, min_rating, max_rating, city,
        max_participants, bracket_type, match_format, games_per_set,
        final_set_tiebreak, entry_format, seeding_enabled, max_seeds,
        registration_opens_at, registration_closes_at, start_date, end_date
    )
    VALUES
    (
        'Tournois Rallia — Série 1 · Débutant',
        'Catégorie Débutant (niveau 1.5 à 2.5). Tournoi gratuit, ouvert à tous les joueurs du Grand Montréal, géré sur Rallia.',
        v_rules, v_sport, v_org,
        'public', 'open', 'draft',
        'Débutant', ARRAY['Débutant'], 1.5, 2.5, v_city,
        32, 'single_elimination', 'one_set', 8,
        'super_tb_10pt', 'singles', false, 0,
        v_opens, v_closes, v_start, v_end
    ),
    (
        'Tournois Rallia — Série 1 · Intermédiaire',
        'Catégorie Intermédiaire (niveau 3.0 à 3.5). Tournoi gratuit, ouvert à tous les joueurs du Grand Montréal, géré sur Rallia.',
        v_rules, v_sport, v_org,
        'public', 'open', 'draft',
        'Intermédiaire', ARRAY['Intermédiaire'], 3.0, 3.5, v_city,
        32, 'single_elimination', 'one_set', 8,
        'super_tb_10pt', 'singles', false, 0,
        v_opens, v_closes, v_start, v_end
    ),
    (
        'Tournois Rallia — Série 1 · Avancé',
        'Catégorie Avancé (niveau 4.0 et plus). Tournoi gratuit, ouvert à tous les joueurs du Grand Montréal, géré sur Rallia.',
        v_rules, v_sport, v_org,
        'public', 'open', 'draft',
        'Avancé', ARRAY['Avancé'], 4.0, NULL, v_city,
        32, 'single_elimination', 'one_set', 8,
        'super_tb_10pt', 'singles', false, 0,
        v_opens, v_closes, v_start, v_end
    );

    RAISE NOTICE 'Seeded 3 Série 1 tournaments (organizer %, sport tennis).', v_org;
END $$;
