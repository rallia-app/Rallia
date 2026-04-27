-- =============================================================================
-- Migration: Replace Rallia Beta auto-join with GMA zone-based auto-join
-- Description: When a player completes onboarding, automatically add them to
--              the GMA community matching their (zone × sport × skill_level).
--              Zone is derived from player.location via nearest of 5 hardcoded
--              zone centroids (Mail Fairview, Avenue Monkland, Plateau-Mont-
--              Royal, Stade IGA, Promenades Hochelaga). Replaces the prior
--              "Rallia Beta" auto-join trigger.
-- =============================================================================

-- =============================================================================
-- STEP 1: Drop the prior beta auto-join trigger + function
-- The Rallia Beta network row and its members are intentionally preserved.
-- =============================================================================
DROP TRIGGER IF EXISTS trigger_add_to_beta_communities ON public.profile;
DROP FUNCTION IF EXISTS public.add_to_rallia_beta_communities();

-- =============================================================================
-- STEP 2: Helper - derive_zone_from_location
-- Returns one of 'ouest_ile' | 'ouest' | 'centre' | 'nord' | 'est', or NULL
-- when the location is NULL or further than 50 km from every centroid.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.derive_zone_from_location(
  p_location extensions.geography
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  -- Centroids tuned by coordinate descent against the sheet 3 venue assignments
  -- (132 venues with ground-truth zone labels). Optimum is 12/132 = 9.1% error;
  -- residual errors are zones that geometrically overlap (Lachine ↔ NDG,
  -- Saint-Laurent ↔ Saint-Léonard) and cannot be separated by Voronoi alone.
  SELECT zone
  FROM (
    VALUES
      ('ouest_ile', extensions.ST_SetSRID(extensions.ST_MakePoint(-73.8097, 45.4773), 4326)::extensions.geography),
      ('ouest',     extensions.ST_SetSRID(extensions.ST_MakePoint(-73.5888, 45.4687), 4326)::extensions.geography),
      ('centre',    extensions.ST_SetSRID(extensions.ST_MakePoint(-73.5718, 45.5300), 4326)::extensions.geography),
      ('nord',      extensions.ST_SetSRID(extensions.ST_MakePoint(-73.6703, 45.5608), 4326)::extensions.geography),
      ('est',       extensions.ST_SetSRID(extensions.ST_MakePoint(-73.5662, 45.6021), 4326)::extensions.geography)
  ) AS centroids(zone, geo)
  WHERE p_location IS NOT NULL
    AND extensions.ST_Distance(p_location, centroids.geo) <= 50000
  ORDER BY extensions.ST_Distance(p_location, centroids.geo) ASC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.derive_zone_from_location IS
'Returns the GMA zone (ouest_ile/ouest/centre/nord/est) of the nearest of 5 hardcoded community centroids, or NULL if location is NULL or > 50 km from any centroid.';

-- =============================================================================
-- STEP 3: Trigger function - add_to_zone_communities
-- Fires on profile.onboarding_completed flipping to TRUE. Resolves player zone
-- from player.location, then for each (player_sport, skill_level) inserts a
-- network_member row into the matching community.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.add_to_zone_communities()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_community_type_id UUID;
  v_zone TEXT;
  v_location extensions.geography;
  v_player_sport RECORD;
  v_player_skill skill_level;
BEGIN
  -- Only fire on the FALSE/NULL -> TRUE transition
  IF NOT (NEW.onboarding_completed = TRUE
          AND (OLD.onboarding_completed IS DISTINCT FROM TRUE)) THEN
    RETURN NEW;
  END IF;

  -- Player record must exist
  SELECT location INTO v_location FROM public.player WHERE id = NEW.id;
  IF NOT FOUND THEN
    RAISE LOG 'Zone auto-join skipped (no player record): user_id=%', NEW.id;
    RETURN NEW;
  END IF;

  v_zone := public.derive_zone_from_location(v_location);
  IF v_zone IS NULL THEN
    RAISE LOG 'Zone auto-join skipped (no resolvable zone): player_id=%', NEW.id;
    RETURN NEW;
  END IF;

  SELECT id INTO v_community_type_id
  FROM public.network_type WHERE name = 'community';

  -- For each sport the player has selected
  FOR v_player_sport IN
    SELECT sport_id FROM public.player_sport WHERE player_id = NEW.id
  LOOP
    -- Resolve the player's skill level for that sport via their rating_score
    SELECT rs.skill_level INTO v_player_skill
    FROM public.player_rating_score prs
    JOIN public.rating_score rs ON rs.id = prs.rating_score_id
    JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
    WHERE prs.player_id = NEW.id
      AND rsy.sport_id = v_player_sport.sport_id
    ORDER BY rs.value DESC NULLS LAST
    LIMIT 1;

    IF v_player_skill IS NULL THEN
      RAISE LOG 'Zone auto-join: no rating for sport=% player=%, skipping',
        v_player_sport.sport_id, NEW.id;
      CONTINUE;
    END IF;

    -- Map professional -> advanced for community matching
    IF v_player_skill = 'professional' THEN
      v_player_skill := 'advanced';
    END IF;

    INSERT INTO public.network_member (
      network_id, player_id, status, joined_at, request_type, role, added_by
    )
    SELECT
      n.id, NEW.id, 'active'::network_member_status, NOW(),
      'direct_add'::network_member_request_type, 'member', NULL
    FROM public.network n
    WHERE n.network_type_id = v_community_type_id
      AND n.zone = v_zone
      AND n.sport_id = v_player_sport.sport_id
      AND n.skill_level = v_player_skill
      AND n.archived_at IS NULL
    ON CONFLICT (network_id, player_id) DO NOTHING;
  END LOOP;

  RAISE LOG 'Zone auto-join completed: player_id=%, zone=%', NEW.id, v_zone;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.add_to_zone_communities IS
'Trigger function: on profile.onboarding_completed=TRUE, adds the player to the GMA community matching their (zone × sport × skill_level). Zone derived from player.location; skill_level from player_rating_score.';

DROP TRIGGER IF EXISTS trigger_add_to_zone_communities ON public.profile;

CREATE TRIGGER trigger_add_to_zone_communities
  AFTER UPDATE OF onboarding_completed ON public.profile
  FOR EACH ROW
  EXECUTE FUNCTION public.add_to_zone_communities();

COMMENT ON TRIGGER trigger_add_to_zone_communities ON public.profile IS
'Fires when onboarding_completed flips to TRUE; auto-joins the player to their GMA zone communities.';

-- =============================================================================
-- STEP 4: Backfill existing onboarded users
-- =============================================================================
DO $$
DECLARE
  v_community_type_id UUID;
  v_inserted INTEGER;
BEGIN
  SELECT id INTO v_community_type_id
  FROM public.network_type WHERE name = 'community';

  WITH player_zone_skill AS (
    SELECT
      p.id AS player_id,
      public.derive_zone_from_location(p.location) AS zone,
      rsy.sport_id,
      CASE WHEN rs.skill_level = 'professional' THEN 'advanced'::skill_level
           ELSE rs.skill_level END AS skill_level
    FROM public.profile pr
    JOIN public.player p ON p.id = pr.id
    JOIN public.player_rating_score prs ON prs.player_id = p.id
    JOIN public.rating_score rs ON rs.id = prs.rating_score_id
    JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
    JOIN public.player_sport ps ON ps.player_id = p.id AND ps.sport_id = rsy.sport_id
    WHERE pr.onboarding_completed = TRUE
  ),
  inserted AS (
    INSERT INTO public.network_member (
      network_id, player_id, status, joined_at, request_type, role
    )
    SELECT
      n.id, pzs.player_id, 'active'::network_member_status, NOW(),
      'direct_add'::network_member_request_type, 'member'
    FROM player_zone_skill pzs
    JOIN public.network n
      ON n.network_type_id = v_community_type_id
     AND n.zone = pzs.zone
     AND n.sport_id = pzs.sport_id
     AND n.skill_level = pzs.skill_level
     AND n.archived_at IS NULL
    WHERE pzs.zone IS NOT NULL
      AND pzs.skill_level IS NOT NULL
    ON CONFLICT (network_id, player_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM inserted;

  RAISE NOTICE 'Zone auto-join backfill: % memberships inserted', v_inserted;
END
$$;
