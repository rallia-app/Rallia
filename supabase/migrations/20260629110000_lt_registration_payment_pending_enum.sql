-- ============================================
-- Leagues & Tournaments — payments: 'payment_pending' registration status
-- ============================================
-- A registration enters 'payment_pending' the moment a paid sign-up reserves a
-- slot, and is finalized to 'registered' by the payment webhook (or released by
-- the stale-payment reaper). Must live in its own migration: a newly added enum
-- value cannot be USED in the same transaction that adds it, and the begin /
-- reaper RPCs in the next migration reference it.
-- ============================================

ALTER TYPE public.registration_status ADD VALUE IF NOT EXISTS 'payment_pending';
