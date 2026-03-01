create extension if not exists "btree_gist" with schema "public";

-- Wrap enum type creation in exception handlers for idempotency
DO $$ BEGIN
  CREATE TYPE "public"."availability_block_type_enum" AS ENUM ('manual', 'maintenance', 'holiday', 'weather', 'private_event');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."booking_type_enum" AS ENUM ('player', 'program_session', 'maintenance');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."match_report_priority_enum" AS ENUM ('high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."match_report_reason_enum" AS ENUM ('harassment', 'unsportsmanlike', 'safety', 'misrepresented_level', 'inappropriate');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."match_report_status_enum" AS ENUM ('pending', 'reviewed', 'dismissed', 'action_taken');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."network_member_role_enum" AS ENUM ('member', 'moderator');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."payment_plan_enum" AS ENUM ('full', 'installment');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."program_status_enum" AS ENUM ('draft', 'published', 'cancelled', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."program_type_enum" AS ENUM ('program', 'lesson');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."registration_payment_status_enum" AS ENUM ('pending', 'succeeded', 'failed', 'refunded', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."registration_status_enum" AS ENUM ('pending', 'confirmed', 'cancelled', 'refunded');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."reputation_event_type" AS ENUM ('match_completed', 'match_no_show', 'match_ghosted', 'match_on_time', 'match_late', 'match_cancelled_early', 'match_cancelled_late', 'match_repeat_opponent', 'review_received_5star', 'review_received_4star', 'review_received_3star', 'review_received_2star', 'review_received_1star', 'report_received', 'report_dismissed', 'report_upheld', 'warning_issued', 'suspension_lifted', 'peer_rating_given', 'first_match_bonus', 'feedback_submitted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."reputation_tier" AS ENUM ('unknown', 'bronze', 'silver', 'gold', 'platinum');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Wrap trigger drops in exception handlers since tables may not exist yet
DO $$ BEGIN
  drop trigger if exists "on_critical_admin_alert_push" on "public"."admin_alert";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  drop trigger if exists "admin_device_updated_at" on "public"."admin_device";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

drop trigger if exists "trigger_feedback_updated_at" on "public"."feedback";

drop trigger if exists "trigger_notify_new_feedback" on "public"."feedback";

drop trigger if exists "trigger_auto_add_creator" on "public"."network";

drop trigger if exists "trigger_handle_orphaned_community" on "public"."network";

drop trigger if exists "trigger_log_network_created" on "public"."network";

drop trigger if exists "trigger_log_member_joined" on "public"."network_member";

drop trigger if exists "trigger_log_member_left" on "public"."network_member";

drop trigger if exists "trigger_log_member_role_change" on "public"."network_member";

drop trigger if exists "trigger_update_network_member_count_delete" on "public"."network_member";

drop trigger if exists "trigger_update_network_member_count_insert" on "public"."network_member";

drop trigger if exists "trigger_update_network_member_count_update" on "public"."network_member";

DO $$ BEGIN
  drop trigger if exists "trigger_check_ban_expiration" on "public"."player_ban";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  drop trigger if exists "trigger_player_ban_updated_at" on "public"."player_ban";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  drop trigger if exists "trigger_player_report_updated_at" on "public"."player_report";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

drop trigger if exists "on_invitation_insert" on "public"."invitation";

-- Wrap policy drops for tables that may not exist
DO $$ BEGIN
  drop policy if exists "Admins can update their alerts" on "public"."admin_alert";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "Admins can view their alerts" on "public"."admin_alert";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "Admins can manage their preferences" on "public"."admin_alert_preference";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "Admins can view audit logs" on "public"."admin_audit_log";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "Audit logs are insert-only via function" on "public"."admin_audit_log";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "Admins can delete own devices" on "public"."admin_device";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "Admins can insert own devices" on "public"."admin_device";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "Admins can update own devices" on "public"."admin_device";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "Admins can view own devices" on "public"."admin_device";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "Admins can read analytics snapshots" on "public"."analytics_snapshot";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "System can insert analytics snapshots" on "public"."analytics_snapshot";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "System can update analytics snapshots" on "public"."analytics_snapshot";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

drop policy if exists "Anonymous feedback submission" on "public"."feedback";

drop policy if exists "Service role full access" on "public"."feedback";

DO $$ BEGIN
  drop policy if exists "Users can submit feedback" on "public"."feedback";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "Users can view own feedback" on "public"."feedback";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "Members can view group activity" on "public"."group_activity";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "System can insert group activity" on "public"."group_activity";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "Admins can read all onboarding analytics" on "public"."onboarding_analytics";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "Users can insert own onboarding analytics" on "public"."onboarding_analytics";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "Users can update own onboarding analytics" on "public"."onboarding_analytics";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "Admins can view all bans" on "public"."player_ban";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "Moderators can create bans" on "public"."player_ban";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "Moderators can update bans" on "public"."player_ban";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "Players can view own ban" on "public"."player_ban";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "Admins can update reports" on "public"."player_report";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "Admins can view all reports" on "public"."player_report";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "Players can create reports" on "public"."player_report";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "Players can view own reports" on "public"."player_report";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "Admins can read all screen analytics" on "public"."screen_analytics";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  drop policy if exists "Users can insert own screen analytics" on "public"."screen_analytics";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

drop policy if exists "Allow anonymous insert" on "public"."verification_code";

drop policy if exists "Allow select by email" on "public"."verification_code";

drop policy if exists "Allow update by email" on "public"."verification_code";

drop policy if exists "match_network_delete_policy" on "public"."match_network";

drop policy if exists "Users can create recipients for their shares" on "public"."match_share_recipient";

drop policy if exists "Users can delete recipients of their shares" on "public"."match_share_recipient";

drop policy if exists "Users can update recipients of their shares" on "public"."match_share_recipient";

drop policy if exists "Users can view recipients of their shares" on "public"."match_share_recipient";

drop policy if exists "Users can create contacts in own lists" on "public"."shared_contact";

drop policy if exists "Users can delete contacts in own lists" on "public"."shared_contact";

drop policy if exists "Users can update contacts in own lists" on "public"."shared_contact";

drop policy if exists "Users can view contacts in own lists" on "public"."shared_contact";

-- Wrap revokes for tables that may not exist
DO $$ BEGIN
  revoke delete on table "public"."admin_alert" from "anon";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  revoke insert on table "public"."admin_alert" from "anon";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  revoke references on table "public"."admin_alert" from "anon";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  revoke select on table "public"."admin_alert" from "anon";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  revoke trigger on table "public"."admin_alert" from "anon";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  revoke truncate on table "public"."admin_alert" from "anon";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  revoke update on table "public"."admin_alert" from "anon";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  revoke delete on table "public"."admin_alert" from "authenticated";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  revoke insert on table "public"."admin_alert" from "authenticated";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  revoke references on table "public"."admin_alert" from "authenticated";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- All remaining revokes are wrapped in exception handlers for tables that may not exist yet
-- These tables are created in later migrations (admin_*, analytics_*, player_ban, player_report, etc.)
DO $$
BEGIN
  revoke select on table "public"."admin_alert" from "authenticated";
  revoke trigger on table "public"."admin_alert" from "authenticated";
  revoke truncate on table "public"."admin_alert" from "authenticated";
  revoke update on table "public"."admin_alert" from "authenticated";
  revoke delete on table "public"."admin_alert" from "service_role";
  revoke insert on table "public"."admin_alert" from "service_role";
  revoke references on table "public"."admin_alert" from "service_role";
  revoke select on table "public"."admin_alert" from "service_role";
  revoke trigger on table "public"."admin_alert" from "service_role";
  revoke truncate on table "public"."admin_alert" from "service_role";
  revoke update on table "public"."admin_alert" from "service_role";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
  revoke delete on table "public"."admin_alert_preference" from "anon";
  revoke insert on table "public"."admin_alert_preference" from "anon";
  revoke references on table "public"."admin_alert_preference" from "anon";
  revoke select on table "public"."admin_alert_preference" from "anon";
  revoke trigger on table "public"."admin_alert_preference" from "anon";
  revoke truncate on table "public"."admin_alert_preference" from "anon";
  revoke update on table "public"."admin_alert_preference" from "anon";
  revoke delete on table "public"."admin_alert_preference" from "authenticated";
  revoke insert on table "public"."admin_alert_preference" from "authenticated";
  revoke references on table "public"."admin_alert_preference" from "authenticated";
  revoke select on table "public"."admin_alert_preference" from "authenticated";
  revoke trigger on table "public"."admin_alert_preference" from "authenticated";
  revoke truncate on table "public"."admin_alert_preference" from "authenticated";
  revoke update on table "public"."admin_alert_preference" from "authenticated";
  revoke delete on table "public"."admin_alert_preference" from "service_role";
  revoke insert on table "public"."admin_alert_preference" from "service_role";
  revoke references on table "public"."admin_alert_preference" from "service_role";
  revoke select on table "public"."admin_alert_preference" from "service_role";
  revoke trigger on table "public"."admin_alert_preference" from "service_role";
  revoke truncate on table "public"."admin_alert_preference" from "service_role";
  revoke update on table "public"."admin_alert_preference" from "service_role";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
  revoke delete on table "public"."admin_audit_log" from "anon";
  revoke insert on table "public"."admin_audit_log" from "anon";
  revoke references on table "public"."admin_audit_log" from "anon";
  revoke select on table "public"."admin_audit_log" from "anon";
  revoke trigger on table "public"."admin_audit_log" from "anon";
  revoke truncate on table "public"."admin_audit_log" from "anon";
  revoke update on table "public"."admin_audit_log" from "anon";
  revoke delete on table "public"."admin_audit_log" from "authenticated";
  revoke insert on table "public"."admin_audit_log" from "authenticated";
  revoke references on table "public"."admin_audit_log" from "authenticated";
  revoke select on table "public"."admin_audit_log" from "authenticated";
  revoke trigger on table "public"."admin_audit_log" from "authenticated";
  revoke truncate on table "public"."admin_audit_log" from "authenticated";
  revoke update on table "public"."admin_audit_log" from "authenticated";
  revoke delete on table "public"."admin_audit_log" from "service_role";
  revoke insert on table "public"."admin_audit_log" from "service_role";
  revoke references on table "public"."admin_audit_log" from "service_role";
  revoke select on table "public"."admin_audit_log" from "service_role";
  revoke trigger on table "public"."admin_audit_log" from "service_role";
  revoke truncate on table "public"."admin_audit_log" from "service_role";
  revoke update on table "public"."admin_audit_log" from "service_role";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
  revoke delete on table "public"."admin_device" from "anon";
  revoke insert on table "public"."admin_device" from "anon";
  revoke references on table "public"."admin_device" from "anon";
  revoke select on table "public"."admin_device" from "anon";
  revoke trigger on table "public"."admin_device" from "anon";
  revoke truncate on table "public"."admin_device" from "anon";
  revoke update on table "public"."admin_device" from "anon";
  revoke delete on table "public"."admin_device" from "authenticated";
  revoke insert on table "public"."admin_device" from "authenticated";
  revoke references on table "public"."admin_device" from "authenticated";
  revoke select on table "public"."admin_device" from "authenticated";
  revoke trigger on table "public"."admin_device" from "authenticated";
  revoke truncate on table "public"."admin_device" from "authenticated";
  revoke update on table "public"."admin_device" from "authenticated";
  revoke delete on table "public"."admin_device" from "service_role";
  revoke insert on table "public"."admin_device" from "service_role";
  revoke references on table "public"."admin_device" from "service_role";
  revoke select on table "public"."admin_device" from "service_role";
  revoke trigger on table "public"."admin_device" from "service_role";
  revoke truncate on table "public"."admin_device" from "service_role";
  revoke update on table "public"."admin_device" from "service_role";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
  revoke delete on table "public"."analytics_snapshot" from "anon";
  revoke insert on table "public"."analytics_snapshot" from "anon";
  revoke references on table "public"."analytics_snapshot" from "anon";
  revoke select on table "public"."analytics_snapshot" from "anon";
  revoke trigger on table "public"."analytics_snapshot" from "anon";
  revoke truncate on table "public"."analytics_snapshot" from "anon";
  revoke update on table "public"."analytics_snapshot" from "anon";
  revoke delete on table "public"."analytics_snapshot" from "authenticated";
  revoke insert on table "public"."analytics_snapshot" from "authenticated";
  revoke references on table "public"."analytics_snapshot" from "authenticated";
  revoke select on table "public"."analytics_snapshot" from "authenticated";
  revoke trigger on table "public"."analytics_snapshot" from "authenticated";
  revoke truncate on table "public"."analytics_snapshot" from "authenticated";
  revoke update on table "public"."analytics_snapshot" from "authenticated";
  revoke delete on table "public"."analytics_snapshot" from "service_role";
  revoke insert on table "public"."analytics_snapshot" from "service_role";
  revoke references on table "public"."analytics_snapshot" from "service_role";
  revoke select on table "public"."analytics_snapshot" from "service_role";
  revoke trigger on table "public"."analytics_snapshot" from "service_role";
  revoke truncate on table "public"."analytics_snapshot" from "service_role";
  revoke update on table "public"."analytics_snapshot" from "service_role";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

revoke delete on table "public"."feedback" from "anon";

revoke insert on table "public"."feedback" from "anon";

revoke references on table "public"."feedback" from "anon";

revoke select on table "public"."feedback" from "anon";

revoke trigger on table "public"."feedback" from "anon";

revoke truncate on table "public"."feedback" from "anon";

revoke update on table "public"."feedback" from "anon";

revoke delete on table "public"."feedback" from "authenticated";

revoke insert on table "public"."feedback" from "authenticated";

revoke references on table "public"."feedback" from "authenticated";

revoke select on table "public"."feedback" from "authenticated";

revoke trigger on table "public"."feedback" from "authenticated";

revoke truncate on table "public"."feedback" from "authenticated";

revoke update on table "public"."feedback" from "authenticated";

revoke delete on table "public"."feedback" from "service_role";

revoke insert on table "public"."feedback" from "service_role";

revoke references on table "public"."feedback" from "service_role";

revoke select on table "public"."feedback" from "service_role";

revoke trigger on table "public"."feedback" from "service_role";

revoke truncate on table "public"."feedback" from "service_role";

revoke update on table "public"."feedback" from "service_role";

revoke delete on table "public"."group_activity" from "anon";

revoke insert on table "public"."group_activity" from "anon";

revoke references on table "public"."group_activity" from "anon";

revoke select on table "public"."group_activity" from "anon";

revoke trigger on table "public"."group_activity" from "anon";

revoke truncate on table "public"."group_activity" from "anon";

revoke update on table "public"."group_activity" from "anon";

revoke delete on table "public"."group_activity" from "authenticated";

revoke insert on table "public"."group_activity" from "authenticated";

revoke references on table "public"."group_activity" from "authenticated";

revoke select on table "public"."group_activity" from "authenticated";

revoke trigger on table "public"."group_activity" from "authenticated";

revoke truncate on table "public"."group_activity" from "authenticated";

revoke update on table "public"."group_activity" from "authenticated";

revoke delete on table "public"."group_activity" from "service_role";

revoke insert on table "public"."group_activity" from "service_role";

revoke references on table "public"."group_activity" from "service_role";

revoke select on table "public"."group_activity" from "service_role";

revoke trigger on table "public"."group_activity" from "service_role";

revoke truncate on table "public"."group_activity" from "service_role";

revoke update on table "public"."group_activity" from "service_role";

DO $$
BEGIN
  revoke delete on table "public"."onboarding_analytics" from "anon";
  revoke insert on table "public"."onboarding_analytics" from "anon";
  revoke references on table "public"."onboarding_analytics" from "anon";
  revoke select on table "public"."onboarding_analytics" from "anon";
  revoke trigger on table "public"."onboarding_analytics" from "anon";
  revoke truncate on table "public"."onboarding_analytics" from "anon";
  revoke update on table "public"."onboarding_analytics" from "anon";
  revoke delete on table "public"."onboarding_analytics" from "authenticated";
  revoke insert on table "public"."onboarding_analytics" from "authenticated";
  revoke references on table "public"."onboarding_analytics" from "authenticated";
  revoke select on table "public"."onboarding_analytics" from "authenticated";
  revoke trigger on table "public"."onboarding_analytics" from "authenticated";
  revoke truncate on table "public"."onboarding_analytics" from "authenticated";
  revoke update on table "public"."onboarding_analytics" from "authenticated";
  revoke delete on table "public"."onboarding_analytics" from "service_role";
  revoke insert on table "public"."onboarding_analytics" from "service_role";
  revoke references on table "public"."onboarding_analytics" from "service_role";
  revoke select on table "public"."onboarding_analytics" from "service_role";
  revoke trigger on table "public"."onboarding_analytics" from "service_role";
  revoke truncate on table "public"."onboarding_analytics" from "service_role";
  revoke update on table "public"."onboarding_analytics" from "service_role";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
  revoke delete on table "public"."player_ban" from "anon";
  revoke insert on table "public"."player_ban" from "anon";
  revoke references on table "public"."player_ban" from "anon";
  revoke select on table "public"."player_ban" from "anon";
  revoke trigger on table "public"."player_ban" from "anon";
  revoke truncate on table "public"."player_ban" from "anon";
  revoke update on table "public"."player_ban" from "anon";
  revoke delete on table "public"."player_ban" from "authenticated";
  revoke insert on table "public"."player_ban" from "authenticated";
  revoke references on table "public"."player_ban" from "authenticated";
  revoke select on table "public"."player_ban" from "authenticated";
  revoke trigger on table "public"."player_ban" from "authenticated";
  revoke truncate on table "public"."player_ban" from "authenticated";
  revoke update on table "public"."player_ban" from "authenticated";
  revoke delete on table "public"."player_ban" from "service_role";
  revoke insert on table "public"."player_ban" from "service_role";
  revoke references on table "public"."player_ban" from "service_role";
  revoke select on table "public"."player_ban" from "service_role";
  revoke trigger on table "public"."player_ban" from "service_role";
  revoke truncate on table "public"."player_ban" from "service_role";
  revoke update on table "public"."player_ban" from "service_role";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
revoke delete on table "public"."player_play_attribute" from "anon";

revoke insert on table "public"."player_play_attribute" from "anon";

revoke references on table "public"."player_play_attribute" from "anon";

revoke select on table "public"."player_play_attribute" from "anon";

revoke trigger on table "public"."player_play_attribute" from "anon";

revoke truncate on table "public"."player_play_attribute" from "anon";

revoke update on table "public"."player_play_attribute" from "anon";

revoke delete on table "public"."player_play_attribute" from "authenticated";

revoke insert on table "public"."player_play_attribute" from "authenticated";

revoke references on table "public"."player_play_attribute" from "authenticated";

revoke select on table "public"."player_play_attribute" from "authenticated";

revoke trigger on table "public"."player_play_attribute" from "authenticated";

revoke truncate on table "public"."player_play_attribute" from "authenticated";

revoke update on table "public"."player_play_attribute" from "authenticated";

revoke delete on table "public"."player_play_attribute" from "service_role";

revoke insert on table "public"."player_play_attribute" from "service_role";

revoke references on table "public"."player_play_attribute" from "service_role";

revoke select on table "public"."player_play_attribute" from "service_role";

revoke trigger on table "public"."player_play_attribute" from "service_role";

revoke truncate on table "public"."player_play_attribute" from "service_role";

revoke update on table "public"."player_play_attribute" from "service_role";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
  revoke delete on table "public"."player_report" from "anon";
  revoke insert on table "public"."player_report" from "anon";
  revoke references on table "public"."player_report" from "anon";
  revoke select on table "public"."player_report" from "anon";
  revoke trigger on table "public"."player_report" from "anon";
  revoke truncate on table "public"."player_report" from "anon";
  revoke update on table "public"."player_report" from "anon";
  revoke delete on table "public"."player_report" from "authenticated";
  revoke insert on table "public"."player_report" from "authenticated";
  revoke references on table "public"."player_report" from "authenticated";
  revoke select on table "public"."player_report" from "authenticated";
  revoke trigger on table "public"."player_report" from "authenticated";
  revoke truncate on table "public"."player_report" from "authenticated";
  revoke update on table "public"."player_report" from "authenticated";
  revoke delete on table "public"."player_report" from "service_role";
  revoke insert on table "public"."player_report" from "service_role";
  revoke references on table "public"."player_report" from "service_role";
  revoke select on table "public"."player_report" from "service_role";
  revoke trigger on table "public"."player_report" from "service_role";
  revoke truncate on table "public"."player_report" from "service_role";
  revoke update on table "public"."player_report" from "service_role";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

revoke delete on table "public"."player_sport_profile" from "anon";

revoke insert on table "public"."player_sport_profile" from "anon";

revoke references on table "public"."player_sport_profile" from "anon";

revoke select on table "public"."player_sport_profile" from "anon";

revoke trigger on table "public"."player_sport_profile" from "anon";

revoke truncate on table "public"."player_sport_profile" from "anon";

revoke update on table "public"."player_sport_profile" from "anon";

revoke delete on table "public"."player_sport_profile" from "authenticated";

revoke insert on table "public"."player_sport_profile" from "authenticated";

revoke references on table "public"."player_sport_profile" from "authenticated";

revoke select on table "public"."player_sport_profile" from "authenticated";

revoke trigger on table "public"."player_sport_profile" from "authenticated";

revoke truncate on table "public"."player_sport_profile" from "authenticated";

revoke update on table "public"."player_sport_profile" from "authenticated";

revoke delete on table "public"."player_sport_profile" from "service_role";

revoke insert on table "public"."player_sport_profile" from "service_role";

revoke references on table "public"."player_sport_profile" from "service_role";

revoke select on table "public"."player_sport_profile" from "service_role";

revoke trigger on table "public"."player_sport_profile" from "service_role";

revoke truncate on table "public"."player_sport_profile" from "service_role";

revoke update on table "public"."player_sport_profile" from "service_role";

DO $$
BEGIN
  revoke delete on table "public"."screen_analytics" from "anon";
  revoke insert on table "public"."screen_analytics" from "anon";
  revoke references on table "public"."screen_analytics" from "anon";
  revoke select on table "public"."screen_analytics" from "anon";
  revoke trigger on table "public"."screen_analytics" from "anon";
  revoke truncate on table "public"."screen_analytics" from "anon";
  revoke update on table "public"."screen_analytics" from "anon";
  revoke delete on table "public"."screen_analytics" from "authenticated";
  revoke insert on table "public"."screen_analytics" from "authenticated";
  revoke references on table "public"."screen_analytics" from "authenticated";
  revoke select on table "public"."screen_analytics" from "authenticated";
  revoke trigger on table "public"."screen_analytics" from "authenticated";
  revoke truncate on table "public"."screen_analytics" from "authenticated";
  revoke update on table "public"."screen_analytics" from "authenticated";
  revoke delete on table "public"."screen_analytics" from "service_role";
  revoke insert on table "public"."screen_analytics" from "service_role";
  revoke references on table "public"."screen_analytics" from "service_role";
  revoke select on table "public"."screen_analytics" from "service_role";
  revoke trigger on table "public"."screen_analytics" from "service_role";
  revoke truncate on table "public"."screen_analytics" from "service_role";
  revoke update on table "public"."screen_analytics" from "service_role";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

revoke delete on table "public"."verification_code" from "anon";

revoke insert on table "public"."verification_code" from "anon";

revoke references on table "public"."verification_code" from "anon";

revoke select on table "public"."verification_code" from "anon";

revoke trigger on table "public"."verification_code" from "anon";

revoke truncate on table "public"."verification_code" from "anon";

revoke update on table "public"."verification_code" from "anon";

revoke delete on table "public"."verification_code" from "authenticated";

revoke insert on table "public"."verification_code" from "authenticated";

revoke references on table "public"."verification_code" from "authenticated";

revoke select on table "public"."verification_code" from "authenticated";

revoke trigger on table "public"."verification_code" from "authenticated";

revoke truncate on table "public"."verification_code" from "authenticated";

revoke update on table "public"."verification_code" from "authenticated";

revoke delete on table "public"."verification_code" from "service_role";

revoke insert on table "public"."verification_code" from "service_role";

revoke references on table "public"."verification_code" from "service_role";

revoke select on table "public"."verification_code" from "service_role";

revoke trigger on table "public"."verification_code" from "service_role";

revoke truncate on table "public"."verification_code" from "service_role";

revoke update on table "public"."verification_code" from "service_role";

-- Wrap alter table statements for tables that may not exist yet
DO $$ BEGIN
  alter table "public"."admin_alert" drop constraint "admin_alert_dismissed_by_fkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."admin_alert" drop constraint "admin_alert_read_by_fkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."admin_alert" drop constraint "admin_alert_severity_check";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."admin_alert" drop constraint "admin_alert_type_check";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."admin_alert_preference" drop constraint "admin_alert_preference_admin_id_fkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."admin_alert_preference" drop constraint "admin_alert_preference_severity_check";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."admin_alert_preference" drop constraint "admin_alert_preference_unique";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."admin_audit_log" drop constraint "admin_audit_log_admin_id_fkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."admin_audit_log" drop constraint "admin_audit_log_severity_check";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."admin_device" drop constraint "admin_device_admin_id_fkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."admin_device" drop constraint "admin_device_admin_id_push_token_key";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."admin_device" drop constraint "admin_device_platform_check";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."analytics_snapshot" drop constraint "analytics_snapshot_sport_id_fkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."analytics_snapshot" drop constraint "analytics_snapshot_unique";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

alter table "public"."feedback" drop constraint "feedback_category_check";

alter table "public"."feedback" drop constraint "feedback_player_id_fkey";

alter table "public"."feedback" drop constraint "feedback_status_check";

DO $$ BEGIN
  alter table "public"."group_activity" drop constraint "group_activity_activity_type_check";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."group_activity" drop constraint "group_activity_network_id_fkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."group_activity" drop constraint "group_activity_player_id_fkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

alter table "public"."match_participant" drop constraint "match_participant_star_rating_check";

DO $$ BEGIN
  alter table "public"."onboarding_analytics" drop constraint "onboarding_analytics_player_id_fkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."player_ban" drop constraint "player_ban_banned_by_admin_id_fkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."player_ban" drop constraint "player_ban_expires_check";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."player_ban" drop constraint "player_ban_lifted_by_admin_id_fkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."player_ban" drop constraint "player_ban_player_id_fkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."player_play_attribute" drop constraint "player_play_attributes_play_attribute_id_fkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."player_play_attribute" drop constraint "player_play_attributes_player_sport_profile_id_fkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."player_report" drop constraint "no_self_report";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."player_report" drop constraint "player_report_priority_check";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."player_report" drop constraint "player_report_related_match_id_fkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."player_report" drop constraint "player_report_reported_player_id_fkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."player_report" drop constraint "player_report_reporter_id_fkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."player_report" drop constraint "player_report_resulting_ban_id_fkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."player_report" drop constraint "player_report_reviewed_by_fkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."player_sport_profile" drop constraint "player_sport_profiles_play_style_id_fkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."player_sport_profile" drop constraint "player_sport_profiles_preferred_facility_id_fkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."player_sport_profile" drop constraint "player_sport_profiles_sport_id_fkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."screen_analytics" drop constraint "screen_analytics_player_id_fkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."screen_analytics" drop constraint "screen_analytics_sport_id_fkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

drop function if exists "public"."auto_add_creator_as_moderator"();

drop function if exists "public"."check_ban_expiration"();

drop function if exists "public"."check_community_access"(p_community_id uuid, p_player_id uuid);

drop function if exists "public"."dismiss_alert"(p_alert_id uuid, p_admin_id uuid);

drop function if exists "public"."generate_daily_analytics_snapshot"();

drop function if exists "public"."generate_weekly_matches_for_all_players"(p_target_match_count_per_player integer);

drop function if exists "public"."generate_weekly_matches_for_player"(p_player_id uuid, p_target_match_count integer);

drop function if exists "public"."get_active_player_ban"(p_player_id uuid);

drop function if exists "public"."get_admin_alerts"(p_admin_id uuid, p_limit integer, p_include_read boolean);

drop function if exists "public"."get_admin_audit_log"(p_limit integer, p_offset integer, p_admin_id uuid, p_action_type text, p_entity_type text, p_severity text, p_start_date timestamp with time zone, p_end_date timestamp with time zone);

drop function if exists "public"."get_admin_push_tokens"(p_alert_type text, p_severity text);

drop function if exists "public"."get_alert_counts"(p_admin_id uuid);

drop function if exists "public"."get_audit_log_stats"(p_days integer);

drop function if exists "public"."get_compatible_players"(p_player_id uuid, p_sport_id uuid, p_rating_tolerance numeric, p_max_results integer);

drop function if exists "public"."get_gender_types"();

drop function if exists "public"."get_group_activity"(p_network_id uuid, p_limit integer);

drop function if exists "public"."get_latest_metric"(p_metric_type text, p_metric_name text, p_sport_id uuid);

drop function if exists "public"."get_match_statistics"(p_sport_id uuid, p_days integer);

drop function if exists "public"."get_metric_trend"(p_metric_type text, p_metric_name text, p_days integer, p_sport_id uuid);

drop function if exists "public"."get_onboarding_funnel"(p_days integer);

drop function if exists "public"."get_pending_reports_count"();

drop function if exists "public"."get_player_matches"(p_player_id uuid, p_time_filter text, p_sport_id uuid, p_limit integer, p_offset integer);

drop function if exists "public"."get_player_reports"(p_limit integer, p_offset integer, p_status public.report_status_enum, p_report_type public.report_type_enum, p_priority text, p_reported_player_id uuid);

drop function if exists "public"."get_realtime_user_count"();

drop function if exists "public"."get_time_slot_starts"(p_period text, p_duration_minutes integer);

drop function if exists "public"."handle_orphaned_community"();

drop function if exists "public"."is_player_banned"(p_player_id uuid);

drop function if exists "public"."log_admin_action"(p_admin_id uuid, p_action_type public.admin_action_type_enum, p_entity_type public.admin_entity_type_enum, p_entity_id uuid, p_old_data jsonb, p_new_data jsonb, p_metadata jsonb);

drop function if exists "public"."log_admin_action"(p_admin_id uuid, p_action_type text, p_entity_type text, p_entity_id uuid, p_entity_name text, p_old_data jsonb, p_new_data jsonb, p_metadata jsonb, p_severity text);

drop function if exists "public"."log_member_joined_activity"();

drop function if exists "public"."log_member_left_activity"();

drop function if exists "public"."log_member_role_change_activity"();

drop function if exists "public"."log_network_created_activity"();

drop function if exists "public"."mark_alert_read"(p_alert_id uuid, p_admin_id uuid);

drop function if exists "public"."notify_admin_new_feedback"();

drop function if exists "public"."notify_admin_push_on_critical_alert"();

drop function if exists "public"."parse_match_duration_to_minutes"(p_duration text);

drop function if exists "public"."register_admin_device"(p_admin_id uuid, p_push_token text, p_platform text, p_device_name text);

drop function if exists "public"."review_player_report"(p_report_id uuid, p_admin_id uuid, p_status public.report_status_enum, p_action_taken text, p_admin_notes text, p_ban_id uuid);

drop function if exists "public"."search_facilities_nearby"(p_sport_id uuid, p_latitude double precision, p_longitude double precision, p_search_query text, p_limit integer, p_offset integer);

drop function if exists "public"."search_public_matches"(p_latitude double precision, p_longitude double precision, p_max_distance_km double precision, p_sport_id uuid, p_search_query text, p_format text, p_match_type text, p_date_range text, p_time_of_day text, p_skill_level text, p_gender text, p_cost text, p_join_mode text, p_limit integer, p_offset integer, p_user_gender text);

drop function if exists "public"."send_admin_broadcast_push"(p_title text, p_message text, p_severity text, p_alert_type text, p_admin_ids uuid[]);

drop function if exists "public"."trigger_weekly_match_generation"(p_target_match_count integer);

drop function if exists "public"."unregister_admin_device"(p_admin_id uuid, p_push_token text);

drop function if exists "public"."update_admin_device_updated_at"();

drop function if exists "public"."update_feedback_updated_at"();

drop function if exists "public"."update_player_ban_updated_at"();

drop function if exists "public"."update_player_report_updated_at"();

-- Wrap alter table pkey drops for tables that may not exist yet
DO $$ BEGIN
  alter table "public"."admin_alert" drop constraint "admin_alert_pkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."admin_alert_preference" drop constraint "admin_alert_preference_pkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."admin_audit_log" drop constraint "admin_audit_log_pkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."admin_device" drop constraint "admin_device_pkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."analytics_snapshot" drop constraint "analytics_snapshot_pkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

alter table "public"."feedback" drop constraint "feedback_pkey";

DO $$ BEGIN
  alter table "public"."group_activity" drop constraint "group_activity_pkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."onboarding_analytics" drop constraint "onboarding_analytics_pkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."player_ban" drop constraint "player_ban_pkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."player_play_attribute" drop constraint "player_play_attributes_pkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."player_report" drop constraint "player_report_pkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."player_sport_profile" drop constraint "player_sport_profiles_pkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."screen_analytics" drop constraint "screen_analytics_pkey";
EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
END $$;

alter table "public"."verification_code" drop constraint "verification_code_pkey";

drop index if exists "public"."admin_alert_pkey";

drop index if exists "public"."admin_alert_preference_pkey";

drop index if exists "public"."admin_alert_preference_unique";

drop index if exists "public"."admin_audit_log_pkey";

drop index if exists "public"."admin_device_admin_id_push_token_key";

drop index if exists "public"."admin_device_pkey";

drop index if exists "public"."analytics_snapshot_pkey";

drop index if exists "public"."analytics_snapshot_unique";

drop index if exists "public"."feedback_pkey";

drop index if exists "public"."group_activity_pkey";

drop index if exists "public"."idx_admin_alert_created_at";

drop index if exists "public"."idx_admin_alert_severity";

drop index if exists "public"."idx_admin_alert_type";

drop index if exists "public"."idx_admin_alert_unread";

drop index if exists "public"."idx_admin_audit_log_action";

drop index if exists "public"."idx_admin_audit_log_admin_id";

drop index if exists "public"."idx_admin_audit_log_created_at";

drop index if exists "public"."idx_admin_audit_log_entity";

drop index if exists "public"."idx_admin_audit_log_severity";

drop index if exists "public"."idx_admin_device_active";

drop index if exists "public"."idx_admin_device_admin_id";

drop index if exists "public"."idx_admin_device_push_token";

drop index if exists "public"."idx_analytics_snapshot_composite";

drop index if exists "public"."idx_analytics_snapshot_date";

drop index if exists "public"."idx_analytics_snapshot_sport";

drop index if exists "public"."idx_analytics_snapshot_type";

drop index if exists "public"."idx_feedback_category";

drop index if exists "public"."idx_feedback_created_at";

drop index if exists "public"."idx_feedback_player_id";

drop index if exists "public"."idx_feedback_status";

drop index if exists "public"."idx_group_activity_created_at";

drop index if exists "public"."idx_group_activity_network_id";

drop index if exists "public"."idx_group_activity_type";

drop index if exists "public"."idx_match_is_auto_generated";

drop index if exists "public"."idx_onboarding_analytics_date";

drop index if exists "public"."idx_onboarding_analytics_player";

drop index if exists "public"."idx_onboarding_analytics_screen";

drop index if exists "public"."idx_player_ban_banned_at";

drop index if exists "public"."idx_player_ban_banned_by";

drop index if exists "public"."idx_player_ban_is_active";

drop index if exists "public"."idx_player_ban_player_id";

drop index if exists "public"."idx_player_report_admin_queue";

drop index if exists "public"."idx_player_report_created";

drop index if exists "public"."idx_player_report_priority";

drop index if exists "public"."idx_player_report_reported";

drop index if exists "public"."idx_player_report_reporter";

drop index if exists "public"."idx_player_report_status";

drop index if exists "public"."idx_player_report_type";

drop index if exists "public"."idx_player_sport_profiles_player_id";

drop index if exists "public"."idx_player_sport_profiles_sport_id";

drop index if exists "public"."idx_screen_analytics_date";

drop index if exists "public"."idx_screen_analytics_player";

drop index if exists "public"."idx_screen_analytics_screen";

drop index if exists "public"."idx_verification_code_email";

drop index if exists "public"."idx_verification_code_expires_at";

drop index if exists "public"."idx_verification_code_lookup";

drop index if exists "public"."onboarding_analytics_pkey";

drop index if exists "public"."player_ban_pkey";

drop index if exists "public"."player_play_attributes_pkey";

drop index if exists "public"."player_report_pkey";

drop index if exists "public"."player_sport_profiles_pkey";

drop index if exists "public"."screen_analytics_pkey";

drop index if exists "public"."uq_player_play_attributes";

drop index if exists "public"."uq_player_sport_profiles_player_sport";

drop index if exists "public"."verification_code_pkey";

-- Drop tables that may not exist (created in later migrations)
drop table if exists "public"."admin_alert";

drop table if exists "public"."admin_alert_preference";

drop table if exists "public"."admin_audit_log";

drop table if exists "public"."admin_device";

drop table if exists "public"."analytics_snapshot";

drop table if exists "public"."feedback";

drop table if exists "public"."group_activity";

drop table if exists "public"."onboarding_analytics";

drop table if exists "public"."player_ban";

drop table if exists "public"."player_play_attribute";

drop table if exists "public"."player_report";

drop table if exists "public"."player_sport_profile";

drop table if exists "public"."screen_analytics";

drop table if exists "public"."verification_code";

alter table "public"."booking" alter column "status" drop default;

-- Handle enum migrations with exception handling for idempotency
DO $$ BEGIN
  ALTER TYPE "public"."admin_role_enum" RENAME TO "admin_role_enum__old_version_to_be_dropped";
EXCEPTION WHEN undefined_object OR duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."admin_role_enum" AS ENUM ('super_admin', 'moderator', 'support');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "public"."booking_status" RENAME TO "booking_status__old_version_to_be_dropped";
EXCEPTION WHEN undefined_object OR duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."booking_status" AS ENUM ('pending', 'confirmed', 'cancelled', 'completed', 'no_show', 'awaiting_approval');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "public"."cancellation_reason_enum" RENAME TO "cancellation_reason_enum__old_version_to_be_dropped";
EXCEPTION WHEN undefined_object OR duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."cancellation_reason_enum" AS ENUM ('weather', 'court_unavailable', 'emergency', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "public"."gender_enum" RENAME TO "gender_enum__old_version_to_be_dropped";
EXCEPTION WHEN undefined_object OR duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."gender_enum" AS ENUM ('male', 'female', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "public"."match_outcome_enum" RENAME TO "match_outcome_enum__old_version_to_be_dropped";
EXCEPTION WHEN undefined_object OR duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."match_outcome_enum" AS ENUM ('played', 'mutual_cancel', 'opponent_no_show');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "public"."notification_type_enum" RENAME TO "notification_type_enum__old_version_to_be_dropped";
EXCEPTION WHEN undefined_object OR duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."notification_type_enum" AS ENUM ('match_invitation', 'reminder', 'payment', 'support', 'chat', 'system', 'match_join_request', 'match_join_accepted', 'match_join_rejected', 'match_player_joined', 'match_cancelled', 'match_updated', 'match_starting_soon', 'match_completed', 'player_kicked', 'player_left', 'new_message', 'friend_request', 'rating_verified', 'feedback_request', 'score_confirmation', 'feedback_reminder', 'booking_created', 'booking_cancelled_by_player', 'booking_modified', 'new_member_joined', 'member_left', 'member_role_changed', 'payment_received', 'payment_failed', 'refund_processed', 'daily_summary', 'weekly_report', 'booking_confirmed', 'booking_reminder', 'booking_cancelled_by_org', 'membership_approved', 'org_announcement', 'match_new_available');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


  create table "public"."availability_block" (
    "id" uuid not null default gen_random_uuid(),
    "court_id" uuid,
    "facility_id" uuid not null,
    "block_date" date not null,
    "start_time" time without time zone,
    "end_time" time without time zone,
    "reason" text,
    "block_type" public.availability_block_type_enum not null default 'manual'::public.availability_block_type_enum,
    "created_by" uuid,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."availability_block" enable row level security;


  create table "public"."beta_signup" (
    "id" bigint generated always as identity not null,
    "full_name" text not null,
    "city" text not null,
    "plays_tennis" boolean not null default false,
    "tennis_level" text,
    "plays_pickleball" boolean not null default false,
    "pickleball_level" text,
    "email" text not null,
    "phone" text,
    "ip_address" text,
    "location" text,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."beta_signup" enable row level security;


  create table "public"."cancellation_policy" (
    "id" uuid not null default gen_random_uuid(),
    "organization_id" uuid not null,
    "free_cancellation_hours" integer default 24,
    "partial_refund_hours" integer default 12,
    "partial_refund_percent" integer default 50,
    "no_refund_hours" integer default 0,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."cancellation_policy" enable row level security;


  create table "public"."court_one_time_availability" (
    "id" uuid not null default gen_random_uuid(),
    "court_id" uuid,
    "facility_id" uuid not null,
    "availability_date" date not null,
    "start_time" time without time zone not null,
    "end_time" time without time zone not null,
    "slot_duration_minutes" integer not null default 60,
    "price_cents" integer,
    "is_available" boolean not null default true,
    "reason" text,
    "created_by" uuid,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."court_one_time_availability" enable row level security;


  create table "public"."instructor_profile" (
    "id" uuid not null default gen_random_uuid(),
    "organization_id" uuid not null,
    "organization_member_id" uuid,
    "display_name" character varying(255) not null,
    "bio" text,
    "avatar_url" text,
    "email" character varying(255),
    "phone" character varying(30),
    "hourly_rate_cents" integer,
    "currency" character varying(3) default 'CAD'::character varying,
    "certifications" jsonb default '[]'::jsonb,
    "specializations" jsonb default '[]'::jsonb,
    "is_external" boolean not null default false,
    "is_active" boolean not null default true,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."instructor_profile" enable row level security;


  create table "public"."match_feedback" (
    "id" uuid not null default gen_random_uuid(),
    "match_id" uuid not null,
    "reviewer_id" uuid not null,
    "opponent_id" uuid not null,
    "showed_up" boolean not null,
    "was_late" boolean,
    "star_rating" smallint,
    "comments" text,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."match_feedback" enable row level security;


  create table "public"."match_report" (
    "id" uuid not null default gen_random_uuid(),
    "match_id" uuid not null,
    "reporter_id" uuid not null,
    "reported_id" uuid not null,
    "reason" public.match_report_reason_enum not null,
    "details" text,
    "priority" public.match_report_priority_enum not null,
    "status" public.match_report_status_enum not null default 'pending'::public.match_report_status_enum,
    "created_at" timestamp with time zone not null default now(),
    "reviewed_by" uuid,
    "reviewed_at" timestamp with time zone
      );


alter table "public"."match_report" enable row level security;


  create table "public"."organization_notification_preference" (
    "id" uuid not null default gen_random_uuid(),
    "organization_id" uuid not null,
    "notification_type" public.notification_type_enum not null,
    "channel" public.delivery_channel_enum not null,
    "enabled" boolean not null default true,
    "recipient_roles" public.role_enum[],
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."organization_notification_preference" enable row level security;


  create table "public"."organization_notification_recipient" (
    "id" uuid not null default gen_random_uuid(),
    "organization_id" uuid not null,
    "notification_type" public.notification_type_enum not null,
    "user_id" uuid not null,
    "enabled" boolean not null default true,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."organization_notification_recipient" enable row level security;


  create table "public"."organization_player_block" (
    "id" uuid not null default gen_random_uuid(),
    "organization_id" uuid not null,
    "player_id" uuid not null,
    "blocked_by" uuid,
    "reason" text,
    "blocked_until" timestamp with time zone,
    "is_active" boolean default true,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."organization_player_block" enable row level security;


  create table "public"."organization_settings" (
    "id" uuid not null default gen_random_uuid(),
    "organization_id" uuid not null,
    "require_booking_approval" boolean default false,
    "approval_timeout_hours" integer default 24,
    "allow_same_day_booking" boolean default true,
    "min_booking_notice_hours" integer default 1,
    "max_advance_booking_days" integer default 30,
    "slot_duration_minutes" integer default 60,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."organization_settings" enable row level security;


  create table "public"."organization_stripe_account" (
    "id" uuid not null default gen_random_uuid(),
    "organization_id" uuid not null,
    "stripe_account_id" character varying(255) not null,
    "stripe_account_type" character varying(50) default 'express'::character varying,
    "onboarding_complete" boolean default false,
    "charges_enabled" boolean default false,
    "payouts_enabled" boolean default false,
    "default_currency" character varying(3) default 'CAD'::character varying,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."organization_stripe_account" enable row level security;


  create table "public"."player_reputation" (
    "player_id" uuid not null,
    "reputation_score" numeric(5,2) not null default 100,
    "reputation_tier" public.reputation_tier not null default 'unknown'::public.reputation_tier,
    "total_events" integer not null default 0,
    "positive_events" integer not null default 0,
    "negative_events" integer not null default 0,
    "matches_completed" integer not null default 0,
    "last_decay_calculation" timestamp with time zone,
    "calculated_at" timestamp with time zone not null default now(),
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "min_events_for_public" integer not null default 10,
    "is_public" boolean generated always as ((total_events >= min_events_for_public)) stored
      );


alter table "public"."player_reputation" enable row level security;


  create table "public"."pricing_rule" (
    "id" uuid not null default gen_random_uuid(),
    "organization_id" uuid not null,
    "facility_id" uuid,
    "court_id" uuid,
    "name" character varying(100) not null,
    "days_of_week" integer[] not null,
    "start_time" time without time zone not null,
    "end_time" time without time zone not null,
    "price_cents" integer not null,
    "currency" character varying(3) default 'CAD'::character varying,
    "priority" integer default 0,
    "valid_from" date,
    "valid_until" date,
    "is_active" boolean default true,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."pricing_rule" enable row level security;


  create table "public"."program" (
    "id" uuid not null default gen_random_uuid(),
    "organization_id" uuid not null,
    "facility_id" uuid,
    "sport_id" uuid,
    "type" public.program_type_enum not null default 'program'::public.program_type_enum,
    "status" public.program_status_enum not null default 'draft'::public.program_status_enum,
    "name" character varying(255) not null,
    "description" text,
    "start_date" date not null,
    "end_date" date,
    "registration_opens_at" timestamp with time zone,
    "registration_deadline" timestamp with time zone,
    "min_participants" integer default 1,
    "max_participants" integer,
    "current_participants" integer not null default 0,
    "price_cents" integer not null,
    "currency" character varying(3) not null default 'CAD'::character varying,
    "allow_installments" boolean not null default false,
    "installment_count" integer default 1,
    "deposit_cents" integer,
    "auto_block_courts" boolean not null default false,
    "waitlist_enabled" boolean not null default true,
    "waitlist_limit" integer,
    "age_min" integer,
    "age_max" integer,
    "skill_level_min" character varying(50),
    "skill_level_max" character varying(50),
    "cancellation_policy" jsonb default '{"no_refund_after_start": true, "partial_refund_percent": 50, "prorate_by_sessions_attended": true, "full_refund_days_before_start": 7, "partial_refund_days_before_start": 3}'::jsonb,
    "cover_image_url" text,
    "metadata" jsonb default '{}'::jsonb,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "published_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone
      );


alter table "public"."program" enable row level security;


  create table "public"."program_instructor" (
    "id" uuid not null default gen_random_uuid(),
    "program_id" uuid not null,
    "instructor_id" uuid not null,
    "is_primary" boolean not null default false,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."program_instructor" enable row level security;


  create table "public"."program_registration" (
    "id" uuid not null default gen_random_uuid(),
    "program_id" uuid not null,
    "player_id" uuid not null,
    "registered_by" uuid not null,
    "status" public.registration_status_enum not null default 'pending'::public.registration_status_enum,
    "payment_plan" public.payment_plan_enum not null default 'full'::public.payment_plan_enum,
    "total_amount_cents" integer not null,
    "paid_amount_cents" integer not null default 0,
    "refund_amount_cents" integer not null default 0,
    "currency" character varying(3) not null default 'CAD'::character varying,
    "stripe_customer_id" character varying(255),
    "notes" text,
    "emergency_contact_name" character varying(255),
    "emergency_contact_phone" character varying(30),
    "registered_at" timestamp with time zone not null default now(),
    "confirmed_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "refunded_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."program_registration" enable row level security;


  create table "public"."program_session" (
    "id" uuid not null default gen_random_uuid(),
    "program_id" uuid not null,
    "date" date not null,
    "start_time" time without time zone not null,
    "end_time" time without time zone not null,
    "location_override" text,
    "notes" text,
    "is_cancelled" boolean not null default false,
    "cancelled_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."program_session" enable row level security;


  create table "public"."program_session_court" (
    "id" uuid not null default gen_random_uuid(),
    "session_id" uuid not null,
    "court_id" uuid not null,
    "booking_id" uuid,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."program_session_court" enable row level security;


  create table "public"."program_waitlist" (
    "id" uuid not null default gen_random_uuid(),
    "program_id" uuid not null,
    "player_id" uuid not null,
    "added_by" uuid not null,
    "position" integer not null,
    "promoted_at" timestamp with time zone,
    "promotion_expires_at" timestamp with time zone,
    "registration_id" uuid,
    "notification_sent_at" timestamp with time zone,
    "notes" text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."program_waitlist" enable row level security;


  create table "public"."registration_payment" (
    "id" uuid not null default gen_random_uuid(),
    "registration_id" uuid not null,
    "amount_cents" integer not null,
    "currency" character varying(3) not null default 'CAD'::character varying,
    "installment_number" integer not null default 1,
    "total_installments" integer not null default 1,
    "stripe_payment_intent_id" character varying(255),
    "stripe_customer_id" character varying(255),
    "stripe_charge_id" character varying(255),
    "status" public.registration_payment_status_enum not null default 'pending'::public.registration_payment_status_enum,
    "due_date" date not null,
    "paid_at" timestamp with time zone,
    "failed_at" timestamp with time zone,
    "failure_reason" text,
    "refund_amount_cents" integer default 0,
    "refunded_at" timestamp with time zone,
    "retry_count" integer not null default 0,
    "next_retry_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."registration_payment" enable row level security;


  create table "public"."reputation_config" (
    "id" uuid not null default gen_random_uuid(),
    "event_type" public.reputation_event_type not null,
    "default_impact" numeric(5,2) not null,
    "min_impact" numeric(5,2),
    "max_impact" numeric(5,2),
    "decay_enabled" boolean not null default false,
    "decay_half_life_days" integer default 180,
    "is_active" boolean not null default true,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."reputation_config" enable row level security;


  create table "public"."reputation_event" (
    "id" uuid not null default gen_random_uuid(),
    "player_id" uuid not null,
    "event_type" public.reputation_event_type not null,
    "base_impact" numeric(5,2) not null,
    "match_id" uuid,
    "caused_by_player_id" uuid,
    "metadata" jsonb default '{}'::jsonb,
    "event_occurred_at" timestamp with time zone not null default now(),
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."reputation_event" enable row level security;


  create table "public"."session_attendance" (
    "id" uuid not null default gen_random_uuid(),
    "session_id" uuid not null,
    "registration_id" uuid not null,
    "attended" boolean,
    "marked_at" timestamp with time zone,
    "marked_by" uuid,
    "notes" text,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."session_attendance" enable row level security;

alter table "public"."admin" alter column role type "public"."admin_role_enum" using role::text::"public"."admin_role_enum";

alter table "public"."booking" alter column status type "public"."booking_status" using status::text::"public"."booking_status";

alter table "public"."invitation" alter column admin_role type "public"."admin_role_enum" using admin_role::text::"public"."admin_role_enum";

alter table "public"."match_participant" alter column cancellation_reason type "public"."cancellation_reason_enum" using cancellation_reason::text::"public"."cancellation_reason_enum";

alter table "public"."match_participant" alter column match_outcome type "public"."match_outcome_enum" using match_outcome::text::"public"."match_outcome_enum";

alter table "public"."notification" alter column type type "public"."notification_type_enum" using type::text::"public"."notification_type_enum";

alter table "public"."notification_preference" alter column notification_type type "public"."notification_type_enum" using notification_type::text::"public"."notification_type_enum";

alter table "public"."booking" alter column "status" set default 'pending'::public.booking_status;

drop type "public"."admin_role_enum__old_version_to_be_dropped";

drop type "public"."booking_status__old_version_to_be_dropped";

drop type "public"."cancellation_reason_enum__old_version_to_be_dropped";

drop type "public"."gender_enum__old_version_to_be_dropped";

drop type "public"."match_outcome_enum__old_version_to_be_dropped";

drop type "public"."notification_type_enum__old_version_to_be_dropped";

alter table "public"."booking" add column "approved_at" timestamp with time zone;

alter table "public"."booking" add column "approved_by" uuid;

alter table "public"."booking" add column "booking_type" public.booking_type_enum not null default 'player'::public.booking_type_enum;

alter table "public"."booking" add column "cancellation_reason" text;

alter table "public"."booking" add column "cancelled_at" timestamp with time zone;

alter table "public"."booking" add column "cancelled_by" uuid;

alter table "public"."booking" add column "court_id" uuid;

alter table "public"."booking" add column "currency" character varying(3) default 'CAD'::character varying;

alter table "public"."booking" add column "metadata" jsonb;

alter table "public"."booking" add column "organization_id" uuid;

alter table "public"."booking" add column "price_cents" integer;

alter table "public"."booking" add column "refund_amount_cents" integer;

alter table "public"."booking" add column "refund_status" character varying(50);

alter table "public"."booking" add column "requires_approval" boolean default false;

alter table "public"."booking" add column "stripe_charge_id" character varying(255);

alter table "public"."booking" add column "stripe_payment_intent_id" character varying(255);

alter table "public"."booking" alter column "court_slot_id" drop not null;

alter table "public"."booking" alter column "player_id" drop not null;

alter table "public"."court" add column "external_provider_id" text;

alter table "public"."court_slot" add column "facility_id" uuid;

alter table "public"."court_slot" add column "name" character varying(100);

alter table "public"."court_slot" add column "price_cents" integer;

alter table "public"."court_slot" add column "priority" integer default 0;

alter table "public"."court_slot" add column "slot_duration_minutes" integer default 60;

alter table "public"."court_slot" add column "valid_from" date;

alter table "public"."court_slot" add column "valid_until" date;

alter table "public"."court_slot" alter column "court_id" drop not null;

alter table "public"."facility_file" enable row level security;

alter table "public"."file" enable row level security;

alter table "public"."match" drop column "is_auto_generated";

alter table "public"."match" alter column "preferred_opponent_gender" set data type public.gender_enum using "preferred_opponent_gender"::text::public.gender_enum;

alter table "public"."network" drop column "archived_at";

alter table "public"."network" add column "conversation_id" uuid;

alter table "public"."network" add column "cover_image_url" text;

alter table "public"."network" alter column "max_members" drop default;

alter table "public"."network" enable row level security;

alter table "public"."network_member" add column "added_by" uuid;

alter table "public"."network_member" add column "role" public.network_member_role_enum default 'member'::public.network_member_role_enum;

alter table "public"."network_member" enable row level security;

alter table "public"."notification" add column "organization_id" uuid;

-- Handle organization_member role changes that may have type mismatches
DO $$ BEGIN
  alter table "public"."organization_member" alter column "role" set default 'member'::public.member_role;
EXCEPTION WHEN undefined_object OR invalid_text_representation OR datatype_mismatch THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."organization_member" alter column "role" set data type public.member_role using "role"::text::public.member_role;
EXCEPTION WHEN undefined_object OR invalid_text_representation OR datatype_mismatch THEN NULL;
END $$;

alter table "public"."player" drop column "postal_code_country";

alter table "public"."player" drop column "postal_code_lat";

alter table "public"."player" drop column "postal_code_location";

alter table "public"."player" drop column "postal_code_long";

alter table "public"."player" add column "address" text;

alter table "public"."player" add column "city" text;

alter table "public"."player" add column "country" character varying(2);

alter table "public"."player" add column "latitude" numeric(9,6);

alter table "public"."player" add column "longitude" numeric(9,6);

-- The location column depends on both latitude and longitude, so add it after both
DO $$ BEGIN
  alter table "public"."player" add column "location" extensions.geography(Point,4326) generated always as (
  CASE
      WHEN ((latitude IS NOT NULL) AND (longitude IS NOT NULL)) THEN (extensions.st_setsrid(extensions.st_makepoint((longitude)::double precision, (latitude)::double precision), 4326))::extensions.geography
      ELSE NULL::extensions.geography
  END) stored;
EXCEPTION WHEN duplicate_column OR undefined_column THEN NULL;
END $$;

alter table "public"."player" add column "province" text;

alter table "public"."player" alter column "gender" set data type public.gender_enum using "gender"::text::public.gender_enum;

alter table "public"."player" alter column "postal_code" set data type character varying(20) using "postal_code"::character varying(20);

alter table "public"."profile" drop column "address";

alter table "public"."profile" drop column "city";

alter table "public"."profile" drop column "country";

alter table "public"."profile" drop column "postal_code";

alter table "public"."profile" drop column "province";

alter table "public"."profile" alter column "first_name" drop not null;

drop type if exists "public"."admin_action_type_enum";

drop type if exists "public"."admin_entity_type_enum";

drop type if exists "public"."ban_type_enum";

drop type if exists "public"."gender_type";

drop type if exists "public"."report_status_enum";

drop type if exists "public"."report_type_enum";

CREATE UNIQUE INDEX availability_block_pkey ON public.availability_block USING btree (id);

CREATE INDEX beta_signup_email_idx ON public.beta_signup USING btree (email);

CREATE UNIQUE INDEX beta_signup_pkey ON public.beta_signup USING btree (id);

CREATE UNIQUE INDEX cancellation_policy_organization_id_key ON public.cancellation_policy USING btree (organization_id);

CREATE UNIQUE INDEX cancellation_policy_pkey ON public.cancellation_policy USING btree (id);

CREATE UNIQUE INDEX court_one_time_availability_pkey ON public.court_one_time_availability USING btree (id);

CREATE INDEX idx_availability_block_court_date ON public.availability_block USING btree (court_id, block_date) WHERE (court_id IS NOT NULL);

CREATE INDEX idx_availability_block_facility_date ON public.availability_block USING btree (facility_id, block_date);

CREATE INDEX idx_availability_block_facility_wide ON public.availability_block USING btree (facility_id, block_date) WHERE (court_id IS NULL);

CREATE INDEX idx_booking_cancelled ON public.booking USING btree (cancelled_at) WHERE (cancelled_at IS NOT NULL);

CREATE INDEX idx_booking_court ON public.booking USING btree (court_id) WHERE (court_id IS NOT NULL);

CREATE INDEX idx_booking_court_date ON public.booking USING btree (court_id, booking_date) WHERE (court_id IS NOT NULL);

CREATE INDEX idx_booking_date_time ON public.booking USING btree (booking_date, start_time);

CREATE INDEX idx_booking_metadata_program ON public.booking USING btree (((metadata ->> 'program_id'::text))) WHERE ((metadata ->> 'program_id'::text) IS NOT NULL);

CREATE INDEX idx_booking_organization ON public.booking USING btree (organization_id) WHERE (organization_id IS NOT NULL);

CREATE INDEX idx_booking_stripe_intent ON public.booking USING btree (stripe_payment_intent_id) WHERE (stripe_payment_intent_id IS NOT NULL);

CREATE INDEX idx_booking_type ON public.booking USING btree (booking_type);

CREATE INDEX idx_court_external_provider_id ON public.court USING btree (external_provider_id) WHERE (external_provider_id IS NOT NULL);

CREATE UNIQUE INDEX idx_court_facility_external_unique ON public.court USING btree (facility_id, external_provider_id) WHERE (external_provider_id IS NOT NULL);

CREATE INDEX idx_court_slot_court_day ON public.court_slot USING btree (court_id, day_of_week) WHERE (court_id IS NOT NULL);

CREATE INDEX idx_court_slot_facility ON public.court_slot USING btree (facility_id) WHERE (facility_id IS NOT NULL);

CREATE INDEX idx_court_slot_facility_day ON public.court_slot USING btree (facility_id, day_of_week) WHERE ((facility_id IS NOT NULL) AND (court_id IS NULL));

CREATE INDEX idx_instructor_profile_active ON public.instructor_profile USING btree (organization_id, is_active);

CREATE INDEX idx_instructor_profile_member ON public.instructor_profile USING btree (organization_member_id);

CREATE INDEX idx_instructor_profile_org ON public.instructor_profile USING btree (organization_id);

CREATE INDEX idx_match_feedback_match_id ON public.match_feedback USING btree (match_id);

CREATE INDEX idx_match_feedback_opponent_id ON public.match_feedback USING btree (opponent_id);

CREATE INDEX idx_match_participant_feedback_notifications ON public.match_participant USING btree (initial_feedback_notification_sent_at, feedback_reminder_sent_at) WHERE (status = 'joined'::public.match_participant_status_enum);

CREATE INDEX idx_match_participant_pending_feedback ON public.match_participant USING btree (match_id) WHERE ((feedback_completed = false) AND (status = 'joined'::public.match_participant_status_enum));

CREATE INDEX idx_match_pending_closure ON public.match USING btree (end_time) WHERE ((closed_at IS NULL) AND (cancelled_at IS NULL));

CREATE INDEX idx_match_report_match_id ON public.match_report USING btree (match_id);

CREATE INDEX idx_match_report_pending ON public.match_report USING btree (priority, created_at) WHERE (status = 'pending'::public.match_report_status_enum);

CREATE INDEX idx_network_conversation_id ON public.network USING btree (conversation_id) WHERE (conversation_id IS NOT NULL);

CREATE INDEX idx_network_member_role ON public.network_member USING btree (network_id, role) WHERE (role = 'moderator'::public.network_member_role_enum);

CREATE INDEX idx_notification_org_user ON public.notification USING btree (organization_id, user_id) WHERE (organization_id IS NOT NULL);

CREATE INDEX idx_notification_organization ON public.notification USING btree (organization_id) WHERE (organization_id IS NOT NULL);

CREATE INDEX idx_one_time_availability_court_date ON public.court_one_time_availability USING btree (court_id, availability_date) WHERE (court_id IS NOT NULL);

CREATE INDEX idx_one_time_availability_date ON public.court_one_time_availability USING btree (availability_date);

CREATE INDEX idx_one_time_availability_facility_date ON public.court_one_time_availability USING btree (facility_id, availability_date);

CREATE INDEX idx_one_time_availability_facility_wide ON public.court_one_time_availability USING btree (facility_id, availability_date) WHERE (court_id IS NULL);

CREATE INDEX idx_org_notification_preference_org ON public.organization_notification_preference USING btree (organization_id);

CREATE INDEX idx_org_notification_preference_org_type ON public.organization_notification_preference USING btree (organization_id, notification_type);

CREATE INDEX idx_org_notification_recipient_org ON public.organization_notification_recipient USING btree (organization_id);

CREATE INDEX idx_org_notification_recipient_org_type ON public.organization_notification_recipient USING btree (organization_id, notification_type);

CREATE INDEX idx_org_notification_recipient_user ON public.organization_notification_recipient USING btree (user_id);

CREATE INDEX idx_org_player_block_active ON public.organization_player_block USING btree (organization_id, player_id) WHERE (is_active = true);

CREATE INDEX idx_player_city ON public.player USING btree (city);

CREATE INDEX idx_player_location_geo ON public.player USING gist (location);

CREATE INDEX idx_pricing_rule_court ON public.pricing_rule USING btree (court_id) WHERE (court_id IS NOT NULL);

CREATE INDEX idx_pricing_rule_facility ON public.pricing_rule USING btree (facility_id, is_active) WHERE (facility_id IS NOT NULL);

CREATE INDEX idx_pricing_rule_org_active ON public.pricing_rule USING btree (organization_id, is_active);

CREATE INDEX idx_program_dates ON public.program USING btree (start_date, end_date);

CREATE INDEX idx_program_facility ON public.program USING btree (facility_id);

CREATE INDEX idx_program_instructor_instructor ON public.program_instructor USING btree (instructor_id);

CREATE INDEX idx_program_instructor_program ON public.program_instructor USING btree (program_id);

CREATE INDEX idx_program_org ON public.program USING btree (organization_id);

CREATE INDEX idx_program_org_status ON public.program USING btree (organization_id, status);

CREATE INDEX idx_program_published ON public.program USING btree (organization_id, status, start_date) WHERE (status = 'published'::public.program_status_enum);

CREATE INDEX idx_program_registration_player ON public.program_registration USING btree (player_id);

CREATE INDEX idx_program_registration_program ON public.program_registration USING btree (program_id);

CREATE INDEX idx_program_registration_program_status ON public.program_registration USING btree (program_id, status);

CREATE INDEX idx_program_registration_status ON public.program_registration USING btree (status);

CREATE INDEX idx_program_session_court_booking ON public.program_session_court USING btree (booking_id);

CREATE INDEX idx_program_session_court_court ON public.program_session_court USING btree (court_id);

CREATE INDEX idx_program_session_court_session ON public.program_session_court USING btree (session_id);

CREATE INDEX idx_program_session_date ON public.program_session USING btree (date);

CREATE INDEX idx_program_session_program ON public.program_session USING btree (program_id);

CREATE INDEX idx_program_status ON public.program USING btree (status);

CREATE INDEX idx_program_waitlist_player ON public.program_waitlist USING btree (player_id);

CREATE INDEX idx_program_waitlist_position ON public.program_waitlist USING btree (program_id, "position");

CREATE INDEX idx_program_waitlist_program ON public.program_waitlist USING btree (program_id);

CREATE INDEX idx_program_waitlist_promotion ON public.program_waitlist USING btree (promotion_expires_at) WHERE (promoted_at IS NOT NULL);

CREATE INDEX idx_registration_payment_due ON public.registration_payment USING btree (due_date, status);

CREATE INDEX idx_registration_payment_registration ON public.registration_payment USING btree (registration_id);

CREATE INDEX idx_registration_payment_status ON public.registration_payment USING btree (status);

CREATE INDEX idx_registration_payment_stripe ON public.registration_payment USING btree (stripe_payment_intent_id);

CREATE INDEX idx_reputation_event_occurred ON public.reputation_event USING btree (event_occurred_at DESC);

CREATE INDEX idx_reputation_event_player ON public.reputation_event USING btree (player_id);

CREATE INDEX idx_reputation_event_player_occurred ON public.reputation_event USING btree (player_id, event_occurred_at DESC);

CREATE INDEX idx_reputation_event_type ON public.reputation_event USING btree (event_type);

CREATE INDEX idx_session_attendance_registration ON public.session_attendance USING btree (registration_id);

CREATE INDEX idx_session_attendance_session ON public.session_attendance USING btree (session_id);

CREATE UNIQUE INDEX instructor_profile_pkey ON public.instructor_profile USING btree (id);

CREATE UNIQUE INDEX match_feedback_pkey ON public.match_feedback USING btree (id);

CREATE UNIQUE INDEX match_feedback_unique ON public.match_feedback USING btree (match_id, reviewer_id, opponent_id);

CREATE UNIQUE INDEX match_report_pkey ON public.match_report USING btree (id);

CREATE UNIQUE INDEX match_report_unique ON public.match_report USING btree (match_id, reporter_id, reported_id);

select 1; 
-- CREATE INDEX no_overlapping_bookings ON public.booking USING gist (court_id, tsrange((booking_date + start_time), (booking_date + end_time))) WHERE ((status <> 'cancelled'::public.booking_status) AND (court_id IS NOT NULL));

CREATE UNIQUE INDEX organization_notification_preference_pkey ON public.organization_notification_preference USING btree (id);

CREATE UNIQUE INDEX organization_notification_recipient_pkey ON public.organization_notification_recipient USING btree (id);

CREATE UNIQUE INDEX organization_player_block_organization_id_player_id_key ON public.organization_player_block USING btree (organization_id, player_id);

CREATE UNIQUE INDEX organization_player_block_pkey ON public.organization_player_block USING btree (id);

CREATE UNIQUE INDEX organization_settings_organization_id_key ON public.organization_settings USING btree (organization_id);

CREATE UNIQUE INDEX organization_settings_pkey ON public.organization_settings USING btree (id);

CREATE UNIQUE INDEX organization_stripe_account_organization_id_key ON public.organization_stripe_account USING btree (organization_id);

CREATE UNIQUE INDEX organization_stripe_account_pkey ON public.organization_stripe_account USING btree (id);

CREATE UNIQUE INDEX player_reputation_pkey ON public.player_reputation USING btree (player_id);

CREATE UNIQUE INDEX pricing_rule_pkey ON public.pricing_rule USING btree (id);

CREATE UNIQUE INDEX program_instructor_pkey ON public.program_instructor USING btree (id);

CREATE UNIQUE INDEX program_pkey ON public.program USING btree (id);

CREATE UNIQUE INDEX program_registration_pkey ON public.program_registration USING btree (id);

CREATE UNIQUE INDEX program_session_court_pkey ON public.program_session_court USING btree (id);

CREATE UNIQUE INDEX program_session_pkey ON public.program_session USING btree (id);

CREATE UNIQUE INDEX program_waitlist_pkey ON public.program_waitlist USING btree (id);

CREATE UNIQUE INDEX registration_payment_pkey ON public.registration_payment USING btree (id);

CREATE UNIQUE INDEX reputation_config_event_type_key ON public.reputation_config USING btree (event_type);

CREATE UNIQUE INDEX reputation_config_pkey ON public.reputation_config USING btree (id);

CREATE UNIQUE INDEX reputation_event_pkey ON public.reputation_event USING btree (id);

CREATE UNIQUE INDEX session_attendance_pkey ON public.session_attendance USING btree (id);

CREATE UNIQUE INDEX uq_org_notification_preference ON public.organization_notification_preference USING btree (organization_id, notification_type, channel);

CREATE UNIQUE INDEX uq_org_notification_recipient ON public.organization_notification_recipient USING btree (organization_id, notification_type, user_id);

CREATE UNIQUE INDEX uq_program_instructor ON public.program_instructor USING btree (program_id, instructor_id);

CREATE UNIQUE INDEX uq_program_player ON public.program_registration USING btree (program_id, player_id);

CREATE UNIQUE INDEX uq_session_attendance ON public.session_attendance USING btree (session_id, registration_id);

CREATE UNIQUE INDEX uq_session_court ON public.program_session_court USING btree (session_id, court_id);

CREATE UNIQUE INDEX uq_waitlist_program_player ON public.program_waitlist USING btree (program_id, player_id);

alter table "public"."availability_block" add constraint "availability_block_pkey" PRIMARY KEY using index "availability_block_pkey";

alter table "public"."beta_signup" add constraint "beta_signup_pkey" PRIMARY KEY using index "beta_signup_pkey";

alter table "public"."cancellation_policy" add constraint "cancellation_policy_pkey" PRIMARY KEY using index "cancellation_policy_pkey";

alter table "public"."court_one_time_availability" add constraint "court_one_time_availability_pkey" PRIMARY KEY using index "court_one_time_availability_pkey";

alter table "public"."instructor_profile" add constraint "instructor_profile_pkey" PRIMARY KEY using index "instructor_profile_pkey";

alter table "public"."match_feedback" add constraint "match_feedback_pkey" PRIMARY KEY using index "match_feedback_pkey";

alter table "public"."match_report" add constraint "match_report_pkey" PRIMARY KEY using index "match_report_pkey";

alter table "public"."organization_notification_preference" add constraint "organization_notification_preference_pkey" PRIMARY KEY using index "organization_notification_preference_pkey";

alter table "public"."organization_notification_recipient" add constraint "organization_notification_recipient_pkey" PRIMARY KEY using index "organization_notification_recipient_pkey";

alter table "public"."organization_player_block" add constraint "organization_player_block_pkey" PRIMARY KEY using index "organization_player_block_pkey";

alter table "public"."organization_settings" add constraint "organization_settings_pkey" PRIMARY KEY using index "organization_settings_pkey";

alter table "public"."organization_stripe_account" add constraint "organization_stripe_account_pkey" PRIMARY KEY using index "organization_stripe_account_pkey";

alter table "public"."player_reputation" add constraint "player_reputation_pkey" PRIMARY KEY using index "player_reputation_pkey";

alter table "public"."pricing_rule" add constraint "pricing_rule_pkey" PRIMARY KEY using index "pricing_rule_pkey";

alter table "public"."program" add constraint "program_pkey" PRIMARY KEY using index "program_pkey";

alter table "public"."program_instructor" add constraint "program_instructor_pkey" PRIMARY KEY using index "program_instructor_pkey";

alter table "public"."program_registration" add constraint "program_registration_pkey" PRIMARY KEY using index "program_registration_pkey";

alter table "public"."program_session" add constraint "program_session_pkey" PRIMARY KEY using index "program_session_pkey";

alter table "public"."program_session_court" add constraint "program_session_court_pkey" PRIMARY KEY using index "program_session_court_pkey";

alter table "public"."program_waitlist" add constraint "program_waitlist_pkey" PRIMARY KEY using index "program_waitlist_pkey";

alter table "public"."registration_payment" add constraint "registration_payment_pkey" PRIMARY KEY using index "registration_payment_pkey";

alter table "public"."reputation_config" add constraint "reputation_config_pkey" PRIMARY KEY using index "reputation_config_pkey";

alter table "public"."reputation_event" add constraint "reputation_event_pkey" PRIMARY KEY using index "reputation_event_pkey";

alter table "public"."session_attendance" add constraint "session_attendance_pkey" PRIMARY KEY using index "session_attendance_pkey";

alter table "public"."availability_block" add constraint "availability_block_court_id_fkey" FOREIGN KEY (court_id) REFERENCES public.court(id) ON DELETE CASCADE not valid;

alter table "public"."availability_block" validate constraint "availability_block_court_id_fkey";

alter table "public"."availability_block" add constraint "availability_block_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profile(id) ON DELETE SET NULL not valid;

alter table "public"."availability_block" validate constraint "availability_block_created_by_fkey";

alter table "public"."availability_block" add constraint "availability_block_facility_id_fkey" FOREIGN KEY (facility_id) REFERENCES public.facility(id) ON DELETE CASCADE not valid;

alter table "public"."availability_block" validate constraint "availability_block_facility_id_fkey";

alter table "public"."availability_block" add constraint "chk_time_range" CHECK ((((start_time IS NULL) AND (end_time IS NULL)) OR ((start_time IS NOT NULL) AND (end_time IS NOT NULL) AND (end_time > start_time)))) not valid;

alter table "public"."availability_block" validate constraint "chk_time_range";

alter table "public"."beta_signup" add constraint "beta_signup_at_least_one_sport_check" CHECK (((plays_tennis = true) OR (plays_pickleball = true))) not valid;

alter table "public"."beta_signup" validate constraint "beta_signup_at_least_one_sport_check";

alter table "public"."beta_signup" add constraint "beta_signup_pickleball_level_check" CHECK (((pickleball_level IS NULL) OR (pickleball_level = ANY (ARRAY['beginner'::text, 'intermediate'::text, 'advanced'::text, 'elite'::text])))) not valid;

alter table "public"."beta_signup" validate constraint "beta_signup_pickleball_level_check";

alter table "public"."beta_signup" add constraint "beta_signup_pickleball_level_required_check" CHECK (((plays_pickleball = false) OR (pickleball_level IS NOT NULL))) not valid;

alter table "public"."beta_signup" validate constraint "beta_signup_pickleball_level_required_check";

alter table "public"."beta_signup" add constraint "beta_signup_tennis_level_check" CHECK (((tennis_level IS NULL) OR (tennis_level = ANY (ARRAY['beginner'::text, 'intermediate'::text, 'advanced'::text, 'elite'::text])))) not valid;

alter table "public"."beta_signup" validate constraint "beta_signup_tennis_level_check";

alter table "public"."beta_signup" add constraint "beta_signup_tennis_level_required_check" CHECK (((plays_tennis = false) OR (tennis_level IS NOT NULL))) not valid;

alter table "public"."beta_signup" validate constraint "beta_signup_tennis_level_required_check";

alter table "public"."booking" add constraint "booking_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES public.profile(id) ON DELETE SET NULL not valid;

alter table "public"."booking" validate constraint "booking_approved_by_fkey";

alter table "public"."booking" add constraint "booking_cancelled_by_fkey" FOREIGN KEY (cancelled_by) REFERENCES public.profile(id) ON DELETE SET NULL not valid;

alter table "public"."booking" validate constraint "booking_cancelled_by_fkey";

alter table "public"."booking" add constraint "booking_court_id_fkey" FOREIGN KEY (court_id) REFERENCES public.court(id) ON DELETE SET NULL not valid;

alter table "public"."booking" validate constraint "booking_court_id_fkey";

alter table "public"."booking" add constraint "booking_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE SET NULL not valid;

alter table "public"."booking" validate constraint "booking_organization_id_fkey";

alter table "public"."booking" add constraint "no_overlapping_bookings" EXCLUDE USING gist (court_id WITH =, tsrange((booking_date + start_time), (booking_date + end_time)) WITH &&) WHERE (((status <> 'cancelled'::public.booking_status) AND (court_id IS NOT NULL)));

alter table "public"."cancellation_policy" add constraint "cancellation_policy_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE not valid;

alter table "public"."cancellation_policy" validate constraint "cancellation_policy_organization_id_fkey";

alter table "public"."cancellation_policy" add constraint "cancellation_policy_organization_id_key" UNIQUE using index "cancellation_policy_organization_id_key";

alter table "public"."cancellation_policy" add constraint "chk_cancellation_hours" CHECK (((free_cancellation_hours >= partial_refund_hours) AND (partial_refund_hours >= no_refund_hours))) not valid;

alter table "public"."cancellation_policy" validate constraint "chk_cancellation_hours";

alter table "public"."cancellation_policy" add constraint "chk_refund_percent" CHECK (((partial_refund_percent >= 0) AND (partial_refund_percent <= 100))) not valid;

alter table "public"."cancellation_policy" validate constraint "chk_refund_percent";

alter table "public"."court_one_time_availability" add constraint "chk_one_time_slot_duration" CHECK ((slot_duration_minutes > 0)) not valid;

alter table "public"."court_one_time_availability" validate constraint "chk_one_time_slot_duration";

alter table "public"."court_one_time_availability" add constraint "chk_one_time_time_range" CHECK ((end_time > start_time)) not valid;

alter table "public"."court_one_time_availability" validate constraint "chk_one_time_time_range";

alter table "public"."court_one_time_availability" add constraint "court_one_time_availability_court_id_fkey" FOREIGN KEY (court_id) REFERENCES public.court(id) ON DELETE CASCADE not valid;

alter table "public"."court_one_time_availability" validate constraint "court_one_time_availability_court_id_fkey";

alter table "public"."court_one_time_availability" add constraint "court_one_time_availability_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profile(id) ON DELETE SET NULL not valid;

alter table "public"."court_one_time_availability" validate constraint "court_one_time_availability_created_by_fkey";

alter table "public"."court_one_time_availability" add constraint "court_one_time_availability_facility_id_fkey" FOREIGN KEY (facility_id) REFERENCES public.facility(id) ON DELETE CASCADE not valid;

alter table "public"."court_one_time_availability" validate constraint "court_one_time_availability_facility_id_fkey";

alter table "public"."court_slot" add constraint "chk_template_scope" CHECK (((facility_id IS NOT NULL) OR (court_id IS NOT NULL))) not valid;

alter table "public"."court_slot" validate constraint "chk_template_scope";

alter table "public"."court_slot" add constraint "court_slot_facility_id_fkey" FOREIGN KEY (facility_id) REFERENCES public.facility(id) ON DELETE CASCADE not valid;

alter table "public"."court_slot" validate constraint "court_slot_facility_id_fkey";

alter table "public"."instructor_profile" add constraint "instructor_profile_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE not valid;

alter table "public"."instructor_profile" validate constraint "instructor_profile_organization_id_fkey";

alter table "public"."instructor_profile" add constraint "instructor_profile_organization_member_id_fkey" FOREIGN KEY (organization_member_id) REFERENCES public.organization_member(id) ON DELETE SET NULL not valid;

alter table "public"."instructor_profile" validate constraint "instructor_profile_organization_member_id_fkey";

alter table "public"."match_feedback" add constraint "match_feedback_match_id_fkey" FOREIGN KEY (match_id) REFERENCES public.match(id) ON DELETE CASCADE not valid;

alter table "public"."match_feedback" validate constraint "match_feedback_match_id_fkey";

alter table "public"."match_feedback" add constraint "match_feedback_opponent_id_fkey" FOREIGN KEY (opponent_id) REFERENCES public.player(id) ON DELETE CASCADE not valid;

alter table "public"."match_feedback" validate constraint "match_feedback_opponent_id_fkey";

alter table "public"."match_feedback" add constraint "match_feedback_reviewer_id_fkey" FOREIGN KEY (reviewer_id) REFERENCES public.player(id) ON DELETE CASCADE not valid;

alter table "public"."match_feedback" validate constraint "match_feedback_reviewer_id_fkey";

alter table "public"."match_feedback" add constraint "match_feedback_star_rating_check" CHECK (((star_rating >= 1) AND (star_rating <= 5))) not valid;

alter table "public"."match_feedback" validate constraint "match_feedback_star_rating_check";

alter table "public"."match_feedback" add constraint "match_feedback_unique" UNIQUE using index "match_feedback_unique";

alter table "public"."match_participant" add constraint "check_star_rating" CHECK (((star_rating IS NULL) OR ((star_rating >= 1) AND (star_rating <= 5)))) not valid;

alter table "public"."match_participant" validate constraint "check_star_rating";

alter table "public"."match_report" add constraint "match_report_match_id_fkey" FOREIGN KEY (match_id) REFERENCES public.match(id) ON DELETE CASCADE not valid;

alter table "public"."match_report" validate constraint "match_report_match_id_fkey";

alter table "public"."match_report" add constraint "match_report_reported_id_fkey" FOREIGN KEY (reported_id) REFERENCES public.player(id) ON DELETE CASCADE not valid;

alter table "public"."match_report" validate constraint "match_report_reported_id_fkey";

alter table "public"."match_report" add constraint "match_report_reporter_id_fkey" FOREIGN KEY (reporter_id) REFERENCES public.player(id) ON DELETE CASCADE not valid;

alter table "public"."match_report" validate constraint "match_report_reporter_id_fkey";

alter table "public"."match_report" add constraint "match_report_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES public.profile(id) not valid;

alter table "public"."match_report" validate constraint "match_report_reviewed_by_fkey";

alter table "public"."match_report" add constraint "match_report_unique" UNIQUE using index "match_report_unique";

alter table "public"."network" add constraint "network_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES public.conversation(id) ON DELETE SET NULL not valid;

alter table "public"."network" validate constraint "network_conversation_id_fkey";

alter table "public"."network_member" add constraint "network_member_added_by_fkey" FOREIGN KEY (added_by) REFERENCES public.player(id) ON DELETE SET NULL not valid;

alter table "public"."network_member" validate constraint "network_member_added_by_fkey";

alter table "public"."notification" add constraint "notification_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE not valid;

alter table "public"."notification" validate constraint "notification_organization_id_fkey";

alter table "public"."organization_notification_preference" add constraint "organization_notification_preference_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE not valid;

alter table "public"."organization_notification_preference" validate constraint "organization_notification_preference_organization_id_fkey";

alter table "public"."organization_notification_preference" add constraint "uq_org_notification_preference" UNIQUE using index "uq_org_notification_preference";

alter table "public"."organization_notification_recipient" add constraint "organization_notification_recipient_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE not valid;

alter table "public"."organization_notification_recipient" validate constraint "organization_notification_recipient_organization_id_fkey";

alter table "public"."organization_notification_recipient" add constraint "organization_notification_recipient_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profile(id) ON DELETE CASCADE not valid;

alter table "public"."organization_notification_recipient" validate constraint "organization_notification_recipient_user_id_fkey";

alter table "public"."organization_notification_recipient" add constraint "uq_org_notification_recipient" UNIQUE using index "uq_org_notification_recipient";

alter table "public"."organization_player_block" add constraint "organization_player_block_blocked_by_fkey" FOREIGN KEY (blocked_by) REFERENCES public.profile(id) ON DELETE SET NULL not valid;

alter table "public"."organization_player_block" validate constraint "organization_player_block_blocked_by_fkey";

alter table "public"."organization_player_block" add constraint "organization_player_block_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE not valid;

alter table "public"."organization_player_block" validate constraint "organization_player_block_organization_id_fkey";

alter table "public"."organization_player_block" add constraint "organization_player_block_organization_id_player_id_key" UNIQUE using index "organization_player_block_organization_id_player_id_key";

alter table "public"."organization_player_block" add constraint "organization_player_block_player_id_fkey" FOREIGN KEY (player_id) REFERENCES public.player(id) ON DELETE CASCADE not valid;

alter table "public"."organization_player_block" validate constraint "organization_player_block_player_id_fkey";

alter table "public"."organization_settings" add constraint "chk_advance_booking" CHECK ((max_advance_booking_days > 0)) not valid;

alter table "public"."organization_settings" validate constraint "chk_advance_booking";

alter table "public"."organization_settings" add constraint "chk_booking_notice" CHECK ((min_booking_notice_hours >= 0)) not valid;

alter table "public"."organization_settings" validate constraint "chk_booking_notice";

alter table "public"."organization_settings" add constraint "chk_slot_duration" CHECK ((slot_duration_minutes > 0)) not valid;

alter table "public"."organization_settings" validate constraint "chk_slot_duration";

alter table "public"."organization_settings" add constraint "organization_settings_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE not valid;

alter table "public"."organization_settings" validate constraint "organization_settings_organization_id_fkey";

alter table "public"."organization_settings" add constraint "organization_settings_organization_id_key" UNIQUE using index "organization_settings_organization_id_key";

alter table "public"."organization_stripe_account" add constraint "organization_stripe_account_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE not valid;

alter table "public"."organization_stripe_account" validate constraint "organization_stripe_account_organization_id_fkey";

alter table "public"."organization_stripe_account" add constraint "organization_stripe_account_organization_id_key" UNIQUE using index "organization_stripe_account_organization_id_key";

alter table "public"."player_reputation" add constraint "player_reputation_player_id_fkey" FOREIGN KEY (player_id) REFERENCES public.player(id) ON DELETE CASCADE not valid;

alter table "public"."player_reputation" validate constraint "player_reputation_player_id_fkey";

alter table "public"."pricing_rule" add constraint "chk_days_of_week" CHECK (((days_of_week IS NOT NULL) AND (array_length(days_of_week, 1) > 0) AND (days_of_week <@ ARRAY[0, 1, 2, 3, 4, 5, 6]))) not valid;

alter table "public"."pricing_rule" validate constraint "chk_days_of_week";

alter table "public"."pricing_rule" add constraint "chk_pricing_time_range" CHECK ((end_time > start_time)) not valid;

alter table "public"."pricing_rule" validate constraint "chk_pricing_time_range";

alter table "public"."pricing_rule" add constraint "pricing_rule_court_id_fkey" FOREIGN KEY (court_id) REFERENCES public.court(id) ON DELETE CASCADE not valid;

alter table "public"."pricing_rule" validate constraint "pricing_rule_court_id_fkey";

alter table "public"."pricing_rule" add constraint "pricing_rule_facility_id_fkey" FOREIGN KEY (facility_id) REFERENCES public.facility(id) ON DELETE CASCADE not valid;

alter table "public"."pricing_rule" validate constraint "pricing_rule_facility_id_fkey";

alter table "public"."pricing_rule" add constraint "pricing_rule_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE not valid;

alter table "public"."pricing_rule" validate constraint "pricing_rule_organization_id_fkey";

alter table "public"."program" add constraint "program_facility_id_fkey" FOREIGN KEY (facility_id) REFERENCES public.facility(id) ON DELETE SET NULL not valid;

alter table "public"."program" validate constraint "program_facility_id_fkey";

alter table "public"."program" add constraint "program_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE not valid;

alter table "public"."program" validate constraint "program_organization_id_fkey";

alter table "public"."program" add constraint "program_sport_id_fkey" FOREIGN KEY (sport_id) REFERENCES public.sport(id) ON DELETE SET NULL not valid;

alter table "public"."program" validate constraint "program_sport_id_fkey";

alter table "public"."program_instructor" add constraint "program_instructor_instructor_id_fkey" FOREIGN KEY (instructor_id) REFERENCES public.instructor_profile(id) ON DELETE CASCADE not valid;

alter table "public"."program_instructor" validate constraint "program_instructor_instructor_id_fkey";

alter table "public"."program_instructor" add constraint "program_instructor_program_id_fkey" FOREIGN KEY (program_id) REFERENCES public.program(id) ON DELETE CASCADE not valid;

alter table "public"."program_instructor" validate constraint "program_instructor_program_id_fkey";

alter table "public"."program_instructor" add constraint "uq_program_instructor" UNIQUE using index "uq_program_instructor";

alter table "public"."program_registration" add constraint "program_registration_player_id_fkey" FOREIGN KEY (player_id) REFERENCES public.player(id) ON DELETE CASCADE not valid;

alter table "public"."program_registration" validate constraint "program_registration_player_id_fkey";

alter table "public"."program_registration" add constraint "program_registration_program_id_fkey" FOREIGN KEY (program_id) REFERENCES public.program(id) ON DELETE CASCADE not valid;

alter table "public"."program_registration" validate constraint "program_registration_program_id_fkey";

alter table "public"."program_registration" add constraint "program_registration_registered_by_fkey" FOREIGN KEY (registered_by) REFERENCES public.profile(id) ON DELETE CASCADE not valid;

alter table "public"."program_registration" validate constraint "program_registration_registered_by_fkey";

alter table "public"."program_registration" add constraint "uq_program_player" UNIQUE using index "uq_program_player";

alter table "public"."program_session" add constraint "program_session_program_id_fkey" FOREIGN KEY (program_id) REFERENCES public.program(id) ON DELETE CASCADE not valid;

alter table "public"."program_session" validate constraint "program_session_program_id_fkey";

alter table "public"."program_session" add constraint "valid_session_times" CHECK ((end_time > start_time)) not valid;

alter table "public"."program_session" validate constraint "valid_session_times";

alter table "public"."program_session_court" add constraint "program_session_court_booking_id_fkey" FOREIGN KEY (booking_id) REFERENCES public.booking(id) ON DELETE SET NULL not valid;

alter table "public"."program_session_court" validate constraint "program_session_court_booking_id_fkey";

alter table "public"."program_session_court" add constraint "program_session_court_court_id_fkey" FOREIGN KEY (court_id) REFERENCES public.court(id) ON DELETE CASCADE not valid;

alter table "public"."program_session_court" validate constraint "program_session_court_court_id_fkey";

alter table "public"."program_session_court" add constraint "program_session_court_session_id_fkey" FOREIGN KEY (session_id) REFERENCES public.program_session(id) ON DELETE CASCADE not valid;

alter table "public"."program_session_court" validate constraint "program_session_court_session_id_fkey";

alter table "public"."program_session_court" add constraint "uq_session_court" UNIQUE using index "uq_session_court";

alter table "public"."program_waitlist" add constraint "program_waitlist_added_by_fkey" FOREIGN KEY (added_by) REFERENCES public.profile(id) ON DELETE CASCADE not valid;

alter table "public"."program_waitlist" validate constraint "program_waitlist_added_by_fkey";

alter table "public"."program_waitlist" add constraint "program_waitlist_player_id_fkey" FOREIGN KEY (player_id) REFERENCES public.player(id) ON DELETE CASCADE not valid;

alter table "public"."program_waitlist" validate constraint "program_waitlist_player_id_fkey";

alter table "public"."program_waitlist" add constraint "program_waitlist_program_id_fkey" FOREIGN KEY (program_id) REFERENCES public.program(id) ON DELETE CASCADE not valid;

alter table "public"."program_waitlist" validate constraint "program_waitlist_program_id_fkey";

alter table "public"."program_waitlist" add constraint "program_waitlist_registration_id_fkey" FOREIGN KEY (registration_id) REFERENCES public.program_registration(id) ON DELETE SET NULL not valid;

alter table "public"."program_waitlist" validate constraint "program_waitlist_registration_id_fkey";

alter table "public"."program_waitlist" add constraint "uq_waitlist_program_player" UNIQUE using index "uq_waitlist_program_player";

alter table "public"."registration_payment" add constraint "registration_payment_registration_id_fkey" FOREIGN KEY (registration_id) REFERENCES public.program_registration(id) ON DELETE CASCADE not valid;

alter table "public"."registration_payment" validate constraint "registration_payment_registration_id_fkey";

alter table "public"."reputation_config" add constraint "reputation_config_event_type_key" UNIQUE using index "reputation_config_event_type_key";

alter table "public"."reputation_event" add constraint "reputation_event_caused_by_player_id_fkey" FOREIGN KEY (caused_by_player_id) REFERENCES public.player(id) ON DELETE SET NULL not valid;

alter table "public"."reputation_event" validate constraint "reputation_event_caused_by_player_id_fkey";

alter table "public"."reputation_event" add constraint "reputation_event_match_id_fkey" FOREIGN KEY (match_id) REFERENCES public.match(id) ON DELETE SET NULL not valid;

alter table "public"."reputation_event" validate constraint "reputation_event_match_id_fkey";

alter table "public"."reputation_event" add constraint "reputation_event_player_id_fkey" FOREIGN KEY (player_id) REFERENCES public.player(id) ON DELETE CASCADE not valid;

alter table "public"."reputation_event" validate constraint "reputation_event_player_id_fkey";

alter table "public"."session_attendance" add constraint "session_attendance_marked_by_fkey" FOREIGN KEY (marked_by) REFERENCES public.profile(id) ON DELETE SET NULL not valid;

alter table "public"."session_attendance" validate constraint "session_attendance_marked_by_fkey";

alter table "public"."session_attendance" add constraint "session_attendance_registration_id_fkey" FOREIGN KEY (registration_id) REFERENCES public.program_registration(id) ON DELETE CASCADE not valid;

alter table "public"."session_attendance" validate constraint "session_attendance_registration_id_fkey";

alter table "public"."session_attendance" add constraint "session_attendance_session_id_fkey" FOREIGN KEY (session_id) REFERENCES public.program_session(id) ON DELETE CASCADE not valid;

alter table "public"."session_attendance" validate constraint "session_attendance_session_id_fkey";

alter table "public"."session_attendance" add constraint "uq_session_attendance" UNIQUE using index "uq_session_attendance";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.add_network_member_to_conversation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_conversation_id UUID;
BEGIN
  -- Only act on active members
  IF NEW.status = 'active' THEN
    -- Get the network's conversation_id
    SELECT conversation_id INTO v_conversation_id
    FROM public.network
    WHERE id = NEW.network_id;
    
    -- If network has a conversation, add the member as a participant
    IF v_conversation_id IS NOT NULL THEN
      INSERT INTO public.conversation_participant (conversation_id, player_id)
      VALUES (v_conversation_id, NEW.player_id)
      ON CONFLICT (conversation_id, player_id) DO NOTHING;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.assign_waitlist_position()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.position IS NULL OR NEW.position = 0 THEN
    SELECT COALESCE(MAX(position), 0) + 1 INTO NEW.position
    FROM program_waitlist
    WHERE program_id = NEW.program_id;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_reputation_tier(score numeric, total_events integer, min_events integer DEFAULT 10)
 RETURNS public.reputation_tier
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
BEGIN
    -- Not enough events = unknown tier
    IF total_events < min_events THEN
        RETURN 'unknown';
    END IF;

    -- Tier based on score
    IF score >= 90 THEN
        RETURN 'platinum';
    ELSIF score >= 75 THEN
        RETURN 'gold';
    ELSIF score >= 60 THEN
        RETURN 'silver';
    ELSE
        RETURN 'bronze';
    END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_host_participant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- Automatically create a match_participant record for the match creator
  INSERT INTO match_participant (match_id, player_id, is_host, status)
  VALUES (NEW.id, NEW.created_by, TRUE, 'joined');
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_available_slots(p_court_id uuid, p_date date)
 RETURNS TABLE(start_time time without time zone, end_time time without time zone, price_cents integer, template_source text)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
    v_day_of_week TEXT;
    v_facility_id UUID;
    v_court_status TEXT;
BEGIN
    v_day_of_week := lower(trim(to_char(p_date, 'Day')));
    SELECT c.facility_id, c.availability_status INTO v_facility_id, v_court_status 
    FROM court c WHERE c.id = p_court_id;
    
    -- If court is not available (maintenance, closed, etc.), return no slots
    IF v_court_status IS NOT NULL AND v_court_status != 'available' THEN
        RETURN;
    END IF;
    
    RETURN QUERY
    WITH 
    -- Check if there are any one-time availability entries for this date
    has_one_time AS (
        SELECT EXISTS (
            SELECT 1 FROM court_one_time_availability ota
            WHERE ota.availability_date = p_date
                AND (ota.court_id = p_court_id OR (ota.court_id IS NULL AND ota.facility_id = v_facility_id))
                AND ota.is_available = TRUE
        ) AS has_entries
    ),
    -- Get one-time availability slots for this specific date
    one_time_templates AS (
        SELECT 
            ota.start_time AS template_start,
            ota.end_time AS template_end,
            ota.price_cents,
            ota.slot_duration_minutes,
            'one_time' AS template_source,
            CASE WHEN ota.court_id IS NOT NULL THEN 1 ELSE 0 END AS priority
        FROM court_one_time_availability ota
        WHERE ota.availability_date = p_date
            AND (ota.court_id = p_court_id OR (ota.court_id IS NULL AND ota.facility_id = v_facility_id))
            AND ota.is_available = TRUE
    ),
    -- Get effective recurring templates (court-specific overrides facility-wide)
    recurring_templates AS (
        SELECT 
            et.start_time AS template_start,
            et.end_time AS template_end,
            et.price_cents,
            et.slot_duration_minutes,
            et.template_source,
            0 AS priority
        FROM get_effective_templates(p_court_id, p_date) et
    ),
    -- Combine templates: use one-time if available, otherwise use recurring
    -- If there are any one-time entries for this date, use ONLY one-time slots
    -- This allows clubs to completely override the recurring schedule for a specific date
    combined_templates AS (
        SELECT * FROM one_time_templates
        WHERE (SELECT has_entries FROM has_one_time)
        UNION ALL
        SELECT * FROM recurring_templates
        WHERE NOT (SELECT has_entries FROM has_one_time)
    ),
    -- Generate individual slots from templates using slot_duration_minutes
    generated_slots AS (
        SELECT 
            (ct.template_start + (gs.slot_num * (ct.slot_duration_minutes || ' minutes')::INTERVAL))::TIME AS slot_start,
            (ct.template_start + ((gs.slot_num + 1) * (ct.slot_duration_minutes || ' minutes')::INTERVAL))::TIME AS slot_end,
            ct.price_cents,
            ct.template_source
        FROM combined_templates ct
        CROSS JOIN LATERAL generate_series(
            0, 
            GREATEST(0, (EXTRACT(EPOCH FROM (ct.template_end - ct.template_start)) / 60 / ct.slot_duration_minutes)::INTEGER - 1)
        ) AS gs(slot_num)
        WHERE (ct.template_start + ((gs.slot_num + 1) * (ct.slot_duration_minutes || ' minutes')::INTERVAL))::TIME <= ct.template_end
    ),
    -- Get existing bookings for this court and date
    booked_times AS (
        SELECT b.start_time, b.end_time
        FROM booking b
        WHERE b.court_id = p_court_id
            AND b.booking_date = p_date
            AND b.status NOT IN ('cancelled')
    ),
    -- Get blocks for this court/facility and date (from availability_block table)
    blocked_times AS (
        SELECT ab.start_time, ab.end_time
        FROM availability_block ab
        WHERE ab.block_date = p_date
            AND (ab.court_id = p_court_id OR (ab.court_id IS NULL AND ab.facility_id = v_facility_id))
    ),
    -- Also get one-time unavailability entries (is_available = FALSE)
    one_time_blocked AS (
        SELECT ota.start_time, ota.end_time
        FROM court_one_time_availability ota
        WHERE ota.availability_date = p_date
            AND (ota.court_id = p_court_id OR (ota.court_id IS NULL AND ota.facility_id = v_facility_id))
            AND ota.is_available = FALSE
    )
    -- Return slots that are not booked or blocked
    SELECT 
        gs.slot_start AS start_time,
        gs.slot_end AS end_time,
        -- Apply pricing rules if any match this slot
        COALESCE(
            (SELECT pr.price_cents 
             FROM pricing_rule pr 
             WHERE (pr.court_id = p_court_id OR (pr.facility_id = v_facility_id AND pr.court_id IS NULL))
                 AND p_date >= COALESCE(pr.valid_from, '1900-01-01'::DATE)
                 AND p_date <= COALESCE(pr.valid_until, '2100-01-01'::DATE)
                 AND EXTRACT(DOW FROM p_date)::INTEGER = ANY(pr.days_of_week)
                 AND gs.slot_start >= pr.start_time
                 AND gs.slot_start < pr.end_time
                 AND pr.is_active = TRUE
             ORDER BY CASE WHEN pr.court_id IS NOT NULL THEN 1 ELSE 0 END DESC, pr.priority DESC
             LIMIT 1),
            gs.price_cents
        ) AS price_cents,
        gs.template_source
    FROM generated_slots gs
    -- Exclude booked slots
    WHERE NOT EXISTS (
        SELECT 1 FROM booked_times bt
        WHERE (gs.slot_start, gs.slot_end) OVERLAPS (bt.start_time, bt.end_time)
    )
    -- Exclude blocked slots (from availability_block)
    AND NOT EXISTS (
        SELECT 1 FROM blocked_times bl
        WHERE bl.start_time IS NULL  -- entire day block
           OR (gs.slot_start, gs.slot_end) OVERLAPS (bl.start_time, bl.end_time)
    )
    -- Exclude one-time blocked slots
    AND NOT EXISTS (
        SELECT 1 FROM one_time_blocked otb
        WHERE (gs.slot_start, gs.slot_end) OVERLAPS (otb.start_time, otb.end_time)
    )
    ORDER BY gs.slot_start;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_available_slots_batch(p_court_ids uuid[], p_date_from date, p_date_to date)
 RETURNS TABLE(out_court_id uuid, out_slot_date date, out_start_time time without time zone, out_end_time time without time zone, out_price_cents integer, out_template_source text)
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
    RETURN QUERY
    WITH 
    -- Generate all dates in the range
    date_range AS (
        SELECT generate_series(p_date_from, p_date_to, '1 day'::INTERVAL)::DATE AS the_date
    ),
    -- Get all courts with their facility info and status
    courts_info AS (
        SELECT 
            c.id AS court_id,
            c.facility_id,
            c.availability_status
        FROM court c
        WHERE c.id = ANY(p_court_ids)
            -- Filter out unavailable courts
            AND (c.availability_status IS NULL OR c.availability_status = 'available')
    ),
    -- Cross join courts with dates to get all (court, date) combinations
    court_dates AS (
        SELECT 
            ci.court_id,
            ci.facility_id,
            dr.the_date,
            lower(trim(to_char(dr.the_date, 'Day'))) AS day_of_week
        FROM courts_info ci
        CROSS JOIN date_range dr
    ),
    -- Check which (court, date) pairs have one-time availability entries
    one_time_check AS (
        SELECT DISTINCT
            cd.court_id,
            cd.the_date,
            TRUE AS has_one_time
        FROM court_dates cd
        WHERE EXISTS (
            SELECT 1 FROM court_one_time_availability ota
            WHERE ota.availability_date = cd.the_date
                AND (ota.court_id = cd.court_id OR (ota.court_id IS NULL AND ota.facility_id = cd.facility_id))
                AND ota.is_available = TRUE
        )
    ),
    -- Get one-time availability templates
    one_time_templates AS (
        SELECT 
            cd.court_id,
            cd.the_date,
            cd.facility_id,
            ota.start_time AS template_start,
            ota.end_time AS template_end,
            ota.price_cents,
            ota.slot_duration_minutes,
            'one_time' AS template_source
        FROM court_dates cd
        JOIN court_one_time_availability ota ON (
            ota.availability_date = cd.the_date
            AND (ota.court_id = cd.court_id OR (ota.court_id IS NULL AND ota.facility_id = cd.facility_id))
            AND ota.is_available = TRUE
        )
        -- Only include if this court/date has one-time entries
        WHERE EXISTS (
            SELECT 1 FROM one_time_check otc
            WHERE otc.court_id = cd.court_id AND otc.the_date = cd.the_date
        )
    ),
    -- Get recurring templates for court/dates that DON'T have one-time entries
    recurring_templates AS (
        SELECT 
            cd.court_id,
            cd.the_date,
            cd.facility_id,
            cs.start_time AS template_start,
            cs.end_time AS template_end,
            COALESCE(cs.price_cents, (cs.price * 100)::INTEGER) AS price_cents,
            COALESCE(cs.slot_duration_minutes, 60) AS slot_duration_minutes,
            CASE WHEN cs.court_id IS NOT NULL THEN 'court' ELSE 'facility' END AS template_source,
            -- Priority for deduplication: court-specific > facility-wide
            CASE WHEN cs.court_id IS NOT NULL THEN 1 ELSE 0 END AS priority
        FROM court_dates cd
        JOIN court_slot cs ON (
            (cs.court_id = cd.court_id OR (cs.facility_id = cd.facility_id AND cs.court_id IS NULL))
            AND cs.day_of_week::TEXT = cd.day_of_week
            AND cs.is_available = TRUE
            AND (cs.valid_from IS NULL OR cs.valid_from <= cd.the_date)
            AND (cs.valid_until IS NULL OR cs.valid_until >= cd.the_date)
        )
        -- Only include if this court/date does NOT have one-time entries
        WHERE NOT EXISTS (
            SELECT 1 FROM one_time_check otc
            WHERE otc.court_id = cd.court_id AND otc.the_date = cd.the_date
        )
    ),
    -- Deduplicate recurring templates (court-specific overrides facility-wide)
    recurring_deduped AS (
        SELECT DISTINCT ON (court_id, the_date, template_start)
            court_id,
            the_date,
            facility_id,
            template_start,
            template_end,
            price_cents,
            slot_duration_minutes,
            template_source
        FROM recurring_templates
        ORDER BY court_id, the_date, template_start, priority DESC
    ),
    -- Combine one-time and recurring templates
    all_templates AS (
        SELECT court_id, the_date, facility_id, template_start, template_end, 
               price_cents, slot_duration_minutes, template_source
        FROM one_time_templates
        UNION ALL
        SELECT court_id, the_date, facility_id, template_start, template_end, 
               price_cents, slot_duration_minutes, template_source
        FROM recurring_deduped
    ),
    -- Generate individual slots from templates
    generated_slots AS (
        SELECT 
            t.court_id,
            t.the_date,
            t.facility_id,
            (t.template_start + (gs.slot_num * (t.slot_duration_minutes || ' minutes')::INTERVAL))::TIME AS slot_start,
            (t.template_start + ((gs.slot_num + 1) * (t.slot_duration_minutes || ' minutes')::INTERVAL))::TIME AS slot_end,
            t.price_cents,
            t.template_source
        FROM all_templates t
        CROSS JOIN LATERAL generate_series(
            0, 
            GREATEST(0, (EXTRACT(EPOCH FROM (t.template_end - t.template_start)) / 60 / t.slot_duration_minutes)::INTEGER - 1)
        ) AS gs(slot_num)
        WHERE (t.template_start + ((gs.slot_num + 1) * (t.slot_duration_minutes || ' minutes')::INTERVAL))::TIME <= t.template_end
    ),
    -- Get all bookings for these courts in the date range
    booked_times AS (
        SELECT b.court_id, b.booking_date, b.start_time, b.end_time
        FROM booking b
        WHERE b.court_id = ANY(p_court_ids)
            AND b.booking_date >= p_date_from
            AND b.booking_date <= p_date_to
            AND b.status NOT IN ('cancelled')
    ),
    -- Get all blocks for these courts/facilities in the date range
    blocked_times AS (
        SELECT 
            COALESCE(ab.court_id, cd.court_id) AS court_id,
            ab.block_date,
            ab.start_time,
            ab.end_time
        FROM availability_block ab
        JOIN court_dates cd ON (
            ab.block_date = cd.the_date
            AND (ab.court_id = cd.court_id OR (ab.court_id IS NULL AND ab.facility_id = cd.facility_id))
        )
        WHERE ab.block_date >= p_date_from AND ab.block_date <= p_date_to
    ),
    -- Get one-time blocked entries
    one_time_blocked AS (
        SELECT 
            COALESCE(ota.court_id, cd.court_id) AS court_id,
            ota.availability_date AS block_date,
            ota.start_time,
            ota.end_time
        FROM court_one_time_availability ota
        JOIN court_dates cd ON (
            ota.availability_date = cd.the_date
            AND (ota.court_id = cd.court_id OR (ota.court_id IS NULL AND ota.facility_id = cd.facility_id))
        )
        WHERE ota.is_available = FALSE
            AND ota.availability_date >= p_date_from 
            AND ota.availability_date <= p_date_to
    )
    -- Return available slots (excluding booked and blocked)
    SELECT 
        gs.court_id AS out_court_id,
        gs.the_date AS out_slot_date,
        gs.slot_start AS out_start_time,
        gs.slot_end AS out_end_time,
        -- Apply pricing rules if any match this slot
        COALESCE(
            (SELECT pr.price_cents 
             FROM pricing_rule pr 
             WHERE (pr.court_id = gs.court_id OR (pr.facility_id = gs.facility_id AND pr.court_id IS NULL))
                 AND gs.the_date >= COALESCE(pr.valid_from, '1900-01-01'::DATE)
                 AND gs.the_date <= COALESCE(pr.valid_until, '2100-01-01'::DATE)
                 AND EXTRACT(DOW FROM gs.the_date)::INTEGER = ANY(pr.days_of_week)
                 AND gs.slot_start >= pr.start_time
                 AND gs.slot_start < pr.end_time
                 AND pr.is_active = TRUE
             ORDER BY CASE WHEN pr.court_id IS NOT NULL THEN 1 ELSE 0 END DESC, pr.priority DESC
             LIMIT 1),
            gs.price_cents
        ) AS out_price_cents,
        gs.template_source AS out_template_source
    FROM generated_slots gs
    -- Exclude booked slots
    WHERE NOT EXISTS (
        SELECT 1 FROM booked_times bt
        WHERE bt.court_id = gs.court_id 
            AND bt.booking_date = gs.the_date
            AND (gs.slot_start, gs.slot_end) OVERLAPS (bt.start_time, bt.end_time)
    )
    -- Exclude blocked slots (from availability_block)
    AND NOT EXISTS (
        SELECT 1 FROM blocked_times bl
        WHERE bl.court_id = gs.court_id
            AND bl.block_date = gs.the_date
            AND (bl.start_time IS NULL OR (gs.slot_start, gs.slot_end) OVERLAPS (bl.start_time, bl.end_time))
    )
    -- Exclude one-time blocked slots
    AND NOT EXISTS (
        SELECT 1 FROM one_time_blocked otb
        WHERE otb.court_id = gs.court_id
            AND otb.block_date = gs.the_date
            AND (gs.slot_start, gs.slot_end) OVERLAPS (otb.start_time, otb.end_time)
    )
    ORDER BY gs.court_id, gs.the_date, gs.slot_start;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_effective_templates(p_court_id uuid, p_date date)
 RETURNS TABLE(start_time time without time zone, end_time time without time zone, price_cents integer, slot_duration_minutes integer, template_source text)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
    v_facility_id UUID;
    v_day_of_week TEXT;
BEGIN
    -- Get the facility ID for this court
    SELECT c.facility_id INTO v_facility_id FROM court c WHERE c.id = p_court_id;
    
    -- Get day of week (lowercase, trimmed to match enum)
    v_day_of_week := lower(trim(to_char(p_date, 'Day')));
    
    RETURN QUERY
    WITH ranked_templates AS (
        SELECT 
            cs.start_time,
            cs.end_time,
            COALESCE(cs.price_cents, (cs.price * 100)::INTEGER) AS price_cents,
            COALESCE(cs.slot_duration_minutes, 60) AS slot_duration_minutes,
            CASE WHEN cs.court_id IS NOT NULL THEN 'court' ELSE 'facility' END AS template_source,
            CASE WHEN cs.court_id IS NOT NULL THEN 1 ELSE 0 END AS priority
        FROM court_slot cs
        WHERE (cs.court_id = p_court_id OR (cs.facility_id = v_facility_id AND cs.court_id IS NULL))
            AND cs.day_of_week::TEXT = v_day_of_week
            AND cs.is_available = TRUE
            AND (cs.valid_from IS NULL OR cs.valid_from <= p_date)
            AND (cs.valid_until IS NULL OR cs.valid_until >= p_date)
    )
    -- Court-specific templates override facility templates for same time slot
    SELECT DISTINCT ON (rt.start_time)
        rt.start_time,
        rt.end_time,
        rt.price_cents,
        rt.slot_duration_minutes,
        rt.template_source
    FROM ranked_templates rt
    ORDER BY rt.start_time, rt.priority DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_matches_ready_for_closure(cutoff_hours integer DEFAULT 48, batch_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, format public.match_format_enum)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  current_time_utc TIMESTAMPTZ := NOW();
BEGIN
  RETURN QUERY
  SELECT m.id, m.format
  FROM match m
  WHERE m.closed_at IS NULL
    AND m.cancelled_at IS NULL  -- Exclude cancelled matches
    AND (
      CASE
        WHEN m.timezone IS NOT NULL THEN
          -- Handle midnight-spanning matches (end_time < start_time)
          CASE
            WHEN m.end_time < m.start_time THEN
              -- Match spans midnight: end time is on next day
              timezone(m.timezone, ((m.match_date + INTERVAL '1 day') + m.end_time)::timestamp)
            ELSE
              -- Normal case: end time is on same day
              timezone(m.timezone, (m.match_date + m.end_time)::timestamp)
          END
        ELSE
          -- Fallback: if no timezone, assume UTC
          (m.match_date + m.end_time)::timestamptz
      END
    ) < (current_time_utc - (cutoff_hours || ' hours')::INTERVAL)
  ORDER BY m.match_date, m.end_time
  LIMIT batch_limit;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_opponents_for_notification(p_match_id uuid, p_player_id uuid)
 RETURNS TABLE(player_id uuid, first_name text, display_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    mp.player_id,
    pr.first_name::TEXT,
    pr.display_name::TEXT
  FROM match_participant mp
  INNER JOIN player p ON p.id = mp.player_id
  INNER JOIN profile pr ON pr.id = p.id
  WHERE mp.match_id = p_match_id
    AND mp.player_id != p_player_id
    AND mp.status = 'joined';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_org_notification_recipients(p_organization_id uuid, p_notification_type public.notification_type_enum, p_channel public.delivery_channel_enum DEFAULT 'email'::public.delivery_channel_enum)
 RETURNS TABLE(user_id uuid, email text, full_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_preference_enabled BOOLEAN;
    v_recipient_roles role_enum[];
BEGIN
    -- Check if this notification type/channel is enabled for the org
    SELECT enabled, recipient_roles
    INTO v_preference_enabled, v_recipient_roles
    FROM organization_notification_preference
    WHERE organization_id = p_organization_id
        AND notification_type = p_notification_type
        AND channel = p_channel;

    -- Default to enabled if no explicit preference exists
    IF v_preference_enabled IS NULL THEN
        v_preference_enabled := TRUE;
    END IF;

    -- If disabled, return empty
    IF NOT v_preference_enabled THEN
        RETURN;
    END IF;

    -- First check for explicit recipients
    IF EXISTS (
        SELECT 1 FROM organization_notification_recipient onr
        WHERE onr.organization_id = p_organization_id
            AND onr.notification_type = p_notification_type
            AND onr.enabled = TRUE
    ) THEN
        -- Return explicit recipients only
        RETURN QUERY
        SELECT p.id, p.email, p.full_name
        FROM organization_notification_recipient onr
        JOIN profile p ON p.id = onr.user_id
        WHERE onr.organization_id = p_organization_id
            AND onr.notification_type = p_notification_type
            AND onr.enabled = TRUE;
    ELSE
        -- Return org members based on role filter
        RETURN QUERY
        SELECT p.id, p.email, p.full_name
        FROM organization_member om
        JOIN profile p ON p.id = om.user_id
        WHERE om.organization_id = p_organization_id
            AND om.left_at IS NULL
            AND (
                v_recipient_roles IS NULL  -- No role filter = all members
                OR om.role = ANY(v_recipient_roles)
            );
    END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_participants_for_feedback_reminder(p_cutoff_start timestamp with time zone, p_cutoff_end timestamp with time zone)
 RETURNS TABLE(participant_id uuid, player_id uuid, match_id uuid, match_date date, start_time time without time zone, end_time time without time zone, sport_name text, format text, timezone text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    mp.id AS participant_id,
    mp.player_id,
    m.id AS match_id,
    m.match_date,
    m.start_time,
    m.end_time,
    s.name::TEXT AS sport_name,
    m.format::TEXT,
    m.timezone::TEXT
  FROM match_participant mp
  INNER JOIN match m ON m.id = mp.match_id
  INNER JOIN sport s ON s.id = m.sport_id
  WHERE mp.status = 'joined'
    AND mp.feedback_completed = false
    AND mp.feedback_reminder_sent_at IS NULL
    AND mp.initial_feedback_notification_sent_at IS NOT NULL  -- Must have received initial notification
    AND m.cancelled_at IS NULL
    AND m.closed_at IS NULL
    -- Compare in UTC (match_date + end_time is already treated as UTC when cast to TIMESTAMPTZ)
    AND (m.match_date + m.end_time)::TIMESTAMPTZ
      BETWEEN p_cutoff_start AND p_cutoff_end;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_participants_for_initial_feedback_notification(p_cutoff_start timestamp with time zone, p_cutoff_end timestamp with time zone)
 RETURNS TABLE(participant_id uuid, player_id uuid, match_id uuid, match_date date, start_time time without time zone, end_time time without time zone, sport_name text, format text, timezone text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    mp.id AS participant_id,
    mp.player_id,
    m.id AS match_id,
    m.match_date,
    m.start_time,
    m.end_time,
    s.name::TEXT AS sport_name,
    m.format::TEXT,
    m.timezone::TEXT
  FROM match_participant mp
  INNER JOIN match m ON m.id = mp.match_id
  INNER JOIN sport s ON s.id = m.sport_id
  WHERE mp.status = 'joined'
    AND mp.initial_feedback_notification_sent_at IS NULL
    AND m.cancelled_at IS NULL
    AND m.closed_at IS NULL
    -- Compare in UTC (match_date + end_time is already treated as UTC when cast to TIMESTAMPTZ)
    AND (m.match_date + m.end_time)::TIMESTAMPTZ
      BETWEEN p_cutoff_start AND p_cutoff_end;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_player_matches(p_player_id uuid, p_time_filter text DEFAULT 'upcoming'::text, p_sport_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_status_filter text DEFAULT 'all'::text)
 RETURNS TABLE(match_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  current_time_utc TIMESTAMPTZ := NOW();
  forty_eight_hours_ago TIMESTAMPTZ := NOW() - INTERVAL '48 hours';
BEGIN
  RETURN QUERY
  SELECT m.id AS match_id
  FROM match m
  LEFT JOIN match_participant mp ON mp.match_id = m.id AND mp.player_id = p_player_id
  WHERE 
    (
      m.created_by = p_player_id
      OR mp.status IN ('joined', 'requested', 'pending', 'waitlisted')
    )
    AND (p_sport_id IS NULL OR m.sport_id = p_sport_id)
    AND (
      CASE 
        WHEN p_status_filter = 'cancelled' THEN m.cancelled_at IS NOT NULL
        ELSE m.cancelled_at IS NULL
      END
    )
    AND (
      CASE p_status_filter
        WHEN 'all' THEN TRUE
        WHEN 'hosting' THEN 
          m.created_by = p_player_id
        WHEN 'confirmed' THEN 
          mp.status = 'joined'
        WHEN 'pending' THEN 
          mp.status = 'pending'
        WHEN 'requested' THEN 
          mp.status = 'requested'
        WHEN 'waitlisted' THEN 
          mp.status = 'waitlisted'
        WHEN 'needs_players' THEN
          (SELECT COUNT(*) FROM match_participant mp2 
           WHERE mp2.match_id = m.id AND mp2.status = 'joined') 
          < CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
        WHEN 'ready_to_play' THEN
          mp.status = 'joined'
          AND (SELECT COUNT(*) FROM match_participant mp2 
               WHERE mp2.match_id = m.id AND mp2.status = 'joined') 
              >= CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
        WHEN 'feedback_needed' THEN
          mp.status = 'joined'
          AND mp.feedback_completed = false
          AND (SELECT COUNT(*) FROM match_participant mp2 
               WHERE mp2.match_id = m.id AND mp2.status = 'joined') 
              >= CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
          AND (
            CASE 
              WHEN m.timezone IS NOT NULL THEN
                CASE
                  WHEN m.end_time < m.start_time THEN
                    timezone(m.timezone, ((m.match_date + INTERVAL '1 day') + m.end_time)::timestamp) >= forty_eight_hours_ago
                  ELSE
                    timezone(m.timezone, (m.match_date + m.end_time)::timestamp) >= forty_eight_hours_ago
                END
              ELSE
                CASE
                  WHEN m.end_time < m.start_time THEN
                    ((m.match_date + INTERVAL '1 day') + m.end_time)::timestamp >= (forty_eight_hours_ago AT TIME ZONE 'UTC')::timestamp
                  ELSE
                    (m.match_date + m.end_time)::timestamp >= (forty_eight_hours_ago AT TIME ZONE 'UTC')::timestamp
                END
            END
          )
        WHEN 'played' THEN
          (SELECT COUNT(*) FROM match_participant mp2 
           WHERE mp2.match_id = m.id AND mp2.status = 'joined') 
          >= CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
        WHEN 'hosted' THEN
          m.created_by = p_player_id
        WHEN 'as_participant' THEN
          m.created_by != p_player_id
        WHEN 'expired' THEN
          (SELECT COUNT(*) FROM match_participant mp2 
           WHERE mp2.match_id = m.id AND mp2.status = 'joined') 
          < CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
        WHEN 'cancelled' THEN
          TRUE
        ELSE TRUE
      END
    )
    AND (
      CASE 
        WHEN p_time_filter = 'upcoming' THEN
          NOT EXISTS (SELECT 1 FROM match_result mr WHERE mr.match_id = m.id)
          AND (
            CASE 
              WHEN m.timezone IS NOT NULL THEN
                CASE
                  WHEN m.end_time < m.start_time THEN
                    timezone(m.timezone, ((m.match_date + INTERVAL '1 day') + m.end_time)::timestamp) >= current_time_utc
                  ELSE
                    timezone(m.timezone, (m.match_date + m.end_time)::timestamp) >= current_time_utc
                END
              ELSE
                CASE
                  WHEN m.end_time < m.start_time THEN
                    ((m.match_date + INTERVAL '1 day') + m.end_time)::timestamp >= (current_time_utc AT TIME ZONE 'UTC')::timestamp
                  ELSE
                    (m.match_date + m.end_time)::timestamp >= (current_time_utc AT TIME ZONE 'UTC')::timestamp
                END
            END
          )
          AND (
            -- Still scheduled (start_time in future) OR match is full (in progress, not expired)
            (CASE
              WHEN m.timezone IS NOT NULL THEN
                timezone(m.timezone, (m.match_date + m.start_time)::timestamp) >= current_time_utc
              ELSE
                (m.match_date + m.start_time)::timestamp >= (current_time_utc AT TIME ZONE 'UTC')::timestamp
            END)
            OR
            (SELECT COUNT(*) FROM match_participant mp2
             WHERE mp2.match_id = m.id AND mp2.status = 'joined')
            >= CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
          )
        WHEN p_time_filter = 'past' THEN
          EXISTS (SELECT 1 FROM match_result mr WHERE mr.match_id = m.id)
          OR (
            CASE 
              WHEN m.timezone IS NOT NULL THEN
                CASE
                  WHEN m.end_time < m.start_time THEN
                    timezone(m.timezone, ((m.match_date + INTERVAL '1 day') + m.end_time)::timestamp) < current_time_utc
                  ELSE
                    timezone(m.timezone, (m.match_date + m.end_time)::timestamp) < current_time_utc
                END
              ELSE
                CASE
                  WHEN m.end_time < m.start_time THEN
                    ((m.match_date + INTERVAL '1 day') + m.end_time)::timestamp < (current_time_utc AT TIME ZONE 'UTC')::timestamp
                  ELSE
                    (m.match_date + m.end_time)::timestamp < (current_time_utc AT TIME ZONE 'UTC')::timestamp
                END
            END
          )
        ELSE
          FALSE
      END
    )
  ORDER BY 
    CASE WHEN p_time_filter = 'upcoming' THEN (m.match_date + m.start_time)::timestamp END ASC,
    CASE WHEN p_time_filter = 'past' THEN (m.match_date + m.start_time)::timestamp END DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_reputation_summary(target_player_id uuid)
 RETURNS TABLE(score numeric, tier public.reputation_tier, matches_completed integer, is_public boolean, positive_events integer, negative_events integer, total_events integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        pr.reputation_score,
        pr.reputation_tier,
        pr.matches_completed,
        pr.is_public,
        pr.positive_events,
        pr.negative_events,
        pr.total_events
    FROM player_reputation pr
    WHERE pr.player_id = target_player_id;

    -- If no record found, return default values
    IF NOT FOUND THEN
        RETURN QUERY
        SELECT
            100::DECIMAL(5,2) as score,
            'unknown'::reputation_tier as tier,
            0 as matches_completed,
            false as is_public,
            0 as positive_events,
            0 as negative_events,
            0 as total_events;
    END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.insert_notification(p_user_id uuid, p_type public.notification_type_enum, p_target_id uuid DEFAULT NULL::uuid, p_title text DEFAULT 'Notification'::text, p_body text DEFAULT NULL::text, p_payload jsonb DEFAULT '{}'::jsonb, p_priority public.notification_priority_enum DEFAULT 'normal'::public.notification_priority_enum, p_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS public.notification
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result notification;
BEGIN
  INSERT INTO notification (
    user_id, type, target_id, title, body, payload, priority, scheduled_at, expires_at, organization_id
  )
  VALUES (
    p_user_id, p_type, p_target_id, p_title, p_body, p_payload, p_priority, p_scheduled_at, p_expires_at, p_organization_id
  )
  RETURNING * INTO result;
  
  RETURN result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_network_creator(network_id_param uuid, user_id_param uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.network
    WHERE id = network_id_param
    AND created_by = user_id_param
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_network_moderator(network_id_param uuid, user_id_param uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.network_member
    WHERE network_id = network_id_param
    AND player_id = user_id_param
    AND role = 'moderator'
    AND status = 'active'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.mark_feedback_reminders_sent(p_participant_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE match_participant
  SET feedback_reminder_sent_at = NOW()
  WHERE id = ANY(p_participant_ids)
    AND feedback_reminder_sent_at IS NULL;
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_initial_feedback_notifications_sent(p_participant_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE match_participant
  SET initial_feedback_notification_sent_at = NOW()
  WHERE id = ANY(p_participant_ids)
    AND initial_feedback_notification_sent_at IS NULL;
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_group_members_on_match_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_player_group_type_id UUID;
  v_sport_name TEXT;
  v_notifications JSONB := '[]'::JSONB;
BEGIN
  -- Only run when match is public, or private with visible_in_groups
  IF NEW.visibility IS DISTINCT FROM 'public'
     AND NOT (NEW.visibility = 'private' AND COALESCE(NEW.visible_in_groups, true) = true) THEN
    RETURN NEW;
  END IF;

  -- Get player_group network type id
  SELECT id INTO v_player_group_type_id
  FROM network_type
  WHERE name = 'player_group'
  LIMIT 1;

  IF v_player_group_type_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Optional: sport name for payload (for push display)
  SELECT s.name INTO v_sport_name
  FROM sport s
  WHERE s.id = NEW.sport_id
  LIMIT 1;

  -- Build batch of notifications for distinct group members (excluding creator)
  -- Recipients: active members of any player_group the creator is in, except the creator
  WITH creator_groups AS (
    SELECT nm.network_id
    FROM network_member nm
    JOIN network n ON n.id = nm.network_id AND n.network_type_id = v_player_group_type_id
    WHERE nm.player_id = NEW.created_by
      AND nm.status = 'active'
  ),
  recipients AS (
    SELECT DISTINCT nm.player_id AS user_id
    FROM network_member nm
    JOIN creator_groups cg ON cg.network_id = nm.network_id
    WHERE nm.player_id IS NOT NULL
      AND nm.player_id != NEW.created_by
      AND nm.status = 'active'
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'user_id', r.user_id,
        'type', 'match_new_available',
        'target_id', NEW.id,
        'title', 'New game',
        'body', 'A group member created a match you can join.',
        'payload', jsonb_build_object(
          'matchId', NEW.id,
          'creatorId', NEW.created_by,
          'sportName', COALESCE(v_sport_name, '')
        ),
        'priority', 'normal'
      )
    ),
    '[]'::JSONB
  )
  INTO v_notifications
  FROM recipients r;

  IF jsonb_array_length(v_notifications) > 0 THEN
    PERFORM insert_notifications(v_notifications);
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_send_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  request_id bigint;
  functions_url TEXT;
  anon_key TEXT;
BEGIN
  -- Get the functions URL from vault
  SELECT decrypted_secret INTO functions_url 
  FROM vault.decrypted_secrets 
  WHERE name = 'supabase_functions_url' 
  LIMIT 1;
  
  -- Get the anon (publishable) key from vault
  SELECT decrypted_secret INTO anon_key 
  FROM vault.decrypted_secrets 
  WHERE name = 'anon_key' 
  LIMIT 1;
  
  -- Check if secrets are available
  IF functions_url IS NULL OR anon_key IS NULL THEN
    RAISE WARNING 'Cannot dispatch notification: Vault secrets not configured (functions_url: %, anon_key: %)',
      CASE WHEN functions_url IS NULL THEN 'missing' ELSE 'ok' END,
      CASE WHEN anon_key IS NULL THEN 'missing' ELSE 'ok' END;
    RETURN NEW;
  END IF;

  -- Call the Edge Function using pg_net with Bearer auth (publishable key)
  SELECT INTO request_id net.http_post(
    url := functions_url || '/functions/v1/send-notification',
    body := jsonb_build_object('type', 'INSERT', 'table', 'notification', 'record', row_to_json(NEW)::jsonb),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key
    ),
    timeout_milliseconds := 5000
  );
  
  RAISE NOTICE 'Triggered notification dispatch for % with request_id %', NEW.id, request_id;
  RETURN NEW;
EXCEPTION
  WHEN others THEN
    -- Log error but don't fail the insert
    RAISE WARNING 'Failed to trigger notification dispatch: %', SQLERRM;
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recalculate_player_reputation(target_player_id uuid, apply_decay boolean DEFAULT false)
 RETURNS public.player_reputation
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    base_score DECIMAL(5,2) := 100;
    total_impact DECIMAL(5,2) := 0;
    event_record RECORD;
    decay_factor DECIMAL(5,4);
    age_days INT;
    result_row player_reputation;
    p_total_events INT := 0;
    p_positive_events INT := 0;
    p_negative_events INT := 0;
    p_matches_completed INT := 0;
BEGIN
    -- Calculate sum of all event impacts with optional decay
    FOR event_record IN
        SELECT
            re.base_impact,
            re.event_type,
            re.event_occurred_at,
            rc.decay_enabled,
            rc.decay_half_life_days
        FROM reputation_event re
        LEFT JOIN reputation_config rc ON rc.event_type = re.event_type
        WHERE re.player_id = target_player_id
    LOOP
        p_total_events := p_total_events + 1;

        IF event_record.base_impact > 0 THEN
            p_positive_events := p_positive_events + 1;
        ELSIF event_record.base_impact < 0 THEN
            p_negative_events := p_negative_events + 1;
        END IF;

        -- Count matches completed
        IF event_record.event_type = 'match_completed' THEN
            p_matches_completed := p_matches_completed + 1;
        END IF;

        -- Apply decay if enabled
        IF apply_decay AND event_record.decay_enabled AND event_record.decay_half_life_days IS NOT NULL THEN
            age_days := EXTRACT(EPOCH FROM (now() - event_record.event_occurred_at)) / 86400;
            decay_factor := POWER(0.5, age_days::DECIMAL / event_record.decay_half_life_days);
            total_impact := total_impact + (event_record.base_impact * decay_factor);
        ELSE
            total_impact := total_impact + event_record.base_impact;
        END IF;
    END LOOP;

    -- Calculate final score (clamped 0-100)
    base_score := GREATEST(0, LEAST(100, base_score + total_impact));

    -- Upsert player_reputation
    INSERT INTO player_reputation (
        player_id,
        reputation_score,
        reputation_tier,
        total_events,
        positive_events,
        negative_events,
        matches_completed,
        last_decay_calculation,
        calculated_at,
        updated_at
    )
    VALUES (
        target_player_id,
        base_score,
        calculate_reputation_tier(base_score, p_total_events, 10),
        p_total_events,
        p_positive_events,
        p_negative_events,
        p_matches_completed,
        CASE WHEN apply_decay THEN now() ELSE NULL END,
        now(),
        now()
    )
    ON CONFLICT (player_id) DO UPDATE SET
        reputation_score = EXCLUDED.reputation_score,
        reputation_tier = EXCLUDED.reputation_tier,
        total_events = EXCLUDED.total_events,
        positive_events = EXCLUDED.positive_events,
        negative_events = EXCLUDED.negative_events,
        matches_completed = EXCLUDED.matches_completed,
        last_decay_calculation = EXCLUDED.last_decay_calculation,
        calculated_at = EXCLUDED.calculated_at,
        updated_at = EXCLUDED.updated_at
    RETURNING * INTO result_row;

    RETURN result_row;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_facilities_nearby(p_sport_ids uuid[], p_latitude double precision, p_longitude double precision, p_search_query text DEFAULT NULL::text, p_max_distance_km double precision DEFAULT NULL::double precision, p_facility_types text[] DEFAULT NULL::text[], p_surface_types text[] DEFAULT NULL::text[], p_court_types text[] DEFAULT NULL::text[], p_has_lighting boolean DEFAULT NULL::boolean, p_membership_required boolean DEFAULT NULL::boolean, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, name character varying, city character varying, address character varying, distance_meters double precision, facility_type text, data_provider_id uuid, data_provider_type text, booking_url_template text, external_provider_id text, timezone text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT sub.id, sub.name, sub.city, sub.address, sub.distance_meters,
         sub.facility_type, sub.data_provider_id, sub.data_provider_type,
         sub.booking_url_template, sub.external_provider_id, sub.timezone
  FROM (
    SELECT DISTINCT ON (f.id)
      f.id,
      f.name,
      f.city,
      f.address,
      extensions.ST_Distance(
        f.location,
        extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::extensions.geography
      ) AS distance_meters,
      f.facility_type::TEXT AS facility_type,
      COALESCE(f.data_provider_id, o.data_provider_id) AS data_provider_id,
      COALESCE(fp.provider_type, op.provider_type) AS data_provider_type,
      COALESCE(fp.booking_url_template, op.booking_url_template) AS booking_url_template,
      f.external_provider_id,
      f.timezone
    FROM facility f
    INNER JOIN facility_sport fs ON fs.facility_id = f.id
    LEFT JOIN organization o ON o.id = f.organization_id
    LEFT JOIN data_provider fp ON fp.id = f.data_provider_id
    LEFT JOIN data_provider op ON op.id = o.data_provider_id
    WHERE fs.sport_id = ANY(p_sport_ids)
      AND f.is_active = TRUE
      -- Text search filter
      AND (
        p_search_query IS NULL
        OR f.name ILIKE '%' || p_search_query || '%'
        OR f.city ILIKE '%' || p_search_query || '%'
        OR f.address ILIKE '%' || p_search_query || '%'
      )
      -- Distance filter (convert km to meters)
      AND (
        p_max_distance_km IS NULL
        OR extensions.ST_DWithin(
          f.location,
          extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::extensions.geography,
          p_max_distance_km * 1000
        )
      )
      -- Facility type filter
      AND (
        p_facility_types IS NULL
        OR f.facility_type::TEXT = ANY(p_facility_types)
      )
      -- Surface type filter (check if facility has any court with matching surface)
      AND (
        p_surface_types IS NULL
        OR EXISTS (
          SELECT 1 FROM court c
          WHERE c.facility_id = f.id
            AND c.is_active = TRUE
            AND c.surface_type::TEXT = ANY(p_surface_types)
        )
      )
      -- Court type filter (indoor/outdoor based on court.indoor boolean)
      AND (
        p_court_types IS NULL
        OR EXISTS (
          SELECT 1 FROM court c
          WHERE c.facility_id = f.id
            AND c.is_active = TRUE
            AND (
              ('indoor' = ANY(p_court_types) AND c.indoor = TRUE)
              OR ('outdoor' = ANY(p_court_types) AND c.indoor = FALSE)
            )
        )
      )
      -- Lighting filter (check if facility has any court with lighting)
      AND (
        p_has_lighting IS NULL
        OR EXISTS (
          SELECT 1 FROM court c
          WHERE c.facility_id = f.id
            AND c.is_active = TRUE
            AND c.lighting = p_has_lighting
        )
      )
      -- Membership required filter
      AND (
        p_membership_required IS NULL
        OR f.membership_required = p_membership_required
      )
    ORDER BY f.id
  ) sub
  ORDER BY sub.distance_meters ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_facilities_nearby_count(p_sport_ids uuid[], p_latitude double precision, p_longitude double precision, p_search_query text DEFAULT NULL::text, p_max_distance_km double precision DEFAULT NULL::double precision, p_facility_types text[] DEFAULT NULL::text[], p_surface_types text[] DEFAULT NULL::text[], p_court_types text[] DEFAULT NULL::text[], p_has_lighting boolean DEFAULT NULL::boolean, p_membership_required boolean DEFAULT NULL::boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(DISTINCT f.id) INTO v_count
  FROM facility f
  INNER JOIN facility_sport fs ON fs.facility_id = f.id
  LEFT JOIN organization o ON o.id = f.organization_id
  LEFT JOIN data_provider fp ON fp.id = f.data_provider_id
  LEFT JOIN data_provider op ON op.id = o.data_provider_id
  WHERE fs.sport_id = ANY(p_sport_ids)
    AND f.is_active = TRUE
    -- Text search filter
    AND (
      p_search_query IS NULL
      OR f.name ILIKE '%' || p_search_query || '%'
      OR f.city ILIKE '%' || p_search_query || '%'
      OR f.address ILIKE '%' || p_search_query || '%'
    )
    -- Distance filter (convert km to meters)
    AND (
      p_max_distance_km IS NULL
      OR extensions.ST_DWithin(
        f.location,
        extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::extensions.geography,
        p_max_distance_km * 1000
      )
    )
    -- Facility type filter
    AND (
      p_facility_types IS NULL
      OR f.facility_type::TEXT = ANY(p_facility_types)
    )
    -- Surface type filter
    AND (
      p_surface_types IS NULL
      OR EXISTS (
        SELECT 1 FROM court c
        WHERE c.facility_id = f.id
          AND c.is_active = TRUE
          AND c.surface_type::TEXT = ANY(p_surface_types)
      )
    )
    -- Court type filter
    AND (
      p_court_types IS NULL
      OR EXISTS (
        SELECT 1 FROM court c
        WHERE c.facility_id = f.id
          AND c.is_active = TRUE
          AND (
            ('indoor' = ANY(p_court_types) AND c.indoor = TRUE)
            OR ('outdoor' = ANY(p_court_types) AND c.indoor = FALSE)
          )
      )
    )
    -- Lighting filter
    AND (
      p_has_lighting IS NULL
      OR EXISTS (
        SELECT 1 FROM court c
        WHERE c.facility_id = f.id
          AND c.is_active = TRUE
          AND c.lighting = p_has_lighting
      )
    )
    -- Membership required filter
    AND (
      p_membership_required IS NULL
      OR f.membership_required = p_membership_required
    );

  RETURN v_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_public_matches(p_latitude double precision, p_longitude double precision, p_max_distance_km double precision, p_sport_id uuid, p_search_query text DEFAULT NULL::text, p_format text DEFAULT NULL::text, p_match_type text DEFAULT NULL::text, p_date_range text DEFAULT NULL::text, p_time_of_day text DEFAULT NULL::text, p_skill_level text DEFAULT NULL::text, p_gender text DEFAULT NULL::text, p_cost text DEFAULT NULL::text, p_join_mode text DEFAULT NULL::text, p_duration text DEFAULT NULL::text, p_court_status text DEFAULT NULL::text, p_specific_date date DEFAULT NULL::date, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_user_gender text DEFAULT NULL::text, p_facility_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(match_id uuid, distance_meters double precision)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_point extensions.geography;
  v_date_start DATE;
  v_date_end DATE;
  v_time_start TIME;
  v_time_end TIME;
  v_search_pattern TEXT;
  v_has_distance_filter BOOLEAN;
  v_has_facility_filter BOOLEAN;
BEGIN
  -- Create point from coordinates
  v_point := extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::extensions.geography;
  
  -- Determine if distance filter is active
  v_has_distance_filter := p_max_distance_km IS NOT NULL;
  
  -- Determine if facility filter is active
  v_has_facility_filter := p_facility_id IS NOT NULL;
  
  -- Prepare search pattern for LIKE matching
  IF p_search_query IS NOT NULL AND LENGTH(TRIM(p_search_query)) > 0 THEN
    v_search_pattern := '%' || LOWER(TRIM(p_search_query)) || '%';
  END IF;
  
  -- Calculate date range boundaries based on filter
  -- If p_specific_date is set, it overrides p_date_range
  IF p_specific_date IS NOT NULL THEN
    v_date_start := p_specific_date;
    v_date_end := p_specific_date;
  ELSIF p_date_range = 'today' THEN
    v_date_start := CURRENT_DATE;
    v_date_end := CURRENT_DATE;
  ELSIF p_date_range = 'week' THEN
    v_date_start := CURRENT_DATE;
    v_date_end := CURRENT_DATE + INTERVAL '7 days';
  ELSIF p_date_range = 'weekend' THEN
    -- Next Saturday to Sunday
    v_date_start := CURRENT_DATE + (6 - EXTRACT(DOW FROM CURRENT_DATE))::INT;
    v_date_end := v_date_start + INTERVAL '1 day';
  ELSE
    -- 'all' or NULL - no date filter beyond >= today
    v_date_start := CURRENT_DATE;
    v_date_end := NULL;
  END IF;
  
  -- Calculate time of day boundaries
  IF p_time_of_day = 'morning' THEN
    v_time_start := '06:00:00'::TIME;
    v_time_end := '12:00:00'::TIME;
  ELSIF p_time_of_day = 'afternoon' THEN
    v_time_start := '12:00:00'::TIME;
    v_time_end := '18:00:00'::TIME;
  ELSIF p_time_of_day = 'evening' THEN
    v_time_start := '18:00:00'::TIME;
    v_time_end := '23:59:59'::TIME;
  ELSE
    v_time_start := NULL;
    v_time_end := NULL;
  END IF;

  RETURN QUERY
  WITH match_distances AS (
    -- Calculate distance for matches with known coordinates (facility or custom location)
    SELECT 
      m.id,
      CASE
        -- Use facility coordinates when location_type is 'facility' and facility has valid location
        WHEN m.location_type = 'facility' AND f.location IS NOT NULL AND f.is_active = TRUE THEN
          extensions.ST_Distance(v_point, f.location::extensions.geography)
        -- Use custom location coordinates when location_type is 'custom' and coords are available
        WHEN m.location_type = 'custom' AND m.custom_latitude IS NOT NULL AND m.custom_longitude IS NOT NULL THEN
          extensions.ST_Distance(
            v_point, 
            extensions.ST_SetSRID(
              extensions.ST_MakePoint(m.custom_longitude, m.custom_latitude), 
              4326
            )::extensions.geography
          )
        -- TBD locations have NULL distance
        ELSE NULL
      END AS dist_meters
    FROM match m
    LEFT JOIN facility f ON m.facility_id = f.id AND f.is_active = TRUE
    WHERE 
      -- Only public, non-cancelled matches
      m.visibility = 'public'
      AND m.cancelled_at IS NULL
      -- Sport filter
      AND m.sport_id = p_sport_id
      -- Facility filter (when specified) - skip distance check when filtering by facility
      AND (NOT v_has_facility_filter OR m.facility_id = p_facility_id)
      -- When distance filter is active and NOT filtering by facility, only include matches with valid coordinates
      -- When no distance filter or filtering by facility, include all location types (including TBD)
      AND (
        v_has_facility_filter
        OR NOT v_has_distance_filter
        OR (
          -- Facility matches with valid location
          (m.location_type = 'facility' AND f.location IS NOT NULL AND f.is_active = TRUE)
          OR
          -- Custom location matches with valid coordinates
          (m.location_type = 'custom' AND m.custom_latitude IS NOT NULL AND m.custom_longitude IS NOT NULL)
        )
      )
  ),
  filtered_matches AS (
    SELECT 
      m.id,
      md.dist_meters,
      m.match_date,
      m.start_time,
      m.end_time,
      m.timezone,
      m.format,
      m.duration,
      m.player_expectation,
      m.location_type,
      m.location_name,
      m.location_address,
      m.is_court_free,
      m.estimated_cost,
      m.join_mode,
      m.court_status,
      m.created_by,
      m.preferred_opponent_gender,
      m.min_rating_score_id,
      m.notes
    FROM match m
    INNER JOIN match_distances md ON m.id = md.id
    WHERE
      -- Distance filter (when specified and NOT filtering by facility)
      -- If p_max_distance_km is NULL or we have a facility filter, include all matches regardless of distance
      -- TBD locations (NULL distance) are included when p_max_distance_km is NULL
      (
        v_has_facility_filter
        OR NOT v_has_distance_filter
        OR (md.dist_meters IS NOT NULL AND md.dist_meters <= p_max_distance_km * 1000)
      )
      -- ALWAYS filter out matches that have already started today (regardless of date range filter)
      -- For matches today, only show if start_time > current time in match's timezone
      AND (
        m.match_date > CURRENT_DATE
        OR m.start_time > (NOW() AT TIME ZONE COALESCE(m.timezone, 'UTC'))::TIME
      )
      -- Date range filter (matches on or after today)
      AND m.match_date >= v_date_start
      AND (v_date_end IS NULL OR m.match_date <= v_date_end)
      -- Format filter (singles/doubles) - cast enum to TEXT for comparison
      AND (p_format IS NULL OR m.format::TEXT = p_format)
      -- Match type filter (casual/competitive/both) - now uses player_expectation
      AND (
        p_match_type IS NULL 
        OR (p_match_type = 'casual' AND m.player_expectation::TEXT IN ('casual', 'both'))
        OR (p_match_type = 'competitive' AND m.player_expectation::TEXT IN ('competitive', 'both'))
      )
      -- Time of day filter
      AND (
        v_time_start IS NULL
        OR (m.start_time >= v_time_start AND m.start_time < v_time_end)
      )
      -- Cost filter
      AND (
        p_cost IS NULL
        OR (p_cost = 'free' AND m.is_court_free = TRUE)
        OR (p_cost = 'paid' AND (m.is_court_free = FALSE OR m.estimated_cost IS NOT NULL))
      )
      -- Join mode filter - cast enum to TEXT for comparison
      AND (p_join_mode IS NULL OR m.join_mode::TEXT = p_join_mode)
      -- Duration filter - cast enum to TEXT for comparison
      -- '120+' includes both '120' and 'custom' durations
      AND (
        p_duration IS NULL
        OR (p_duration = '30' AND m.duration::TEXT = '30')
        OR (p_duration = '60' AND m.duration::TEXT = '60')
        OR (p_duration = '90' AND m.duration::TEXT = '90')
        OR (p_duration = '120+' AND m.duration::TEXT IN ('120', 'custom'))
      )
      -- Court status filter - cast enum to TEXT for comparison
      AND (p_court_status IS NULL OR m.court_status::TEXT = p_court_status)
      -- Gender eligibility filter: only show matches the user is eligible to join
      -- Matches with NULL preferred_opponent_gender are open to all
      -- Matches with a specific gender requirement only show to users of that gender
      -- Uses gender_enum cast for proper enum comparison
      AND (
        m.preferred_opponent_gender IS NULL  -- Open to all genders
        OR p_user_gender IS NULL              -- User didn't specify their gender (show all)
        OR m.preferred_opponent_gender = p_user_gender::gender_enum  -- User matches the preference
      )
      -- UI Gender filter (for additional narrowing within eligible matches)
      AND (
        p_gender IS NULL
        OR p_gender = 'all'
        OR m.preferred_opponent_gender = p_gender::gender_enum  -- Cast to gender_enum for comparison
      )
      -- Text search on location name, address, notes, and creator display name
      AND (
        v_search_pattern IS NULL
        OR LOWER(COALESCE(m.location_name, '')) LIKE v_search_pattern
        OR LOWER(COALESCE(m.location_address, '')) LIKE v_search_pattern
        OR LOWER(COALESCE(m.notes, '')) LIKE v_search_pattern
        OR EXISTS (
          SELECT 1 FROM profile p 
          WHERE p.id = m.created_by 
          AND LOWER(COALESCE(p.display_name, '')) LIKE v_search_pattern
        )
      )
  ),
  -- Calculate participant counts to filter out full matches
  match_counts AS (
    SELECT 
      fm.id,
      fm.dist_meters,
      fm.match_date,
      fm.start_time,
      fm.format,
      CASE fm.format 
        WHEN 'doubles' THEN 4 
        ELSE 2 
      END AS total_spots,
      -- Count joined participants (now includes the creator who has a participant record)
      (
        SELECT COUNT(*) 
        FROM match_participant mp 
        WHERE mp.match_id = fm.id AND mp.status = 'joined'
      ) AS filled_spots
    FROM filtered_matches fm
  )
  SELECT 
    mc.id AS match_id,
    mc.dist_meters AS distance_meters
  FROM match_counts mc
  WHERE 
    -- Only include matches that still have spots available
    mc.filled_spots < mc.total_spots
  ORDER BY 
    mc.match_date ASC,
    mc.start_time ASC,
    COALESCE(mc.dist_meters, 999999999) ASC  -- TBD matches sort last within same date/time
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.seed_org_notification_defaults(p_organization_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Staff notifications (admins/owners only, email enabled by default)
    INSERT INTO organization_notification_preference
        (organization_id, notification_type, channel, enabled, recipient_roles)
    VALUES
        -- Booking notifications for staff
        (p_organization_id, 'booking_created', 'email', TRUE, ARRAY['admin', 'owner']::role_enum[]),
        (p_organization_id, 'booking_cancelled_by_player', 'email', TRUE, ARRAY['admin', 'owner']::role_enum[]),
        (p_organization_id, 'booking_modified', 'email', TRUE, ARRAY['admin', 'owner']::role_enum[]),
        -- Member notifications for staff
        (p_organization_id, 'new_member_joined', 'email', TRUE, ARRAY['admin', 'owner']::role_enum[]),
        (p_organization_id, 'member_left', 'email', TRUE, ARRAY['admin', 'owner']::role_enum[]),
        (p_organization_id, 'member_role_changed', 'email', TRUE, ARRAY['admin', 'owner']::role_enum[]),
        -- Payment notifications for owners only
        (p_organization_id, 'payment_received', 'email', TRUE, ARRAY['owner']::role_enum[]),
        (p_organization_id, 'payment_failed', 'email', TRUE, ARRAY['owner']::role_enum[]),
        (p_organization_id, 'refund_processed', 'email', TRUE, ARRAY['owner']::role_enum[]),
        -- Summary reports for admins/owners
        (p_organization_id, 'daily_summary', 'email', FALSE, ARRAY['admin', 'owner']::role_enum[]),
        (p_organization_id, 'weekly_report', 'email', TRUE, ARRAY['admin', 'owner']::role_enum[])
    ON CONFLICT (organization_id, notification_type, channel) DO NOTHING;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_match_result_for_match(p_match_id uuid, p_submitted_by uuid, p_winning_team integer, p_sets jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_player_id UUID;
  v_is_participant BOOLEAN;
  v_match_exists BOOLEAN;
  v_has_result BOOLEAN;
  v_match_cancelled BOOLEAN;
  v_match_end_utc TIMESTAMPTZ;
  v_match_ended BOOLEAN;
  v_within_48h BOOLEAN;
  v_set_count INT;
  v_set_el JSONB;
  v_team1_total INT := 0;
  v_team2_total INT := 0;
  v_result_id UUID;
  v_i INT;
BEGIN
  -- Caller must be authenticated; player.id = profile.id = auth.uid()
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Caller must be submitting as themselves
  IF v_player_id != p_submitted_by THEN
    RAISE EXCEPTION 'Cannot submit score on behalf of another player';
  END IF;

  -- Participant check: must be a joined participant of this match
  SELECT EXISTS(
    SELECT 1 FROM match_participant mp
    WHERE mp.match_id = p_match_id
      AND mp.player_id = p_submitted_by
      AND mp.status = 'joined'
  ) INTO v_is_participant;
  IF NOT v_is_participant THEN
    RAISE EXCEPTION 'Player is not a joined participant of this match';
  END IF;

  -- Match must exist and not be cancelled
  SELECT EXISTS(SELECT 1 FROM match m WHERE m.id = p_match_id),
         COALESCE((SELECT m.cancelled_at IS NOT NULL FROM match m WHERE m.id = p_match_id), TRUE)
  INTO v_match_exists, v_match_cancelled;
  IF NOT v_match_exists OR v_match_cancelled THEN
    RAISE EXCEPTION 'Match not found or cancelled';
  END IF;

  -- No existing result
  SELECT EXISTS(SELECT 1 FROM match_result mr WHERE mr.match_id = p_match_id)
  INTO v_has_result;
  IF v_has_result THEN
    RAISE EXCEPTION 'Match already has a result';
  END IF;

  -- Match must have ended (end time in match timezone < now)
  SELECT
    CASE
      WHEN m.timezone IS NOT NULL THEN
        CASE
          WHEN m.end_time < m.start_time THEN
            timezone(m.timezone, ((m.match_date + INTERVAL '1 day') + m.end_time)::timestamp)
          ELSE
            timezone(m.timezone, (m.match_date + m.end_time)::timestamp)
        END
      ELSE
        (m.match_date + m.end_time)::timestamptz
    END
  INTO v_match_end_utc
  FROM match m
  WHERE m.id = p_match_id;

  v_match_ended := v_match_end_utc < NOW();
  IF NOT v_match_ended THEN
    RAISE EXCEPTION 'Match has not ended yet';
  END IF;

  -- Optional: allow only within 48h feedback window
  v_within_48h := v_match_end_utc > (NOW() - INTERVAL '48 hours');
  IF NOT v_within_48h THEN
    RAISE EXCEPTION 'Score can only be registered within 48 hours after match end';
  END IF;

  -- Validate p_winning_team
  IF p_winning_team IS NULL OR p_winning_team NOT IN (1, 2) THEN
    RAISE EXCEPTION 'winning_team must be 1 or 2';
  END IF;

  -- Validate p_sets: array of 1-5 objects with team1_score, team2_score (non-negative integers)
  IF jsonb_typeof(p_sets) != 'array' THEN
    RAISE EXCEPTION 'sets must be a JSON array';
  END IF;
  v_set_count := jsonb_array_length(p_sets);
  IF v_set_count < 1 OR v_set_count > 5 THEN
    RAISE EXCEPTION 'sets must contain 1 to 5 elements';
  END IF;

  FOR v_i IN 0..(v_set_count - 1) LOOP
    v_set_el := p_sets->v_i;
    IF jsonb_typeof(v_set_el) != 'object' THEN
      RAISE EXCEPTION 'Each set must be an object';
    END IF;
    IF NOT (v_set_el ? 'team1_score' AND v_set_el ? 'team2_score') THEN
      RAISE EXCEPTION 'Each set must have team1_score and team2_score';
    END IF;
    IF (v_set_el->>'team1_score')::INT IS NULL OR (v_set_el->>'team1_score')::INT < 0 OR
       (v_set_el->>'team2_score')::INT IS NULL OR (v_set_el->>'team2_score')::INT < 0 THEN
      RAISE EXCEPTION 'Set scores must be non-negative integers';
    END IF;
    IF (v_set_el->>'team1_score')::INT > (v_set_el->>'team2_score')::INT THEN
      v_team1_total := v_team1_total + 1;
    ELSIF (v_set_el->>'team2_score')::INT > (v_set_el->>'team1_score')::INT THEN
      v_team2_total := v_team2_total + 1;
    END IF;
  END LOOP;

  -- Insert match_result
  INSERT INTO match_result (
    match_id,
    winning_team,
    team1_score,
    team2_score,
    is_verified,
    submitted_by,
    confirmation_deadline
  ) VALUES (
    p_match_id,
    p_winning_team,
    v_team1_total,
    v_team2_total,
    FALSE,
    p_submitted_by,
    NOW() + INTERVAL '24 hours'
  )
  RETURNING id INTO v_result_id;

  -- Insert match_set rows
  FOR v_i IN 0..(v_set_count - 1) LOOP
    v_set_el := p_sets->v_i;
    INSERT INTO match_set (
      match_result_id,
      set_number,
      team1_score,
      team2_score
    ) VALUES (
      v_result_id,
      v_i + 1,
      (v_set_el->>'team1_score')::INT,
      (v_set_el->>'team2_score')::INT
    );
  END LOOP;

  RETURN v_result_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trigger_recalculate_reputation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    -- Recalculate without decay (decay is handled by scheduled job)
    PERFORM recalculate_player_reputation(NEW.player_id, false);
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_program_participant_count()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'confirmed' THEN
    UPDATE program SET current_participants = current_participants + 1
    WHERE id = NEW.program_id;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Handle status changes
    IF OLD.status != 'confirmed' AND NEW.status = 'confirmed' THEN
      UPDATE program SET current_participants = current_participants + 1
      WHERE id = NEW.program_id;
    ELSIF OLD.status = 'confirmed' AND NEW.status != 'confirmed' THEN
      UPDATE program SET current_participants = GREATEST(current_participants - 1, 0)
      WHERE id = NEW.program_id;
    END IF;
  ELSIF TG_OP = 'DELETE' AND OLD.status = 'confirmed' THEN
    UPDATE program SET current_participants = GREATEST(current_participants - 1, 0)
    WHERE id = OLD.program_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_registration_paid_amount(p_registration_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_total_paid INTEGER;
BEGIN
  -- Calculate total paid from successful payments
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_total_paid
  FROM registration_payment
  WHERE registration_id = p_registration_id
  AND status = 'succeeded';

  -- Update registration
  UPDATE program_registration
  SET paid_amount_cents = v_total_paid
  WHERE id = p_registration_id;

  RETURN v_total_paid;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.approve_community_member(p_community_id uuid, p_member_id uuid, p_approver_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_approver_id UUID;
  v_is_moderator BOOLEAN;
  v_target_player_id UUID;
BEGIN
  -- Use provided approver_id or get from auth
  v_approver_id := COALESCE(p_approver_id, auth.uid());
  
  IF v_approver_id IS NULL THEN
    RAISE EXCEPTION 'Approver ID is required';
  END IF;
  
  -- Verify the approver is a moderator
  SELECT is_network_moderator(p_community_id, v_approver_id) INTO v_is_moderator;
  
  IF NOT v_is_moderator THEN
    RAISE EXCEPTION 'Only moderators can approve members';
  END IF;
  
  -- Get target player ID
  SELECT player_id INTO v_target_player_id
  FROM public.network_member
  WHERE id = p_member_id AND network_id = p_community_id AND status = 'pending';
  
  IF v_target_player_id IS NULL THEN
    RAISE EXCEPTION 'Pending membership not found';
  END IF;
  
  -- Approve the membership
  UPDATE public.network_member
  SET status = 'active', joined_at = NOW()
  WHERE id = p_member_id;
  
  -- Log activity
  INSERT INTO public.network_activity (
    network_id,
    activity_type,
    actor_id,
    target_id,
    metadata
  ) VALUES (
    p_community_id,
    'member_joined',
    v_approver_id,
    v_target_player_id,
    jsonb_build_object('status', 'approved', 'approved_by', v_approver_id)
  );
  
  RETURN true;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.auto_confirm_expired_scores()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE match_result
  SET 
    is_verified = TRUE,
    verified_at = NOW()
  WHERE 
    is_verified = FALSE 
    AND disputed = FALSE
    AND confirmation_deadline IS NOT NULL
    AND confirmation_deadline < NOW();
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.auto_verify_api_ratings()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- If source_type is api_verified, automatically set is_verified to TRUE
    IF NEW.source_type = 'api_verified' THEN
        NEW.is_verified := TRUE;
        NEW.verified_at := NOW();
        
        -- Set verification method if not already set
        IF NEW.verification_method IS NULL THEN
            NEW.verification_method := 'api_import';
        END IF;
        
        -- Demote other ratings to non-primary for this player's sport
        UPDATE player_rating_score prs
        SET is_primary = FALSE
        FROM rating_score rs
        JOIN rating r ON rs.rating_id = r.id
        WHERE prs.player_id = NEW.player_id
          AND prs.id != NEW.id
          AND rs.id = prs.rating_score_id
          AND r.sport_id = (
              SELECT r2.sport_id 
              FROM rating_score rs2 
              JOIN rating r2 ON rs2.rating_id = r2.id 
              WHERE rs2.id = NEW.rating_score_id
          );
    END IF;
    
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.check_and_update_certification()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_referrals_count INTEGER;
    v_current_level_proofs_count INTEGER;
    v_should_certify BOOLEAN := false;
    v_rating_value NUMERIC;
    v_sport_name TEXT;
    v_min_for_referral NUMERIC;
BEGIN
    -- Get current referrals count
    v_referrals_count := NEW.referrals_count;
    
    -- Get current-level proofs count (proofs that match current rating_score_id)
    SELECT COUNT(*) INTO v_current_level_proofs_count
    FROM rating_proof
    WHERE player_rating_score_id = NEW.id
    AND rating_score_id = NEW.rating_score_id
    AND is_active = true;
    
    -- Get rating value and sport info
    SELECT rs.value, s.name, rsys.min_for_referral
    INTO v_rating_value, v_sport_name, v_min_for_referral
    FROM rating_score rs
    JOIN rating_system rsys ON rs.rating_system_id = rsys.id
    JOIN sport s ON rsys.sport_id = s.id
    WHERE rs.id = NEW.rating_score_id;
    
    -- Check certification conditions:
    -- 1. At least 2 current-level proofs
    -- 2. At least 3 references from certified players at same/higher level
    IF v_current_level_proofs_count >= 2 THEN
        v_should_certify := true;
    ELSIF v_referrals_count >= 3 THEN
        v_should_certify := true;
    END IF;
    
    -- Update certification status
    IF v_should_certify AND NOT NEW.is_certified THEN
        NEW.is_certified := true;
        NEW.certified_at := NOW();
        NEW.badge_status := 'certified';
        
        -- Determine certification method
        IF v_current_level_proofs_count >= 2 THEN
            NEW.certified_via := 'proof';
        ELSE
            NEW.certified_via := 'referral';
        END IF;
    ELSIF NOT v_should_certify AND NEW.is_certified THEN
        -- If user changed rating and no longer meets criteria, reset to self_declared
        -- (only if the rating_score_id changed)
        IF OLD.rating_score_id IS DISTINCT FROM NEW.rating_score_id THEN
            NEW.is_certified := false;
            NEW.certified_at := NULL;
            NEW.badge_status := 'self_declared';
            NEW.certified_via := NULL;
        END IF;
    END IF;
    
    -- Check for disputed status (if certified but evaluation average is significantly lower)
    IF NEW.is_certified AND NEW.peer_evaluation_average IS NOT NULL THEN
        -- Get current rating value
        SELECT value INTO v_rating_value
        FROM rating_score WHERE id = NEW.rating_score_id;
        
        -- If evaluation average is 0.5+ lower, mark as disputed
        IF v_rating_value - NEW.peer_evaluation_average >= 0.5 THEN
            NEW.badge_status := 'disputed';
        ELSIF NEW.badge_status = 'disputed' THEN
            -- If no longer disputed, restore to certified
            NEW.badge_status := 'certified';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.check_peer_verification_threshold(p_player_id uuid, p_sport_id uuid, p_threshold integer DEFAULT 5)
 RETURNS TABLE(should_create_verified boolean, peer_count integer, average_rating numeric, recommended_rating_score_id uuid)
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_peer_count INTEGER;
    v_average_rating NUMERIC;
    v_recommended_id UUID;
BEGIN
    -- Get peer rating statistics
    SELECT 
        COUNT(*),
        AVG(skill_rating_value)
    INTO v_peer_count, v_average_rating
    FROM player_review
    WHERE reviewed_id = p_player_id
      AND sport_id = p_sport_id
      AND skill_rating_value IS NOT NULL;
    
    -- Find closest rating_score for the average
    IF v_average_rating IS NOT NULL THEN
        SELECT rs.id INTO v_recommended_id
        FROM rating_score rs
        JOIN rating r ON rs.rating_id = r.id
        WHERE r.sport_id = p_sport_id
        ORDER BY ABS(rs.score_value - v_average_rating)
        LIMIT 1;
    END IF;
    
    -- Return results
    RETURN QUERY SELECT 
        v_peer_count >= p_threshold,
        v_peer_count,
        v_average_rating,
        v_recommended_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.check_reference_verification_threshold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    completed_references_count INTEGER;
    reference_average NUMERIC;
    verification_threshold INTEGER := 3; -- Minimum 3 references needed
    existing_reference_verified_rating UUID;
BEGIN
    -- Only proceed if status changed to 'completed'
    IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
        
        -- Count completed references for this requester/sport
        SELECT COUNT(*), AVG(reference_rating_value)
        INTO completed_references_count, reference_average
        FROM reference_request
        WHERE requester_id = NEW.requester_id
          AND sport_id = NEW.sport_id
          AND status = 'completed'
          AND reference_rating_value IS NOT NULL;
        
        -- If threshold is met, create or update reference_verified rating
        IF completed_references_count >= verification_threshold THEN
            
            -- Find the appropriate rating_score for the average value
            DECLARE
                target_rating_score_id UUID;
            BEGIN
                SELECT rs.id INTO target_rating_score_id
                FROM rating_score rs
                INNER JOIN rating r ON rs.rating_id = r.id
                WHERE r.sport_id = NEW.sport_id
                  AND rs.score_value <= reference_average
                ORDER BY rs.score_value DESC
                LIMIT 1;
                
                IF target_rating_score_id IS NOT NULL THEN
                    -- Check if reference_verified rating already exists
                    SELECT id INTO existing_reference_verified_rating
                    FROM player_rating_score
                    WHERE player_id = NEW.requester_id
                      AND rating_score_id = target_rating_score_id
                      AND source_type = 'reference_verified';
                    
                    IF existing_reference_verified_rating IS NULL THEN
                        -- Create new reference_verified rating
                        INSERT INTO player_rating_score (
                            player_id,
                            rating_score_id,
                            source_type,
                            verification_method,
                            is_verified,
                            is_primary,
                            peer_rating_count,
                            peer_rating_average
                        ) VALUES (
                            NEW.requester_id,
                            target_rating_score_id,
                            'reference_verified',
                            'reference_consensus',
                            TRUE,
                            TRUE, -- Make it primary
                            completed_references_count,
                            reference_average
                        );
                        
                        -- Update old self_reported rating to not be primary
                        UPDATE player_rating_score
                        SET is_primary = FALSE
                        WHERE player_id = NEW.requester_id
                          AND sport_id = (
                              SELECT r.sport_id 
                              FROM rating_score rs
                              INNER JOIN rating r ON rs.rating_id = r.id
                              WHERE rs.id = rating_score_id
                          )
                          AND source_type = 'self_reported'
                          AND is_primary = TRUE;
                    ELSE
                        -- Update existing reference_verified rating
                        UPDATE player_rating_score
                        SET peer_rating_count = completed_references_count,
                            peer_rating_average = reference_average,
                            updated_at = now()
                        WHERE id = existing_reference_verified_rating;
                    END IF;
                END IF;
            END;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_match_score(p_match_result_id uuid, p_player_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_match_id UUID;
  v_is_participant BOOLEAN;
BEGIN
  -- Get match_id and verify player is a participant
  SELECT mr.match_id INTO v_match_id
  FROM match_result mr
  WHERE mr.id = p_match_result_id
    AND mr.is_verified = FALSE
    AND mr.disputed = FALSE
    AND mr.submitted_by != p_player_id;
  
  IF v_match_id IS NULL THEN
    RAISE EXCEPTION 'Score not found or already processed';
  END IF;
  
  -- Check player is a participant
  SELECT EXISTS(
    SELECT 1 FROM match_participant mp
    WHERE mp.match_id = v_match_id AND mp.player_id = p_player_id
  ) INTO v_is_participant;
  
  IF NOT v_is_participant THEN
    RAISE EXCEPTION 'Player is not a participant of this match';
  END IF;
  
  -- Confirm the score
  UPDATE match_result
  SET 
    is_verified = TRUE,
    verified_at = NOW(),
    confirmed_by = p_player_id
  WHERE id = p_match_result_id;
  
  RETURN TRUE;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.count_current_level_proofs(p_player_rating_score_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_count INTEGER;
    v_current_rating_score_id UUID;
BEGIN
    -- Get the current rating_score_id for the player
    SELECT rating_score_id INTO v_current_rating_score_id
    FROM player_rating_score
    WHERE id = p_player_rating_score_id;
    
    -- Count proofs that match the current rating level
    SELECT COUNT(*) INTO v_count
    FROM rating_proof
    WHERE player_rating_score_id = p_player_rating_score_id
    AND rating_score_id = v_current_rating_score_id
    AND is_active = true;
    
    RETURN v_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_network_conversation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  new_conversation_id UUID;
  group_type_id UUID;
  community_type_id UUID;
BEGIN
  -- Get type IDs for player_group and community
  SELECT id INTO group_type_id FROM public.network_type WHERE name = 'player_group';
  SELECT id INTO community_type_id FROM public.network_type WHERE name = 'community';
  
  -- Create conversation for player groups OR communities
  IF (NEW.network_type_id = group_type_id OR NEW.network_type_id = community_type_id) 
     AND NEW.conversation_id IS NULL THEN
    -- Create the group/community conversation
    INSERT INTO public.conversation (conversation_type, title, created_by)
    VALUES ('group', NEW.name, NEW.created_by)
    RETURNING id INTO new_conversation_id;
    
    -- Update the network with the conversation id
    NEW.conversation_id := new_conversation_id;
    
    -- Add the creator as a participant
    INSERT INTO public.conversation_participant (conversation_id, player_id)
    VALUES (new_conversation_id, NEW.created_by);
  END IF;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.debug_check_conversation_participant(p_conversation_id uuid, p_player_id uuid)
 RETURNS TABLE(is_participant boolean, participant_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    EXISTS (
      SELECT 1 FROM conversation_participant cp
      WHERE cp.conversation_id = p_conversation_id
      AND cp.player_id = p_player_id
    ) as is_participant,
    (SELECT COUNT(*) FROM conversation_participant WHERE conversation_id = p_conversation_id) as participant_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.dispute_match_score(p_match_result_id uuid, p_player_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_match_id UUID;
  v_is_participant BOOLEAN;
BEGIN
  -- Get match_id and verify player is a participant
  SELECT mr.match_id INTO v_match_id
  FROM match_result mr
  WHERE mr.id = p_match_result_id
    AND mr.is_verified = FALSE
    AND mr.disputed = FALSE
    AND mr.submitted_by != p_player_id;
  
  IF v_match_id IS NULL THEN
    RAISE EXCEPTION 'Score not found or already processed';
  END IF;
  
  -- Check player is a participant
  SELECT EXISTS(
    SELECT 1 FROM match_participant mp
    WHERE mp.match_id = v_match_id AND mp.player_id = p_player_id
  ) INTO v_is_participant;
  
  IF NOT v_is_participant THEN
    RAISE EXCEPTION 'Player is not a participant of this match';
  END IF;
  
  -- Dispute the score
  UPDATE match_result
  SET 
    disputed = TRUE,
    dispute_reason = p_reason
  WHERE id = p_match_result_id;
  
  RETURN TRUE;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_network_max_members()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  current_count INTEGER;
  max_allowed INTEGER;
  network_type_name TEXT;
BEGIN
  -- Only check on insert or when status changes to active
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status != 'active' AND NEW.status = 'active') THEN
    -- Get network info including type
    SELECT n.member_count, n.max_members, nt.name 
    INTO current_count, max_allowed, network_type_name
    FROM public.network n
    JOIN public.network_type nt ON n.network_type_id = nt.id
    WHERE n.id = NEW.network_id;
    
    -- Skip limit check for communities (unlimited members)
    IF network_type_name = 'community' THEN
      RETURN NEW;
    END IF;
    
    -- Enforce limit for other network types (like player_group)
    IF max_allowed IS NOT NULL AND current_count >= max_allowed THEN
      RAISE EXCEPTION 'Cannot add member: group has reached maximum capacity of % members', max_allowed;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.expire_old_reference_requests()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
    expired_count INTEGER;
BEGIN
    UPDATE reference_request
    SET status = 'expired',
        updated_at = now()
    WHERE status = 'pending'
      AND expires_at < now();
    
    GET DIAGNOSTICS expired_count = ROW_COUNT;
    RETURN expired_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_unique_invite_code()
 RETURNS character varying
 LANGUAGE plpgsql
AS $function$
DECLARE
  new_code VARCHAR(12);
  code_exists BOOLEAN;
BEGIN
  LOOP
    -- Generate 8 character alphanumeric code (uppercase letters + numbers)
    new_code := '';
    FOR i IN 1..8 LOOP
      new_code := new_code || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', floor(random() * 32 + 1)::int, 1);
    END LOOP;
    
    -- Check if code already exists
    SELECT EXISTS(SELECT 1 FROM public.network WHERE invite_code = new_code) INTO code_exists;
    
    -- Exit loop if code is unique
    EXIT WHEN NOT code_exists;
  END LOOP;
  
  RETURN new_code;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_match_duration_types()
 RETURNS TABLE(value text, label text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    enumlabel::TEXT AS value,
    CASE enumlabel::TEXT
      WHEN '30' THEN '30 Minutes'
      WHEN '60' THEN '1 Hour'
      WHEN '90' THEN '1.5 Hours'
      WHEN '120' THEN '2 Hours'
      WHEN 'custom' THEN 'Custom'
      ELSE enumlabel::TEXT
    END AS label
  FROM pg_enum
  WHERE enumtypid = 'match_duration_enum'::regtype
  ORDER BY enumsortorder;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_match_type_types()
 RETURNS TABLE(value text, label text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    enumlabel::TEXT AS value,
    CASE enumlabel::TEXT
      WHEN 'casual' THEN 'Casual'
      WHEN 'competitive' THEN 'Competitive'
      WHEN 'both' THEN 'Both'
      ELSE enumlabel::TEXT
    END AS label
  FROM pg_enum
  WHERE enumtypid = 'match_type_enum'::regtype
  ORDER BY enumsortorder;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_or_create_group_invite_code(group_id uuid)
 RETURNS character varying
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  existing_code VARCHAR(12);
  new_code VARCHAR(12);
BEGIN
  -- Check for existing code
  SELECT invite_code INTO existing_code 
  FROM public.network 
  WHERE id = group_id;
  
  -- Return existing code if present
  IF existing_code IS NOT NULL THEN
    RETURN existing_code;
  END IF;
  
  -- Generate new code
  new_code := generate_unique_invite_code();
  
  -- Update network with new code
  UPDATE public.network 
  SET invite_code = new_code 
  WHERE id = group_id;
  
  RETURN new_code;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_pending_community_members(p_community_id uuid, p_moderator_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, player_id uuid, request_type public.network_member_request_type, added_by uuid, created_at timestamp with time zone, player_name text, player_profile_picture text, referrer_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_moderator_id UUID;
  v_is_moderator BOOLEAN;
BEGIN
  -- Use provided moderator_id or get from auth
  v_moderator_id := COALESCE(p_moderator_id, auth.uid());
  
  IF v_moderator_id IS NULL THEN
    RAISE EXCEPTION 'Moderator ID is required';
  END IF;
  
  -- Verify the user is a moderator
  SELECT is_network_moderator(p_community_id, v_moderator_id) INTO v_is_moderator;
  
  IF NOT v_is_moderator THEN
    RAISE EXCEPTION 'Only moderators can view pending members';
  END IF;
  
  RETURN QUERY
  SELECT 
    nm.id,
    nm.player_id,
    nm.request_type,
    nm.added_by,
    nm.created_at,
    COALESCE(p.display_name, p.first_name || ' ' || COALESCE(p.last_name, '')) as player_name,
    p.profile_picture_url as player_profile_picture,
    COALESCE(r.display_name, r.first_name || ' ' || COALESCE(r.last_name, '')) as referrer_name
  FROM public.network_member nm
  JOIN public.profile p ON p.id = nm.player_id
  LEFT JOIN public.profile r ON r.id = nm.added_by AND nm.request_type = 'member_referral'
  WHERE nm.network_id = p_community_id
    AND nm.status = 'pending'
  ORDER BY nm.created_at ASC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_pending_score_confirmations(p_player_id uuid)
 RETURNS TABLE(match_result_id uuid, match_id uuid, match_date date, sport_name text, sport_icon_url text, winning_team integer, team1_score integer, team2_score integer, submitted_by_id uuid, submitted_by_name text, submitted_by_avatar text, confirmation_deadline timestamp with time zone, opponent_name text, opponent_avatar text, player_team integer, network_id uuid, network_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    mr.id as match_result_id,
    m.id as match_id,
    m.match_date as match_date,
    s.name::TEXT as sport_name,
    s.icon_url::TEXT as sport_icon_url,
    mr.winning_team,
    mr.team1_score,
    mr.team2_score,
    mr.submitted_by as submitted_by_id,
    COALESCE(sub_profile.display_name, sub_profile.first_name || ' ' || COALESCE(sub_profile.last_name, ''))::TEXT as submitted_by_name,
    sub_profile.profile_picture_url::TEXT as submitted_by_avatar,
    mr.confirmation_deadline,
    COALESCE(opp_profile.display_name, opp_profile.first_name || ' ' || COALESCE(opp_profile.last_name, ''))::TEXT as opponent_name,
    opp_profile.profile_picture_url::TEXT as opponent_avatar,
    my_part.team_number as player_team,
    mn.network_id,
    n.name::TEXT as network_name
  FROM match_result mr
  JOIN match m ON m.id = mr.match_id
  JOIN sport s ON s.id = m.sport_id
  JOIN match_participant my_part ON my_part.match_id = m.id AND my_part.player_id = p_player_id
  LEFT JOIN player sub_player ON sub_player.id = mr.submitted_by
  LEFT JOIN profile sub_profile ON sub_profile.id = sub_player.id
  LEFT JOIN match_participant opp_part ON opp_part.match_id = m.id AND opp_part.player_id != p_player_id
  LEFT JOIN player opp_player ON opp_player.id = opp_part.player_id
  LEFT JOIN profile opp_profile ON opp_profile.id = opp_player.id
  LEFT JOIN match_network mn ON mn.match_id = m.id
  LEFT JOIN network n ON n.id = mn.network_id
  WHERE 
    mr.is_verified = FALSE
    AND mr.disputed = FALSE
    AND mr.submitted_by != p_player_id
    AND mr.confirmation_deadline > NOW()
  ORDER BY mr.confirmation_deadline ASC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_player_communities(p_player_id uuid)
 RETURNS TABLE(id uuid, name text, description text, cover_image_url text, is_private boolean, member_count integer, created_by uuid, created_at timestamp with time zone, membership_status text, membership_role text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    n.id,
    n.name,
    n.description,
    n.cover_image_url,
    n.is_private,
    n.member_count,
    n.created_by,
    n.created_at,
    nm.status::TEXT as membership_status,
    nm.role::TEXT as membership_role
  FROM public.network n
  JOIN public.network_type nt ON n.network_type_id = nt.id
  JOIN public.network_member nm ON nm.network_id = n.id AND nm.player_id = p_player_id
  WHERE nt.name = 'community'
  ORDER BY n.name ASC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_player_online_status(player_uuid uuid)
 RETURNS TABLE(is_online boolean, last_seen timestamp with time zone)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT 
    p.last_seen_at > NOW() - INTERVAL '5 minutes' AS is_online,
    p.last_seen_at AS last_seen
  FROM public.player p
  WHERE p.id = player_uuid;
$function$
;

CREATE OR REPLACE FUNCTION public.get_players_by_play_attributes(p_sport_id uuid, p_play_attributes public.play_attribute_enum[])
 RETURNS TABLE(player_id uuid, play_style public.play_style_enum, play_attributes public.play_attribute_enum[], matching_attributes integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    ps.player_id,
    ps.preferred_play_style,
    ps.preferred_play_attributes,
    -- Count how many attributes match
    COALESCE(
      array_length(
        ARRAY(
          SELECT UNNEST(ps.preferred_play_attributes)
          INTERSECT
          SELECT UNNEST(p_play_attributes)
        ),
        1
      ),
      0
    ) AS matching_attributes
  FROM player_sport ps
  WHERE ps.sport_id = p_sport_id
    AND ps.preferred_play_attributes && p_play_attributes -- Has at least one matching attribute
    AND ps.is_active = TRUE
  ORDER BY matching_attributes DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_players_by_play_style(p_sport_id uuid, p_play_style public.play_style_enum)
 RETURNS TABLE(player_id uuid, play_style public.play_style_enum, play_attributes public.play_attribute_enum[])
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    ps.player_id,
    ps.preferred_play_style,
    ps.preferred_play_attributes
  FROM player_sport ps
  WHERE ps.sport_id = p_sport_id
    AND ps.preferred_play_style = p_play_style
    AND ps.is_active = TRUE;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_playing_hand_types()
 RETURNS TABLE(value text, label text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    enumlabel::TEXT AS value,
    CASE enumlabel::TEXT
      WHEN 'left' THEN 'Left'
      WHEN 'right' THEN 'Right'
      WHEN 'both' THEN 'Both'
      ELSE enumlabel::TEXT
    END AS label
  FROM pg_enum
  WHERE enumtypid = 'playing_hand'::regtype
  ORDER BY enumsortorder;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_proof_counts(p_player_rating_score_id uuid)
 RETURNS TABLE(total_proofs_count integer, current_level_proofs_count integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_current_rating_score_id UUID;
BEGIN
    -- Get the current rating_score_id
    SELECT rating_score_id INTO v_current_rating_score_id
    FROM player_rating_score
    WHERE id = p_player_rating_score_id;
    
    RETURN QUERY
    SELECT 
        COUNT(*)::INTEGER AS total_proofs_count,
        COUNT(*) FILTER (WHERE rp.rating_score_id = v_current_rating_score_id)::INTEGER AS current_level_proofs_count
    FROM rating_proof rp
    WHERE rp.player_rating_score_id = p_player_rating_score_id
    AND rp.is_active = true;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_public_communities(p_player_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, name text, description text, cover_image_url text, member_count integer, created_by uuid, created_at timestamp with time zone, is_member boolean, membership_status text, membership_role text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    n.id,
    n.name,
    n.description,
    n.cover_image_url,
    n.member_count,
    n.created_by,
    n.created_at,
    CASE WHEN nm.id IS NOT NULL THEN true ELSE false END as is_member,
    nm.status::TEXT as membership_status,
    nm.role::TEXT as membership_role
  FROM public.network n
  JOIN public.network_type nt ON n.network_type_id = nt.id
  LEFT JOIN public.network_member nm ON nm.network_id = n.id 
    AND nm.player_id = COALESCE(p_player_id, auth.uid())
  WHERE nt.name = 'community'
    AND n.is_private = false
  ORDER BY n.member_count DESC, n.created_at DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_rating_scores_by_type(p_sport_name text, p_rating_system_code public.rating_system_code_enum)
 RETURNS TABLE(id uuid, score_value numeric, display_label text, skill_level public.skill_level, description text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    rs.id,
    rs.value::NUMERIC as score_value,
    rs.label::TEXT as display_label,
    rs.skill_level,
    rs.description::TEXT
  FROM rating_score rs
  INNER JOIN rating_system rsys ON rs.rating_system_id = rsys.id
  INNER JOIN sport s ON rsys.sport_id = s.id
  WHERE s.name = p_sport_name
    AND rsys.code = p_rating_system_code
    AND rsys.is_active = TRUE
  ORDER BY rs.value ASC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_rating_systems_for_sport(p_sport_name text)
 RETURNS TABLE(id uuid, code public.rating_system_code_enum, name text, description text, min_value numeric, max_value numeric, step numeric, default_initial_value numeric, is_active boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    rsys.id,
    rsys.code,
    rsys.name::TEXT,
    rsys.description::TEXT,
    rsys.min_value,
    rsys.max_value,
    rsys.step,
    rsys.default_initial_value,
    rsys.is_active
  FROM rating_system rsys
  INNER JOIN sport s ON rsys.sport_id = s.id
  WHERE s.name = p_sport_name
    AND rsys.is_active = TRUE
  ORDER BY rsys.name ASC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_conversation_ids(user_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT conversation_id 
  FROM public.conversation_participant 
  WHERE player_id = user_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_created_match_ids(p_player_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
    SELECT id FROM match WHERE created_by = p_player_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_participating_match_ids(p_player_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
    SELECT match_id FROM match_participant WHERE player_id = p_player_id;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  provider text;
  full_name_raw text;
  first_name_val text;
  last_name_val text;
  display_name text;
  avatar_url text;
  user_email text;
BEGIN
  -- Determine provider (could be null for email/password)
  provider := COALESCE(new.raw_app_meta_data->>'provider', 'email');
  
  -- Default values
  full_name_raw := NULL;
  first_name_val := NULL;
  last_name_val := NULL;
  display_name := NULL;
  avatar_url := NULL;
  user_email := new.email;
  
  -- For Google/Microsoft OAuth: extract name fields from JWT metadata.
  -- Note: Apple is NOT included here because Apple's JWT token does NOT contain
  -- the user's name. For Apple, name fields are populated client-side after
  -- sign-in using the credential object from the native SDK.
  IF provider IN ('google', 'azure', 'microsoft') THEN
    IF new.raw_user_meta_data IS NOT NULL THEN
      full_name_raw := new.raw_user_meta_data->>'full_name';
      -- display_name (username) is NOT pre-filled — users set it during onboarding
      avatar_url := new.raw_user_meta_data->>'avatar_url';
      
      -- Try to get first_name and last_name from metadata
      first_name_val := new.raw_user_meta_data->>'given_name';
      last_name_val := new.raw_user_meta_data->>'family_name';
    END IF;
  END IF;
  
  -- If first_name not available from metadata, try to split full_name
  IF first_name_val IS NULL AND full_name_raw IS NOT NULL THEN
    IF position(' ' IN full_name_raw) > 0 THEN
      first_name_val := split_part(full_name_raw, ' ', 1);
      last_name_val := COALESCE(last_name_val, substring(full_name_raw FROM position(' ' IN full_name_raw) + 1));
    ELSE
      first_name_val := full_name_raw;
    END IF;
  END IF;
  
  -- For Google/Microsoft only: if we still don't have a first_name, use email prefix as last resort.
  -- For Apple and email signups: leave first_name NULL (Apple: set client-side; email: set during onboarding).
  IF provider IN ('google', 'azure', 'microsoft') AND (first_name_val IS NULL OR first_name_val = '') THEN
    first_name_val := COALESCE(
      NULLIF(split_part(new.email, '@', 1), ''),
      'User'
    );
  END IF;
  
  -- Insert into profile table
  -- Use ON CONFLICT to handle case where profile might already exist
  INSERT INTO public.profile (
    id,
    email,
    first_name,
    last_name,
    display_name,
    profile_picture_url,
    is_active,
    created_at,
    updated_at
  )
  VALUES (
    new.id,
    user_email,
    first_name_val,
    last_name_val,
    display_name,
    avatar_url,
    true,
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(EXCLUDED.email, profile.email),
    updated_at = now();
  
  RETURN new;
EXCEPTION
  WHEN others THEN
    RAISE WARNING 'Error in handle_new_user: % - SQLSTATE: %', SQLERRM, SQLSTATE;
    RETURN new;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.insert_notification(p_user_id uuid, p_type text, p_target_id uuid DEFAULT NULL::uuid, p_title text DEFAULT 'Notification'::text, p_body text DEFAULT NULL::text, p_payload jsonb DEFAULT '{}'::jsonb, p_priority text DEFAULT 'normal'::text, p_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS public.notification
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result notification;
BEGIN
  INSERT INTO notification (
    user_id, type, target_id, title, body, payload, priority, scheduled_at, expires_at
  ) VALUES (
    p_user_id, p_type::notification_type_enum, p_target_id, p_title, p_body, p_payload, p_priority::notification_priority_enum, p_scheduled_at, p_expires_at
  )
  RETURNING * INTO result;
  
  RETURN result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.insert_notifications(p_notifications jsonb)
 RETURNS SETOF public.notification
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  INSERT INTO notification (
    user_id, type, target_id, title, body, payload, priority, scheduled_at, expires_at, organization_id
  )
  SELECT 
    (n->>'user_id')::UUID,
    (n->>'type')::notification_type_enum,
    (n->>'target_id')::UUID,
    COALESCE(n->>'title', 'Notification'),
    n->>'body',
    COALESCE((n->'payload')::JSONB, '{}'),
    COALESCE((n->>'priority')::notification_priority_enum, 'normal'),
    (n->>'scheduled_at')::TIMESTAMPTZ,
    (n->>'expires_at')::TIMESTAMPTZ,
    (n->>'organization_id')::UUID
  FROM jsonb_array_elements(p_notifications) AS n
  RETURNING *;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_match_creator(p_match_id uuid, p_player_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM match
        WHERE id = p_match_id AND created_by = p_player_id
    );
$function$
;

CREATE OR REPLACE FUNCTION public.is_match_participant(p_match_id uuid, p_player_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM match_participant
        WHERE match_id = p_match_id AND player_id = p_player_id
    );
$function$
;

CREATE OR REPLACE FUNCTION public.is_network_member(network_id_param uuid, user_id_param uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.network_member
    WHERE network_id = network_id_param
    AND player_id = user_id_param
    AND status = 'active'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_player_online(player_uuid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.player 
    WHERE id = player_uuid 
    AND last_seen_at > NOW() - INTERVAL '5 minutes'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_public_match(p_match_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM match
        WHERE id = p_match_id AND visibility = 'public'
    );
$function$
;

CREATE OR REPLACE FUNCTION public.join_group_by_invite_code(p_invite_code character varying, p_player_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_network_id UUID;
  v_network_type_id UUID;
  v_player_group_type_id UUID;
  v_is_member BOOLEAN;
  v_group_name VARCHAR(255);
BEGIN
  -- Get player_group network type id
  SELECT id INTO v_player_group_type_id 
  FROM public.network_type 
  WHERE name = 'player_group';
  
  -- Find the group by invite code
  SELECT id, network_type_id, name INTO v_network_id, v_network_type_id, v_group_name
  FROM public.network 
  WHERE invite_code = UPPER(p_invite_code);
  
  -- Check if group exists
  IF v_network_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid invite code'
    );
  END IF;
  
  -- Verify it's a player group (not a club)
  IF v_network_type_id != v_player_group_type_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid invite code'
    );
  END IF;
  
  -- Check if already a member
  SELECT EXISTS(
    SELECT 1 FROM public.network_member 
    WHERE network_id = v_network_id 
    AND player_id = p_player_id 
    AND status = 'active'
  ) INTO v_is_member;
  
  IF v_is_member THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'You are already a member of this group'
    );
  END IF;
  
  -- Add player to group
  INSERT INTO public.network_member (network_id, player_id, role, status, added_by, joined_at)
  VALUES (v_network_id, p_player_id, 'member', 'active', NULL, NOW())
  ON CONFLICT (network_id, player_id) 
  DO UPDATE SET status = 'active', joined_at = NOW();
  
  -- Update member count
  UPDATE public.network 
  SET member_count = (
    SELECT COUNT(*) FROM public.network_member 
    WHERE network_id = v_network_id AND status = 'active'
  )
  WHERE id = v_network_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'group_id', v_network_id,
    'group_name', v_group_name
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_new_invitation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  request_id bigint;
  functions_url TEXT;
  anon_key TEXT;
  error_msg TEXT;
BEGIN
  -- Skip if no email (email is required for sending invitations)
  IF NEW.email IS NULL THEN
    RAISE NOTICE 'Skipping email trigger for invitation %: no email address', NEW.id;
    RETURN NEW;
  END IF;

  -- Get secrets from Vault
  SELECT decrypted_secret INTO functions_url 
  FROM vault.decrypted_secrets 
  WHERE name = 'supabase_functions_url' 
  LIMIT 1;
  
  SELECT decrypted_secret INTO anon_key 
  FROM vault.decrypted_secrets 
  WHERE name = 'anon_key' 
  LIMIT 1;

  -- Check if secrets are missing
  IF functions_url IS NULL THEN
    RAISE WARNING 'Cannot send invitation email: supabase_functions_url secret not found in Vault';
    RETURN NEW;
  END IF;

  IF anon_key IS NULL THEN
    RAISE WARNING 'Cannot send invitation email: anon_key secret not found in Vault';
    RETURN NEW;
  END IF;

  -- Log the attempt
  RAISE NOTICE 'Triggering email for invitation % to % (org: %)', NEW.id, NEW.email, COALESCE(NEW.organization_id::text, 'none');

  -- Call send-email Edge Function with Bearer auth (publishable key)
  BEGIN
    SELECT INTO request_id net.http_post(
      url := functions_url || '/functions/v1/send-email',
      body := jsonb_build_object(
        'id', NEW.id,
        'email', NEW.email,
        'phone', NEW.phone,
        'role', NEW.role,
        'admin_role', NEW.admin_role,
        'token', NEW.token,
        'status', NEW.status,
        'inviter_id', NEW.inviter_id,
        'invited_user_id', NEW.invited_user_id,
        'organization_id', NEW.organization_id,
        'source', NEW.source,
        'expires_at', NEW.expires_at,
        'metadata', NEW.metadata,
        'emailType', 'invitation'
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key
      ),
      timeout_milliseconds := 10000
    );

    RAISE NOTICE 'Edge function called successfully with request_id: % for invitation %', request_id, NEW.id;
  EXCEPTION
    WHEN OTHERS THEN
      error_msg := SQLERRM;
      RAISE WARNING 'Error calling edge function for invitation %: %', NEW.id, error_msg;
      RAISE WARNING 'Functions URL: %, Anon key present: %', 
        COALESCE(functions_url, 'NULL'), 
        CASE WHEN anon_key IS NOT NULL THEN 'YES' ELSE 'NO' END;
  END;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.refer_player_to_community(p_community_id uuid, p_referred_player_id uuid, p_referrer_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_referrer_id UUID;
  v_is_referrer_member BOOLEAN;
  v_existing_member UUID;
  v_member_id UUID;
BEGIN
  -- Use provided referrer_id or get from auth
  v_referrer_id := COALESCE(p_referrer_id, auth.uid());
  
  IF v_referrer_id IS NULL THEN
    RAISE EXCEPTION 'Referrer ID is required';
  END IF;
  
  -- Verify the referrer is an active member
  SELECT EXISTS(
    SELECT 1 FROM public.network_member
    WHERE network_id = p_community_id 
      AND player_id = v_referrer_id 
      AND status = 'active'
  ) INTO v_is_referrer_member;
  
  IF NOT v_is_referrer_member THEN
    RAISE EXCEPTION 'Only active members can refer other players';
  END IF;
  
  -- Check if player is already a member or has pending request
  SELECT id INTO v_existing_member
  FROM public.network_member
  WHERE network_id = p_community_id AND player_id = p_referred_player_id;
  
  IF v_existing_member IS NOT NULL THEN
    RAISE EXCEPTION 'Player is already a member or has a pending request';
  END IF;
  
  -- Create pending membership referral
  INSERT INTO public.network_member (
    network_id, 
    player_id, 
    status, 
    role, 
    request_type,
    added_by
  )
  VALUES (
    p_community_id, 
    p_referred_player_id, 
    'pending', 
    'member', 
    'member_referral',
    v_referrer_id
  )
  RETURNING id INTO v_member_id;
  
  -- Log activity
  INSERT INTO public.network_activity (
    network_id,
    activity_type,
    actor_id,
    target_id,
    metadata
  ) VALUES (
    p_community_id,
    'member_joined',
    v_referrer_id,
    p_referred_player_id,
    jsonb_build_object('status', 'pending', 'request_type', 'member_referral')
  );
  
  RETURN v_member_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reject_community_member(p_community_id uuid, p_member_id uuid, p_rejector_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_rejector_id UUID;
  v_is_moderator BOOLEAN;
  v_target_player_id UUID;
BEGIN
  -- Use provided rejector_id or get from auth
  v_rejector_id := COALESCE(p_rejector_id, auth.uid());
  
  IF v_rejector_id IS NULL THEN
    RAISE EXCEPTION 'Rejector ID is required';
  END IF;
  
  -- Verify the rejector is a moderator
  SELECT is_network_moderator(p_community_id, v_rejector_id) INTO v_is_moderator;
  
  IF NOT v_is_moderator THEN
    RAISE EXCEPTION 'Only moderators can reject members';
  END IF;
  
  -- Get target player ID
  SELECT player_id INTO v_target_player_id
  FROM public.network_member
  WHERE id = p_member_id AND network_id = p_community_id AND status = 'pending';
  
  IF v_target_player_id IS NULL THEN
    RAISE EXCEPTION 'Pending membership not found';
  END IF;
  
  -- Delete the membership request
  DELETE FROM public.network_member
  WHERE id = p_member_id;
  
  RETURN true;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.request_to_join_community(p_community_id uuid, p_player_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_player_id UUID;
  v_network_type TEXT;
  v_is_private BOOLEAN;
  v_existing_member UUID;
  v_member_id UUID;
BEGIN
  -- Use provided player_id or get from auth
  v_player_id := COALESCE(p_player_id, auth.uid());
  
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'Player ID is required';
  END IF;
  
  -- Verify this is a public community
  SELECT nt.name, n.is_private INTO v_network_type, v_is_private
  FROM public.network n
  JOIN public.network_type nt ON n.network_type_id = nt.id
  WHERE n.id = p_community_id;
  
  IF v_network_type IS NULL THEN
    RAISE EXCEPTION 'Community not found';
  END IF;
  
  IF v_network_type != 'community' THEN
    RAISE EXCEPTION 'This is not a community';
  END IF;
  
  IF v_is_private = true THEN
    RAISE EXCEPTION 'Cannot request to join a private community';
  END IF;
  
  -- Check if already a member or has pending request
  SELECT id INTO v_existing_member
  FROM public.network_member
  WHERE network_id = p_community_id AND player_id = v_player_id;
  
  IF v_existing_member IS NOT NULL THEN
    RAISE EXCEPTION 'Already a member or have a pending request';
  END IF;
  
  -- Create pending membership request
  INSERT INTO public.network_member (
    network_id, 
    player_id, 
    status, 
    role, 
    request_type,
    added_by
  )
  VALUES (
    p_community_id, 
    v_player_id, 
    'pending', 
    'member', 
    'join_request',
    v_player_id  -- Self-requested
  )
  RETURNING id INTO v_member_id;
  
  -- Log activity
  INSERT INTO public.network_activity (
    network_id,
    activity_type,
    actor_id,
    target_id,
    metadata
  ) VALUES (
    p_community_id,
    'member_joined',
    v_player_id,
    v_player_id,
    jsonb_build_object('status', 'pending', 'request_type', 'join_request')
  );
  
  RETURN v_member_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reset_group_invite_code(p_group_id uuid, p_moderator_id uuid)
 RETURNS character varying
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_is_moderator BOOLEAN;
  new_code VARCHAR(12);
BEGIN
  -- Check if user is a moderator
  SELECT EXISTS(
    SELECT 1 FROM public.network_member 
    WHERE network_id = p_group_id 
    AND player_id = p_moderator_id 
    AND status = 'active'
    AND role = 'moderator'
  ) INTO v_is_moderator;
  
  IF NOT v_is_moderator THEN
    RAISE EXCEPTION 'Only moderators can reset the invite code';
  END IF;
  
  -- Generate new code
  new_code := generate_unique_invite_code();
  
  -- Update network with new code
  UPDATE public.network 
  SET invite_code = new_code 
  WHERE id = p_group_id;
  
  RETURN new_code;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_conversation_messages(p_conversation_id uuid, p_query text, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, conversation_id uuid, sender_id uuid, content text, created_at timestamp with time zone, rank real)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT 
    m.id,
    m.conversation_id,
    m.sender_id,
    m.content,
    m.created_at,
    ts_rank(m.search_vector, plainto_tsquery('english', p_query)) AS rank
  FROM public.message m
  WHERE m.conversation_id = p_conversation_id
    AND m.deleted_at IS NULL
    AND m.search_vector @@ plainto_tsquery('english', p_query)
  ORDER BY rank DESC, m.created_at DESC
  LIMIT p_limit;
$function$
;

CREATE OR REPLACE FUNCTION public.search_matches_nearby(p_latitude double precision, p_longitude double precision, p_max_distance_km double precision, p_sport_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_user_gender text DEFAULT NULL::text)
 RETURNS TABLE(match_id uuid, distance_meters double precision)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  current_time_utc TIMESTAMPTZ := NOW();
  v_user_point extensions.geography;
BEGIN
  v_user_point := extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::extensions.geography;

  RETURN QUERY
  SELECT
    m.id AS match_id,
    CASE
      WHEN m.location_type = 'facility' AND f.location IS NOT NULL THEN
        extensions.ST_Distance(f.location, v_user_point)
      WHEN m.location_type = 'custom' AND m.custom_latitude IS NOT NULL AND m.custom_longitude IS NOT NULL THEN
        extensions.ST_Distance(
          extensions.ST_SetSRID(extensions.ST_MakePoint(m.custom_longitude, m.custom_latitude), 4326)::extensions.geography,
          v_user_point
        )
      ELSE
        NULL
    END AS distance_meters
  FROM match m
  LEFT JOIN facility f ON f.id = m.facility_id
  WHERE m.visibility = 'public'
    AND m.cancelled_at IS NULL
    AND m.sport_id = p_sport_id
    AND (
      (m.location_type = 'facility' AND f.is_active = TRUE AND f.location IS NOT NULL)
      OR (m.location_type = 'custom' AND m.custom_latitude IS NOT NULL AND m.custom_longitude IS NOT NULL)
    )
    AND (
      (m.location_type = 'facility' AND extensions.ST_DWithin(
        f.location,
        v_user_point,
        p_max_distance_km * 1000
      ))
      OR
      (m.location_type = 'custom' AND extensions.ST_DWithin(
        extensions.ST_SetSRID(extensions.ST_MakePoint(m.custom_longitude, m.custom_latitude), 4326)::extensions.geography,
        v_user_point,
        p_max_distance_km * 1000
      ))
    )
    AND (
      CASE
        WHEN m.timezone IS NOT NULL THEN
          timezone(m.timezone, (m.match_date + m.start_time)::timestamp) > current_time_utc
        ELSE
          (m.match_date + m.start_time)::timestamp > (current_time_utc AT TIME ZONE 'UTC')::timestamp
      END
    )
    AND (
      p_user_gender IS NULL
      OR m.preferred_opponent_gender IS NULL
      OR m.preferred_opponent_gender = p_user_gender::gender_enum
    )
  ORDER BY
    (m.match_date + m.start_time)::timestamp ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_rating_score_id_on_proof_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- If rating_score_id is not provided, get it from the player_rating_score
    IF NEW.rating_score_id IS NULL THEN
        SELECT rating_score_id INTO NEW.rating_score_id
        FROM player_rating_score
        WHERE id = NEW.player_rating_score_id;
    END IF;
    
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_approved_proofs_count()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Update the count on the player_rating_score
    UPDATE player_rating_score
    SET approved_proofs_count = (
        SELECT COUNT(*)
        FROM rating_proof
        WHERE player_rating_score_id = COALESCE(NEW.player_rating_score_id, OLD.player_rating_score_id)
        AND status = 'approved'
        AND is_active = true
    )
    WHERE id = COALESCE(NEW.player_rating_score_id, OLD.player_rating_score_id);
    
    RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_message_search_vector()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.search_vector := to_tsvector('english', COALESCE(NEW.content, ''));
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_network_member_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  target_network_id UUID;
BEGIN
  -- Determine which network to update
  IF TG_OP = 'DELETE' THEN
    target_network_id := OLD.network_id;
  ELSE
    target_network_id := NEW.network_id;
  END IF;
  
  -- Update the member count
  UPDATE public.network
  SET member_count = (
    SELECT COUNT(*) 
    FROM public.network_member 
    WHERE network_id = target_network_id 
    AND status = 'active'
  )
  WHERE id = target_network_id;
  
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_notification_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_player_favorite_facility_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_player_last_seen()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  UPDATE public.player 
  SET last_seen_at = NOW() 
  WHERE id = auth.uid();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_referrals_count_on_reference()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Only process when status changes to 'accepted' and rating_supported is true
    IF NEW.status = 'accepted' AND NEW.rating_supported = true THEN
        UPDATE player_rating_score
        SET referrals_count = referrals_count + 1
        WHERE id = NEW.player_rating_score_id;
    END IF;
    
    -- Handle case where reference was accepted but now declined/expired
    IF OLD.status = 'accepted' AND OLD.rating_supported = true 
       AND (NEW.status != 'accepted' OR NEW.rating_supported = false) THEN
        UPDATE player_rating_score
        SET referrals_count = GREATEST(0, referrals_count - 1)
        WHERE id = NEW.player_rating_score_id;
    END IF;
    
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_shared_contact_list_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.shared_contact_list 
    SET contact_count = contact_count + 1, updated_at = NOW()
    WHERE id = NEW.list_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.shared_contact_list 
    SET contact_count = contact_count - 1, updated_at = NOW()
    WHERE id = OLD.list_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_shared_contact_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

grant delete on table "public"."availability_block" to "anon";

grant insert on table "public"."availability_block" to "anon";

grant references on table "public"."availability_block" to "anon";

grant select on table "public"."availability_block" to "anon";

grant trigger on table "public"."availability_block" to "anon";

grant truncate on table "public"."availability_block" to "anon";

grant update on table "public"."availability_block" to "anon";

grant delete on table "public"."availability_block" to "authenticated";

grant insert on table "public"."availability_block" to "authenticated";

grant references on table "public"."availability_block" to "authenticated";

grant select on table "public"."availability_block" to "authenticated";

grant trigger on table "public"."availability_block" to "authenticated";

grant truncate on table "public"."availability_block" to "authenticated";

grant update on table "public"."availability_block" to "authenticated";

grant delete on table "public"."availability_block" to "service_role";

grant insert on table "public"."availability_block" to "service_role";

grant references on table "public"."availability_block" to "service_role";

grant select on table "public"."availability_block" to "service_role";

grant trigger on table "public"."availability_block" to "service_role";

grant truncate on table "public"."availability_block" to "service_role";

grant update on table "public"."availability_block" to "service_role";

grant delete on table "public"."beta_signup" to "anon";

grant insert on table "public"."beta_signup" to "anon";

grant references on table "public"."beta_signup" to "anon";

grant select on table "public"."beta_signup" to "anon";

grant trigger on table "public"."beta_signup" to "anon";

grant truncate on table "public"."beta_signup" to "anon";

grant update on table "public"."beta_signup" to "anon";

grant delete on table "public"."beta_signup" to "authenticated";

grant insert on table "public"."beta_signup" to "authenticated";

grant references on table "public"."beta_signup" to "authenticated";

grant select on table "public"."beta_signup" to "authenticated";

grant trigger on table "public"."beta_signup" to "authenticated";

grant truncate on table "public"."beta_signup" to "authenticated";

grant update on table "public"."beta_signup" to "authenticated";

grant delete on table "public"."beta_signup" to "service_role";

grant insert on table "public"."beta_signup" to "service_role";

grant references on table "public"."beta_signup" to "service_role";

grant select on table "public"."beta_signup" to "service_role";

grant trigger on table "public"."beta_signup" to "service_role";

grant truncate on table "public"."beta_signup" to "service_role";

grant update on table "public"."beta_signup" to "service_role";

grant delete on table "public"."cancellation_policy" to "anon";

grant insert on table "public"."cancellation_policy" to "anon";

grant references on table "public"."cancellation_policy" to "anon";

grant select on table "public"."cancellation_policy" to "anon";

grant trigger on table "public"."cancellation_policy" to "anon";

grant truncate on table "public"."cancellation_policy" to "anon";

grant update on table "public"."cancellation_policy" to "anon";

grant delete on table "public"."cancellation_policy" to "authenticated";

grant insert on table "public"."cancellation_policy" to "authenticated";

grant references on table "public"."cancellation_policy" to "authenticated";

grant select on table "public"."cancellation_policy" to "authenticated";

grant trigger on table "public"."cancellation_policy" to "authenticated";

grant truncate on table "public"."cancellation_policy" to "authenticated";

grant update on table "public"."cancellation_policy" to "authenticated";

grant delete on table "public"."cancellation_policy" to "service_role";

grant insert on table "public"."cancellation_policy" to "service_role";

grant references on table "public"."cancellation_policy" to "service_role";

grant select on table "public"."cancellation_policy" to "service_role";

grant trigger on table "public"."cancellation_policy" to "service_role";

grant truncate on table "public"."cancellation_policy" to "service_role";

grant update on table "public"."cancellation_policy" to "service_role";

grant delete on table "public"."court_one_time_availability" to "anon";

grant insert on table "public"."court_one_time_availability" to "anon";

grant references on table "public"."court_one_time_availability" to "anon";

grant select on table "public"."court_one_time_availability" to "anon";

grant trigger on table "public"."court_one_time_availability" to "anon";

grant truncate on table "public"."court_one_time_availability" to "anon";

grant update on table "public"."court_one_time_availability" to "anon";

grant delete on table "public"."court_one_time_availability" to "authenticated";

grant insert on table "public"."court_one_time_availability" to "authenticated";

grant references on table "public"."court_one_time_availability" to "authenticated";

grant select on table "public"."court_one_time_availability" to "authenticated";

grant trigger on table "public"."court_one_time_availability" to "authenticated";

grant truncate on table "public"."court_one_time_availability" to "authenticated";

grant update on table "public"."court_one_time_availability" to "authenticated";

grant delete on table "public"."court_one_time_availability" to "service_role";

grant insert on table "public"."court_one_time_availability" to "service_role";

grant references on table "public"."court_one_time_availability" to "service_role";

grant select on table "public"."court_one_time_availability" to "service_role";

grant trigger on table "public"."court_one_time_availability" to "service_role";

grant truncate on table "public"."court_one_time_availability" to "service_role";

grant update on table "public"."court_one_time_availability" to "service_role";

grant delete on table "public"."instructor_profile" to "anon";

grant insert on table "public"."instructor_profile" to "anon";

grant references on table "public"."instructor_profile" to "anon";

grant select on table "public"."instructor_profile" to "anon";

grant trigger on table "public"."instructor_profile" to "anon";

grant truncate on table "public"."instructor_profile" to "anon";

grant update on table "public"."instructor_profile" to "anon";

grant delete on table "public"."instructor_profile" to "authenticated";

grant insert on table "public"."instructor_profile" to "authenticated";

grant references on table "public"."instructor_profile" to "authenticated";

grant select on table "public"."instructor_profile" to "authenticated";

grant trigger on table "public"."instructor_profile" to "authenticated";

grant truncate on table "public"."instructor_profile" to "authenticated";

grant update on table "public"."instructor_profile" to "authenticated";

grant delete on table "public"."instructor_profile" to "service_role";

grant insert on table "public"."instructor_profile" to "service_role";

grant references on table "public"."instructor_profile" to "service_role";

grant select on table "public"."instructor_profile" to "service_role";

grant trigger on table "public"."instructor_profile" to "service_role";

grant truncate on table "public"."instructor_profile" to "service_role";

grant update on table "public"."instructor_profile" to "service_role";

grant delete on table "public"."match_feedback" to "anon";

grant insert on table "public"."match_feedback" to "anon";

grant references on table "public"."match_feedback" to "anon";

grant select on table "public"."match_feedback" to "anon";

grant trigger on table "public"."match_feedback" to "anon";

grant truncate on table "public"."match_feedback" to "anon";

grant update on table "public"."match_feedback" to "anon";

grant delete on table "public"."match_feedback" to "authenticated";

grant insert on table "public"."match_feedback" to "authenticated";

grant references on table "public"."match_feedback" to "authenticated";

grant select on table "public"."match_feedback" to "authenticated";

grant trigger on table "public"."match_feedback" to "authenticated";

grant truncate on table "public"."match_feedback" to "authenticated";

grant update on table "public"."match_feedback" to "authenticated";

grant delete on table "public"."match_feedback" to "service_role";

grant insert on table "public"."match_feedback" to "service_role";

grant references on table "public"."match_feedback" to "service_role";

grant select on table "public"."match_feedback" to "service_role";

grant trigger on table "public"."match_feedback" to "service_role";

grant truncate on table "public"."match_feedback" to "service_role";

grant update on table "public"."match_feedback" to "service_role";

grant delete on table "public"."match_report" to "anon";

grant insert on table "public"."match_report" to "anon";

grant references on table "public"."match_report" to "anon";

grant select on table "public"."match_report" to "anon";

grant trigger on table "public"."match_report" to "anon";

grant truncate on table "public"."match_report" to "anon";

grant update on table "public"."match_report" to "anon";

grant delete on table "public"."match_report" to "authenticated";

grant insert on table "public"."match_report" to "authenticated";

grant references on table "public"."match_report" to "authenticated";

grant select on table "public"."match_report" to "authenticated";

grant trigger on table "public"."match_report" to "authenticated";

grant truncate on table "public"."match_report" to "authenticated";

grant update on table "public"."match_report" to "authenticated";

grant delete on table "public"."match_report" to "service_role";

grant insert on table "public"."match_report" to "service_role";

grant references on table "public"."match_report" to "service_role";

grant select on table "public"."match_report" to "service_role";

grant trigger on table "public"."match_report" to "service_role";

grant truncate on table "public"."match_report" to "service_role";

grant update on table "public"."match_report" to "service_role";

grant delete on table "public"."organization_notification_preference" to "anon";

grant insert on table "public"."organization_notification_preference" to "anon";

grant references on table "public"."organization_notification_preference" to "anon";

grant select on table "public"."organization_notification_preference" to "anon";

grant trigger on table "public"."organization_notification_preference" to "anon";

grant truncate on table "public"."organization_notification_preference" to "anon";

grant update on table "public"."organization_notification_preference" to "anon";

grant delete on table "public"."organization_notification_preference" to "authenticated";

grant insert on table "public"."organization_notification_preference" to "authenticated";

grant references on table "public"."organization_notification_preference" to "authenticated";

grant select on table "public"."organization_notification_preference" to "authenticated";

grant trigger on table "public"."organization_notification_preference" to "authenticated";

grant truncate on table "public"."organization_notification_preference" to "authenticated";

grant update on table "public"."organization_notification_preference" to "authenticated";

grant delete on table "public"."organization_notification_preference" to "service_role";

grant insert on table "public"."organization_notification_preference" to "service_role";

grant references on table "public"."organization_notification_preference" to "service_role";

grant select on table "public"."organization_notification_preference" to "service_role";

grant trigger on table "public"."organization_notification_preference" to "service_role";

grant truncate on table "public"."organization_notification_preference" to "service_role";

grant update on table "public"."organization_notification_preference" to "service_role";

grant delete on table "public"."organization_notification_recipient" to "anon";

grant insert on table "public"."organization_notification_recipient" to "anon";

grant references on table "public"."organization_notification_recipient" to "anon";

grant select on table "public"."organization_notification_recipient" to "anon";

grant trigger on table "public"."organization_notification_recipient" to "anon";

grant truncate on table "public"."organization_notification_recipient" to "anon";

grant update on table "public"."organization_notification_recipient" to "anon";

grant delete on table "public"."organization_notification_recipient" to "authenticated";

grant insert on table "public"."organization_notification_recipient" to "authenticated";

grant references on table "public"."organization_notification_recipient" to "authenticated";

grant select on table "public"."organization_notification_recipient" to "authenticated";

grant trigger on table "public"."organization_notification_recipient" to "authenticated";

grant truncate on table "public"."organization_notification_recipient" to "authenticated";

grant update on table "public"."organization_notification_recipient" to "authenticated";

grant delete on table "public"."organization_notification_recipient" to "service_role";

grant insert on table "public"."organization_notification_recipient" to "service_role";

grant references on table "public"."organization_notification_recipient" to "service_role";

grant select on table "public"."organization_notification_recipient" to "service_role";

grant trigger on table "public"."organization_notification_recipient" to "service_role";

grant truncate on table "public"."organization_notification_recipient" to "service_role";

grant update on table "public"."organization_notification_recipient" to "service_role";

grant delete on table "public"."organization_player_block" to "anon";

grant insert on table "public"."organization_player_block" to "anon";

grant references on table "public"."organization_player_block" to "anon";

grant select on table "public"."organization_player_block" to "anon";

grant trigger on table "public"."organization_player_block" to "anon";

grant truncate on table "public"."organization_player_block" to "anon";

grant update on table "public"."organization_player_block" to "anon";

grant delete on table "public"."organization_player_block" to "authenticated";

grant insert on table "public"."organization_player_block" to "authenticated";

grant references on table "public"."organization_player_block" to "authenticated";

grant select on table "public"."organization_player_block" to "authenticated";

grant trigger on table "public"."organization_player_block" to "authenticated";

grant truncate on table "public"."organization_player_block" to "authenticated";

grant update on table "public"."organization_player_block" to "authenticated";

grant delete on table "public"."organization_player_block" to "service_role";

grant insert on table "public"."organization_player_block" to "service_role";

grant references on table "public"."organization_player_block" to "service_role";

grant select on table "public"."organization_player_block" to "service_role";

grant trigger on table "public"."organization_player_block" to "service_role";

grant truncate on table "public"."organization_player_block" to "service_role";

grant update on table "public"."organization_player_block" to "service_role";

grant delete on table "public"."organization_settings" to "anon";

grant insert on table "public"."organization_settings" to "anon";

grant references on table "public"."organization_settings" to "anon";

grant select on table "public"."organization_settings" to "anon";

grant trigger on table "public"."organization_settings" to "anon";

grant truncate on table "public"."organization_settings" to "anon";

grant update on table "public"."organization_settings" to "anon";

grant delete on table "public"."organization_settings" to "authenticated";

grant insert on table "public"."organization_settings" to "authenticated";

grant references on table "public"."organization_settings" to "authenticated";

grant select on table "public"."organization_settings" to "authenticated";

grant trigger on table "public"."organization_settings" to "authenticated";

grant truncate on table "public"."organization_settings" to "authenticated";

grant update on table "public"."organization_settings" to "authenticated";

grant delete on table "public"."organization_settings" to "service_role";

grant insert on table "public"."organization_settings" to "service_role";

grant references on table "public"."organization_settings" to "service_role";

grant select on table "public"."organization_settings" to "service_role";

grant trigger on table "public"."organization_settings" to "service_role";

grant truncate on table "public"."organization_settings" to "service_role";

grant update on table "public"."organization_settings" to "service_role";

grant delete on table "public"."organization_stripe_account" to "anon";

grant insert on table "public"."organization_stripe_account" to "anon";

grant references on table "public"."organization_stripe_account" to "anon";

grant select on table "public"."organization_stripe_account" to "anon";

grant trigger on table "public"."organization_stripe_account" to "anon";

grant truncate on table "public"."organization_stripe_account" to "anon";

grant update on table "public"."organization_stripe_account" to "anon";

grant delete on table "public"."organization_stripe_account" to "authenticated";

grant insert on table "public"."organization_stripe_account" to "authenticated";

grant references on table "public"."organization_stripe_account" to "authenticated";

grant select on table "public"."organization_stripe_account" to "authenticated";

grant trigger on table "public"."organization_stripe_account" to "authenticated";

grant truncate on table "public"."organization_stripe_account" to "authenticated";

grant update on table "public"."organization_stripe_account" to "authenticated";

grant delete on table "public"."organization_stripe_account" to "service_role";

grant insert on table "public"."organization_stripe_account" to "service_role";

grant references on table "public"."organization_stripe_account" to "service_role";

grant select on table "public"."organization_stripe_account" to "service_role";

grant trigger on table "public"."organization_stripe_account" to "service_role";

grant truncate on table "public"."organization_stripe_account" to "service_role";

grant update on table "public"."organization_stripe_account" to "service_role";

grant delete on table "public"."player_reputation" to "anon";

grant insert on table "public"."player_reputation" to "anon";

grant references on table "public"."player_reputation" to "anon";

grant select on table "public"."player_reputation" to "anon";

grant trigger on table "public"."player_reputation" to "anon";

grant truncate on table "public"."player_reputation" to "anon";

grant update on table "public"."player_reputation" to "anon";

grant delete on table "public"."player_reputation" to "authenticated";

grant insert on table "public"."player_reputation" to "authenticated";

grant references on table "public"."player_reputation" to "authenticated";

grant select on table "public"."player_reputation" to "authenticated";

grant trigger on table "public"."player_reputation" to "authenticated";

grant truncate on table "public"."player_reputation" to "authenticated";

grant update on table "public"."player_reputation" to "authenticated";

grant delete on table "public"."player_reputation" to "service_role";

grant insert on table "public"."player_reputation" to "service_role";

grant references on table "public"."player_reputation" to "service_role";

grant select on table "public"."player_reputation" to "service_role";

grant trigger on table "public"."player_reputation" to "service_role";

grant truncate on table "public"."player_reputation" to "service_role";

grant update on table "public"."player_reputation" to "service_role";

grant delete on table "public"."pricing_rule" to "anon";

grant insert on table "public"."pricing_rule" to "anon";

grant references on table "public"."pricing_rule" to "anon";

grant select on table "public"."pricing_rule" to "anon";

grant trigger on table "public"."pricing_rule" to "anon";

grant truncate on table "public"."pricing_rule" to "anon";

grant update on table "public"."pricing_rule" to "anon";

grant delete on table "public"."pricing_rule" to "authenticated";

grant insert on table "public"."pricing_rule" to "authenticated";

grant references on table "public"."pricing_rule" to "authenticated";

grant select on table "public"."pricing_rule" to "authenticated";

grant trigger on table "public"."pricing_rule" to "authenticated";

grant truncate on table "public"."pricing_rule" to "authenticated";

grant update on table "public"."pricing_rule" to "authenticated";

grant delete on table "public"."pricing_rule" to "service_role";

grant insert on table "public"."pricing_rule" to "service_role";

grant references on table "public"."pricing_rule" to "service_role";

grant select on table "public"."pricing_rule" to "service_role";

grant trigger on table "public"."pricing_rule" to "service_role";

grant truncate on table "public"."pricing_rule" to "service_role";

grant update on table "public"."pricing_rule" to "service_role";

grant delete on table "public"."program" to "anon";

grant insert on table "public"."program" to "anon";

grant references on table "public"."program" to "anon";

grant select on table "public"."program" to "anon";

grant trigger on table "public"."program" to "anon";

grant truncate on table "public"."program" to "anon";

grant update on table "public"."program" to "anon";

grant delete on table "public"."program" to "authenticated";

grant insert on table "public"."program" to "authenticated";

grant references on table "public"."program" to "authenticated";

grant select on table "public"."program" to "authenticated";

grant trigger on table "public"."program" to "authenticated";

grant truncate on table "public"."program" to "authenticated";

grant update on table "public"."program" to "authenticated";

grant delete on table "public"."program" to "service_role";

grant insert on table "public"."program" to "service_role";

grant references on table "public"."program" to "service_role";

grant select on table "public"."program" to "service_role";

grant trigger on table "public"."program" to "service_role";

grant truncate on table "public"."program" to "service_role";

grant update on table "public"."program" to "service_role";

grant delete on table "public"."program_instructor" to "anon";

grant insert on table "public"."program_instructor" to "anon";

grant references on table "public"."program_instructor" to "anon";

grant select on table "public"."program_instructor" to "anon";

grant trigger on table "public"."program_instructor" to "anon";

grant truncate on table "public"."program_instructor" to "anon";

grant update on table "public"."program_instructor" to "anon";

grant delete on table "public"."program_instructor" to "authenticated";

grant insert on table "public"."program_instructor" to "authenticated";

grant references on table "public"."program_instructor" to "authenticated";

grant select on table "public"."program_instructor" to "authenticated";

grant trigger on table "public"."program_instructor" to "authenticated";

grant truncate on table "public"."program_instructor" to "authenticated";

grant update on table "public"."program_instructor" to "authenticated";

grant delete on table "public"."program_instructor" to "service_role";

grant insert on table "public"."program_instructor" to "service_role";

grant references on table "public"."program_instructor" to "service_role";

grant select on table "public"."program_instructor" to "service_role";

grant trigger on table "public"."program_instructor" to "service_role";

grant truncate on table "public"."program_instructor" to "service_role";

grant update on table "public"."program_instructor" to "service_role";

grant delete on table "public"."program_registration" to "anon";

grant insert on table "public"."program_registration" to "anon";

grant references on table "public"."program_registration" to "anon";

grant select on table "public"."program_registration" to "anon";

grant trigger on table "public"."program_registration" to "anon";

grant truncate on table "public"."program_registration" to "anon";

grant update on table "public"."program_registration" to "anon";

grant delete on table "public"."program_registration" to "authenticated";

grant insert on table "public"."program_registration" to "authenticated";

grant references on table "public"."program_registration" to "authenticated";

grant select on table "public"."program_registration" to "authenticated";

grant trigger on table "public"."program_registration" to "authenticated";

grant truncate on table "public"."program_registration" to "authenticated";

grant update on table "public"."program_registration" to "authenticated";

grant delete on table "public"."program_registration" to "service_role";

grant insert on table "public"."program_registration" to "service_role";

grant references on table "public"."program_registration" to "service_role";

grant select on table "public"."program_registration" to "service_role";

grant trigger on table "public"."program_registration" to "service_role";

grant truncate on table "public"."program_registration" to "service_role";

grant update on table "public"."program_registration" to "service_role";

grant delete on table "public"."program_session" to "anon";

grant insert on table "public"."program_session" to "anon";

grant references on table "public"."program_session" to "anon";

grant select on table "public"."program_session" to "anon";

grant trigger on table "public"."program_session" to "anon";

grant truncate on table "public"."program_session" to "anon";

grant update on table "public"."program_session" to "anon";

grant delete on table "public"."program_session" to "authenticated";

grant insert on table "public"."program_session" to "authenticated";

grant references on table "public"."program_session" to "authenticated";

grant select on table "public"."program_session" to "authenticated";

grant trigger on table "public"."program_session" to "authenticated";

grant truncate on table "public"."program_session" to "authenticated";

grant update on table "public"."program_session" to "authenticated";

grant delete on table "public"."program_session" to "service_role";

grant insert on table "public"."program_session" to "service_role";

grant references on table "public"."program_session" to "service_role";

grant select on table "public"."program_session" to "service_role";

grant trigger on table "public"."program_session" to "service_role";

grant truncate on table "public"."program_session" to "service_role";

grant update on table "public"."program_session" to "service_role";

grant delete on table "public"."program_session_court" to "anon";

grant insert on table "public"."program_session_court" to "anon";

grant references on table "public"."program_session_court" to "anon";

grant select on table "public"."program_session_court" to "anon";

grant trigger on table "public"."program_session_court" to "anon";

grant truncate on table "public"."program_session_court" to "anon";

grant update on table "public"."program_session_court" to "anon";

grant delete on table "public"."program_session_court" to "authenticated";

grant insert on table "public"."program_session_court" to "authenticated";

grant references on table "public"."program_session_court" to "authenticated";

grant select on table "public"."program_session_court" to "authenticated";

grant trigger on table "public"."program_session_court" to "authenticated";

grant truncate on table "public"."program_session_court" to "authenticated";

grant update on table "public"."program_session_court" to "authenticated";

grant delete on table "public"."program_session_court" to "service_role";

grant insert on table "public"."program_session_court" to "service_role";

grant references on table "public"."program_session_court" to "service_role";

grant select on table "public"."program_session_court" to "service_role";

grant trigger on table "public"."program_session_court" to "service_role";

grant truncate on table "public"."program_session_court" to "service_role";

grant update on table "public"."program_session_court" to "service_role";

grant delete on table "public"."program_waitlist" to "anon";

grant insert on table "public"."program_waitlist" to "anon";

grant references on table "public"."program_waitlist" to "anon";

grant select on table "public"."program_waitlist" to "anon";

grant trigger on table "public"."program_waitlist" to "anon";

grant truncate on table "public"."program_waitlist" to "anon";

grant update on table "public"."program_waitlist" to "anon";

grant delete on table "public"."program_waitlist" to "authenticated";

grant insert on table "public"."program_waitlist" to "authenticated";

grant references on table "public"."program_waitlist" to "authenticated";

grant select on table "public"."program_waitlist" to "authenticated";

grant trigger on table "public"."program_waitlist" to "authenticated";

grant truncate on table "public"."program_waitlist" to "authenticated";

grant update on table "public"."program_waitlist" to "authenticated";

grant delete on table "public"."program_waitlist" to "service_role";

grant insert on table "public"."program_waitlist" to "service_role";

grant references on table "public"."program_waitlist" to "service_role";

grant select on table "public"."program_waitlist" to "service_role";

grant trigger on table "public"."program_waitlist" to "service_role";

grant truncate on table "public"."program_waitlist" to "service_role";

grant update on table "public"."program_waitlist" to "service_role";

grant delete on table "public"."registration_payment" to "anon";

grant insert on table "public"."registration_payment" to "anon";

grant references on table "public"."registration_payment" to "anon";

grant select on table "public"."registration_payment" to "anon";

grant trigger on table "public"."registration_payment" to "anon";

grant truncate on table "public"."registration_payment" to "anon";

grant update on table "public"."registration_payment" to "anon";

grant delete on table "public"."registration_payment" to "authenticated";

grant insert on table "public"."registration_payment" to "authenticated";

grant references on table "public"."registration_payment" to "authenticated";

grant select on table "public"."registration_payment" to "authenticated";

grant trigger on table "public"."registration_payment" to "authenticated";

grant truncate on table "public"."registration_payment" to "authenticated";

grant update on table "public"."registration_payment" to "authenticated";

grant delete on table "public"."registration_payment" to "service_role";

grant insert on table "public"."registration_payment" to "service_role";

grant references on table "public"."registration_payment" to "service_role";

grant select on table "public"."registration_payment" to "service_role";

grant trigger on table "public"."registration_payment" to "service_role";

grant truncate on table "public"."registration_payment" to "service_role";

grant update on table "public"."registration_payment" to "service_role";

grant delete on table "public"."reputation_config" to "anon";

grant insert on table "public"."reputation_config" to "anon";

grant references on table "public"."reputation_config" to "anon";

grant select on table "public"."reputation_config" to "anon";

grant trigger on table "public"."reputation_config" to "anon";

grant truncate on table "public"."reputation_config" to "anon";

grant update on table "public"."reputation_config" to "anon";

grant delete on table "public"."reputation_config" to "authenticated";

grant insert on table "public"."reputation_config" to "authenticated";

grant references on table "public"."reputation_config" to "authenticated";

grant select on table "public"."reputation_config" to "authenticated";

grant trigger on table "public"."reputation_config" to "authenticated";

grant truncate on table "public"."reputation_config" to "authenticated";

grant update on table "public"."reputation_config" to "authenticated";

grant delete on table "public"."reputation_config" to "service_role";

grant insert on table "public"."reputation_config" to "service_role";

grant references on table "public"."reputation_config" to "service_role";

grant select on table "public"."reputation_config" to "service_role";

grant trigger on table "public"."reputation_config" to "service_role";

grant truncate on table "public"."reputation_config" to "service_role";

grant update on table "public"."reputation_config" to "service_role";

grant delete on table "public"."reputation_event" to "anon";

grant insert on table "public"."reputation_event" to "anon";

grant references on table "public"."reputation_event" to "anon";

grant select on table "public"."reputation_event" to "anon";

grant trigger on table "public"."reputation_event" to "anon";

grant truncate on table "public"."reputation_event" to "anon";

grant update on table "public"."reputation_event" to "anon";

grant delete on table "public"."reputation_event" to "authenticated";

grant insert on table "public"."reputation_event" to "authenticated";

grant references on table "public"."reputation_event" to "authenticated";

grant select on table "public"."reputation_event" to "authenticated";

grant trigger on table "public"."reputation_event" to "authenticated";

grant truncate on table "public"."reputation_event" to "authenticated";

grant update on table "public"."reputation_event" to "authenticated";

grant delete on table "public"."reputation_event" to "service_role";

grant insert on table "public"."reputation_event" to "service_role";

grant references on table "public"."reputation_event" to "service_role";

grant select on table "public"."reputation_event" to "service_role";

grant trigger on table "public"."reputation_event" to "service_role";

grant truncate on table "public"."reputation_event" to "service_role";

grant update on table "public"."reputation_event" to "service_role";

grant delete on table "public"."session_attendance" to "anon";

grant insert on table "public"."session_attendance" to "anon";

grant references on table "public"."session_attendance" to "anon";

grant select on table "public"."session_attendance" to "anon";

grant trigger on table "public"."session_attendance" to "anon";

grant truncate on table "public"."session_attendance" to "anon";

grant update on table "public"."session_attendance" to "anon";

grant delete on table "public"."session_attendance" to "authenticated";

grant insert on table "public"."session_attendance" to "authenticated";

grant references on table "public"."session_attendance" to "authenticated";

grant select on table "public"."session_attendance" to "authenticated";

grant trigger on table "public"."session_attendance" to "authenticated";

grant truncate on table "public"."session_attendance" to "authenticated";

grant update on table "public"."session_attendance" to "authenticated";

grant delete on table "public"."session_attendance" to "service_role";

grant insert on table "public"."session_attendance" to "service_role";

grant references on table "public"."session_attendance" to "service_role";

grant select on table "public"."session_attendance" to "service_role";

grant trigger on table "public"."session_attendance" to "service_role";

grant truncate on table "public"."session_attendance" to "service_role";

grant update on table "public"."session_attendance" to "service_role";


  create policy "availability_block_delete_org_staff"
  on "public"."availability_block"
  as permissive
  for delete
  to public
using ((EXISTS ( SELECT 1
   FROM (public.organization_member om
     JOIN public.facility f ON ((f.organization_id = om.organization_id)))
  WHERE ((f.id = availability_block.facility_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));



  create policy "availability_block_insert_org_staff"
  on "public"."availability_block"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM (public.organization_member om
     JOIN public.facility f ON ((f.organization_id = om.organization_id)))
  WHERE ((f.id = availability_block.facility_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));



  create policy "availability_block_select_org_members"
  on "public"."availability_block"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM (public.organization_member om
     JOIN public.facility f ON ((f.organization_id = om.organization_id)))
  WHERE ((f.id = availability_block.facility_id) AND (om.user_id = auth.uid())))));



  create policy "availability_block_update_org_staff"
  on "public"."availability_block"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM (public.organization_member om
     JOIN public.facility f ON ((f.organization_id = om.organization_id)))
  WHERE ((f.id = availability_block.facility_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));



  create policy "anyone can insert beta signup"
  on "public"."beta_signup"
  as permissive
  for insert
  to anon, authenticated
with check (true);



  create policy "booking_delete_org_admin"
  on "public"."booking"
  as permissive
  for delete
  to public
using ((EXISTS ( SELECT 1
   FROM ((public.court c
     JOIN public.facility f ON ((f.id = c.facility_id)))
     JOIN public.organization_member om ON ((om.organization_id = f.organization_id)))
  WHERE ((c.id = booking.court_id) AND (om.user_id = auth.uid()) AND (om.left_at IS NULL) AND (om.role = ANY (ARRAY['owner'::public.member_role, 'admin'::public.member_role]))))));



  create policy "booking_insert_org_staff"
  on "public"."booking"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM ((public.court c
     JOIN public.facility f ON ((f.id = c.facility_id)))
     JOIN public.organization_member om ON ((om.organization_id = f.organization_id)))
  WHERE ((c.id = booking.court_id) AND (om.user_id = auth.uid()) AND (om.left_at IS NULL) AND (om.role = ANY (ARRAY['owner'::public.member_role, 'admin'::public.member_role, 'staff'::public.member_role]))))));



  create policy "booking_insert_own"
  on "public"."booking"
  as permissive
  for insert
  to public
with check (((player_id IS NOT NULL) AND (player_id = auth.uid())));



  create policy "booking_select_org_staff"
  on "public"."booking"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM ((public.court c
     JOIN public.facility f ON ((f.id = c.facility_id)))
     JOIN public.organization_member om ON ((om.organization_id = f.organization_id)))
  WHERE ((c.id = booking.court_id) AND (om.user_id = auth.uid()) AND (om.left_at IS NULL)))));



  create policy "booking_select_own"
  on "public"."booking"
  as permissive
  for select
  to public
using (((player_id IS NOT NULL) AND (player_id = auth.uid())));



  create policy "booking_update_org_staff"
  on "public"."booking"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM ((public.court c
     JOIN public.facility f ON ((f.id = c.facility_id)))
     JOIN public.organization_member om ON ((om.organization_id = f.organization_id)))
  WHERE ((c.id = booking.court_id) AND (om.user_id = auth.uid()) AND (om.left_at IS NULL) AND (om.role = ANY (ARRAY['owner'::public.member_role, 'admin'::public.member_role, 'staff'::public.member_role]))))));



  create policy "booking_update_own"
  on "public"."booking"
  as permissive
  for update
  to public
using (((player_id IS NOT NULL) AND (player_id = auth.uid())));



  create policy "cancellation_policy_insert_org_owner"
  on "public"."cancellation_policy"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = cancellation_policy.organization_id) AND (om.user_id = auth.uid()) AND (om.role = 'owner'::public.member_role)))));



  create policy "cancellation_policy_select_all"
  on "public"."cancellation_policy"
  as permissive
  for select
  to public
using (true);



  create policy "cancellation_policy_update_org_staff"
  on "public"."cancellation_policy"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = cancellation_policy.organization_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));



  create policy "Anonymous users can view courts"
  on "public"."court"
  as permissive
  for select
  to anon
using (true);



  create policy "one_time_availability_delete_org_staff"
  on "public"."court_one_time_availability"
  as permissive
  for delete
  to public
using ((EXISTS ( SELECT 1
   FROM (public.organization_member om
     JOIN public.facility f ON ((f.organization_id = om.organization_id)))
  WHERE ((f.id = court_one_time_availability.facility_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));



  create policy "one_time_availability_insert_org_staff"
  on "public"."court_one_time_availability"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM (public.organization_member om
     JOIN public.facility f ON ((f.organization_id = om.organization_id)))
  WHERE ((f.id = court_one_time_availability.facility_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));



  create policy "one_time_availability_select_org_members"
  on "public"."court_one_time_availability"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM (public.organization_member om
     JOIN public.facility f ON ((f.organization_id = om.organization_id)))
  WHERE ((f.id = court_one_time_availability.facility_id) AND (om.user_id = auth.uid())))));



  create policy "one_time_availability_update_org_staff"
  on "public"."court_one_time_availability"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM (public.organization_member om
     JOIN public.facility f ON ((f.organization_id = om.organization_id)))
  WHERE ((f.id = court_one_time_availability.facility_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));



  create policy "Anonymous users can view facilities"
  on "public"."facility"
  as permissive
  for select
  to anon
using ((is_active = true));



  create policy "Authenticated users can view facility files"
  on "public"."facility_file"
  as permissive
  for select
  to authenticated
using (true);



  create policy "Org members can delete facility files"
  on "public"."facility_file"
  as permissive
  for delete
  to authenticated
using ((EXISTS ( SELECT 1
   FROM (public.facility f
     JOIN public.organization_member om ON ((om.organization_id = f.organization_id)))
  WHERE ((f.id = facility_file.facility_id) AND (om.user_id = auth.uid())))));



  create policy "Org members can insert facility files"
  on "public"."facility_file"
  as permissive
  for insert
  to authenticated
with check ((EXISTS ( SELECT 1
   FROM (public.facility f
     JOIN public.organization_member om ON ((om.organization_id = f.organization_id)))
  WHERE ((f.id = facility_file.facility_id) AND (om.user_id = auth.uid())))));



  create policy "Org members can update facility files"
  on "public"."facility_file"
  as permissive
  for update
  to authenticated
using ((EXISTS ( SELECT 1
   FROM (public.facility f
     JOIN public.organization_member om ON ((om.organization_id = f.organization_id)))
  WHERE ((f.id = facility_file.facility_id) AND (om.user_id = auth.uid())))));



  create policy "Authenticated users can insert files"
  on "public"."file"
  as permissive
  for insert
  to authenticated
with check ((uploaded_by = auth.uid()));



  create policy "Authenticated users can view files"
  on "public"."file"
  as permissive
  for select
  to authenticated
using ((is_deleted = false));



  create policy "Users can delete their own files"
  on "public"."file"
  as permissive
  for delete
  to authenticated
using ((uploaded_by = auth.uid()));



  create policy "Users can update their own files"
  on "public"."file"
  as permissive
  for update
  to authenticated
using ((uploaded_by = auth.uid()))
with check ((uploaded_by = auth.uid()));



  create policy "instructors_view_own"
  on "public"."instructor_profile"
  as permissive
  for select
  to public
using ((organization_member_id IN ( SELECT organization_member.id
   FROM public.organization_member
  WHERE (organization_member.user_id = auth.uid()))));



  create policy "org_admins_manage_instructors"
  on "public"."instructor_profile"
  as permissive
  for all
  to public
using ((organization_id IN ( SELECT organization_member.organization_id
   FROM public.organization_member
  WHERE ((organization_member.user_id = auth.uid()) AND (organization_member.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));



  create policy "org_members_view_instructors"
  on "public"."instructor_profile"
  as permissive
  for select
  to public
using ((organization_id IN ( SELECT organization_member.organization_id
   FROM public.organization_member
  WHERE (organization_member.user_id = auth.uid()))));



  create policy "service_role_all_instructor_profile"
  on "public"."instructor_profile"
  as permissive
  for all
  to service_role
using (true)
with check (true);



  create policy "match_select_public_anon"
  on "public"."match"
  as permissive
  for select
  to anon
using (((visibility = 'public'::public.match_visibility_enum) AND (cancelled_at IS NULL)));



  create policy "match_feedback_insert"
  on "public"."match_feedback"
  as permissive
  for insert
  to public
with check (((reviewer_id = auth.uid()) AND public.is_match_participant(match_id, auth.uid())));



  create policy "match_feedback_select"
  on "public"."match_feedback"
  as permissive
  for select
  to public
using (((reviewer_id = auth.uid()) OR (opponent_id = auth.uid()) OR public.is_match_participant(match_id, auth.uid())));



  create policy "match_participant_select_public_match_anon"
  on "public"."match_participant"
  as permissive
  for select
  to anon
using (public.is_public_match(match_id));



  create policy "match_report_insert"
  on "public"."match_report"
  as permissive
  for insert
  to public
with check (((reporter_id = auth.uid()) AND public.is_match_participant(match_id, auth.uid())));



  create policy "match_report_select"
  on "public"."match_report"
  as permissive
  for select
  to public
using ((reporter_id = auth.uid()));



  create policy "Creator can delete network"
  on "public"."network"
  as permissive
  for delete
  to public
using ((created_by = auth.uid()));



  create policy "Members can view their networks"
  on "public"."network"
  as permissive
  for select
  to public
using (((created_by = auth.uid()) OR public.is_network_member(id, auth.uid())));



  create policy "Moderators can update network"
  on "public"."network"
  as permissive
  for update
  to public
using (((created_by = auth.uid()) OR public.is_network_moderator(id, auth.uid())));



  create policy "Users can create networks"
  on "public"."network"
  as permissive
  for insert
  to public
with check ((auth.uid() = created_by));



  create policy "Members can add members"
  on "public"."network_member"
  as permissive
  for insert
  to public
with check (((public.is_network_member(network_id, auth.uid()) OR public.is_network_creator(network_id, auth.uid())) AND ((role = 'member'::public.network_member_role_enum) OR public.is_network_moderator(network_id, auth.uid()) OR public.is_network_creator(network_id, auth.uid()))));



  create policy "Members can view network members"
  on "public"."network_member"
  as permissive
  for select
  to public
using ((public.is_network_member(network_id, auth.uid()) OR public.is_network_creator(network_id, auth.uid()) OR (player_id = auth.uid())));



  create policy "Moderators can remove members"
  on "public"."network_member"
  as permissive
  for delete
  to public
using ((public.is_network_moderator(network_id, auth.uid()) OR public.is_network_creator(network_id, auth.uid()) OR (player_id = auth.uid())));



  create policy "Moderators can update members"
  on "public"."network_member"
  as permissive
  for update
  to public
using ((public.is_network_moderator(network_id, auth.uid()) OR public.is_network_creator(network_id, auth.uid())));



  create policy "notification_select_org_context"
  on "public"."notification"
  as permissive
  for select
  to public
using (((auth.uid() = user_id) OR ((organization_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = notification.organization_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role])) AND (om.left_at IS NULL)))))));



  create policy "org_notification_preference_delete_org_admin"
  on "public"."organization_notification_preference"
  as permissive
  for delete
  to public
using ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_notification_preference.organization_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role])) AND (om.left_at IS NULL)))));



  create policy "org_notification_preference_insert_org_admin"
  on "public"."organization_notification_preference"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_notification_preference.organization_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role])) AND (om.left_at IS NULL)))));



  create policy "org_notification_preference_select_org_members"
  on "public"."organization_notification_preference"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_notification_preference.organization_id) AND (om.user_id = auth.uid()) AND (om.left_at IS NULL)))));



  create policy "org_notification_preference_update_org_admin"
  on "public"."organization_notification_preference"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_notification_preference.organization_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role])) AND (om.left_at IS NULL)))));



  create policy "org_notification_recipient_delete_org_admin"
  on "public"."organization_notification_recipient"
  as permissive
  for delete
  to public
using ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_notification_recipient.organization_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role])) AND (om.left_at IS NULL)))));



  create policy "org_notification_recipient_insert_org_admin"
  on "public"."organization_notification_recipient"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_notification_recipient.organization_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role])) AND (om.left_at IS NULL)))));



  create policy "org_notification_recipient_select_org_members"
  on "public"."organization_notification_recipient"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_notification_recipient.organization_id) AND (om.user_id = auth.uid()) AND (om.left_at IS NULL)))));



  create policy "org_notification_recipient_update_org_admin"
  on "public"."organization_notification_recipient"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_notification_recipient.organization_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role])) AND (om.left_at IS NULL)))));



  create policy "org_player_block_insert_org_staff"
  on "public"."organization_player_block"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_player_block.organization_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));



  create policy "org_player_block_select_org_staff"
  on "public"."organization_player_block"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_player_block.organization_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role, 'staff'::public.member_role]))))));



  create policy "org_player_block_update_org_staff"
  on "public"."organization_player_block"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_player_block.organization_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));



  create policy "org_settings_insert_org_owner"
  on "public"."organization_settings"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_settings.organization_id) AND (om.user_id = auth.uid()) AND (om.role = 'owner'::public.member_role)))));



  create policy "org_settings_select_org_members"
  on "public"."organization_settings"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_settings.organization_id) AND (om.user_id = auth.uid())))));



  create policy "org_settings_update_org_staff"
  on "public"."organization_settings"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_settings.organization_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));



  create policy "org_stripe_insert_org_owner"
  on "public"."organization_stripe_account"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_stripe_account.organization_id) AND (om.user_id = auth.uid()) AND (om.role = 'owner'::public.member_role)))));



  create policy "org_stripe_select_org_members"
  on "public"."organization_stripe_account"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_stripe_account.organization_id) AND (om.user_id = auth.uid())))));



  create policy "org_stripe_update_org_owner"
  on "public"."organization_stripe_account"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = organization_stripe_account.organization_id) AND (om.user_id = auth.uid()) AND (om.role = 'owner'::public.member_role)))));



  create policy "Anonymous users can view players"
  on "public"."player"
  as permissive
  for select
  to anon
using (true);



  create policy "player_reputation_insert"
  on "public"."player_reputation"
  as permissive
  for insert
  to authenticated
with check ((player_id = auth.uid()));



  create policy "player_reputation_read_own"
  on "public"."player_reputation"
  as permissive
  for select
  to authenticated
using ((player_id = auth.uid()));



  create policy "player_reputation_read_public"
  on "public"."player_reputation"
  as permissive
  for select
  to authenticated
using ((is_public = true));



  create policy "player_reputation_update_own"
  on "public"."player_reputation"
  as permissive
  for update
  to authenticated
using ((player_id = auth.uid()))
with check ((player_id = auth.uid()));



  create policy "pricing_rule_delete_org_staff"
  on "public"."pricing_rule"
  as permissive
  for delete
  to public
using ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = pricing_rule.organization_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));



  create policy "pricing_rule_insert_org_staff"
  on "public"."pricing_rule"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = pricing_rule.organization_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));



  create policy "pricing_rule_select_org_members"
  on "public"."pricing_rule"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = pricing_rule.organization_id) AND (om.user_id = auth.uid())))));



  create policy "pricing_rule_update_org_staff"
  on "public"."pricing_rule"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM public.organization_member om
  WHERE ((om.organization_id = pricing_rule.organization_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role]))))));



  create policy "Anonymous users can view profiles"
  on "public"."profile"
  as permissive
  for select
  to anon
using (true);



  create policy "org_members_view_all_programs"
  on "public"."program"
  as permissive
  for select
  to public
using ((organization_id IN ( SELECT organization_member.organization_id
   FROM public.organization_member
  WHERE (organization_member.user_id = auth.uid()))));



  create policy "org_staff_manage_programs"
  on "public"."program"
  as permissive
  for all
  to public
using ((organization_id IN ( SELECT organization_member.organization_id
   FROM public.organization_member
  WHERE ((organization_member.user_id = auth.uid()) AND (organization_member.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role, 'staff'::public.member_role]))))));



  create policy "public_view_published_programs"
  on "public"."program"
  as permissive
  for select
  to public
using ((status = 'published'::public.program_status_enum));



  create policy "service_role_all_program"
  on "public"."program"
  as permissive
  for all
  to service_role
using (true)
with check (true);



  create policy "org_staff_manage_program_instructors"
  on "public"."program_instructor"
  as permissive
  for all
  to public
using ((program_id IN ( SELECT program.id
   FROM public.program
  WHERE (program.organization_id IN ( SELECT organization_member.organization_id
           FROM public.organization_member
          WHERE ((organization_member.user_id = auth.uid()) AND (organization_member.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role, 'staff'::public.member_role]))))))));



  create policy "service_role_all_program_instructor"
  on "public"."program_instructor"
  as permissive
  for all
  to service_role
using (true)
with check (true);



  create policy "view_program_instructors"
  on "public"."program_instructor"
  as permissive
  for select
  to public
using (((program_id IN ( SELECT program.id
   FROM public.program
  WHERE (program.status = 'published'::public.program_status_enum))) OR (program_id IN ( SELECT p.id
   FROM (public.program p
     JOIN public.organization_member om ON ((p.organization_id = om.organization_id)))
  WHERE (om.user_id = auth.uid())))));



  create policy "org_staff_manage_registrations"
  on "public"."program_registration"
  as permissive
  for all
  to public
using ((program_id IN ( SELECT program.id
   FROM public.program
  WHERE (program.organization_id IN ( SELECT organization_member.organization_id
           FROM public.organization_member
          WHERE ((organization_member.user_id = auth.uid()) AND (organization_member.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role, 'staff'::public.member_role]))))))));



  create policy "org_staff_view_registrations"
  on "public"."program_registration"
  as permissive
  for select
  to public
using ((program_id IN ( SELECT program.id
   FROM public.program
  WHERE (program.organization_id IN ( SELECT organization_member.organization_id
           FROM public.organization_member
          WHERE ((organization_member.user_id = auth.uid()) AND (organization_member.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role, 'staff'::public.member_role]))))))));



  create policy "players_cancel_own_registrations"
  on "public"."program_registration"
  as permissive
  for update
  to public
using ((((player_id = auth.uid()) OR (registered_by = auth.uid())) AND (status <> 'refunded'::public.registration_status_enum)));



  create policy "players_create_registrations"
  on "public"."program_registration"
  as permissive
  for insert
  to public
with check ((registered_by = auth.uid()));



  create policy "players_view_own_registrations"
  on "public"."program_registration"
  as permissive
  for select
  to public
using (((player_id = auth.uid()) OR (registered_by = auth.uid())));



  create policy "service_role_all_program_registration"
  on "public"."program_registration"
  as permissive
  for all
  to service_role
using (true)
with check (true);



  create policy "org_staff_manage_sessions"
  on "public"."program_session"
  as permissive
  for all
  to public
using ((program_id IN ( SELECT program.id
   FROM public.program
  WHERE (program.organization_id IN ( SELECT organization_member.organization_id
           FROM public.organization_member
          WHERE ((organization_member.user_id = auth.uid()) AND (organization_member.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role, 'staff'::public.member_role]))))))));



  create policy "service_role_all_program_session"
  on "public"."program_session"
  as permissive
  for all
  to service_role
using (true)
with check (true);



  create policy "view_sessions"
  on "public"."program_session"
  as permissive
  for select
  to public
using (((program_id IN ( SELECT program.id
   FROM public.program
  WHERE (program.status = 'published'::public.program_status_enum))) OR (program_id IN ( SELECT p.id
   FROM (public.program p
     JOIN public.organization_member om ON ((p.organization_id = om.organization_id)))
  WHERE (om.user_id = auth.uid())))));



  create policy "org_staff_manage_session_courts"
  on "public"."program_session_court"
  as permissive
  for all
  to public
using ((session_id IN ( SELECT ps.id
   FROM (public.program_session ps
     JOIN public.program p ON ((ps.program_id = p.id)))
  WHERE (p.organization_id IN ( SELECT organization_member.organization_id
           FROM public.organization_member
          WHERE ((organization_member.user_id = auth.uid()) AND (organization_member.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role, 'staff'::public.member_role]))))))));



  create policy "service_role_all_program_session_court"
  on "public"."program_session_court"
  as permissive
  for all
  to service_role
using (true)
with check (true);



  create policy "view_session_courts"
  on "public"."program_session_court"
  as permissive
  for select
  to public
using (((session_id IN ( SELECT ps.id
   FROM (public.program_session ps
     JOIN public.program p ON ((ps.program_id = p.id)))
  WHERE (p.status = 'published'::public.program_status_enum))) OR (session_id IN ( SELECT ps.id
   FROM ((public.program_session ps
     JOIN public.program p ON ((ps.program_id = p.id)))
     JOIN public.organization_member om ON ((p.organization_id = om.organization_id)))
  WHERE (om.user_id = auth.uid())))));



  create policy "org_staff_manage_waitlist"
  on "public"."program_waitlist"
  as permissive
  for all
  to public
using ((program_id IN ( SELECT program.id
   FROM public.program
  WHERE (program.organization_id IN ( SELECT organization_member.organization_id
           FROM public.organization_member
          WHERE ((organization_member.user_id = auth.uid()) AND (organization_member.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role, 'staff'::public.member_role]))))))));



  create policy "players_join_waitlist"
  on "public"."program_waitlist"
  as permissive
  for insert
  to public
with check ((added_by = auth.uid()));



  create policy "players_leave_waitlist"
  on "public"."program_waitlist"
  as permissive
  for delete
  to public
using (((player_id = auth.uid()) OR (added_by = auth.uid())));



  create policy "players_view_own_waitlist"
  on "public"."program_waitlist"
  as permissive
  for select
  to public
using (((player_id = auth.uid()) OR (added_by = auth.uid())));



  create policy "service_role_all_program_waitlist"
  on "public"."program_waitlist"
  as permissive
  for all
  to service_role
using (true)
with check (true);



  create policy "Anonymous users can view rating scores"
  on "public"."rating_score"
  as permissive
  for select
  to anon
using (true);



  create policy "org_staff_manage_payments"
  on "public"."registration_payment"
  as permissive
  for all
  to public
using ((registration_id IN ( SELECT pr.id
   FROM (public.program_registration pr
     JOIN public.program p ON ((pr.program_id = p.id)))
  WHERE (p.organization_id IN ( SELECT organization_member.organization_id
           FROM public.organization_member
          WHERE ((organization_member.user_id = auth.uid()) AND (organization_member.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role, 'staff'::public.member_role]))))))));



  create policy "players_view_own_payments"
  on "public"."registration_payment"
  as permissive
  for select
  to public
using ((registration_id IN ( SELECT program_registration.id
   FROM public.program_registration
  WHERE ((program_registration.player_id = auth.uid()) OR (program_registration.registered_by = auth.uid())))));



  create policy "service_role_all_registration_payment"
  on "public"."registration_payment"
  as permissive
  for all
  to service_role
using (true)
with check (true);



  create policy "reputation_config_read_all"
  on "public"."reputation_config"
  as permissive
  for select
  to authenticated
using (true);



  create policy "reputation_event_insert"
  on "public"."reputation_event"
  as permissive
  for insert
  to authenticated
with check (true);



  create policy "reputation_event_select_own_inserts"
  on "public"."reputation_event"
  as permissive
  for select
  to authenticated
using (((player_id = auth.uid()) OR (caused_by_player_id = auth.uid())));



  create policy "org_staff_manage_attendance"
  on "public"."session_attendance"
  as permissive
  for all
  to public
using ((session_id IN ( SELECT ps.id
   FROM (public.program_session ps
     JOIN public.program p ON ((ps.program_id = p.id)))
  WHERE (p.organization_id IN ( SELECT organization_member.organization_id
           FROM public.organization_member
          WHERE ((organization_member.user_id = auth.uid()) AND (organization_member.role = ANY (ARRAY['admin'::public.member_role, 'owner'::public.member_role, 'staff'::public.member_role]))))))));



  create policy "players_view_own_attendance"
  on "public"."session_attendance"
  as permissive
  for select
  to public
using ((registration_id IN ( SELECT program_registration.id
   FROM public.program_registration
  WHERE ((program_registration.player_id = auth.uid()) OR (program_registration.registered_by = auth.uid())))));



  create policy "service_role_all_session_attendance"
  on "public"."session_attendance"
  as permissive
  for all
  to service_role
using (true)
with check (true);



  create policy "Anonymous users can view sports"
  on "public"."sport"
  as permissive
  for select
  to anon
using ((is_active = true));



  create policy "match_network_delete_policy"
  on "public"."match_network"
  as permissive
  for delete
  to public
using (((posted_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.network n
  WHERE ((n.id = match_network.network_id) AND (n.created_by = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.network_member nm
  WHERE ((nm.network_id = match_network.network_id) AND (nm.player_id = auth.uid()) AND (nm.role = 'moderator'::public.network_member_role_enum) AND (nm.status = 'active'::public.network_member_status))))));



  create policy "Users can create recipients for their shares"
  on "public"."match_share_recipient"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM public.match_share
  WHERE ((match_share.id = match_share_recipient.share_id) AND (match_share.shared_by = auth.uid())))));



  create policy "Users can delete recipients of their shares"
  on "public"."match_share_recipient"
  as permissive
  for delete
  to public
using ((EXISTS ( SELECT 1
   FROM public.match_share
  WHERE ((match_share.id = match_share_recipient.share_id) AND (match_share.shared_by = auth.uid())))));



  create policy "Users can update recipients of their shares"
  on "public"."match_share_recipient"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM public.match_share
  WHERE ((match_share.id = match_share_recipient.share_id) AND (match_share.shared_by = auth.uid())))));



  create policy "Users can view recipients of their shares"
  on "public"."match_share_recipient"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.match_share
  WHERE ((match_share.id = match_share_recipient.share_id) AND (match_share.shared_by = auth.uid())))));



  create policy "Users can create contacts in own lists"
  on "public"."shared_contact"
  as permissive
  for insert
  to authenticated
with check ((EXISTS ( SELECT 1
   FROM public.shared_contact_list
  WHERE ((shared_contact_list.id = shared_contact.list_id) AND (shared_contact_list.player_id = auth.uid())))));



  create policy "Users can delete contacts in own lists"
  on "public"."shared_contact"
  as permissive
  for delete
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.shared_contact_list
  WHERE ((shared_contact_list.id = shared_contact.list_id) AND (shared_contact_list.player_id = auth.uid())))));



  create policy "Users can update contacts in own lists"
  on "public"."shared_contact"
  as permissive
  for update
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.shared_contact_list
  WHERE ((shared_contact_list.id = shared_contact.list_id) AND (shared_contact_list.player_id = auth.uid())))))
with check ((EXISTS ( SELECT 1
   FROM public.shared_contact_list
  WHERE ((shared_contact_list.id = shared_contact.list_id) AND (shared_contact_list.player_id = auth.uid())))));



  create policy "Users can view contacts in own lists"
  on "public"."shared_contact"
  as permissive
  for select
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.shared_contact_list
  WHERE ((shared_contact_list.id = shared_contact.list_id) AND (shared_contact_list.player_id = auth.uid())))));


CREATE TRIGGER set_instructor_profile_updated_at BEFORE UPDATE ON public.instructor_profile FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER match_create_host_participant AFTER INSERT ON public.match FOR EACH ROW EXECUTE FUNCTION public.create_host_participant();

CREATE TRIGGER match_notify_group_members_on_create AFTER INSERT ON public.match FOR EACH ROW EXECUTE FUNCTION public.notify_group_members_on_match_created();

CREATE TRIGGER trigger_create_network_conversation BEFORE INSERT ON public.network FOR EACH ROW EXECUTE FUNCTION public.create_network_conversation();

CREATE TRIGGER trigger_add_network_member_to_conversation AFTER INSERT OR UPDATE OF status ON public.network_member FOR EACH ROW EXECUTE FUNCTION public.add_network_member_to_conversation();

CREATE TRIGGER trigger_update_network_member_count AFTER INSERT OR DELETE OR UPDATE OF status ON public.network_member FOR EACH ROW EXECUTE FUNCTION public.update_network_member_count();

CREATE TRIGGER on_notification_insert AFTER INSERT ON public.notification FOR EACH ROW EXECUTE FUNCTION public.notify_send_notification();

CREATE TRIGGER update_org_notification_preference_updated_at BEFORE UPDATE ON public.organization_notification_preference FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_org_notification_recipient_updated_at BEFORE UPDATE ON public.organization_notification_recipient FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_program_updated_at BEFORE UPDATE ON public.program FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_program_registration_updated_at BEFORE UPDATE ON public.program_registration FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_program_participants AFTER INSERT OR DELETE OR UPDATE ON public.program_registration FOR EACH ROW EXECUTE FUNCTION public.update_program_participant_count();

CREATE TRIGGER set_program_session_updated_at BEFORE UPDATE ON public.program_session FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_program_waitlist_updated_at BEFORE UPDATE ON public.program_waitlist FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_waitlist_position BEFORE INSERT ON public.program_waitlist FOR EACH ROW EXECUTE FUNCTION public.assign_waitlist_position();

CREATE TRIGGER set_registration_payment_updated_at BEFORE UPDATE ON public.registration_payment FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER reputation_event_recalculate AFTER INSERT ON public.reputation_event FOR EACH ROW EXECUTE FUNCTION public.trigger_recalculate_reputation();

CREATE TRIGGER on_invitation_insert AFTER INSERT ON public.invitation FOR EACH ROW WHEN ((new.email IS NOT NULL)) EXECUTE FUNCTION public.notify_new_invitation();

drop trigger if exists "objects_delete_delete_prefix" on "storage"."objects";

drop trigger if exists "objects_insert_create_prefix" on "storage"."objects";

drop trigger if exists "objects_update_create_prefix" on "storage"."objects";

drop trigger if exists "prefixes_create_hierarchy" on "storage"."prefixes";

drop trigger if exists "prefixes_delete_hierarchy" on "storage"."prefixes";

DO $$ BEGIN
  drop policy "Feedback screenshots are publicly accessible" on "storage"."objects";
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  drop policy "Users can delete their own feedback screenshots" on "storage"."objects";
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  drop policy "Users can update their own feedback screenshots" on "storage"."objects";
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  drop policy "Users can upload feedback screenshots" on "storage"."objects";
EXCEPTION WHEN undefined_object THEN NULL;
END $$;


DO $$ BEGIN
  create policy "Authenticated users can delete facility files"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using ((bucket_id = 'facility-files'::text));
EXCEPTION WHEN insufficient_privilege OR duplicate_object THEN NULL;
END $$;


DO $$ BEGIN
  create policy "Authenticated users can update facility files"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using ((bucket_id = 'facility-files'::text))
with check ((bucket_id = 'facility-files'::text));
EXCEPTION WHEN insufficient_privilege OR duplicate_object THEN NULL;
END $$;


DO $$ BEGIN
  create policy "Authenticated users can upload facility files"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check ((bucket_id = 'facility-files'::text));
EXCEPTION WHEN insufficient_privilege OR duplicate_object THEN NULL;
END $$;


DO $$ BEGIN
  create policy "Public facility files are publicly accessible"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'facility-files'::text));
EXCEPTION WHEN insufficient_privilege OR duplicate_object THEN NULL;
END $$;


DO $$ BEGIN
  CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();
EXCEPTION WHEN insufficient_privilege OR duplicate_object OR undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();
EXCEPTION WHEN insufficient_privilege OR duplicate_object OR undefined_function THEN NULL;
END $$;


