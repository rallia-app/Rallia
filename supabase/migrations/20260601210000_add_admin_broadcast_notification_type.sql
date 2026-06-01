-- ============================================================================
-- Migration: add 'admin_broadcast' to notification_type_enum
-- Created: 2026-06-01
-- Description:
--   Admin email broadcasts (the new /admin/emails tab) are an opt-out-able
--   category. Adding the enum value in its own migration so it is committed
--   before any function/query references it (Postgres forbids using a freshly
--   added enum value in the same transaction). Mirrors how 'morning_digest'
--   was introduced in 20260429100000 and used later.
-- ============================================================================

ALTER TYPE public.notification_type_enum ADD VALUE IF NOT EXISTS 'admin_broadcast';
