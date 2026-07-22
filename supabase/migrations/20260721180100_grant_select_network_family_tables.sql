-- Grant the missing table-level SELECT on the network family tables.
--
-- network / network_member / network_type were created in the initial schema
-- (2026-11 era) and never received explicit grants. They have RLS enabled with
-- SELECT policies targeting anon/authenticated (e.g. "Authenticated users can
-- view network types" USING true, "Anon users can view public networks"), but
-- those policies are dead without a table-level GRANT: the invoking role gets
-- "permission denied for table ..." before RLS is ever consulted.
--
-- The tournaments_select policy's community branch evaluates an EXISTS over
-- network_member as the invoking role, which transitively reaches network and
-- network_type, so any authenticated user reading a community-scoped tournament
-- hits this. Idempotent; a no-op against prod/staging where the historical
-- implicit Data API grants already cover these, and future-proof ahead of
-- Supabase removing those implicit grants (2026-10-30).

GRANT SELECT ON public.network TO anon, authenticated, service_role;
GRANT SELECT ON public.network_member TO anon, authenticated, service_role;
GRANT SELECT ON public.network_type TO anon, authenticated, service_role;
