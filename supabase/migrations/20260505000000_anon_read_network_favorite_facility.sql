-- Allow anonymous (signed-out) users to read network_favorite_facility
-- rows when the underlying network is public.
--
-- Context: the existing "Anyone can view network favorite facilities" SELECT
-- policy is scoped to {authenticated} despite its name, so signed-out users
-- on the Group/Community Facilities tab got zero rows back even though
-- favorites are configured. This mirrors the pattern already in place for
-- network_member ("Anon users can view network members" gated on
-- network.is_private = false).

CREATE POLICY "Anon users can view network favorite facilities"
ON public.network_favorite_facility
FOR SELECT
TO anon
USING (
  EXISTS (
    SELECT 1
    FROM public.network n
    WHERE n.id = network_favorite_facility.network_id
      AND (n.is_private = false OR n.is_private IS NULL)
  )
);
