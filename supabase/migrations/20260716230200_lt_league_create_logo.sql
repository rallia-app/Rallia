-- ============================================
-- Leagues & Tournaments — league_create gains a cover image
-- ============================================
-- Mirrors the tournament-logos bucket/pattern (20260622120100,
-- 20260622120400): leagues.logo_url already existed and is already patchable
-- via league_update (20260716180000), but league_create never accepted it, so
-- there was no way to set a cover image at creation time.
--
-- CREATE OR REPLACE can't add a trailing parameter safely here: Postgres
-- resolves overloaded calls by parameter *types*, so a plain CREATE OR REPLACE
-- with an extra arg creates a second, distinct overload rather than replacing
-- the original — any caller invoking the old 11-arg shape then hits a
-- "function is not unique" ambiguity error. Drop the exact old signature first.
-- ============================================

DROP FUNCTION IF EXISTS public.league_create(
    text, uuid, text, tournament_visibility, tournament_registration_mode,
    uuid, text, uuid, numeric, numeric, smallint
);

CREATE OR REPLACE FUNCTION public.league_create(
    p_name              text,
    p_sport_id          uuid,
    p_description       text                          DEFAULT NULL,
    p_visibility        tournament_visibility         DEFAULT 'private',
    p_join_mode         tournament_registration_mode  DEFAULT 'approval',
    p_facility_id       uuid                          DEFAULT NULL,
    p_venue_name        text                          DEFAULT NULL,
    p_network_id        uuid                          DEFAULT NULL,
    p_min_rating        numeric                       DEFAULT NULL,
    p_max_rating        numeric                       DEFAULT NULL,
    p_min_reputation    smallint                      DEFAULT NULL,
    p_logo_url          text                          DEFAULT NULL
)
RETURNS leagues
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id    uuid := auth.uid();
    v_recent_count integer;
    v_rules        jsonb;
    v_row          leagues;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    PERFORM public.assert_caller_plays_sport(p_sport_id);

    IF p_network_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1
              FROM network n
              JOIN network_type nt ON nt.id = n.network_type_id
             WHERE n.id = p_network_id
               AND nt.name = 'community'
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NETWORK_NOT_COMMUNITY';
        END IF;
    END IF;

    IF NOT public.is_admin() THEN
        SELECT count(*) INTO v_recent_count
          FROM leagues
         WHERE organizer_id = v_caller_id
           AND created_at  > now() - interval '24 hours';

        IF v_recent_count >= 5 THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RATE_LIMITED';
        END IF;
    END IF;

    v_rules := public.lt_league_default_rules(p_sport_id);

    INSERT INTO leagues (
        name, sport_id, description, visibility, join_mode,
        facility_id, venue_name, network_id,
        min_rating, max_rating, min_reputation, logo_url,
        default_rules, organizer_id
    )
    VALUES (
        p_name, p_sport_id, p_description, p_visibility, p_join_mode,
        p_facility_id, p_venue_name, p_network_id,
        p_min_rating, p_max_rating, p_min_reputation, p_logo_url,
        v_rules, v_caller_id
    )
    RETURNING * INTO v_row;

    INSERT INTO league_members (league_id, user_id, role, status, approved_at, approved_by)
    VALUES (v_row.id, v_caller_id, 'organizer', 'active', now(), v_caller_id);

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'league', v_row.id, 'create', v_caller_id,
        jsonb_build_object(
            'name', v_row.name,
            'sport_id', v_row.sport_id,
            'visibility', v_row.visibility,
            'join_mode', v_row.join_mode
        )
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_create(
    text, uuid, text, tournament_visibility, tournament_registration_mode,
    uuid, text, uuid, numeric, numeric, smallint, text
) TO authenticated;

-- =====================
-- league-logos storage bucket
-- =====================
-- Public bucket for league cover images, mirroring tournament-logos
-- (20260622120100_tournament_logos_bucket.sql).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'league-logos',
  'league-logos',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated users can upload league logos" ON storage.objects;
CREATE POLICY "Authenticated users can upload league logos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'league-logos');

DROP POLICY IF EXISTS "Anyone can view league logos" ON storage.objects;
CREATE POLICY "Anyone can view league logos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'league-logos');

DROP POLICY IF EXISTS "Authenticated users can update league logos" ON storage.objects;
CREATE POLICY "Authenticated users can update league logos"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'league-logos')
WITH CHECK (bucket_id = 'league-logos');

DROP POLICY IF EXISTS "Authenticated users can delete league logos" ON storage.objects;
CREATE POLICY "Authenticated users can delete league logos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'league-logos');
