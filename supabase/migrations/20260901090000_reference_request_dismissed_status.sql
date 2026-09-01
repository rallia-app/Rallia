-- Migration: Let a referee close a reference request without judging the rating
-- A referee asked to vouch for a player they have never played with had two
-- exits: assert the rating is wrong ('declined', which pushes "could not confirm
-- your level" at the requester), or let the request sit in their list until
-- expires_at. 'dismissed' is the neutral third outcome.
-- Certification counting is unaffected by construction: update_referrals_count_on_reference,
-- check_and_update_certification, reevaluate_certification_for_player_rating and
-- get_rating_score_referees all filter on status = 'completed' AND rating_supported = true.
-- Created: 2026-09-01

ALTER TYPE "public"."rating_request_status_enum" ADD VALUE IF NOT EXISTS 'dismissed';

ALTER TYPE "public"."notification_type_enum" ADD VALUE IF NOT EXISTS 'reference_request_dismissed';
