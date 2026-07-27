-- Same initplan treatment as 20260727011000, extended to public.is_admin():
-- it is zero-arg (default check_uid = auth.uid()), STABLE, and was still being
-- executed per row in these policies. Wrapping it in a scalar subquery makes it
-- run once per statement.

ALTER POLICY "Admins can delete admin records" ON "public"."admin"
  USING (( SELECT public.is_admin() ));

ALTER POLICY "Admins can insert admin records" ON "public"."admin"
  WITH CHECK (( SELECT public.is_admin() ));

ALTER POLICY "Admins can update admin records" ON "public"."admin"
  USING (( SELECT public.is_admin() ));

ALTER POLICY "Admins can view admin records" ON "public"."admin"
  USING (((id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() )));

ALTER POLICY "Org admins can delete courts" ON "public"."court"
  USING (((EXISTS ( SELECT 1
   FROM public.facility f
  WHERE ((f.id = court.facility_id) AND public.is_org_admin(f.organization_id, ( SELECT auth.uid() AS uid))))) OR ( SELECT public.is_admin() )));

ALTER POLICY "Org staff can create courts" ON "public"."court"
  WITH CHECK (((EXISTS ( SELECT 1
   FROM public.facility f
  WHERE ((f.id = court.facility_id) AND public.is_org_staff(f.organization_id, ( SELECT auth.uid() AS uid))))) OR ( SELECT public.is_admin() )));

ALTER POLICY "Org staff can update courts" ON "public"."court"
  USING (((EXISTS ( SELECT 1
   FROM public.facility f
  WHERE ((f.id = court.facility_id) AND public.is_org_staff(f.organization_id, ( SELECT auth.uid() AS uid))))) OR ( SELECT public.is_admin() )));

ALTER POLICY "Org admins can delete court sports" ON "public"."court_sport"
  USING (((EXISTS ( SELECT 1
   FROM (public.court c
     JOIN public.facility f ON ((f.id = c.facility_id)))
  WHERE ((c.id = court_sport.court_id) AND public.is_org_admin(f.organization_id, ( SELECT auth.uid() AS uid))))) OR ( SELECT public.is_admin() )));

ALTER POLICY "Org staff can create court sports" ON "public"."court_sport"
  WITH CHECK (((EXISTS ( SELECT 1
   FROM (public.court c
     JOIN public.facility f ON ((f.id = c.facility_id)))
  WHERE ((c.id = court_sport.court_id) AND public.is_org_staff(f.organization_id, ( SELECT auth.uid() AS uid))))) OR ( SELECT public.is_admin() )));

ALTER POLICY "Org staff can update court sports" ON "public"."court_sport"
  USING (((EXISTS ( SELECT 1
   FROM (public.court c
     JOIN public.facility f ON ((f.id = c.facility_id)))
  WHERE ((c.id = court_sport.court_id) AND public.is_org_staff(f.organization_id, ( SELECT auth.uid() AS uid))))) OR ( SELECT public.is_admin() )));

ALTER POLICY "Org admins can delete facilities" ON "public"."facility"
  USING ((public.is_org_admin(organization_id, ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() )));

ALTER POLICY "Org staff can create facilities" ON "public"."facility"
  WITH CHECK ((public.is_org_staff(organization_id, ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() )));

ALTER POLICY "Org staff can update facilities" ON "public"."facility"
  USING ((public.is_org_staff(organization_id, ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() )));

ALTER POLICY "Org admins can delete facility contacts" ON "public"."facility_contact"
  USING (((EXISTS ( SELECT 1
   FROM public.facility f
  WHERE ((f.id = facility_contact.facility_id) AND public.is_org_admin(f.organization_id, ( SELECT auth.uid() AS uid))))) OR ( SELECT public.is_admin() )));

ALTER POLICY "Org staff can create facility contacts" ON "public"."facility_contact"
  WITH CHECK (((EXISTS ( SELECT 1
   FROM public.facility f
  WHERE ((f.id = facility_contact.facility_id) AND public.is_org_staff(f.organization_id, ( SELECT auth.uid() AS uid))))) OR ( SELECT public.is_admin() )));

ALTER POLICY "Org staff can update facility contacts" ON "public"."facility_contact"
  USING (((EXISTS ( SELECT 1
   FROM public.facility f
  WHERE ((f.id = facility_contact.facility_id) AND public.is_org_staff(f.organization_id, ( SELECT auth.uid() AS uid))))) OR ( SELECT public.is_admin() )));

ALTER POLICY "Org admins can delete facility images" ON "public"."facility_image"
  USING (((EXISTS ( SELECT 1
   FROM public.facility f
  WHERE ((f.id = facility_image.facility_id) AND public.is_org_admin(f.organization_id, ( SELECT auth.uid() AS uid))))) OR ( SELECT public.is_admin() )));

ALTER POLICY "Org staff can create facility images" ON "public"."facility_image"
  WITH CHECK (((EXISTS ( SELECT 1
   FROM public.facility f
  WHERE ((f.id = facility_image.facility_id) AND public.is_org_staff(f.organization_id, ( SELECT auth.uid() AS uid))))) OR ( SELECT public.is_admin() )));

ALTER POLICY "Org staff can update facility images" ON "public"."facility_image"
  USING (((EXISTS ( SELECT 1
   FROM public.facility f
  WHERE ((f.id = facility_image.facility_id) AND public.is_org_staff(f.organization_id, ( SELECT auth.uid() AS uid))))) OR ( SELECT public.is_admin() )));

ALTER POLICY "Org admins can delete facility sports" ON "public"."facility_sport"
  USING (((EXISTS ( SELECT 1
   FROM public.facility f
  WHERE ((f.id = facility_sport.facility_id) AND public.is_org_admin(f.organization_id, ( SELECT auth.uid() AS uid))))) OR ( SELECT public.is_admin() )));

ALTER POLICY "Org staff can create facility sports" ON "public"."facility_sport"
  WITH CHECK (((EXISTS ( SELECT 1
   FROM public.facility f
  WHERE ((f.id = facility_sport.facility_id) AND public.is_org_staff(f.organization_id, ( SELECT auth.uid() AS uid))))) OR ( SELECT public.is_admin() )));

ALTER POLICY "Org staff can update facility sports" ON "public"."facility_sport"
  USING (((EXISTS ( SELECT 1
   FROM public.facility f
  WHERE ((f.id = facility_sport.facility_id) AND public.is_org_staff(f.organization_id, ( SELECT auth.uid() AS uid))))) OR ( SELECT public.is_admin() )));

ALTER POLICY "linvite_select" ON "public"."league_invite_links"
  USING ((( SELECT public.is_admin() ) OR public.is_league_organizer(league_id)));

ALTER POLICY "lmw_select" ON "public"."league_member_waitlist"
  USING ((( SELECT public.is_admin() ) OR (user_id = ( SELECT auth.uid() AS uid)) OR public.is_league_organizer(league_id)));

ALTER POLICY "lm_select" ON "public"."league_members"
  USING ((( SELECT public.is_admin() ) OR (user_id = ( SELECT auth.uid() AS uid)) OR public.is_league_organizer(league_id) OR public.is_active_league_member(league_id) OR ((status = 'active'::public.league_member_status) AND public.league_is_public(league_id))));

ALTER POLICY "leagues_delete" ON "public"."leagues"
  USING (( SELECT public.is_admin() ));

ALTER POLICY "leagues_select" ON "public"."leagues"
  USING ((( SELECT public.is_admin() ) OR (visibility = 'public'::public.tournament_visibility) OR (organizer_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.league_members m
  WHERE ((m.league_id = leagues.id) AND (m.user_id = ( SELECT auth.uid() AS uid))))) OR ((visibility = 'community'::public.tournament_visibility) AND (network_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.network_member nm
  WHERE ((nm.network_id = leagues.network_id) AND (nm.player_id = ( SELECT auth.uid() AS uid)) AND (nm.status = 'active'::public.network_member_status)))))));

ALTER POLICY "leagues_update" ON "public"."leagues"
  USING ((( SELECT public.is_admin() ) OR public.is_league_organizer(id)))
  WITH CHECK ((( SELECT public.is_admin() ) OR public.is_league_organizer(id)));

ALTER POLICY "audit_select" ON "public"."leagues_tournaments_audit"
  USING ((( SELECT public.is_admin() ) OR ((scope = 'tournament'::public.audit_scope) AND public.is_tournament_organizer(entity_id)) OR ((scope = 'league'::public.audit_scope) AND public.is_league_organizer(entity_id))));

ALTER POLICY "player_consent_select" ON "public"."player_consent"
  USING (((player_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() )));

ALTER POLICY "Player or admin can delete rating scores" ON "public"."player_rating_score"
  USING (((player_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() )));

ALTER POLICY "Player or admin can update rating scores" ON "public"."player_rating_score"
  USING (((player_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() )));

ALTER POLICY "Admins can delete rating scores" ON "public"."rating_score"
  USING (( SELECT public.is_admin() ));

ALTER POLICY "Admins can insert rating scores" ON "public"."rating_score"
  WITH CHECK (( SELECT public.is_admin() ));

ALTER POLICY "Admins can update rating scores" ON "public"."rating_score"
  USING (( SELECT public.is_admin() ));

ALTER POLICY "Admins can delete rating systems" ON "public"."rating_system"
  USING (( SELECT public.is_admin() ));

ALTER POLICY "Admins can insert rating systems" ON "public"."rating_system"
  WITH CHECK (( SELECT public.is_admin() ));

ALTER POLICY "Admins can update rating systems" ON "public"."rating_system"
  USING (( SELECT public.is_admin() ));

ALTER POLICY "season_members_select" ON "public"."season_members"
  USING ((( SELECT public.is_admin() ) OR (user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM (public.seasons s
     JOIN public.leagues l ON ((l.id = s.league_id)))
  WHERE ((s.id = season_members.season_id) AND ((l.visibility = 'public'::public.tournament_visibility) OR public.is_league_organizer(l.id) OR public.is_active_league_member(l.id)))))));

ALTER POLICY "rankings_select" ON "public"."season_rankings"
  USING ((( SELECT public.is_admin() ) OR (EXISTS ( SELECT 1
   FROM (public.seasons s
     JOIN public.leagues l ON ((l.id = s.league_id)))
  WHERE ((s.id = season_rankings.season_id) AND ((l.visibility = 'public'::public.tournament_visibility) OR public.is_league_organizer(l.id) OR public.is_active_league_member(l.id)))))));

ALTER POLICY "seasons_select" ON "public"."seasons"
  USING ((( SELECT public.is_admin() ) OR public.is_league_organizer(league_id) OR public.is_active_league_member(league_id) OR (EXISTS ( SELECT 1
   FROM public.leagues l
  WHERE ((l.id = seasons.league_id) AND (l.visibility = 'public'::public.tournament_visibility))))));

ALTER POLICY "scourts_select" ON "public"."session_courts"
  USING ((( SELECT public.is_admin() ) OR (EXISTS ( SELECT 1
   FROM ((public.sessions ss
     JOIN public.seasons s ON ((s.id = ss.season_id)))
     JOIN public.leagues l ON ((l.id = s.league_id)))
  WHERE ((ss.id = session_courts.session_id) AND ((l.visibility = 'public'::public.tournament_visibility) OR public.is_league_organizer(l.id) OR public.is_active_league_member(l.id)))))));

ALTER POLICY "smscores_select" ON "public"."session_match_scores"
  USING ((( SELECT public.is_admin() ) OR (submitted_by = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM (((public.session_matches m
     JOIN public.sessions ss ON ((ss.id = m.session_id)))
     JOIN public.seasons s ON ((s.id = ss.season_id)))
     JOIN public.leagues l ON ((l.id = s.league_id)))
  WHERE ((m.id = session_match_scores.session_match_id) AND (public.is_league_organizer(l.id) OR public.is_active_league_member(l.id)))))));

ALTER POLICY "smatches_select" ON "public"."session_matches"
  USING ((( SELECT public.is_admin() ) OR (EXISTS ( SELECT 1
   FROM ((public.sessions ss
     JOIN public.seasons s ON ((s.id = ss.season_id)))
     JOIN public.leagues l ON ((l.id = s.league_id)))
  WHERE ((ss.id = session_matches.session_id) AND ((l.visibility = 'public'::public.tournament_visibility) OR public.is_league_organizer(l.id) OR public.is_active_league_member(l.id)))))));

ALTER POLICY "spresence_select" ON "public"."session_presence"
  USING ((( SELECT public.is_admin() ) OR (user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM ((public.sessions ss
     JOIN public.seasons s ON ((s.id = ss.season_id)))
     JOIN public.leagues l ON ((l.id = s.league_id)))
  WHERE ((ss.id = session_presence.session_id) AND (public.is_league_organizer(l.id) OR public.is_active_league_member(l.id)))))));

ALTER POLICY "sessions_select" ON "public"."sessions"
  USING ((( SELECT public.is_admin() ) OR (EXISTS ( SELECT 1
   FROM (public.seasons s
     JOIN public.leagues l ON ((l.id = s.league_id)))
  WHERE ((s.id = sessions.season_id) AND ((l.visibility = 'public'::public.tournament_visibility) OR public.is_league_organizer(l.id) OR public.is_active_league_member(l.id)))))));

ALTER POLICY "Admins can delete sports" ON "public"."sport"
  USING (( SELECT public.is_admin() ));

ALTER POLICY "Admins can insert sports" ON "public"."sport"
  WITH CHECK (( SELECT public.is_admin() ));

ALTER POLICY "Admins can update sports" ON "public"."sport"
  USING (( SELECT public.is_admin() ));

ALTER POLICY "tco_select" ON "public"."tournament_co_organizers"
  USING ((( SELECT public.is_admin() ) OR (user_id = ( SELECT auth.uid() AS uid)) OR public.is_tournament_organizer(tournament_id)));

ALTER POLICY "tinvite_select" ON "public"."tournament_invite_links"
  USING ((( SELECT public.is_admin() ) OR public.is_tournament_organizer(tournament_id)));

ALTER POLICY "tmscores_select" ON "public"."tournament_match_scores"
  USING ((( SELECT public.is_admin() ) OR (submitted_by = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.tournament_matches m
  WHERE ((m.id = tournament_match_scores.tournament_match_id) AND public.is_tournament_organizer(m.tournament_id))))));

ALTER POLICY "tmatches_select" ON "public"."tournament_matches"
  USING ((( SELECT public.is_admin() ) OR public.tournament_is_public(tournament_id) OR public.is_tournament_organizer(tournament_id) OR public.is_tournament_registrant(tournament_id)));

ALTER POLICY "treg_select" ON "public"."tournament_registrations"
  USING ((( SELECT public.is_admin() ) OR (user_id = ( SELECT auth.uid() AS uid)) OR (partner_user_id = ( SELECT auth.uid() AS uid)) OR public.is_tournament_organizer(tournament_id) OR public.tournament_is_public(tournament_id)));

ALTER POLICY "twait_select" ON "public"."tournament_waitlist"
  USING ((( SELECT public.is_admin() ) OR (user_id = ( SELECT auth.uid() AS uid)) OR public.is_tournament_organizer(tournament_id)));

ALTER POLICY "tournaments_delete" ON "public"."tournaments"
  USING (( SELECT public.is_admin() ));

ALTER POLICY "tournaments_select" ON "public"."tournaments"
  USING ((( SELECT public.is_admin() ) OR (visibility = 'public'::public.tournament_visibility) OR (organizer_id = ( SELECT auth.uid() AS uid)) OR public.is_tournament_organizer(id) OR public.is_tournament_registrant(id) OR ((visibility = 'community'::public.tournament_visibility) AND (network_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.network_member nm
  WHERE ((nm.network_id = tournaments.network_id) AND (nm.player_id = ( SELECT auth.uid() AS uid)) AND (nm.status = 'active'::public.network_member_status)))))));

ALTER POLICY "tournaments_update" ON "public"."tournaments"
  USING ((( SELECT public.is_admin() ) OR public.is_tournament_organizer(id)))
  WITH CHECK ((( SELECT public.is_admin() ) OR public.is_tournament_organizer(id)));
