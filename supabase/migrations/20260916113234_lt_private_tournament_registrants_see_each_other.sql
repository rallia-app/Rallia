-- ============================================================================
-- A registrant of a private tournament can see the other registrations.
-- ============================================================================
-- Seen on staging 2026-09-16: a private pool tournament showed its own
-- registrant 1/8 and "?" for every opponent, because treg_select let a
-- non-organizer read other registrations only on a public tournament. The
-- pairings, deadlines, availability and bookings policies all already carry
-- the registrant clause; the roster, which they all resolve names through,
-- was the one that did not. Amended in place (policy text from the live
-- definition, last written by 20260727120000).
-- ============================================================================

ALTER POLICY treg_select ON public.tournament_registrations
USING (
    (SELECT public.is_admin())
    OR user_id = (SELECT auth.uid())
    OR partner_user_id = (SELECT auth.uid())
    OR public.is_tournament_organizer(tournament_id)
    OR public.tournament_is_public(tournament_id)
    OR public.is_tournament_registrant(tournament_id)
);
