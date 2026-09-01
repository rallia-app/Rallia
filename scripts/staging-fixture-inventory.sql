-- ============================================================================
-- Staging fixture inventory — read-only
-- ============================================================================
-- Answers "what is actually on staging, and is anything still using it" before
-- anything gets deleted. Deletes nothing, changes nothing.
--
-- The last cleanup (2026-08-29, scripts/leagues/cleanup-staging-spent-fixtures.sql)
-- removed [JDL v2], [SEED] Paid League, [PAYE2E] and [PAYUI%]. Everything below
-- is what has accumulated since, plus what that pass deliberately kept.
--
-- Run:  psql "$STAGING_DB_URL" -f scripts/staging-fixture-inventory.sql
-- ============================================================================

\pset pager off

\echo
\echo '=== Tournament sets: size, age, and whether anyone touched them ==='
SELECT
    CASE
      WHEN name LIKE '[JDL v5]%'   THEN '[JDL v5]  1.4.0 retest (current)'
      WHEN name LIKE '[JDL v4]%'   THEN '[JDL v4]  funnel retest (current)'
      WHEN name LIKE '[JDL-PK]%'   THEN '[JDL-PK]  pool/knockout shapes'
      WHEN name LIKE '[JDL v3]%'   THEN '[JDL v3]  league retest'
      WHEN name LIKE '[JDL v2]%'   THEN '[JDL v2]  superseded'
      WHEN name LIKE '[SEED-T]%'   THEN '[SEED-T]  generic tournament seed'
      WHEN name LIKE '[SEED]%'     THEN '[SEED]    generic seed'
      WHEN name LIKE '[TEST-PK]%'  THEN '[TEST-PK] local pool fixture'
      WHEN name LIKE '[PSE]%'      THEN '[PSE]     participant score entry'
      WHEN name LIKE '[PAY%'       THEN '[PAY*]    paid fixtures'
      WHEN name LIKE '[MOMENTUM]%' THEN '[MOMENTUM]'
      WHEN name ILIKE 'Série 2%'   THEN 'Série 2   LIVE PAID EVENT'
      WHEN name ILIKE 'Série 1%'   THEN 'Série 1   historical'
      ELSE '(unprefixed) ' || left(name, 40)
    END                                            AS set,
    count(*)                                       AS tournois,
    min(created_at)::date                          AS cree,
    max(updated_at)::date                          AS dernier_touche,
    count(*) FILTER (WHERE status IN ('in_progress', 'registration_open')) AS actifs,
    sum((SELECT count(*) FROM tournament_registrations r
          WHERE r.tournament_id = t.id))           AS inscriptions
  FROM tournaments t
 GROUP BY 1
 ORDER BY dernier_touche DESC NULLS LAST;

\echo
\echo '=== League sets ==='
SELECT
    CASE
      WHEN name LIKE '[JDL v3]%'  THEN '[JDL v3]  league retest'
      WHEN name LIKE '[JDL v2]%'  THEN '[JDL v2]  superseded'
      WHEN name LIKE '[SEED-S]%'  THEN '[SEED-S]  session loop'
      WHEN name LIKE '[SEED]%'    THEN '[SEED]    generic seed'
      WHEN name LIKE '[PAY%'      THEN '[PAY*]    paid fixtures'
      ELSE '(unprefixed) ' || left(name, 40)
    END                                   AS set,
    count(*)                              AS ligues,
    min(created_at)::date                 AS cree,
    max(updated_at)::date                 AS dernier_touche,
    sum((SELECT count(*) FROM league_members lm WHERE lm.league_id = l.id)) AS membres,
    sum((SELECT count(*) FROM seasons s WHERE s.league_id = l.id))          AS saisons
  FROM leagues l
 GROUP BY 1
 ORDER BY dernier_touche DESC NULLS LAST;

\echo
\echo '=== Is a REAL person (not a fixture account) registered in any of these? ==='
\echo '=== Anything with a real registrant is not safe to delete blind.       ==='
SELECT
    left(t.name, 45) AS tournoi,
    count(*)         AS vrais_inscrits,
    string_agg(DISTINCT split_part(u.email, '@', 2), ', ') AS domaines
  FROM tournaments t
  JOIN tournament_registrations r ON r.tournament_id = t.id
  JOIN auth.users u ON u.id = r.user_id
 WHERE u.email NOT LIKE '%@fake-rallia.com'
   AND u.email NOT LIKE '%@example.com'
 GROUP BY t.id, t.name
 HAVING count(*) > 0
 ORDER BY count(*) DESC
 LIMIT 40;

\echo
\echo '=== Orphans left behind by earlier reseeds (the replica-mode bug) ==='
SELECT 'seasons sans ligue'        AS quoi, count(*) FROM seasons se
        WHERE NOT EXISTS (SELECT 1 FROM leagues l WHERE l.id = se.league_id)
UNION ALL
SELECT 'sessions sans saison',      count(*) FROM sessions s
        WHERE NOT EXISTS (SELECT 1 FROM seasons se WHERE se.id = s.season_id)
UNION ALL
SELECT 'league_members sans ligue', count(*) FROM league_members lm
        WHERE NOT EXISTS (SELECT 1 FROM leagues l WHERE l.id = lm.league_id)
UNION ALL
SELECT 'notifications orphelines',  count(*) FROM notification n
        WHERE n.target_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM tournaments t WHERE t.id = n.target_id)
          AND NOT EXISTS (SELECT 1 FROM leagues    l WHERE l.id = n.target_id)
          AND NOT EXISTS (SELECT 1 FROM match      m WHERE m.id = n.target_id)
          AND NOT EXISTS (SELECT 1 FROM tournament_matches tm WHERE tm.id = n.target_id);

\echo
\echo '=== Casual fixture games still lying around ==='
SELECT COALESCE(left(m.notes, 30), '(sans note)') AS note,
       count(*) AS parties,
       min(m.match_date) AS de,
       max(m.match_date) AS a
  FROM match m
 WHERE m.notes LIKE '[%'
 GROUP BY 1 ORDER BY 2 DESC LIMIT 20;
