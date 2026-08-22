-- =============================================================================
-- Account deletion: audit columns release the player, and the records that
-- still block auth.admin.deleteUser are reported so delete-account can answer
-- with a reason instead of a 500 (Sentry REACT-NATIVE-EA).
--
-- The nullable "who did it" columns below were NO ACTION, so a player who had
-- approved a registration or resolved a time suggestion could never be deleted.
-- They now SET NULL. The RESTRICT constraints on L&T organizer / participant /
-- score / payment / audit rows are kept on purpose: erasing those needs an
-- anonymization design, not a cascade. Until then delete-account refuses with
-- the breakdown from account_deletion_blockers().
-- =============================================================================

ALTER TABLE public.tournament_registrations
  DROP CONSTRAINT tournament_registrations_approved_by_fkey,
  ADD CONSTRAINT tournament_registrations_approved_by_fkey
    FOREIGN KEY (approved_by) REFERENCES public.player(id) ON DELETE SET NULL;

ALTER TABLE public.league_members
  DROP CONSTRAINT league_members_approved_by_fkey,
  ADD CONSTRAINT league_members_approved_by_fkey
    FOREIGN KEY (approved_by) REFERENCES public.player(id) ON DELETE SET NULL;

ALTER TABLE public.season_members
  DROP CONSTRAINT season_members_invited_by_fkey,
  ADD CONSTRAINT season_members_invited_by_fkey
    FOREIGN KEY (invited_by) REFERENCES public.player(id) ON DELETE SET NULL;

ALTER TABLE public.season_members
  DROP CONSTRAINT season_members_approved_by_fkey,
  ADD CONSTRAINT season_members_approved_by_fkey
    FOREIGN KEY (approved_by) REFERENCES public.player(id) ON DELETE SET NULL;

ALTER TABLE public.session_presence
  DROP CONSTRAINT session_presence_guest_invited_by_fkey,
  ADD CONSTRAINT session_presence_guest_invited_by_fkey
    FOREIGN KEY (guest_invited_by) REFERENCES public.player(id) ON DELETE SET NULL;

ALTER TABLE public.session_match_scores
  DROP CONSTRAINT session_match_scores_validated_by_fkey,
  ADD CONSTRAINT session_match_scores_validated_by_fkey
    FOREIGN KEY (validated_by) REFERENCES public.player(id) ON DELETE SET NULL;

ALTER TABLE public.tournament_match_scores
  DROP CONSTRAINT tournament_match_scores_validated_by_fkey,
  ADD CONSTRAINT tournament_match_scores_validated_by_fkey
    FOREIGN KEY (validated_by) REFERENCES public.player(id) ON DELETE SET NULL;

ALTER TABLE public.match_time_suggestion
  DROP CONSTRAINT match_time_suggestion_resolved_by_fkey,
  ADD CONSTRAINT match_time_suggestion_resolved_by_fkey
    FOREIGN KEY (resolved_by) REFERENCES public.player(id) ON DELETE SET NULL;

-- Service-role only: called by the delete-account edge function before
-- auth.admin.deleteUser. Mirrors the RESTRICT foreign keys onto player; keep
-- it in step when a new RESTRICT reference to player is added.
CREATE OR REPLACE FUNCTION public.account_deletion_blockers(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH c AS (
    SELECT
      (SELECT count(*) FROM public.tournaments t
         WHERE t.organizer_id = p_user_id)                                   AS organized_tournaments,
      (SELECT count(*) FROM public.leagues l
         WHERE l.organizer_id = p_user_id)                                   AS organized_leagues,
      (SELECT count(*) FROM public.tournament_registrations r
         WHERE r.user_id = p_user_id OR r.partner_user_id = p_user_id)       AS tournament_registrations,
      (SELECT count(*) FROM public.tournament_registrations r
         JOIN public.tournaments t ON t.id = r.tournament_id
         WHERE (r.user_id = p_user_id OR r.partner_user_id = p_user_id)
           AND r.status IN ('registered', 'pending', 'waitlisted', 'payment_pending')
           AND t.status IN ('registration_open', 'registration_closed', 'in_progress')) AS active_tournament_registrations,
      (SELECT count(*) FROM public.league_members m
         WHERE m.user_id = p_user_id)                                        AS league_memberships,
      (SELECT count(*) FROM public.league_members m
         JOIN public.leagues l ON l.id = m.league_id
         WHERE m.user_id = p_user_id
           AND m.status IN ('active', 'pending')
           AND l.status IN ('active', 'paused'))                            AS active_league_memberships,
      (SELECT count(*) FROM public.season_members s
         WHERE s.user_id = p_user_id)                                        AS season_memberships,
      (SELECT count(*) FROM public.session_presence s
         WHERE s.user_id = p_user_id)                                        AS session_presences,
      (SELECT count(*) FROM public.tournament_invite_links i
         WHERE i.created_by = p_user_id)
      + (SELECT count(*) FROM public.league_invite_links i
         WHERE i.created_by = p_user_id)                                     AS invite_links_created,
      (SELECT count(*) FROM public.tournament_co_organizers co
         WHERE co.added_by = p_user_id)                                      AS co_organizers_added,
      (SELECT count(*) FROM public.tournament_match_scores s
         WHERE s.submitted_by = p_user_id)
      + (SELECT count(*) FROM public.session_match_scores s
         WHERE s.submitted_by = p_user_id)                                   AS scores_submitted,
      (SELECT count(*) FROM public.leagues_tournaments_audit a
         WHERE a.actor_id = p_user_id)                                       AS audit_entries,
      (SELECT count(*) FROM public.lt_registration_payment p
         WHERE p.payer_user_id = p_user_id OR p.organizer_id = p_user_id)    AS payments
  )
  SELECT jsonb_build_object(
    'ok', (organized_tournaments + organized_leagues + tournament_registrations
           + league_memberships + season_memberships + session_presences
           + invite_links_created + co_organizers_added + scores_submitted
           + audit_entries + payments) = 0,
    'organized_tournaments',           organized_tournaments,
    'organized_leagues',               organized_leagues,
    'tournament_registrations',        tournament_registrations,
    'active_tournament_registrations', active_tournament_registrations,
    'league_memberships',              league_memberships,
    'active_league_memberships',       active_league_memberships,
    'season_memberships',              season_memberships,
    'session_presences',               session_presences,
    'invite_links_created',            invite_links_created,
    'co_organizers_added',             co_organizers_added,
    'scores_submitted',                scores_submitted,
    'audit_entries',                   audit_entries,
    'payments',                        payments
  )
  FROM c;
$$;

REVOKE ALL ON FUNCTION public.account_deletion_blockers(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.account_deletion_blockers(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_deletion_blockers(uuid) TO service_role;

COMMENT ON FUNCTION public.account_deletion_blockers(uuid) IS
  'Counts of rows that RESTRICT deleting this player (leagues & tournaments). ok=false means auth.admin.deleteUser would fail. Service role only.';
