-- Fix all auth_rls_initplan advisor warnings: wrap auth.uid()/auth.role() in a
-- scalar subquery so Postgres evaluates it once per statement instead of per row.
-- Amends the live policies in place (ALTER POLICY); expressions otherwise
-- unchanged, regenerated from pg_policies with search_path='' so references
-- are schema-qualified.

ALTER POLICY "Admins can view admin records" ON "public"."admin"
  USING (((id = ( SELECT auth.uid() )) OR public.is_admin()));

ALTER POLICY "Admins can update their alerts" ON "public"."admin_alert"
  USING ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE ((admin.id = ( SELECT auth.uid() )) AND ((admin.role)::text = ANY (admin_alert.target_roles))))));

ALTER POLICY "Admins can view their alerts" ON "public"."admin_alert"
  USING ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE ((admin.id = ( SELECT auth.uid() )) AND ((admin.role)::text = ANY (admin_alert.target_roles))))));

ALTER POLICY "Admins can manage their preferences" ON "public"."admin_alert_preference"
  USING ((admin_id IN ( SELECT admin.id
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Admins can view audit logs" ON "public"."admin_audit_log"
  USING ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Audit logs are insert-only via function" ON "public"."admin_audit_log"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Admins can delete own devices" ON "public"."admin_device"
  USING ((admin_id IN ( SELECT admin.id
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Admins can insert own devices" ON "public"."admin_device"
  WITH CHECK ((admin_id IN ( SELECT admin.id
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Admins can update own devices" ON "public"."admin_device"
  USING ((admin_id IN ( SELECT admin.id
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Admins can view own devices" ON "public"."admin_device"
  USING ((admin_id IN ( SELECT admin.id
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "admin_settings_modify_policy" ON "public"."admin_settings"
  USING ((EXISTS ( SELECT 1
   FROM public.admin a
  WHERE ((a.id = ( SELECT auth.uid() )) AND (a.role = 'super_admin'::public.admin_role_enum)))));

ALTER POLICY "admin_settings_select_policy" ON "public"."admin_settings"
  USING ((EXISTS ( SELECT 1
   FROM public.admin a
  WHERE (a.id = ( SELECT auth.uid() )))));

ALTER POLICY "Admins can read analytics snapshots" ON "public"."analytics_snapshot"
  USING ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "availability_block_delete_org_staff" ON "public"."availability_block"
  USING ((EXISTS ( SELECT 1
   FROM (public.organization_member om
     JOIN public.facility f ON ((f.organization_id = om.organization_id)))
  WHERE ((f.id = availability_block.facility_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));

ALTER POLICY "availability_block_insert_org_staff" ON "public"."availability_block"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.organization_member om
     JOIN public.facility f ON ((f.organization_id = om.organization_id)))
  WHERE ((f.id = availability_block.facility_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));

ALTER POLICY "availability_block_select_org_members" ON "public"."availability_block"
  USING ((EXISTS ( SELECT 1
   FROM (public.organization_member om
     JOIN public.facility f ON ((f.organization_id = om.organization_id)))
  WHERE ((f.id = availability_block.facility_id) AND (om.user_id = ( SELECT auth.uid() ))))));

ALTER POLICY "availability_block_update_org_staff" ON "public"."availability_block"
  USING ((EXISTS ( SELECT 1
   FROM (public.organization_member om
     JOIN public.facility f ON ((f.organization_id = om.organization_id)))
  WHERE ((f.id = availability_block.facility_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));

ALTER POLICY "booking_delete_org_admin" ON "public"."booking"
  USING ((EXISTS ( SELECT 1
   FROM ((public.court c
     JOIN public.facility f ON ((f.id = c.facility_id)))
     JOIN public.organization_member om ON ((om.organization_id = f.organization_id)))
  WHERE ((c.id = booking.court_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.left_at IS NULL) AND (om.role = ANY (ARRAY['owner'::public.member_role, 'admin'::public.member_role]))))));

ALTER POLICY "booking_insert_org_staff" ON "public"."booking"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM ((public.court c
     JOIN public.facility f ON ((f.id = c.facility_id)))
     JOIN public.organization_member om ON ((om.organization_id = f.organization_id)))
  WHERE ((c.id = booking.court_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.left_at IS NULL) AND (om.role = ANY (ARRAY['owner'::public.member_role, 'admin'::public.member_role, 'staff'::public.member_role]))))));

ALTER POLICY "booking_insert_own" ON "public"."booking"
  WITH CHECK (((player_id IS NOT NULL) AND (player_id = ( SELECT auth.uid() ))));

ALTER POLICY "booking_select_org_staff" ON "public"."booking"
  USING ((EXISTS ( SELECT 1
   FROM ((public.court c
     JOIN public.facility f ON ((f.id = c.facility_id)))
     JOIN public.organization_member om ON ((om.organization_id = f.organization_id)))
  WHERE ((c.id = booking.court_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.left_at IS NULL)))));

ALTER POLICY "booking_select_own" ON "public"."booking"
  USING (((player_id IS NOT NULL) AND (player_id = ( SELECT auth.uid() ))));

ALTER POLICY "booking_update_org_staff" ON "public"."booking"
  USING ((EXISTS ( SELECT 1
   FROM ((public.court c
     JOIN public.facility f ON ((f.id = c.facility_id)))
     JOIN public.organization_member om ON ((om.organization_id = f.organization_id)))
  WHERE ((c.id = booking.court_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.left_at IS NULL) AND (om.role = ANY (ARRAY['owner'::public.member_role, 'admin'::public.member_role, 'staff'::public.member_role]))))));

ALTER POLICY "booking_update_own" ON "public"."booking"
  USING (((player_id IS NOT NULL) AND (player_id = ( SELECT auth.uid() ))));

ALTER POLICY "cancellation_policy_insert_org_owner" ON "public"."cancellation_policy"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = cancellation_policy.organization_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.role = 'owner'::public.member_role)))));

ALTER POLICY "cancellation_policy_update_org_staff" ON "public"."cancellation_policy"
  USING ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = cancellation_policy.organization_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));

ALTER POLICY "Creator can delete conversation" ON "public"."conversation"
  USING ((created_by = ( SELECT auth.uid() )));

ALTER POLICY "Creator can update conversation" ON "public"."conversation"
  USING ((created_by = ( SELECT auth.uid() )));

ALTER POLICY "Participants can view conversations" ON "public"."conversation"
  USING (((created_by = ( SELECT auth.uid() )) OR public.is_conversation_participant(id, ( SELECT auth.uid() ))));

ALTER POLICY "Users can add participants to conversations" ON "public"."conversation_participant"
  WITH CHECK (((EXISTS ( SELECT 1
   FROM public.conversation c
  WHERE ((c.id = conversation_participant.conversation_id) AND (c.created_by = ( SELECT auth.uid() ))))) OR (conversation_id IN ( SELECT public.get_user_conversation_ids(( SELECT auth.uid() )) AS get_user_conversation_ids)) OR (player_id = ( SELECT auth.uid() ))));

ALTER POLICY "Users can leave conversations" ON "public"."conversation_participant"
  USING (((player_id = ( SELECT auth.uid() )) AND (NOT public.is_announcement_conversation(conversation_id))));

ALTER POLICY "Users can update own participation" ON "public"."conversation_participant"
  USING ((player_id = ( SELECT auth.uid() )))
  WITH CHECK ((player_id = ( SELECT auth.uid() )));

ALTER POLICY "Users can view co-participants" ON "public"."conversation_participant"
  USING (((conversation_id IN ( SELECT public.get_user_conversation_ids(( SELECT auth.uid() )) AS get_user_conversation_ids)) AND (NOT public.is_announcement_conversation(conversation_id))));

ALTER POLICY "Users can view own participations" ON "public"."conversation_participant"
  USING ((player_id = ( SELECT auth.uid() )));

ALTER POLICY "Org admins can delete courts" ON "public"."court"
  USING (((EXISTS ( SELECT 1
   FROM public.facility f
  WHERE ((f.id = court.facility_id) AND public.is_org_admin(f.organization_id, ( SELECT auth.uid() ))))) OR public.is_admin()));

ALTER POLICY "Org staff can create courts" ON "public"."court"
  WITH CHECK (((EXISTS ( SELECT 1
   FROM public.facility f
  WHERE ((f.id = court.facility_id) AND public.is_org_staff(f.organization_id, ( SELECT auth.uid() ))))) OR public.is_admin()));

ALTER POLICY "Org staff can update courts" ON "public"."court"
  USING (((EXISTS ( SELECT 1
   FROM public.facility f
  WHERE ((f.id = court.facility_id) AND public.is_org_staff(f.organization_id, ( SELECT auth.uid() ))))) OR public.is_admin()));

ALTER POLICY "one_time_availability_delete_org_staff" ON "public"."court_one_time_availability"
  USING ((EXISTS ( SELECT 1
   FROM (public.organization_member om
     JOIN public.facility f ON ((f.organization_id = om.organization_id)))
  WHERE ((f.id = court_one_time_availability.facility_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));

ALTER POLICY "one_time_availability_insert_org_staff" ON "public"."court_one_time_availability"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.organization_member om
     JOIN public.facility f ON ((f.organization_id = om.organization_id)))
  WHERE ((f.id = court_one_time_availability.facility_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));

ALTER POLICY "one_time_availability_select_authenticated" ON "public"."court_one_time_availability"
  USING ((( SELECT auth.role() ) = 'authenticated'::text));

ALTER POLICY "one_time_availability_select_org_members" ON "public"."court_one_time_availability"
  USING ((EXISTS ( SELECT 1
   FROM (public.organization_member om
     JOIN public.facility f ON ((f.organization_id = om.organization_id)))
  WHERE ((f.id = court_one_time_availability.facility_id) AND (om.user_id = ( SELECT auth.uid() ))))));

ALTER POLICY "one_time_availability_update_org_staff" ON "public"."court_one_time_availability"
  USING ((EXISTS ( SELECT 1
   FROM (public.organization_member om
     JOIN public.facility f ON ((f.organization_id = om.organization_id)))
  WHERE ((f.id = court_one_time_availability.facility_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));

ALTER POLICY "Org admins can delete court slots" ON "public"."court_slot"
  USING ((EXISTS ( SELECT 1
   FROM (public.court c
     JOIN public.facility f ON ((f.id = c.facility_id)))
  WHERE ((c.id = court_slot.court_id) AND public.is_org_admin(f.organization_id, ( SELECT auth.uid() ))))));

ALTER POLICY "Org staff can create court slots" ON "public"."court_slot"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.court c
     JOIN public.facility f ON ((f.id = c.facility_id)))
  WHERE ((c.id = court_slot.court_id) AND public.is_org_staff(f.organization_id, ( SELECT auth.uid() ))))));

ALTER POLICY "Org staff can update court slots" ON "public"."court_slot"
  USING ((EXISTS ( SELECT 1
   FROM (public.court c
     JOIN public.facility f ON ((f.id = c.facility_id)))
  WHERE ((c.id = court_slot.court_id) AND public.is_org_staff(f.organization_id, ( SELECT auth.uid() ))))));

ALTER POLICY "Org admins can delete court sports" ON "public"."court_sport"
  USING (((EXISTS ( SELECT 1
   FROM (public.court c
     JOIN public.facility f ON ((f.id = c.facility_id)))
  WHERE ((c.id = court_sport.court_id) AND public.is_org_admin(f.organization_id, ( SELECT auth.uid() ))))) OR public.is_admin()));

ALTER POLICY "Org staff can create court sports" ON "public"."court_sport"
  WITH CHECK (((EXISTS ( SELECT 1
   FROM (public.court c
     JOIN public.facility f ON ((f.id = c.facility_id)))
  WHERE ((c.id = court_sport.court_id) AND public.is_org_staff(f.organization_id, ( SELECT auth.uid() ))))) OR public.is_admin()));

ALTER POLICY "Org staff can update court sports" ON "public"."court_sport"
  USING (((EXISTS ( SELECT 1
   FROM (public.court c
     JOIN public.facility f ON ((f.id = c.facility_id)))
  WHERE ((c.id = court_sport.court_id) AND public.is_org_staff(f.organization_id, ( SELECT auth.uid() ))))) OR public.is_admin()));

ALTER POLICY "Admins can view all delivery attempts" ON "public"."delivery_attempt"
  USING ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Users can view own delivery attempts" ON "public"."delivery_attempt"
  USING ((EXISTS ( SELECT 1
   FROM public.notification n
  WHERE ((n.id = delivery_attempt.notification_id) AND (n.user_id = ( SELECT auth.uid() ))))));

ALTER POLICY "Org admins can delete facilities" ON "public"."facility"
  USING ((public.is_org_admin(organization_id, ( SELECT auth.uid() )) OR public.is_admin()));

ALTER POLICY "Org staff can create facilities" ON "public"."facility"
  WITH CHECK ((public.is_org_staff(organization_id, ( SELECT auth.uid() )) OR public.is_admin()));

ALTER POLICY "Org staff can update facilities" ON "public"."facility"
  USING ((public.is_org_staff(organization_id, ( SELECT auth.uid() )) OR public.is_admin()));

ALTER POLICY "Org admins can delete facility contacts" ON "public"."facility_contact"
  USING (((EXISTS ( SELECT 1
   FROM public.facility f
  WHERE ((f.id = facility_contact.facility_id) AND public.is_org_admin(f.organization_id, ( SELECT auth.uid() ))))) OR public.is_admin()));

ALTER POLICY "Org staff can create facility contacts" ON "public"."facility_contact"
  WITH CHECK (((EXISTS ( SELECT 1
   FROM public.facility f
  WHERE ((f.id = facility_contact.facility_id) AND public.is_org_staff(f.organization_id, ( SELECT auth.uid() ))))) OR public.is_admin()));

ALTER POLICY "Org staff can update facility contacts" ON "public"."facility_contact"
  USING (((EXISTS ( SELECT 1
   FROM public.facility f
  WHERE ((f.id = facility_contact.facility_id) AND public.is_org_staff(f.organization_id, ( SELECT auth.uid() ))))) OR public.is_admin()));

ALTER POLICY "Org members can delete facility files" ON "public"."facility_file"
  USING ((EXISTS ( SELECT 1
   FROM (public.facility f
     JOIN public.organization_member om ON ((om.organization_id = f.organization_id)))
  WHERE ((f.id = facility_file.facility_id) AND (om.user_id = ( SELECT auth.uid() ))))));

ALTER POLICY "Org members can insert facility files" ON "public"."facility_file"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.facility f
     JOIN public.organization_member om ON ((om.organization_id = f.organization_id)))
  WHERE ((f.id = facility_file.facility_id) AND (om.user_id = ( SELECT auth.uid() ))))));

ALTER POLICY "Org members can update facility files" ON "public"."facility_file"
  USING ((EXISTS ( SELECT 1
   FROM (public.facility f
     JOIN public.organization_member om ON ((om.organization_id = f.organization_id)))
  WHERE ((f.id = facility_file.facility_id) AND (om.user_id = ( SELECT auth.uid() ))))));

ALTER POLICY "Org admins can delete facility images" ON "public"."facility_image"
  USING (((EXISTS ( SELECT 1
   FROM public.facility f
  WHERE ((f.id = facility_image.facility_id) AND public.is_org_admin(f.organization_id, ( SELECT auth.uid() ))))) OR public.is_admin()));

ALTER POLICY "Org staff can create facility images" ON "public"."facility_image"
  WITH CHECK (((EXISTS ( SELECT 1
   FROM public.facility f
  WHERE ((f.id = facility_image.facility_id) AND public.is_org_staff(f.organization_id, ( SELECT auth.uid() ))))) OR public.is_admin()));

ALTER POLICY "Org staff can update facility images" ON "public"."facility_image"
  USING (((EXISTS ( SELECT 1
   FROM public.facility f
  WHERE ((f.id = facility_image.facility_id) AND public.is_org_staff(f.organization_id, ( SELECT auth.uid() ))))) OR public.is_admin()));

ALTER POLICY "Admins can update facility reports" ON "public"."facility_report"
  USING ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Admins can view all facility reports" ON "public"."facility_report"
  USING ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Players can create facility reports" ON "public"."facility_report"
  WITH CHECK ((reporter_id = ( SELECT auth.uid() )));

ALTER POLICY "Players can view own facility reports" ON "public"."facility_report"
  USING ((reporter_id = ( SELECT auth.uid() )));

ALTER POLICY "Org admins can delete facility sports" ON "public"."facility_sport"
  USING (((EXISTS ( SELECT 1
   FROM public.facility f
  WHERE ((f.id = facility_sport.facility_id) AND public.is_org_admin(f.organization_id, ( SELECT auth.uid() ))))) OR public.is_admin()));

ALTER POLICY "Org staff can create facility sports" ON "public"."facility_sport"
  WITH CHECK (((EXISTS ( SELECT 1
   FROM public.facility f
  WHERE ((f.id = facility_sport.facility_id) AND public.is_org_staff(f.organization_id, ( SELECT auth.uid() ))))) OR public.is_admin()));

ALTER POLICY "Org staff can update facility sports" ON "public"."facility_sport"
  USING (((EXISTS ( SELECT 1
   FROM public.facility f
  WHERE ((f.id = facility_sport.facility_id) AND public.is_org_staff(f.organization_id, ( SELECT auth.uid() ))))) OR public.is_admin()));

ALTER POLICY "Users can submit feedback" ON "public"."feedback"
  WITH CHECK (((( SELECT auth.uid() ) = player_id) OR (player_id IS NULL)));

ALTER POLICY "Users can view own feedback" ON "public"."feedback"
  USING ((( SELECT auth.uid() ) = player_id));

ALTER POLICY "Users can delete their own vote" ON "public"."feedback_vote"
  USING ((( SELECT auth.uid() ) = player_id));

ALTER POLICY "Users can insert their own vote" ON "public"."feedback_vote"
  WITH CHECK ((( SELECT auth.uid() ) = player_id));

ALTER POLICY "Authenticated users can insert files" ON "public"."file"
  WITH CHECK ((uploaded_by = ( SELECT auth.uid() )));

ALTER POLICY "Users can delete their own files" ON "public"."file"
  USING ((uploaded_by = ( SELECT auth.uid() )));

ALTER POLICY "Users can update their own files" ON "public"."file"
  USING ((uploaded_by = ( SELECT auth.uid() )))
  WITH CHECK ((uploaded_by = ( SELECT auth.uid() )));

ALTER POLICY "Members can view group activity" ON "public"."group_activity"
  USING (((network_id IN ( SELECT network_member.network_id
   FROM public.network_member
  WHERE ((network_member.player_id = ( SELECT auth.uid() )) AND (network_member.status = 'active'::public.network_member_status)))) OR (network_id IN ( SELECT network.id
   FROM public.network
  WHERE (network.created_by = ( SELECT auth.uid() ))))));

ALTER POLICY "System can insert group activity" ON "public"."group_activity"
  WITH CHECK (((network_id IN ( SELECT network_member.network_id
   FROM public.network_member
  WHERE ((network_member.player_id = ( SELECT auth.uid() )) AND (network_member.status = 'active'::public.network_member_status)))) OR (network_id IN ( SELECT network.id
   FROM public.network
  WHERE (network.created_by = ( SELECT auth.uid() ))))));

ALTER POLICY "instructors_view_own" ON "public"."instructor_profile"
  USING ((organization_member_id IN ( SELECT organization_member.id
   FROM public.organization_member
  WHERE (organization_member.user_id = ( SELECT auth.uid() )))));

ALTER POLICY "org_admins_manage_instructors" ON "public"."instructor_profile"
  USING ((organization_id IN ( SELECT organization_member.organization_id
   FROM public.organization_member
  WHERE ((organization_member.user_id = ( SELECT auth.uid() )) AND (organization_member.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));

ALTER POLICY "org_members_view_instructors" ON "public"."instructor_profile"
  USING ((organization_id IN ( SELECT organization_member.organization_id
   FROM public.organization_member
  WHERE (organization_member.user_id = ( SELECT auth.uid() )))));

ALTER POLICY "Inviter can update invitations" ON "public"."invitation"
  USING ((inviter_id = ( SELECT auth.uid() )));

ALTER POLICY "Inviter or admin can delete invitations" ON "public"."invitation"
  USING (((inviter_id = ( SELECT auth.uid() )) OR (EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() ))))));

ALTER POLICY "Users can create invitations" ON "public"."invitation"
  WITH CHECK ((inviter_id = ( SELECT auth.uid() )));

ALTER POLICY "Users can view their invitations" ON "public"."invitation"
  USING (((inviter_id = ( SELECT auth.uid() )) OR (invited_user_id = ( SELECT auth.uid() ))));

ALTER POLICY "lmw_select" ON "public"."league_member_waitlist"
  USING ((public.is_admin() OR (user_id = ( SELECT auth.uid() )) OR public.is_league_organizer(league_id)));

ALTER POLICY "lm_select" ON "public"."league_members"
  USING ((public.is_admin() OR (user_id = ( SELECT auth.uid() )) OR public.is_league_organizer(league_id) OR public.is_active_league_member(league_id) OR ((status = 'active'::public.league_member_status) AND public.league_is_public(league_id))));

ALTER POLICY "leagues_insert" ON "public"."leagues"
  WITH CHECK ((organizer_id = ( SELECT auth.uid() )));

ALTER POLICY "leagues_select" ON "public"."leagues"
  USING ((public.is_admin() OR (visibility = 'public'::public.tournament_visibility) OR (organizer_id = ( SELECT auth.uid() )) OR (EXISTS ( SELECT 1
   FROM public.league_members m
  WHERE ((m.league_id = leagues.id) AND (m.user_id = ( SELECT auth.uid() ))))) OR ((visibility = 'community'::public.tournament_visibility) AND (network_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.network_member nm
  WHERE ((nm.network_id = leagues.network_id) AND (nm.player_id = ( SELECT auth.uid() )) AND (nm.status = 'active'::public.network_member_status)))))));

ALTER POLICY "lt_reg_payment_read_organizer" ON "public"."lt_registration_payment"
  USING ((organizer_id = ( SELECT auth.uid() )));

ALTER POLICY "lt_reg_payment_read_payer" ON "public"."lt_registration_payment"
  USING ((payer_user_id = ( SELECT auth.uid() )));

ALTER POLICY "match_delete_creator" ON "public"."match"
  USING ((created_by = ( SELECT auth.uid() )));

ALTER POLICY "match_insert" ON "public"."match"
  WITH CHECK ((created_by = ( SELECT auth.uid() )));

ALTER POLICY "match_select_creator" ON "public"."match"
  USING ((created_by = ( SELECT auth.uid() )));

ALTER POLICY "match_select_participant" ON "public"."match"
  USING (public.is_match_participant(id, ( SELECT auth.uid() )));

ALTER POLICY "match_select_private_in_shared_community" ON "public"."match"
  USING (((visibility = 'private'::public.match_visibility_enum) AND (visible_in_communities = true) AND public.shares_active_network_of_type(created_by, ( SELECT auth.uid() ), 'community'::text)));

ALTER POLICY "match_select_private_in_shared_group" ON "public"."match"
  USING (((visibility = 'private'::public.match_visibility_enum) AND (visible_in_groups = true) AND public.shares_active_network_of_type(created_by, ( SELECT auth.uid() ), 'player_group'::text)));

ALTER POLICY "match_update_creator" ON "public"."match"
  USING ((created_by = ( SELECT auth.uid() )));

ALTER POLICY "match_feedback_insert" ON "public"."match_feedback"
  WITH CHECK (((reviewer_id = ( SELECT auth.uid() )) AND public.is_match_participant(match_id, ( SELECT auth.uid() ))));

ALTER POLICY "match_feedback_select" ON "public"."match_feedback"
  USING (((reviewer_id = ( SELECT auth.uid() )) OR (opponent_id = ( SELECT auth.uid() )) OR public.is_match_participant(match_id, ( SELECT auth.uid() ))));

ALTER POLICY "match_network_delete_policy" ON "public"."match_network"
  USING ((posted_by = ( SELECT auth.uid() )));

ALTER POLICY "match_network_insert_policy" ON "public"."match_network"
  WITH CHECK (((EXISTS ( SELECT 1
   FROM public.network_member nm
  WHERE ((nm.network_id = nm.network_id) AND (nm.player_id = ( SELECT auth.uid() )) AND (nm.status = 'active'::public.network_member_status)))) AND ((EXISTS ( SELECT 1
   FROM public.match_participant mp
  WHERE ((mp.match_id = mp.match_id) AND (mp.player_id = ( SELECT auth.uid() ))))) OR (EXISTS ( SELECT 1
   FROM public.match m
  WHERE ((m.id = match_network.match_id) AND (m.created_by = ( SELECT auth.uid() ))))))));

ALTER POLICY "match_network_select_policy" ON "public"."match_network"
  USING ((EXISTS ( SELECT 1
   FROM public.network_member nm
  WHERE ((nm.network_id = match_network.network_id) AND (nm.player_id = ( SELECT auth.uid() )) AND (nm.status = 'active'::public.network_member_status)))));

ALTER POLICY "match_participant_delete_creator" ON "public"."match_participant"
  USING (public.is_match_creator(match_id, ( SELECT auth.uid() )));

ALTER POLICY "match_participant_delete_self" ON "public"."match_participant"
  USING ((player_id = ( SELECT auth.uid() )));

ALTER POLICY "match_participant_insert_creator" ON "public"."match_participant"
  WITH CHECK ((public.is_match_creator(match_id, ( SELECT auth.uid() )) OR (player_id = ( SELECT auth.uid() ))));

ALTER POLICY "match_participant_select_coparticipant" ON "public"."match_participant"
  USING (public.is_match_participant(match_id, ( SELECT auth.uid() )));

ALTER POLICY "match_participant_select_creator" ON "public"."match_participant"
  USING (public.is_match_creator(match_id, ( SELECT auth.uid() )));

ALTER POLICY "match_participant_select_self" ON "public"."match_participant"
  USING ((player_id = ( SELECT auth.uid() )));

ALTER POLICY "match_participant_update_creator" ON "public"."match_participant"
  USING (public.is_match_creator(match_id, ( SELECT auth.uid() )));

ALTER POLICY "match_participant_update_self" ON "public"."match_participant"
  USING ((player_id = ( SELECT auth.uid() )))
  WITH CHECK ((player_id = ( SELECT auth.uid() )));

ALTER POLICY "match_report_insert" ON "public"."match_report"
  WITH CHECK (((reporter_id = ( SELECT auth.uid() )) AND public.is_match_participant(match_id, ( SELECT auth.uid() ))));

ALTER POLICY "match_report_select" ON "public"."match_report"
  USING ((reporter_id = ( SELECT auth.uid() )));

ALTER POLICY "Admins can delete match results" ON "public"."match_result"
  USING ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Match creator can insert results" ON "public"."match_result"
  WITH CHECK ((match_id IN ( SELECT m.id
   FROM public.match m
  WHERE (m.created_by = ( SELECT auth.uid() )))));

ALTER POLICY "Match creator can update results" ON "public"."match_result"
  USING ((match_id IN ( SELECT m.id
   FROM public.match m
  WHERE (m.created_by = ( SELECT auth.uid() )))));

ALTER POLICY "Match participants can view results" ON "public"."match_result"
  USING (((match_id IN ( SELECT mp.match_id
   FROM public.match_participant mp
  WHERE (mp.player_id = ( SELECT auth.uid() )))) OR (match_id IN ( SELECT m.id
   FROM public.match m
  WHERE (m.created_by = ( SELECT auth.uid() ))))));

ALTER POLICY "Match participants can delete match sets" ON "public"."match_set"
  USING ((EXISTS ( SELECT 1
   FROM (public.match_result mr
     JOIN public.match_participant mp ON ((mp.match_id = mr.match_id)))
  WHERE ((mr.id = match_set.match_result_id) AND (mp.player_id = ( SELECT auth.uid() ))))));

ALTER POLICY "Match participants can insert match sets" ON "public"."match_set"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.match_result mr
     JOIN public.match_participant mp ON ((mp.match_id = mr.match_id)))
  WHERE ((mr.id = match_set.match_result_id) AND (mp.player_id = ( SELECT auth.uid() ))))));

ALTER POLICY "Match participants can update match sets" ON "public"."match_set"
  USING ((EXISTS ( SELECT 1
   FROM (public.match_result mr
     JOIN public.match_participant mp ON ((mp.match_id = mr.match_id)))
  WHERE ((mr.id = match_set.match_result_id) AND (mp.player_id = ( SELECT auth.uid() ))))));

ALTER POLICY "Users can create match shares" ON "public"."match_share"
  WITH CHECK ((( SELECT auth.uid() ) = shared_by));

ALTER POLICY "Users can delete their own match shares" ON "public"."match_share"
  USING ((( SELECT auth.uid() ) = shared_by));

ALTER POLICY "Users can update their own match shares" ON "public"."match_share"
  USING ((( SELECT auth.uid() ) = shared_by));

ALTER POLICY "Users can view their own match shares" ON "public"."match_share"
  USING ((( SELECT auth.uid() ) = shared_by));

ALTER POLICY "Users can create recipients for their shares" ON "public"."match_share_recipient"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.match_share ms
  WHERE ((ms.id = match_share_recipient.share_id) AND (ms.shared_by = ( SELECT auth.uid() ))))));

ALTER POLICY "Users can delete recipients of their shares" ON "public"."match_share_recipient"
  USING ((EXISTS ( SELECT 1
   FROM public.match_share ms
  WHERE ((ms.id = match_share_recipient.share_id) AND (ms.shared_by = ( SELECT auth.uid() ))))));

ALTER POLICY "Users can update recipients of their shares" ON "public"."match_share_recipient"
  USING ((EXISTS ( SELECT 1
   FROM public.match_share ms
  WHERE ((ms.id = match_share_recipient.share_id) AND (ms.shared_by = ( SELECT auth.uid() ))))));

ALTER POLICY "Users can view recipients of their shares" ON "public"."match_share_recipient"
  USING ((EXISTS ( SELECT 1
   FROM public.match_share ms
  WHERE ((ms.id = match_share_recipient.share_id) AND (ms.shared_by = ( SELECT auth.uid() ))))));

ALTER POLICY "Service role full access leads" ON "public"."match_smoke_test_lead"
  USING ((( SELECT auth.role() ) = 'service_role'::text))
  WITH CHECK ((( SELECT auth.role() ) = 'service_role'::text));

ALTER POLICY "Service role full access phone codes" ON "public"."match_smoke_test_phone_code"
  USING ((( SELECT auth.role() ) = 'service_role'::text))
  WITH CHECK ((( SELECT auth.role() ) = 'service_role'::text));

ALTER POLICY "match_time_suggestion_insert" ON "public"."match_time_suggestion"
  WITH CHECK (((suggester_id = ( SELECT auth.uid() )) AND public.is_match_participant(match_id, ( SELECT auth.uid() )) AND (NOT public.is_match_creator(match_id, ( SELECT auth.uid() )))));

ALTER POLICY "match_time_suggestion_select" ON "public"."match_time_suggestion"
  USING (((suggester_id = ( SELECT auth.uid() )) OR public.is_match_creator(match_id, ( SELECT auth.uid() ))));

ALTER POLICY "match_time_suggestion_update_creator" ON "public"."match_time_suggestion"
  USING ((public.is_match_creator(match_id, ( SELECT auth.uid() )) AND (status = 'pending'::text)))
  WITH CHECK (public.is_match_creator(match_id, ( SELECT auth.uid() )));

ALTER POLICY "match_time_suggestion_update_suggester" ON "public"."match_time_suggestion"
  USING (((suggester_id = ( SELECT auth.uid() )) AND (status = 'pending'::text)))
  WITH CHECK ((suggester_id = ( SELECT auth.uid() )));

ALTER POLICY "add own votes in own conversations" ON "public"."match_time_vote"
  WITH CHECK (((player_id = ( SELECT auth.uid() )) AND (EXISTS ( SELECT 1
   FROM (public.message m
     JOIN public.conversation_participant cp ON ((cp.conversation_id = m.conversation_id)))
  WHERE ((m.id = match_time_vote.message_id) AND (cp.player_id = ( SELECT auth.uid() )))))));

ALTER POLICY "remove own votes" ON "public"."match_time_vote"
  USING ((player_id = ( SELECT auth.uid() )));

ALTER POLICY "view votes in own conversations" ON "public"."match_time_vote"
  USING ((EXISTS ( SELECT 1
   FROM (public.message m
     JOIN public.conversation_participant cp ON ((cp.conversation_id = m.conversation_id)))
  WHERE ((m.id = match_time_vote.message_id) AND (cp.player_id = ( SELECT auth.uid() ))))));

ALTER POLICY "Users can update own messages" ON "public"."message"
  USING ((sender_id = ( SELECT auth.uid() )))
  WITH CHECK ((sender_id = ( SELECT auth.uid() )));

ALTER POLICY "Users can view messages in their conversations (with block filt" ON "public"."message"
  USING (((EXISTS ( SELECT 1
   FROM public.conversation_participant cp
  WHERE ((cp.conversation_id = message.conversation_id) AND (cp.player_id = ( SELECT auth.uid() ))))) AND (NOT (EXISTS ( SELECT 1
   FROM public.player_block pb
  WHERE ((pb.player_id = ( SELECT auth.uid() )) AND (pb.blocked_player_id = message.sender_id)))))));

ALTER POLICY "message_delete_policy" ON "public"."message"
  USING ((sender_id = ( SELECT auth.uid() )));

ALTER POLICY "message_insert_policy" ON "public"."message"
  WITH CHECK (((sender_id = ( SELECT auth.uid() )) AND (conversation_id IN ( SELECT cp.conversation_id
   FROM public.conversation_participant cp
  WHERE (cp.player_id = ( SELECT auth.uid() )))) AND (NOT public.is_announcement_conversation(conversation_id))));

ALTER POLICY "message_select_policy" ON "public"."message"
  USING ((EXISTS ( SELECT 1
   FROM public.conversation_participant
  WHERE ((conversation_participant.conversation_id = message.conversation_id) AND (conversation_participant.player_id = ( SELECT auth.uid() ))))));

ALTER POLICY "message_update_policy" ON "public"."message"
  USING ((sender_id = ( SELECT auth.uid() )));

ALTER POLICY "Users can add reactions to messages in their conversations" ON "public"."message_reaction"
  WITH CHECK (((player_id = ( SELECT auth.uid() )) AND (EXISTS ( SELECT 1
   FROM (public.message m
     JOIN public.conversation_participant cp ON ((cp.conversation_id = m.conversation_id)))
  WHERE ((m.id = message_reaction.message_id) AND (cp.player_id = ( SELECT auth.uid() )))))));

ALTER POLICY "Users can remove their own reactions" ON "public"."message_reaction"
  USING ((player_id = ( SELECT auth.uid() )));

ALTER POLICY "Users can view reactions in their conversations" ON "public"."message_reaction"
  USING ((EXISTS ( SELECT 1
   FROM (public.message m
     JOIN public.conversation_participant cp ON ((cp.conversation_id = m.conversation_id)))
  WHERE ((m.id = message_reaction.message_id) AND (cp.player_id = ( SELECT auth.uid() ))))));

ALTER POLICY "Creator can delete network" ON "public"."network"
  USING ((created_by = ( SELECT auth.uid() )));

ALTER POLICY "Members can view their networks" ON "public"."network"
  USING (((created_by = ( SELECT auth.uid() )) OR public.is_network_member(id, ( SELECT auth.uid() ))));

ALTER POLICY "Moderators can update network" ON "public"."network"
  USING (((created_by = ( SELECT auth.uid() )) OR public.is_network_moderator(id, ( SELECT auth.uid() ))));

ALTER POLICY "Users can create networks" ON "public"."network"
  WITH CHECK ((( SELECT auth.uid() ) = created_by));

ALTER POLICY "network_select_policy" ON "public"."network"
  USING ((public.is_network_member(id, ( SELECT auth.uid() )) OR ((is_private = false) AND (network_type_id = ( SELECT network_type.id
   FROM public.network_type
  WHERE (network_type.name = 'community'::text)))) OR (created_by = ( SELECT auth.uid() ))));

ALTER POLICY "Members can view community activity" ON "public"."network_activity"
  USING (((EXISTS ( SELECT 1
   FROM public.network_member nm
  WHERE ((nm.network_id = network_activity.network_id) AND (nm.player_id = ( SELECT auth.uid() )) AND (nm.status = 'active'::public.network_member_status)))) OR (EXISTS ( SELECT 1
   FROM public.network n
  WHERE ((n.id = network_activity.network_id) AND (n.created_by = ( SELECT auth.uid() )))))));

ALTER POLICY "Moderators can delete network favorite facilities" ON "public"."network_favorite_facility"
  USING (public.is_network_moderator(network_id, ( SELECT auth.uid() )));

ALTER POLICY "Moderators can insert network favorite facilities" ON "public"."network_favorite_facility"
  WITH CHECK (public.is_network_moderator(network_id, ( SELECT auth.uid() )));

ALTER POLICY "Moderators can update network favorite facilities" ON "public"."network_favorite_facility"
  USING (public.is_network_moderator(network_id, ( SELECT auth.uid() )));

ALTER POLICY "network_member_delete" ON "public"."network_member"
  USING ((public.is_network_moderator(network_id, ( SELECT auth.uid() )) OR public.is_network_creator(network_id, ( SELECT auth.uid() )) OR (player_id = ( SELECT auth.uid() ))));

ALTER POLICY "network_member_insert" ON "public"."network_member"
  WITH CHECK (((public.is_network_member(network_id, ( SELECT auth.uid() )) OR public.is_network_creator(network_id, ( SELECT auth.uid() ))) AND ((role = 'member'::public.network_member_role_enum) OR public.is_network_moderator(network_id, ( SELECT auth.uid() )) OR public.is_network_creator(network_id, ( SELECT auth.uid() )))));

ALTER POLICY "network_member_select" ON "public"."network_member"
  USING ((public.is_network_member(network_id, ( SELECT auth.uid() )) OR public.is_network_creator(network_id, ( SELECT auth.uid() )) OR (player_id = ( SELECT auth.uid() ))));

ALTER POLICY "network_member_update" ON "public"."network_member"
  USING ((public.is_network_moderator(network_id, ( SELECT auth.uid() )) OR public.is_network_creator(network_id, ( SELECT auth.uid() )) OR (player_id = ( SELECT auth.uid() ))))
  WITH CHECK ((public.is_network_moderator(network_id, ( SELECT auth.uid() )) OR public.is_network_creator(network_id, ( SELECT auth.uid() )) OR ((player_id = ( SELECT auth.uid() )) AND (status = 'removed'::public.network_member_status))));

ALTER POLICY "Admins can delete network types" ON "public"."network_type"
  USING ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Admins can insert network types" ON "public"."network_type"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Admins can update network types" ON "public"."network_type"
  USING ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Users can delete their own notifications" ON "public"."notification"
  USING ((( SELECT auth.uid() ) = user_id));

ALTER POLICY "Users can update their own notifications" ON "public"."notification"
  USING ((( SELECT auth.uid() ) = user_id))
  WITH CHECK ((( SELECT auth.uid() ) = user_id));

ALTER POLICY "Users can view their own notifications" ON "public"."notification"
  USING ((( SELECT auth.uid() ) = user_id));

ALTER POLICY "notification_select_org_context" ON "public"."notification"
  USING (((( SELECT auth.uid() ) = user_id) OR ((organization_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = notification.organization_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role])) AND (om.left_at IS NULL)))))));

ALTER POLICY "Users can create their own notification preferences" ON "public"."notification_preference"
  WITH CHECK ((( SELECT auth.uid() ) = user_id));

ALTER POLICY "Users can delete their own notification preferences" ON "public"."notification_preference"
  USING ((( SELECT auth.uid() ) = user_id));

ALTER POLICY "Users can update their own notification preferences" ON "public"."notification_preference"
  USING ((( SELECT auth.uid() ) = user_id));

ALTER POLICY "Users can view their own notification preferences" ON "public"."notification_preference"
  USING ((( SELECT auth.uid() ) = user_id));

ALTER POLICY "Admins can read all onboarding analytics" ON "public"."onboarding_analytics"
  USING (((player_id = ( SELECT auth.uid() )) OR (EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() ))))));

ALTER POLICY "Users can insert own onboarding analytics" ON "public"."onboarding_analytics"
  WITH CHECK ((player_id = ( SELECT auth.uid() )));

ALTER POLICY "Users can update own onboarding analytics" ON "public"."onboarding_analytics"
  USING ((player_id = ( SELECT auth.uid() )));

ALTER POLICY "Org admins can delete their organization" ON "public"."organization"
  USING (public.is_org_admin(id, ( SELECT auth.uid() )));

ALTER POLICY "Org admins can update their organization" ON "public"."organization"
  USING (public.is_org_admin(id, ( SELECT auth.uid() )));

ALTER POLICY "Members can view org members" ON "public"."organization_member"
  USING ((public.is_org_member(organization_id, ( SELECT auth.uid() )) OR (user_id = ( SELECT auth.uid() ))));

ALTER POLICY "Org admins or self can delete membership" ON "public"."organization_member"
  USING ((public.is_org_admin(organization_id, ( SELECT auth.uid() )) OR (user_id = ( SELECT auth.uid() ))));

ALTER POLICY "Org admins or self can insert membership" ON "public"."organization_member"
  WITH CHECK ((public.is_org_admin(organization_id, ( SELECT auth.uid() )) OR (user_id = ( SELECT auth.uid() ))));

ALTER POLICY "Org admins or self can update membership" ON "public"."organization_member"
  USING ((public.is_org_admin(organization_id, ( SELECT auth.uid() )) OR (user_id = ( SELECT auth.uid() ))));

ALTER POLICY "org_notification_preference_delete_org_admin" ON "public"."organization_notification_preference"
  USING ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_notification_preference.organization_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role])) AND (om.left_at IS NULL)))));

ALTER POLICY "org_notification_preference_insert_org_admin" ON "public"."organization_notification_preference"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_notification_preference.organization_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role])) AND (om.left_at IS NULL)))));

ALTER POLICY "org_notification_preference_select_org_members" ON "public"."organization_notification_preference"
  USING ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_notification_preference.organization_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.left_at IS NULL)))));

ALTER POLICY "org_notification_preference_update_org_admin" ON "public"."organization_notification_preference"
  USING ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_notification_preference.organization_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role])) AND (om.left_at IS NULL)))));

ALTER POLICY "org_notification_recipient_delete_org_admin" ON "public"."organization_notification_recipient"
  USING ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_notification_recipient.organization_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role])) AND (om.left_at IS NULL)))));

ALTER POLICY "org_notification_recipient_insert_org_admin" ON "public"."organization_notification_recipient"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_notification_recipient.organization_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role])) AND (om.left_at IS NULL)))));

ALTER POLICY "org_notification_recipient_select_org_members" ON "public"."organization_notification_recipient"
  USING ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_notification_recipient.organization_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.left_at IS NULL)))));

ALTER POLICY "org_notification_recipient_update_org_admin" ON "public"."organization_notification_recipient"
  USING ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_notification_recipient.organization_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role])) AND (om.left_at IS NULL)))));

ALTER POLICY "org_player_block_insert_org_staff" ON "public"."organization_player_block"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_player_block.organization_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));

ALTER POLICY "org_player_block_select_org_staff" ON "public"."organization_player_block"
  USING ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_player_block.organization_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role, 'staff'::public.member_role]))))));

ALTER POLICY "org_player_block_update_org_staff" ON "public"."organization_player_block"
  USING ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_player_block.organization_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));

ALTER POLICY "org_settings_insert_org_owner" ON "public"."organization_settings"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_settings.organization_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.role = 'owner'::public.member_role)))));

ALTER POLICY "org_settings_select_org_members" ON "public"."organization_settings"
  USING ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_settings.organization_id) AND (om.user_id = ( SELECT auth.uid() ))))));

ALTER POLICY "org_settings_update_org_staff" ON "public"."organization_settings"
  USING ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_settings.organization_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));

ALTER POLICY "org_stripe_insert_org_owner" ON "public"."organization_stripe_account"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_stripe_account.organization_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.role = 'owner'::public.member_role)))));

ALTER POLICY "org_stripe_select_org_members" ON "public"."organization_stripe_account"
  USING ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_stripe_account.organization_id) AND (om.user_id = ( SELECT auth.uid() ))))));

ALTER POLICY "org_stripe_update_org_owner" ON "public"."organization_stripe_account"
  USING ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_stripe_account.organization_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.role = 'owner'::public.member_role)))));

ALTER POLICY "Requester can delete rating requests" ON "public"."peer_rating_request"
  USING ((requester_id = ( SELECT auth.uid() )));

ALTER POLICY "Requester or evaluator can update rating requests" ON "public"."peer_rating_request"
  USING (((requester_id = ( SELECT auth.uid() )) OR (evaluator_id = ( SELECT auth.uid() ))));

ALTER POLICY "Requester or evaluator can view rating requests" ON "public"."peer_rating_request"
  USING (((requester_id = ( SELECT auth.uid() )) OR (evaluator_id = ( SELECT auth.uid() ))));

ALTER POLICY "Users can create rating requests" ON "public"."peer_rating_request"
  WITH CHECK ((requester_id = ( SELECT auth.uid() )));

ALTER POLICY "Admins can delete play attributes" ON "public"."play_attribute"
  USING ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Admins can insert play attributes" ON "public"."play_attribute"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Admins can update play attributes" ON "public"."play_attribute"
  USING ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Admins can delete play styles" ON "public"."play_style"
  USING ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Admins can insert play styles" ON "public"."play_style"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Admins can update play styles" ON "public"."play_style"
  USING ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Players can update their own data" ON "public"."player"
  USING ((( SELECT auth.uid() ) = id));

ALTER POLICY "Players can view their own data" ON "public"."player"
  USING ((( SELECT auth.uid() ) = id));

ALTER POLICY "Users can delete their own player data" ON "public"."player"
  USING ((( SELECT auth.uid() ) = id));

ALTER POLICY "Users can insert their own player data" ON "public"."player"
  WITH CHECK ((( SELECT auth.uid() ) = id));

ALTER POLICY "Users can update own last_seen" ON "public"."player"
  USING ((id = ( SELECT auth.uid() )))
  WITH CHECK ((id = ( SELECT auth.uid() )));

ALTER POLICY "Users can update their own player data" ON "public"."player"
  USING ((( SELECT auth.uid() ) = id))
  WITH CHECK ((( SELECT auth.uid() ) = id));

ALTER POLICY "Users can view their own player data" ON "public"."player"
  USING ((( SELECT auth.uid() ) = id));

ALTER POLICY "Players can delete own availability" ON "public"."player_availability"
  USING ((player_id = ( SELECT auth.uid() )));

ALTER POLICY "Players can insert own availability" ON "public"."player_availability"
  WITH CHECK ((player_id = ( SELECT auth.uid() )));

ALTER POLICY "Players can update own availability" ON "public"."player_availability"
  USING ((player_id = ( SELECT auth.uid() )));

ALTER POLICY "Admins can view all bans" ON "public"."player_ban"
  USING ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Moderators can create bans" ON "public"."player_ban"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE ((admin.id = ( SELECT auth.uid() )) AND (admin.role = ANY (ARRAY['super_admin'::public.admin_role_enum, 'moderator'::public.admin_role_enum]))))));

ALTER POLICY "Moderators can update bans" ON "public"."player_ban"
  USING ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE ((admin.id = ( SELECT auth.uid() )) AND (admin.role = ANY (ARRAY['super_admin'::public.admin_role_enum, 'moderator'::public.admin_role_enum]))))));

ALTER POLICY "Players can view own ban" ON "public"."player_ban"
  USING (((player_id = ( SELECT auth.uid() )) AND (is_active = true)));

ALTER POLICY "Users can add blocks" ON "public"."player_block"
  WITH CHECK ((( SELECT auth.uid() ) = player_id));

ALTER POLICY "Users can delete their own blocks" ON "public"."player_block"
  USING ((( SELECT auth.uid() ) = player_id));

ALTER POLICY "Users can view their own blocks" ON "public"."player_block"
  USING ((( SELECT auth.uid() ) = player_id));

ALTER POLICY "Users can view their own check-in preferences" ON "public"."player_check_in_preferences"
  USING ((( SELECT auth.uid() ) = player_id));

ALTER POLICY "player_consent_select" ON "public"."player_consent"
  USING (((player_id = ( SELECT auth.uid() )) OR public.is_admin()));

ALTER POLICY "Users can add favorites" ON "public"."player_favorite"
  WITH CHECK ((( SELECT auth.uid() ) = player_id));

ALTER POLICY "Users can delete their own favorites" ON "public"."player_favorite"
  USING ((( SELECT auth.uid() ) = player_id));

ALTER POLICY "Users can view their own favorites" ON "public"."player_favorite"
  USING ((( SELECT auth.uid() ) = player_id));

ALTER POLICY "Players can delete own favorite facilities" ON "public"."player_favorite_facility"
  USING ((( SELECT auth.uid() ) = player_id));

ALTER POLICY "Players can insert own favorite facilities" ON "public"."player_favorite_facility"
  WITH CHECK ((( SELECT auth.uid() ) = player_id));

ALTER POLICY "Players can update own favorite facilities" ON "public"."player_favorite_facility"
  USING ((( SELECT auth.uid() ) = player_id));

ALTER POLICY "Players can view own favorite facilities" ON "public"."player_favorite_facility"
  USING ((( SELECT auth.uid() ) = player_id));

ALTER POLICY "Player or admin can delete rating scores" ON "public"."player_rating_score"
  USING (((player_id = ( SELECT auth.uid() )) OR public.is_admin()));

ALTER POLICY "Player or admin can update rating scores" ON "public"."player_rating_score"
  USING (((player_id = ( SELECT auth.uid() )) OR public.is_admin()));

ALTER POLICY "Players can insert own rating scores" ON "public"."player_rating_score"
  WITH CHECK ((player_id = ( SELECT auth.uid() )));

ALTER POLICY "Admins can update reports" ON "public"."player_report"
  USING ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Admins can view all reports" ON "public"."player_report"
  USING ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Players can create reports" ON "public"."player_report"
  WITH CHECK ((reporter_id = ( SELECT auth.uid() )));

ALTER POLICY "Players can view own reports" ON "public"."player_report"
  USING ((reporter_id = ( SELECT auth.uid() )));

ALTER POLICY "player_reputation_insert" ON "public"."player_reputation"
  WITH CHECK ((player_id = ( SELECT auth.uid() )));

ALTER POLICY "player_reputation_read_own" ON "public"."player_reputation"
  USING ((player_id = ( SELECT auth.uid() )));

ALTER POLICY "player_reputation_update_own" ON "public"."player_reputation"
  USING ((player_id = ( SELECT auth.uid() )))
  WITH CHECK ((player_id = ( SELECT auth.uid() )));

ALTER POLICY "Players can manage their sport preferences" ON "public"."player_sport"
  USING ((( SELECT auth.uid() ) = player_id));

ALTER POLICY "Users can delete their own player_sport data" ON "public"."player_sport"
  USING ((( SELECT auth.uid() ) = player_id));

ALTER POLICY "Users can insert their own player_sport data" ON "public"."player_sport"
  WITH CHECK ((( SELECT auth.uid() ) = player_id));

ALTER POLICY "Users can update their own player_sport data" ON "public"."player_sport"
  USING ((( SELECT auth.uid() ) = player_id))
  WITH CHECK ((( SELECT auth.uid() ) = player_id));

ALTER POLICY "Users can view their own player_sport data" ON "public"."player_sport"
  USING ((( SELECT auth.uid() ) = player_id));

ALTER POLICY "Players can delete own play attributes" ON "public"."player_sport_play_attribute"
  USING ((EXISTS ( SELECT 1
   FROM public.player_sport ps
  WHERE ((ps.id = player_sport_play_attribute.player_sport_id) AND (ps.player_id = ( SELECT auth.uid() ))))));

ALTER POLICY "Players can insert own play attributes" ON "public"."player_sport_play_attribute"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.player_sport ps
  WHERE ((ps.id = player_sport_play_attribute.player_sport_id) AND (ps.player_id = ( SELECT auth.uid() ))))));

ALTER POLICY "Players can update own play attributes" ON "public"."player_sport_play_attribute"
  USING ((EXISTS ( SELECT 1
   FROM public.player_sport ps
  WHERE ((ps.id = player_sport_play_attribute.player_sport_id) AND (ps.player_id = ( SELECT auth.uid() ))))));

ALTER POLICY "Players can view own play attributes" ON "public"."player_sport_play_attribute"
  USING ((EXISTS ( SELECT 1
   FROM public.player_sport ps
  WHERE ((ps.id = player_sport_play_attribute.player_sport_id) AND (ps.player_id = ( SELECT auth.uid() ))))));

ALTER POLICY "Players can delete own play style" ON "public"."player_sport_play_style"
  USING ((EXISTS ( SELECT 1
   FROM public.player_sport ps
  WHERE ((ps.id = player_sport_play_style.player_sport_id) AND (ps.player_id = ( SELECT auth.uid() ))))));

ALTER POLICY "Players can insert own play style" ON "public"."player_sport_play_style"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.player_sport ps
  WHERE ((ps.id = player_sport_play_style.player_sport_id) AND (ps.player_id = ( SELECT auth.uid() ))))));

ALTER POLICY "Players can update own play style" ON "public"."player_sport_play_style"
  USING ((EXISTS ( SELECT 1
   FROM public.player_sport ps
  WHERE ((ps.id = player_sport_play_style.player_sport_id) AND (ps.player_id = ( SELECT auth.uid() ))))));

ALTER POLICY "Players can view own play style" ON "public"."player_sport_play_style"
  USING ((EXISTS ( SELECT 1
   FROM public.player_sport ps
  WHERE ((ps.id = player_sport_play_style.player_sport_id) AND (ps.player_id = ( SELECT auth.uid() ))))));

ALTER POLICY "Users can view their own streak" ON "public"."player_streak"
  USING ((( SELECT auth.uid() ) = player_id));

ALTER POLICY "psa_owner" ON "public"."player_stripe_account"
  USING ((player_id = ( SELECT auth.uid() )))
  WITH CHECK ((player_id = ( SELECT auth.uid() )));

ALTER POLICY "players_read_own_subscription" ON "public"."player_subscription"
  USING ((( SELECT auth.uid() ) = player_id));

ALTER POLICY "service_role_write_subscription" ON "public"."player_subscription"
  USING ((( SELECT auth.role() ) = 'service_role'::text));

ALTER POLICY "Users can view their own check-ins" ON "public"."player_weekly_checkin"
  USING ((( SELECT auth.uid() ) = player_id));

ALTER POLICY "pricing_rule_delete_org_staff" ON "public"."pricing_rule"
  USING ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = pricing_rule.organization_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));

ALTER POLICY "pricing_rule_insert_org_staff" ON "public"."pricing_rule"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = pricing_rule.organization_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));

ALTER POLICY "pricing_rule_select_org_members" ON "public"."pricing_rule"
  USING ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = pricing_rule.organization_id) AND (om.user_id = ( SELECT auth.uid() ))))));

ALTER POLICY "pricing_rule_update_org_staff" ON "public"."pricing_rule"
  USING ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = pricing_rule.organization_id) AND (om.user_id = ( SELECT auth.uid() )) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));

ALTER POLICY "Users can delete their own profile" ON "public"."profile"
  USING ((( SELECT auth.uid() ) = id));

ALTER POLICY "Users can insert their own profile" ON "public"."profile"
  WITH CHECK ((( SELECT auth.uid() ) = id));

ALTER POLICY "Users can update their own profile" ON "public"."profile"
  USING ((( SELECT auth.uid() ) = id))
  WITH CHECK ((( SELECT auth.uid() ) = id));

ALTER POLICY "org_members_view_all_programs" ON "public"."program"
  USING ((organization_id IN ( SELECT organization_member.organization_id
   FROM public.organization_member
  WHERE (organization_member.user_id = ( SELECT auth.uid() )))));

ALTER POLICY "org_staff_manage_programs" ON "public"."program"
  USING ((organization_id IN ( SELECT organization_member.organization_id
   FROM public.organization_member
  WHERE ((organization_member.user_id = ( SELECT auth.uid() )) AND (organization_member.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role, 'staff'::public.member_role]))))));

ALTER POLICY "org_staff_manage_program_instructors" ON "public"."program_instructor"
  USING ((program_id IN ( SELECT program.id
   FROM public.program
  WHERE (program.organization_id IN ( SELECT organization_member.organization_id
           FROM public.organization_member
          WHERE ((organization_member.user_id = ( SELECT auth.uid() )) AND (organization_member.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role, 'staff'::public.member_role]))))))));

ALTER POLICY "view_program_instructors" ON "public"."program_instructor"
  USING (((program_id IN ( SELECT program.id
   FROM public.program
  WHERE (program.status = 'published'::public.program_status_enum))) OR (program_id IN ( SELECT p.id
   FROM (public.program p
     JOIN public.organization_member om ON ((p.organization_id = om.organization_id)))
  WHERE (om.user_id = ( SELECT auth.uid() ))))));

ALTER POLICY "org_staff_manage_registrations" ON "public"."program_registration"
  USING ((program_id IN ( SELECT program.id
   FROM public.program
  WHERE (program.organization_id IN ( SELECT organization_member.organization_id
           FROM public.organization_member
          WHERE ((organization_member.user_id = ( SELECT auth.uid() )) AND (organization_member.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role, 'staff'::public.member_role]))))))));

ALTER POLICY "org_staff_view_registrations" ON "public"."program_registration"
  USING ((program_id IN ( SELECT program.id
   FROM public.program
  WHERE (program.organization_id IN ( SELECT organization_member.organization_id
           FROM public.organization_member
          WHERE ((organization_member.user_id = ( SELECT auth.uid() )) AND (organization_member.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role, 'staff'::public.member_role]))))))));

ALTER POLICY "players_cancel_own_registrations" ON "public"."program_registration"
  USING ((((player_id = ( SELECT auth.uid() )) OR (registered_by = ( SELECT auth.uid() ))) AND (status <> 'refunded'::public.registration_status_enum)));

ALTER POLICY "players_create_registrations" ON "public"."program_registration"
  WITH CHECK ((registered_by = ( SELECT auth.uid() )));

ALTER POLICY "players_view_own_registrations" ON "public"."program_registration"
  USING (((player_id = ( SELECT auth.uid() )) OR (registered_by = ( SELECT auth.uid() ))));

ALTER POLICY "org_staff_manage_sessions" ON "public"."program_session"
  USING ((program_id IN ( SELECT program.id
   FROM public.program
  WHERE (program.organization_id IN ( SELECT organization_member.organization_id
           FROM public.organization_member
          WHERE ((organization_member.user_id = ( SELECT auth.uid() )) AND (organization_member.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role, 'staff'::public.member_role]))))))));

ALTER POLICY "view_sessions" ON "public"."program_session"
  USING (((program_id IN ( SELECT program.id
   FROM public.program
  WHERE (program.status = 'published'::public.program_status_enum))) OR (program_id IN ( SELECT p.id
   FROM (public.program p
     JOIN public.organization_member om ON ((p.organization_id = om.organization_id)))
  WHERE (om.user_id = ( SELECT auth.uid() ))))));

ALTER POLICY "org_staff_manage_session_courts" ON "public"."program_session_court"
  USING ((session_id IN ( SELECT ps.id
   FROM (public.program_session ps
     JOIN public.program p ON ((ps.program_id = p.id)))
  WHERE (p.organization_id IN ( SELECT organization_member.organization_id
           FROM public.organization_member
          WHERE ((organization_member.user_id = ( SELECT auth.uid() )) AND (organization_member.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role, 'staff'::public.member_role]))))))));

ALTER POLICY "view_session_courts" ON "public"."program_session_court"
  USING (((session_id IN ( SELECT ps.id
   FROM (public.program_session ps
     JOIN public.program p ON ((ps.program_id = p.id)))
  WHERE (p.status = 'published'::public.program_status_enum))) OR (session_id IN ( SELECT ps.id
   FROM ((public.program_session ps
     JOIN public.program p ON ((ps.program_id = p.id)))
     JOIN public.organization_member om ON ((p.organization_id = om.organization_id)))
  WHERE (om.user_id = ( SELECT auth.uid() ))))));

ALTER POLICY "org_staff_manage_waitlist" ON "public"."program_waitlist"
  USING ((program_id IN ( SELECT program.id
   FROM public.program
  WHERE (program.organization_id IN ( SELECT organization_member.organization_id
           FROM public.organization_member
          WHERE ((organization_member.user_id = ( SELECT auth.uid() )) AND (organization_member.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role, 'staff'::public.member_role]))))))));

ALTER POLICY "players_join_waitlist" ON "public"."program_waitlist"
  WITH CHECK ((added_by = ( SELECT auth.uid() )));

ALTER POLICY "players_leave_waitlist" ON "public"."program_waitlist"
  USING (((player_id = ( SELECT auth.uid() )) OR (added_by = ( SELECT auth.uid() ))));

ALTER POLICY "players_view_own_waitlist" ON "public"."program_waitlist"
  USING (((player_id = ( SELECT auth.uid() )) OR (added_by = ( SELECT auth.uid() ))));

ALTER POLICY "Users can delete own endorsements" ON "public"."proof_endorsement"
  USING ((reviewer_id = ( SELECT auth.uid() )));

ALTER POLICY "Users can insert own endorsements" ON "public"."proof_endorsement"
  WITH CHECK ((reviewer_id = ( SELECT auth.uid() )));

ALTER POLICY "Users can update own endorsements" ON "public"."proof_endorsement"
  USING ((reviewer_id = ( SELECT auth.uid() )))
  WITH CHECK ((reviewer_id = ( SELECT auth.uid() )));

ALTER POLICY "Users can delete own proof reactions" ON "public"."proof_reaction"
  USING ((reactor_id = ( SELECT auth.uid() )));

ALTER POLICY "Users can insert own proof reactions" ON "public"."proof_reaction"
  WITH CHECK ((reactor_id = ( SELECT auth.uid() )));

ALTER POLICY "Users can update own proof reactions" ON "public"."proof_reaction"
  USING ((reactor_id = ( SELECT auth.uid() )))
  WITH CHECK ((reactor_id = ( SELECT auth.uid() )));

ALTER POLICY "Admins can update proof reports" ON "public"."proof_report"
  USING ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Admins can view all proof reports" ON "public"."proof_report"
  USING ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Players can create proof reports" ON "public"."proof_report"
  WITH CHECK ((reporter_id = ( SELECT auth.uid() )));

ALTER POLICY "Players can view own proof reports" ON "public"."proof_report"
  USING ((reporter_id = ( SELECT auth.uid() )));

ALTER POLICY "Rating owner can create proofs" ON "public"."rating_proof"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.player_rating_score prs
  WHERE ((prs.id = rating_proof.player_rating_score_id) AND (prs.player_id = ( SELECT auth.uid() ))))));

ALTER POLICY "Rating owner or admin can delete proofs" ON "public"."rating_proof"
  USING (((EXISTS ( SELECT 1
   FROM public.player_rating_score prs
  WHERE ((prs.id = rating_proof.player_rating_score_id) AND (prs.player_id = ( SELECT auth.uid() ))))) OR (EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() ))))));

ALTER POLICY "Rating owner or admin can update proofs" ON "public"."rating_proof"
  USING (((EXISTS ( SELECT 1
   FROM public.player_rating_score prs
  WHERE ((prs.id = rating_proof.player_rating_score_id) AND (prs.player_id = ( SELECT auth.uid() ))))) OR (EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() ))))));

ALTER POLICY "Referees can respond to reference requests" ON "public"."rating_reference_request"
  USING ((referee_id = ( SELECT auth.uid() )))
  WITH CHECK ((referee_id = ( SELECT auth.uid() )));

ALTER POLICY "Requesters can delete their pending requests" ON "public"."rating_reference_request"
  USING (((requester_id = ( SELECT auth.uid() )) AND (status = 'pending'::public.rating_request_status_enum)));

ALTER POLICY "Users can create reference requests" ON "public"."rating_reference_request"
  WITH CHECK ((requester_id = ( SELECT auth.uid() )));

ALTER POLICY "Users can view reference requests sent to them" ON "public"."rating_reference_request"
  USING ((referee_id = ( SELECT auth.uid() )));

ALTER POLICY "Users can view their sent reference requests" ON "public"."rating_reference_request"
  USING ((requester_id = ( SELECT auth.uid() )));

ALTER POLICY "reference_request_delete_policy" ON "public"."reference_request"
  USING (((( SELECT auth.uid() ) = requester_id) AND (status = 'pending'::text)));

ALTER POLICY "reference_request_insert_policy" ON "public"."reference_request"
  WITH CHECK ((( SELECT auth.uid() ) = requester_id));

ALTER POLICY "reference_request_select_policy" ON "public"."reference_request"
  USING (((( SELECT auth.uid() ) = requester_id) OR (( SELECT auth.uid() ) = referee_id)));

ALTER POLICY "reference_request_update_policy" ON "public"."reference_request"
  USING ((( SELECT auth.uid() ) = referee_id))
  WITH CHECK ((( SELECT auth.uid() ) = referee_id));

ALTER POLICY "Users can create referral invites" ON "public"."referral_invite"
  WITH CHECK ((( SELECT auth.uid() ) = referrer_id));

ALTER POLICY "Users can view own referral invites" ON "public"."referral_invite"
  USING ((( SELECT auth.uid() ) = referrer_id));

ALTER POLICY "Users can view clicks for own referral code" ON "public"."referral_link_click"
  USING (((referral_code)::text IN ( SELECT profile.referral_code
   FROM public.profile
  WHERE (profile.id = ( SELECT auth.uid() )))));

ALTER POLICY "org_staff_manage_payments" ON "public"."registration_payment"
  USING ((registration_id IN ( SELECT pr.id
   FROM (public.program_registration pr
     JOIN public.program p ON ((pr.program_id = p.id)))
  WHERE (p.organization_id IN ( SELECT organization_member.organization_id
           FROM public.organization_member
          WHERE ((organization_member.user_id = ( SELECT auth.uid() )) AND (organization_member.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role, 'staff'::public.member_role]))))))));

ALTER POLICY "players_view_own_payments" ON "public"."registration_payment"
  USING ((registration_id IN ( SELECT program_registration.id
   FROM public.program_registration
  WHERE ((program_registration.player_id = ( SELECT auth.uid() )) OR (program_registration.registered_by = ( SELECT auth.uid() ))))));

ALTER POLICY "Admins can delete reports" ON "public"."report"
  USING ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Admins can update reports" ON "public"."report"
  USING ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Authenticated users can create reports" ON "public"."report"
  WITH CHECK ((reporter_id = ( SELECT auth.uid() )));

ALTER POLICY "Reporter or admin can view reports" ON "public"."report"
  USING (((reporter_id = ( SELECT auth.uid() )) OR (EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() ))))));

ALTER POLICY "reputation_event_select_own_inserts" ON "public"."reputation_event"
  USING (((player_id = ( SELECT auth.uid() )) OR (caused_by_player_id = ( SELECT auth.uid() ))));

ALTER POLICY "service_role_write_event_log" ON "public"."revenuecat_event_log"
  USING ((( SELECT auth.role() ) = 'service_role'::text));

ALTER POLICY "Participants can view match score confirmations" ON "public"."score_confirmation"
  USING ((EXISTS ( SELECT 1
   FROM (public.match_result mr
     JOIN public.match_participant mp ON ((mp.match_id = mr.match_id)))
  WHERE ((mr.id = score_confirmation.match_result_id) AND (mp.player_id = ( SELECT auth.uid() )) AND (mp.status = 'joined'::public.match_participant_status_enum)))));

ALTER POLICY "Players can insert their own confirmations" ON "public"."score_confirmation"
  WITH CHECK ((player_id = ( SELECT auth.uid() )));

ALTER POLICY "Admins can read all screen analytics" ON "public"."screen_analytics"
  USING ((EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() )))));

ALTER POLICY "Users can insert own screen analytics" ON "public"."screen_analytics"
  WITH CHECK (((player_id = ( SELECT auth.uid() )) OR (EXISTS ( SELECT 1
   FROM public.admin
  WHERE (admin.id = ( SELECT auth.uid() ))))));

ALTER POLICY "season_members_select" ON "public"."season_members"
  USING ((public.is_admin() OR (user_id = ( SELECT auth.uid() )) OR (EXISTS ( SELECT 1
   FROM (public.seasons s
     JOIN public.leagues l ON ((l.id = s.league_id)))
  WHERE ((s.id = season_members.season_id) AND ((l.visibility = 'public'::public.tournament_visibility) OR public.is_league_organizer(l.id) OR public.is_active_league_member(l.id)))))));

ALTER POLICY "org_staff_manage_attendance" ON "public"."session_attendance"
  USING ((session_id IN ( SELECT ps.id
   FROM (public.program_session ps
     JOIN public.program p ON ((ps.program_id = p.id)))
  WHERE (p.organization_id IN ( SELECT organization_member.organization_id
           FROM public.organization_member
          WHERE ((organization_member.user_id = ( SELECT auth.uid() )) AND (organization_member.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role, 'staff'::public.member_role]))))))));

ALTER POLICY "players_view_own_attendance" ON "public"."session_attendance"
  USING ((registration_id IN ( SELECT program_registration.id
   FROM public.program_registration
  WHERE ((program_registration.player_id = ( SELECT auth.uid() )) OR (program_registration.registered_by = ( SELECT auth.uid() ))))));

ALTER POLICY "smscores_select" ON "public"."session_match_scores"
  USING ((public.is_admin() OR (submitted_by = ( SELECT auth.uid() )) OR (EXISTS ( SELECT 1
   FROM (((public.session_matches m
     JOIN public.sessions ss ON ((ss.id = m.session_id)))
     JOIN public.seasons s ON ((s.id = ss.season_id)))
     JOIN public.leagues l ON ((l.id = s.league_id)))
  WHERE ((m.id = session_match_scores.session_match_id) AND (public.is_league_organizer(l.id) OR public.is_active_league_member(l.id)))))));

ALTER POLICY "spresence_select" ON "public"."session_presence"
  USING ((public.is_admin() OR (user_id = ( SELECT auth.uid() )) OR (EXISTS ( SELECT 1
   FROM ((public.sessions ss
     JOIN public.seasons s ON ((s.id = ss.season_id)))
     JOIN public.leagues l ON ((l.id = s.league_id)))
  WHERE ((ss.id = session_presence.session_id) AND (public.is_league_organizer(l.id) OR public.is_active_league_member(l.id)))))));

ALTER POLICY "Users can create contacts in own lists" ON "public"."shared_contact"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.shared_contact_list scl
  WHERE ((scl.id = shared_contact.list_id) AND (scl.player_id = ( SELECT auth.uid() ))))));

ALTER POLICY "Users can delete contacts in own lists" ON "public"."shared_contact"
  USING ((EXISTS ( SELECT 1
   FROM public.shared_contact_list scl
  WHERE ((scl.id = shared_contact.list_id) AND (scl.player_id = ( SELECT auth.uid() ))))));

ALTER POLICY "Users can update contacts in own lists" ON "public"."shared_contact"
  USING ((EXISTS ( SELECT 1
   FROM public.shared_contact_list scl
  WHERE ((scl.id = shared_contact.list_id) AND (scl.player_id = ( SELECT auth.uid() ))))));

ALTER POLICY "Users can view contacts in own lists" ON "public"."shared_contact"
  USING ((EXISTS ( SELECT 1
   FROM public.shared_contact_list scl
  WHERE ((scl.id = shared_contact.list_id) AND (scl.player_id = ( SELECT auth.uid() ))))));

ALTER POLICY "Users can create own contact lists" ON "public"."shared_contact_list"
  WITH CHECK ((player_id = ( SELECT auth.uid() )));

ALTER POLICY "Users can delete own contact lists" ON "public"."shared_contact_list"
  USING ((player_id = ( SELECT auth.uid() )));

ALTER POLICY "Users can update own contact lists" ON "public"."shared_contact_list"
  USING ((player_id = ( SELECT auth.uid() )))
  WITH CHECK ((player_id = ( SELECT auth.uid() )));

ALTER POLICY "Users can view own contact lists" ON "public"."shared_contact_list"
  USING ((player_id = ( SELECT auth.uid() )));

ALTER POLICY "Players can insert own summer league interest" ON "public"."summer_league_interest"
  WITH CHECK ((( SELECT auth.uid() ) = player_id));

ALTER POLICY "Players can view own summer league interest" ON "public"."summer_league_interest"
  USING ((( SELECT auth.uid() ) = player_id));

ALTER POLICY "tco_select" ON "public"."tournament_co_organizers"
  USING ((public.is_admin() OR (user_id = ( SELECT auth.uid() )) OR public.is_tournament_organizer(tournament_id)));

ALTER POLICY "tmscores_select" ON "public"."tournament_match_scores"
  USING ((public.is_admin() OR (submitted_by = ( SELECT auth.uid() )) OR (EXISTS ( SELECT 1
   FROM public.tournament_matches m
  WHERE ((m.id = tournament_match_scores.tournament_match_id) AND public.is_tournament_organizer(m.tournament_id))))));

ALTER POLICY "treg_select" ON "public"."tournament_registrations"
  USING ((public.is_admin() OR (user_id = ( SELECT auth.uid() )) OR (partner_user_id = ( SELECT auth.uid() )) OR public.is_tournament_organizer(tournament_id) OR public.tournament_is_public(tournament_id)));

ALTER POLICY "twait_select" ON "public"."tournament_waitlist"
  USING ((public.is_admin() OR (user_id = ( SELECT auth.uid() )) OR public.is_tournament_organizer(tournament_id)));

ALTER POLICY "tournaments_insert" ON "public"."tournaments"
  WITH CHECK ((organizer_id = ( SELECT auth.uid() )));

ALTER POLICY "tournaments_select" ON "public"."tournaments"
  USING ((public.is_admin() OR (visibility = 'public'::public.tournament_visibility) OR (organizer_id = ( SELECT auth.uid() )) OR public.is_tournament_organizer(id) OR public.is_tournament_registrant(id) OR ((visibility = 'community'::public.tournament_visibility) AND (network_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.network_member nm
  WHERE ((nm.network_id = tournaments.network_id) AND (nm.player_id = ( SELECT auth.uid() )) AND (nm.status = 'active'::public.network_member_status)))))));

ALTER POLICY "chat receive own conversations" ON "realtime"."messages"
  USING (((realtime.topic() ~ '^(chat|reactions|votes):[0-9a-fA-F-]{36}$'::text) AND (EXISTS ( SELECT 1
   FROM public.conversation_participant cp
  WHERE ((cp.conversation_id = (split_part(realtime.topic(), ':'::text, 2))::uuid) AND (cp.player_id = ( SELECT auth.uid() )))))));
