-- ============================================
-- tournament_series_champions(p_name_prefix)
--
-- Champions of a named series, for the Série 2 announcement popup: every
-- completed public tournament run by a certified organizer whose name starts
-- with the prefix, with its winner. The bracket already shows all of this to
-- any signed-in player; this is just a one-round-trip read for a list of
-- draws.
--
-- The champion is the winner of the final: the 'main'-side match with no
-- next_match_id — same derivation as lt_registration_result (latest body:
-- 20260816234500). Names go through lt_registration_display_name so doubles
-- entries read "A & B". The prefix is compared with left(), not LIKE, so
-- caller wildcards are inert, and short prefixes return nothing rather than
-- the whole catalogue.
-- ============================================

CREATE OR REPLACE FUNCTION public.tournament_series_champions(p_name_prefix text)
RETURNS TABLE (
    tournament_id            uuid,
    tournament_name          text,
    completed_at             timestamptz,
    champion_user_id         uuid,
    champion_partner_user_id uuid,
    champion_name            text,
    champion_avatar_url      text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id,
         t.name,
         t.completed_at,
         r.user_id,
         r.partner_user_id,
         public.lt_registration_display_name(r.id),
         p.profile_picture_url
    FROM tournaments t
    JOIN player org ON org.id = t.organizer_id AND org.is_certified_organizer
    CROSS JOIN LATERAL (
        SELECT tm.winner_registration_id
          FROM tournament_matches tm
         WHERE tm.tournament_id = t.id
           AND tm.bracket_side  = 'main'
           AND tm.next_match_id IS NULL
           AND tm.winner_registration_id IS NOT NULL
         LIMIT 1
    ) fm
    JOIN tournament_registrations r ON r.id = fm.winner_registration_id
    JOIN profile p ON p.id = r.user_id
   WHERE char_length(p_name_prefix) >= 3
     AND t.visibility = 'public'
     AND t.status     = 'completed'
     AND left(t.name, char_length(p_name_prefix)) = p_name_prefix
   ORDER BY t.name;
$$;

COMMENT ON FUNCTION public.tournament_series_champions(text) IS
  'Winners of completed public certified-organizer tournaments whose name '
  'starts with the prefix. Read-only feed for series recap surfaces (Série 2 '
  'announcement popup).';

REVOKE ALL ON FUNCTION public.tournament_series_champions(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.tournament_series_champions(text) TO authenticated, service_role;
