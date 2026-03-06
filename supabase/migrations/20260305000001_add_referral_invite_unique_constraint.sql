-- Add unique constraint on (referrer_id, recipient_email) for referral_invite
-- Required by the upsert with ON CONFLICT in referralService.ts
-- NULLs are treated as distinct in PostgreSQL, so rows without email won't conflict.

ALTER TABLE public.referral_invite
ADD CONSTRAINT uq_referral_invite_referrer_email UNIQUE (referrer_id, recipient_email);
