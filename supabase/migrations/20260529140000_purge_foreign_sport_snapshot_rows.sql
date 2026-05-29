-- Migration: purge mis-stamped foreign-sport availability snapshot rows
--
-- Context: resolveSportId (refresh-facility-availability worker) had a
-- single-candidate fast path that stamped the only tagged sport onto every
-- court a provider returned — including courts for sports Rallia doesn't
-- model. IC3 / Loisirs Montréal siteIds bundle volleyball courts under
-- tennis-only facilities (e.g. Parc Hartenstein siteId 1035, "Terrain de
-- volleyball no 2"), so those slots were stamped tennis and leaked into the
-- tennis space's availability list (search_facilities_nearby filters slots by
-- sport_id = ANY(p_sport_ids)).
--
-- The worker now guards the single-candidate path against foreign sport
-- keywords and returns NULL instead of leaking. This migration removes the
-- rows already written before that fix shipped. The next refresh re-populates
-- each facility from the provider (now correctly skipping foreign courts).
--
-- Keyword list mirrors FOREIGN_SPORT_KEYWORDS in the worker. The
-- not-like-stamped-sport guard ensures we never delete a court that
-- legitimately names its own (supported) sport.

DELETE FROM public.facility_availability_snapshot fas
USING public.sport s
WHERE fas.sport_id = s.id
  AND lower(fas.court_name) ~ '(volleyball|volley|basketball|basket|soccer|futsal|football|baseball|softball|hockey|patinoire|patinage|badminton|handball|rugby|cricket|p[ée]tanque|shuffleboard|racquetball|racketball)'
  AND lower(fas.court_name) NOT LIKE '%' || lower(s.name) || '%';
