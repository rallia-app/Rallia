-- Make table-level GRANTs explicit for chat tables.
-- Idempotent and a no-op against prod/staging (grants already present);
-- restores them on local resets and codifies them ahead of Supabase
-- removing implicit Data API grants (2026-10-30).
--
-- Local Supabase resets can drop the implicit Data API grants on these
-- tables, leaving only REFERENCES/TRIGGER/TRUNCATE. That surfaces as
-- "permission denied for table conversation" when the web/mobile client
-- reads or sends chat, even though RLS would have allowed the row.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation TO service_role, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_participant TO service_role, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message TO service_role, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_reaction TO service_role, authenticated;
