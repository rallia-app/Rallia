-- =============================================================================
-- Phase 1.5 — Drop 30 unused indexes (idx_scan = 0 on prod, non-constraint,
-- non-PK). Targeted at indexes on hot-write tables to maximize WAL reduction.
--
-- Top write-path wins:
--   * idx_fas_expired on facility_availability_snapshot (heavy UPSERT path)
--   * digest_event indexes (1,371 inserts / measurement window)
--   * match_participant partial indexes (match-join hot path)
--
-- Uses plain DROP INDEX (not CONCURRENTLY): the Supabase CLI wraps migrations
-- in a transaction, which CONCURRENTLY forbids. Drops are catalog-only and
-- complete in milliseconds. IF EXISTS keeps this idempotent if already applied
-- via psql.
-- =============================================================================

-- facility_availability_snapshot (high-WAL UPSERT target)
DROP INDEX IF EXISTS public.idx_fas_expired;

-- digest_event (1,371 inserts/window)
DROP INDEX IF EXISTS public.digest_event_resend_id_idx;
DROP INDEX IF EXISTS public.digest_event_event_type_idx;

-- match_participant (match-join hot path)
DROP INDEX IF EXISTS public.idx_match_participant_pending_feedback;
DROP INDEX IF EXISTS public.idx_match_participant_starting_soon;

-- match_set (low volume, included for completeness)
DROP INDEX IF EXISTS public.idx_match_set_result_number;

-- match_share_recipient
DROP INDEX IF EXISTS public.idx_match_share_recipient_status;
DROP INDEX IF EXISTS public.idx_match_share_recipient_share_id;

-- facility
DROP INDEX IF EXISTS public.idx_facilities_slug;

-- invitation
DROP INDEX IF EXISTS public.invitations_status_idx;
DROP INDEX IF EXISTS public.invitations_expires_at_idx;

-- reputation_event
DROP INDEX IF EXISTS public.idx_reputation_event_occurred;

-- referral_link_click
DROP INDEX IF EXISTS public.idx_referral_link_click_type_created_at;

-- reports
DROP INDEX IF EXISTS public.idx_player_report_type;
DROP INDEX IF EXISTS public.idx_player_report_priority;
DROP INDEX IF EXISTS public.idx_facility_report_status;

-- rating / reference workflows
DROP INDEX IF EXISTS public.idx_peer_rating_requests_status;
DROP INDEX IF EXISTS public.idx_reference_request_sport;
DROP INDEX IF EXISTS public.idx_reference_request_expiry;
DROP INDEX IF EXISTS public.idx_rating_reference_request_status;

-- feedback / admin
DROP INDEX IF EXISTS public.idx_feedback_category;
DROP INDEX IF EXISTS public.idx_admin_device_push_token;
DROP INDEX IF EXISTS public.idx_admin_audit_log_entity;

-- misc small tables
DROP INDEX IF EXISTS public.idx_organization_data_provider;
DROP INDEX IF EXISTS public.idx_network_is_certified;
DROP INDEX IF EXISTS public.idx_player_rating_score_badge_status;
DROP INDEX IF EXISTS public.idx_conversation_participant_pinned;
DROP INDEX IF EXISTS public.idx_files_file_type;
DROP INDEX IF EXISTS public.idx_file_storage_provider;
DROP INDEX IF EXISTS public.idx_data_provider_active;
