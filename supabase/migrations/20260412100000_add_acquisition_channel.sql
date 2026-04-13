-- Add acquisition channel column to track how users discovered Rallia
-- Populated from pre-onboarding "How did you hear about us?" question,
-- persisted to profile when onboarding completes.
ALTER TABLE public.profile
  ADD COLUMN IF NOT EXISTS acquisition_channel text;
