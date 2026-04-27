-- =============================================================================
-- Migration: Add zone columns to network and seed GMA communities
-- Description: Adds zone, skill_level, neighborhoods, reference_location to
--              public.network. Seeds 30 GMA communities (5 zones x 2 sports x
--              3 levels) from docs/GMA_Communautes_v2.xlsx (sheet 1).
-- =============================================================================

-- =============================================================================
-- STEP 1: Add columns
-- =============================================================================
ALTER TABLE public.network
  ADD COLUMN IF NOT EXISTS zone TEXT,
  ADD COLUMN IF NOT EXISTS skill_level skill_level,
  ADD COLUMN IF NOT EXISTS neighborhoods TEXT[],
  ADD COLUMN IF NOT EXISTS reference_location TEXT;

ALTER TABLE public.network
  DROP CONSTRAINT IF EXISTS network_zone_check;

ALTER TABLE public.network
  ADD CONSTRAINT network_zone_check
  CHECK (zone IS NULL OR zone IN ('ouest_ile','ouest','centre','nord','est'));

COMMENT ON COLUMN public.network.zone IS 'GMA community zone (ouest_ile, ouest, centre, nord, est). NULL for non-zone networks.';
COMMENT ON COLUMN public.network.skill_level IS 'Target skill level for the community (beginner/intermediate/advanced/professional). NULL for non-leveled networks.';
COMMENT ON COLUMN public.network.neighborhoods IS 'Neighborhoods covered by the community (display only).';
COMMENT ON COLUMN public.network.reference_location IS 'Human-readable anchor location for the community (display only).';

-- One community per (zone, sport, skill_level). Predicate omits the
-- network_type filter (Postgres disallows subqueries in index predicates) — in
-- practice only community rows ever have zone IS NOT NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_network_zone_sport_skill_level
  ON public.network (zone, sport_id, skill_level)
  WHERE archived_at IS NULL
    AND zone IS NOT NULL;

-- =============================================================================
-- STEP 2: Seed 30 GMA communities
-- =============================================================================
DO $$
DECLARE
  v_community_type_id UUID;
  v_creator_id UUID;
  v_tennis_id UUID;
  v_pickleball_id UUID;
  v_min_score_id UUID;
  v_sport_id UUID;
BEGIN
  SELECT id INTO v_community_type_id
  FROM public.network_type WHERE name = 'community';
  IF v_community_type_id IS NULL THEN
    RAISE EXCEPTION 'network_type "community" not found';
  END IF;

  SELECT id INTO v_tennis_id     FROM public.sport WHERE name = 'tennis';
  SELECT id INTO v_pickleball_id FROM public.sport WHERE name = 'pickleball';

  IF v_tennis_id IS NULL OR v_pickleball_id IS NULL THEN
    RAISE EXCEPTION 'Tennis or Pickleball sport not found';
  END IF;

  -- Reuse the creator of the existing "Rallia Beta" community so created_by
  -- references a real player. Falls back to the oldest player if Rallia Beta
  -- doesn't exist (e.g. fresh DB).
  SELECT created_by INTO v_creator_id
  FROM public.network
  WHERE name = 'Rallia Beta'
    AND network_type_id = v_community_type_id
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_creator_id IS NULL THEN
    SELECT id INTO v_creator_id FROM public.player ORDER BY created_at ASC LIMIT 1;
  END IF;

  IF v_creator_id IS NULL THEN
    RAISE NOTICE 'No player found to use as creator; skipping GMA community seed.';
    RETURN;
  END IF;

  -- COM-001: Fairview Smash — Tennis Débutant
  v_sport_id := v_tennis_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'ntrp' AND rs.value = 1.5
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Fairview Smash — Tennis Débutant',
    'Communauté de l''Ouest-de-l''Île, entre fleuve et rapides. Quartiers couverts : Pierrefonds, Roxboro, L''Île-Bizard, Sainte-Geneviève, Kirkland, Dollard-des-Ormeaux, Dorval, Lachine, Montréal-Ouest. Ambiance suburban et nature, joueurs de clubs privés et parcs municipaux bien équipés.',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Fairview_Pointe-Claire.jpg/1280px-Fairview_Pointe-Claire.jpg',
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'ouest_ile', 'beginner'::skill_level,
    ARRAY['Pierrefonds','Roxboro','L''Île-Bizard','Sainte-Geneviève','Kirkland','Dollard-des-Ormeaux','Dorval','Lachine','Montréal-Ouest']::TEXT[],
    'Mail Fairview / Transcanadienne',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-002: Fairview Smash — Tennis Intermédiaire
  v_sport_id := v_tennis_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'ntrp' AND rs.value = 3.0
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Fairview Smash — Tennis Intermédiaire',
    'Communauté de l''Ouest-de-l''Île, entre fleuve et rapides. Quartiers couverts : Pierrefonds, Roxboro, L''Île-Bizard, Sainte-Geneviève, Kirkland, Dollard-des-Ormeaux, Dorval, Lachine, Montréal-Ouest. Ambiance suburban et nature, joueurs de clubs privés et parcs municipaux bien équipés.',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Fairview_Pointe-Claire.jpg/1280px-Fairview_Pointe-Claire.jpg',
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'ouest_ile', 'intermediate'::skill_level,
    ARRAY['Pierrefonds','Roxboro','L''Île-Bizard','Sainte-Geneviève','Kirkland','Dollard-des-Ormeaux','Dorval','Lachine','Montréal-Ouest']::TEXT[],
    'Mail Fairview / Transcanadienne',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-003: Fairview Smash — Tennis Avancé
  v_sport_id := v_tennis_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'ntrp' AND rs.value = 4.5
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Fairview Smash — Tennis Avancé',
    'Communauté de l''Ouest-de-l''Île, entre fleuve et rapides. Quartiers couverts : Pierrefonds, Roxboro, L''Île-Bizard, Sainte-Geneviève, Kirkland, Dollard-des-Ormeaux, Dorval, Lachine, Montréal-Ouest. Ambiance suburban et nature, joueurs de clubs privés et parcs municipaux bien équipés.',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Fairview_Pointe-Claire.jpg/1280px-Fairview_Pointe-Claire.jpg',
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'ouest_ile', 'advanced'::skill_level,
    ARRAY['Pierrefonds','Roxboro','L''Île-Bizard','Sainte-Geneviève','Kirkland','Dollard-des-Ormeaux','Dorval','Lachine','Montréal-Ouest']::TEXT[],
    'Mail Fairview / Transcanadienne',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-004: Fairview Smash — Pickleball Débutant
  v_sport_id := v_pickleball_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'dupr' AND rs.value = 2.0
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Fairview Smash — Pickleball Débutant',
    'Communauté de l''Ouest-de-l''Île, entre fleuve et rapides. Quartiers couverts : Pierrefonds, Roxboro, L''Île-Bizard, Sainte-Geneviève, Kirkland, Dollard-des-Ormeaux, Dorval, Lachine, Montréal-Ouest. Ambiance suburban et nature, joueurs de clubs privés et parcs municipaux bien équipés.',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Fairview_Pointe-Claire.jpg/1280px-Fairview_Pointe-Claire.jpg',
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'ouest_ile', 'beginner'::skill_level,
    ARRAY['Pierrefonds','Roxboro','L''Île-Bizard','Sainte-Geneviève','Kirkland','Dollard-des-Ormeaux','Dorval','Lachine','Montréal-Ouest']::TEXT[],
    'Mail Fairview / Transcanadienne',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-005: Fairview Smash — Pickleball Intermédiaire
  v_sport_id := v_pickleball_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'dupr' AND rs.value = 3.0
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Fairview Smash — Pickleball Intermédiaire',
    'Communauté de l''Ouest-de-l''Île, entre fleuve et rapides. Quartiers couverts : Pierrefonds, Roxboro, L''Île-Bizard, Sainte-Geneviève, Kirkland, Dollard-des-Ormeaux, Dorval, Lachine, Montréal-Ouest. Ambiance suburban et nature, joueurs de clubs privés et parcs municipaux bien équipés.',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Fairview_Pointe-Claire.jpg/1280px-Fairview_Pointe-Claire.jpg',
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'ouest_ile', 'intermediate'::skill_level,
    ARRAY['Pierrefonds','Roxboro','L''Île-Bizard','Sainte-Geneviève','Kirkland','Dollard-des-Ormeaux','Dorval','Lachine','Montréal-Ouest']::TEXT[],
    'Mail Fairview / Transcanadienne',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-006: Fairview Smash — Pickleball Avancé
  v_sport_id := v_pickleball_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'dupr' AND rs.value = 4.0
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Fairview Smash — Pickleball Avancé',
    'Communauté de l''Ouest-de-l''Île, entre fleuve et rapides. Quartiers couverts : Pierrefonds, Roxboro, L''Île-Bizard, Sainte-Geneviève, Kirkland, Dollard-des-Ormeaux, Dorval, Lachine, Montréal-Ouest. Ambiance suburban et nature, joueurs de clubs privés et parcs municipaux bien équipés.',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Fairview_Pointe-Claire.jpg/1280px-Fairview_Pointe-Claire.jpg',
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'ouest_ile', 'advanced'::skill_level,
    ARRAY['Pierrefonds','Roxboro','L''Île-Bizard','Sainte-Geneviève','Kirkland','Dollard-des-Ormeaux','Dorval','Lachine','Montréal-Ouest']::TEXT[],
    'Mail Fairview / Transcanadienne',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-007: Monkland Ace — Tennis Débutant
  v_sport_id := v_tennis_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'ntrp' AND rs.value = 1.5
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Monkland Ace — Tennis Débutant',
    'Communauté du centre-ouest montréalais, de NDG jusqu''au fleuve. Quartiers couverts : Notre-Dame-de-Grâce, Côte-des-Neiges, Westmount, Côte-Saint-Luc, Hampstead, Verdun, LaSalle, Saint-Henri. Mix francophone/anglophone, culture de village urbain autour de l''avenue Monkland.',
    NULL,
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'ouest', 'beginner'::skill_level,
    ARRAY['Notre-Dame-de-Grâce (NDG)','Côte-des-Neiges (CDN)','Westmount','Côte-Saint-Luc','Hampstead','Verdun','LaSalle','Saint-Henri']::TEXT[],
    'Avenue Monkland / NDG',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-008: Monkland Ace — Tennis Intermédiaire
  v_sport_id := v_tennis_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'ntrp' AND rs.value = 3.0
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Monkland Ace — Tennis Intermédiaire',
    'Communauté du centre-ouest montréalais, de NDG jusqu''au fleuve. Quartiers couverts : Notre-Dame-de-Grâce, Côte-des-Neiges, Westmount, Côte-Saint-Luc, Hampstead, Verdun, LaSalle, Saint-Henri. Mix francophone/anglophone, culture de village urbain autour de l''avenue Monkland.',
    NULL,
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'ouest', 'intermediate'::skill_level,
    ARRAY['Notre-Dame-de-Grâce (NDG)','Côte-des-Neiges (CDN)','Westmount','Côte-Saint-Luc','Hampstead','Verdun','LaSalle','Saint-Henri']::TEXT[],
    'Avenue Monkland / NDG',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-009: Monkland Ace — Tennis Avancé
  v_sport_id := v_tennis_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'ntrp' AND rs.value = 4.5
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Monkland Ace — Tennis Avancé',
    'Communauté du centre-ouest montréalais, de NDG jusqu''au fleuve. Quartiers couverts : Notre-Dame-de-Grâce, Côte-des-Neiges, Westmount, Côte-Saint-Luc, Hampstead, Verdun, LaSalle, Saint-Henri. Mix francophone/anglophone, culture de village urbain autour de l''avenue Monkland.',
    NULL,
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'ouest', 'advanced'::skill_level,
    ARRAY['Notre-Dame-de-Grâce (NDG)','Côte-des-Neiges (CDN)','Westmount','Côte-Saint-Luc','Hampstead','Verdun','LaSalle','Saint-Henri']::TEXT[],
    'Avenue Monkland / NDG',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-010: Monkland Ace — Pickleball Débutant
  v_sport_id := v_pickleball_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'dupr' AND rs.value = 2.0
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Monkland Ace — Pickleball Débutant',
    'Communauté du centre-ouest montréalais, de NDG jusqu''au fleuve. Quartiers couverts : Notre-Dame-de-Grâce, Côte-des-Neiges, Westmount, Côte-Saint-Luc, Hampstead, Verdun, LaSalle, Saint-Henri. Mix francophone/anglophone, culture de village urbain autour de l''avenue Monkland.',
    NULL,
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'ouest', 'beginner'::skill_level,
    ARRAY['Notre-Dame-de-Grâce (NDG)','Côte-des-Neiges (CDN)','Westmount','Côte-Saint-Luc','Hampstead','Verdun','LaSalle','Saint-Henri']::TEXT[],
    'Avenue Monkland / NDG',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-011: Monkland Ace — Pickleball Intermédiaire
  v_sport_id := v_pickleball_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'dupr' AND rs.value = 3.0
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Monkland Ace — Pickleball Intermédiaire',
    'Communauté du centre-ouest montréalais, de NDG jusqu''au fleuve. Quartiers couverts : Notre-Dame-de-Grâce, Côte-des-Neiges, Westmount, Côte-Saint-Luc, Hampstead, Verdun, LaSalle, Saint-Henri. Mix francophone/anglophone, culture de village urbain autour de l''avenue Monkland.',
    NULL,
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'ouest', 'intermediate'::skill_level,
    ARRAY['Notre-Dame-de-Grâce (NDG)','Côte-des-Neiges (CDN)','Westmount','Côte-Saint-Luc','Hampstead','Verdun','LaSalle','Saint-Henri']::TEXT[],
    'Avenue Monkland / NDG',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-012: Monkland Ace — Pickleball Avancé
  v_sport_id := v_pickleball_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'dupr' AND rs.value = 4.0
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Monkland Ace — Pickleball Avancé',
    'Communauté du centre-ouest montréalais, de NDG jusqu''au fleuve. Quartiers couverts : Notre-Dame-de-Grâce, Côte-des-Neiges, Westmount, Côte-Saint-Luc, Hampstead, Verdun, LaSalle, Saint-Henri. Mix francophone/anglophone, culture de village urbain autour de l''avenue Monkland.',
    NULL,
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'ouest', 'advanced'::skill_level,
    ARRAY['Notre-Dame-de-Grâce (NDG)','Côte-des-Neiges (CDN)','Westmount','Côte-Saint-Luc','Hampstead','Verdun','LaSalle','Saint-Henri']::TEXT[],
    'Avenue Monkland / NDG',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-013: Plateau Ace — Tennis Débutant
  v_sport_id := v_tennis_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'ntrp' AND rs.value = 1.5
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Plateau Ace — Tennis Débutant',
    'Communauté du cœur créatif de Montréal, autour du mont Royal et de la Main. Quartiers couverts : Plateau-Mont-Royal, Mile End, Outremont, Rosemont, La Petite-Patrie, Ville-Marie, Hochelaga-Maisonneuve. Courts emblématiques comme Jeanne-Mance, La Fontaine et le parc La Fontaine.',
    NULL,
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'centre', 'beginner'::skill_level,
    ARRAY['Plateau-Mont-Royal','Mile End','Outremont','Rosemont','Petite-Patrie','Ville-Marie','Hochelaga-Maisonneuve']::TEXT[],
    'Le Plateau-Mont-Royal',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-014: Plateau Ace — Tennis Intermédiaire
  v_sport_id := v_tennis_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'ntrp' AND rs.value = 3.0
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Plateau Ace — Tennis Intermédiaire',
    'Communauté du cœur créatif de Montréal, autour du mont Royal et de la Main. Quartiers couverts : Plateau-Mont-Royal, Mile End, Outremont, Rosemont, La Petite-Patrie, Ville-Marie, Hochelaga-Maisonneuve. Courts emblématiques comme Jeanne-Mance, La Fontaine et le parc La Fontaine.',
    NULL,
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'centre', 'intermediate'::skill_level,
    ARRAY['Plateau-Mont-Royal','Mile End','Outremont','Rosemont','Petite-Patrie','Ville-Marie','Hochelaga-Maisonneuve']::TEXT[],
    'Le Plateau-Mont-Royal',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-015: Plateau Ace — Tennis Avancé
  v_sport_id := v_tennis_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'ntrp' AND rs.value = 4.5
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Plateau Ace — Tennis Avancé',
    'Communauté du cœur créatif de Montréal, autour du mont Royal et de la Main. Quartiers couverts : Plateau-Mont-Royal, Mile End, Outremont, Rosemont, La Petite-Patrie, Ville-Marie, Hochelaga-Maisonneuve. Courts emblématiques comme Jeanne-Mance, La Fontaine et le parc La Fontaine.',
    NULL,
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'centre', 'advanced'::skill_level,
    ARRAY['Plateau-Mont-Royal','Mile End','Outremont','Rosemont','Petite-Patrie','Ville-Marie','Hochelaga-Maisonneuve']::TEXT[],
    'Le Plateau-Mont-Royal',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-016: Plateau Ace — Pickleball Débutant
  v_sport_id := v_pickleball_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'dupr' AND rs.value = 2.0
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Plateau Ace — Pickleball Débutant',
    'Communauté du cœur créatif de Montréal, autour du mont Royal et de la Main. Quartiers couverts : Plateau-Mont-Royal, Mile End, Outremont, Rosemont, La Petite-Patrie, Ville-Marie, Hochelaga-Maisonneuve. Courts emblématiques comme Jeanne-Mance, La Fontaine et le parc La Fontaine.',
    NULL,
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'centre', 'beginner'::skill_level,
    ARRAY['Plateau-Mont-Royal','Mile End','Outremont','Rosemont','Petite-Patrie','Ville-Marie','Hochelaga-Maisonneuve']::TEXT[],
    'Le Plateau-Mont-Royal',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-017: Plateau Ace — Pickleball Intermédiaire
  v_sport_id := v_pickleball_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'dupr' AND rs.value = 3.0
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Plateau Ace — Pickleball Intermédiaire',
    'Communauté du cœur créatif de Montréal, autour du mont Royal et de la Main. Quartiers couverts : Plateau-Mont-Royal, Mile End, Outremont, Rosemont, La Petite-Patrie, Ville-Marie, Hochelaga-Maisonneuve. Courts emblématiques comme Jeanne-Mance, La Fontaine et le parc La Fontaine.',
    NULL,
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'centre', 'intermediate'::skill_level,
    ARRAY['Plateau-Mont-Royal','Mile End','Outremont','Rosemont','Petite-Patrie','Ville-Marie','Hochelaga-Maisonneuve']::TEXT[],
    'Le Plateau-Mont-Royal',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-018: Plateau Ace — Pickleball Avancé
  v_sport_id := v_pickleball_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'dupr' AND rs.value = 4.0
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Plateau Ace — Pickleball Avancé',
    'Communauté du cœur créatif de Montréal, autour du mont Royal et de la Main. Quartiers couverts : Plateau-Mont-Royal, Mile End, Outremont, Rosemont, La Petite-Patrie, Ville-Marie, Hochelaga-Maisonneuve. Courts emblématiques comme Jeanne-Mance, La Fontaine et le parc La Fontaine.',
    NULL,
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'centre', 'advanced'::skill_level,
    ARRAY['Plateau-Mont-Royal','Mile End','Outremont','Rosemont','Petite-Patrie','Ville-Marie','Hochelaga-Maisonneuve']::TEXT[],
    'Le Plateau-Mont-Royal',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-019: Jarry Serve — Tennis Débutant
  v_sport_id := v_tennis_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'ntrp' AND rs.value = 1.5
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Jarry Serve — Tennis Débutant',
    'Communauté du nord de l''île, ancrée autour du Stade IGA et du Complexe Claude-Robillard. Quartiers couverts : Ahuntsic, Cartierville, Villeray, Saint-Michel, Parc-Extension, Saint-Laurent, Montréal-Nord, Mont-Royal (ville). Quartiers familiaux avec une forte tradition tennistique (Coupe Rogers / Omnium canadien).',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Coupe_Rogers_2015_%40_Montr%C3%A9al_%2819971844064%29.jpg/1280px-Coupe_Rogers_2015_%40_Montr%C3%A9al_%2819971844064%29.jpg',
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'nord', 'beginner'::skill_level,
    ARRAY['Ahuntsic','Cartierville','Villeray','Saint-Michel','Parc-Extension','Saint-Laurent','Montréal-Nord','Mont-Royal (ville)']::TEXT[],
    'Parc Jarry / Stade IGA',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-020: Jarry Serve — Tennis Intermédiaire
  v_sport_id := v_tennis_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'ntrp' AND rs.value = 3.0
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Jarry Serve — Tennis Intermédiaire',
    'Communauté du nord de l''île, ancrée autour du Stade IGA et du Complexe Claude-Robillard. Quartiers couverts : Ahuntsic, Cartierville, Villeray, Saint-Michel, Parc-Extension, Saint-Laurent, Montréal-Nord, Mont-Royal (ville). Quartiers familiaux avec une forte tradition tennistique (Coupe Rogers / Omnium canadien).',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Coupe_Rogers_2015_%40_Montr%C3%A9al_%2819971844064%29.jpg/1280px-Coupe_Rogers_2015_%40_Montr%C3%A9al_%2819971844064%29.jpg',
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'nord', 'intermediate'::skill_level,
    ARRAY['Ahuntsic','Cartierville','Villeray','Saint-Michel','Parc-Extension','Saint-Laurent','Montréal-Nord','Mont-Royal (ville)']::TEXT[],
    'Parc Jarry / Stade IGA',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-021: Jarry Serve — Tennis Avancé
  v_sport_id := v_tennis_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'ntrp' AND rs.value = 4.5
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Jarry Serve — Tennis Avancé',
    'Communauté du nord de l''île, ancrée autour du Stade IGA et du Complexe Claude-Robillard. Quartiers couverts : Ahuntsic, Cartierville, Villeray, Saint-Michel, Parc-Extension, Saint-Laurent, Montréal-Nord, Mont-Royal (ville). Quartiers familiaux avec une forte tradition tennistique (Coupe Rogers / Omnium canadien).',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Coupe_Rogers_2015_%40_Montr%C3%A9al_%2819971844064%29.jpg/1280px-Coupe_Rogers_2015_%40_Montr%C3%A9al_%2819971844064%29.jpg',
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'nord', 'advanced'::skill_level,
    ARRAY['Ahuntsic','Cartierville','Villeray','Saint-Michel','Parc-Extension','Saint-Laurent','Montréal-Nord','Mont-Royal (ville)']::TEXT[],
    'Parc Jarry / Stade IGA',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-022: Jarry Serve — Pickleball Débutant
  v_sport_id := v_pickleball_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'dupr' AND rs.value = 2.0
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Jarry Serve — Pickleball Débutant',
    'Communauté du nord de l''île, ancrée autour du Stade IGA et du Complexe Claude-Robillard. Quartiers couverts : Ahuntsic, Cartierville, Villeray, Saint-Michel, Parc-Extension, Saint-Laurent, Montréal-Nord, Mont-Royal (ville). Quartiers familiaux avec une forte tradition tennistique (Coupe Rogers / Omnium canadien).',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Coupe_Rogers_2015_%40_Montr%C3%A9al_%2819971844064%29.jpg/1280px-Coupe_Rogers_2015_%40_Montr%C3%A9al_%2819971844064%29.jpg',
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'nord', 'beginner'::skill_level,
    ARRAY['Ahuntsic','Cartierville','Villeray','Saint-Michel','Parc-Extension','Saint-Laurent','Montréal-Nord','Mont-Royal (ville)']::TEXT[],
    'Parc Jarry / Stade IGA',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-023: Jarry Serve — Pickleball Intermédiaire
  v_sport_id := v_pickleball_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'dupr' AND rs.value = 3.0
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Jarry Serve — Pickleball Intermédiaire',
    'Communauté du nord de l''île, ancrée autour du Stade IGA et du Complexe Claude-Robillard. Quartiers couverts : Ahuntsic, Cartierville, Villeray, Saint-Michel, Parc-Extension, Saint-Laurent, Montréal-Nord, Mont-Royal (ville). Quartiers familiaux avec une forte tradition tennistique (Coupe Rogers / Omnium canadien).',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Coupe_Rogers_2015_%40_Montr%C3%A9al_%2819971844064%29.jpg/1280px-Coupe_Rogers_2015_%40_Montr%C3%A9al_%2819971844064%29.jpg',
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'nord', 'intermediate'::skill_level,
    ARRAY['Ahuntsic','Cartierville','Villeray','Saint-Michel','Parc-Extension','Saint-Laurent','Montréal-Nord','Mont-Royal (ville)']::TEXT[],
    'Parc Jarry / Stade IGA',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-024: Jarry Serve — Pickleball Avancé
  v_sport_id := v_pickleball_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'dupr' AND rs.value = 4.0
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Jarry Serve — Pickleball Avancé',
    'Communauté du nord de l''île, ancrée autour du Stade IGA et du Complexe Claude-Robillard. Quartiers couverts : Ahuntsic, Cartierville, Villeray, Saint-Michel, Parc-Extension, Saint-Laurent, Montréal-Nord, Mont-Royal (ville). Quartiers familiaux avec une forte tradition tennistique (Coupe Rogers / Omnium canadien).',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Coupe_Rogers_2015_%40_Montr%C3%A9al_%2819971844064%29.jpg/1280px-Coupe_Rogers_2015_%40_Montr%C3%A9al_%2819971844064%29.jpg',
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'nord', 'advanced'::skill_level,
    ARRAY['Ahuntsic','Cartierville','Villeray','Saint-Michel','Parc-Extension','Saint-Laurent','Montréal-Nord','Mont-Royal (ville)']::TEXT[],
    'Parc Jarry / Stade IGA',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-025: Promenades Smash — Tennis Débutant
  v_sport_id := v_tennis_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'ntrp' AND rs.value = 1.5
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Promenades Smash — Tennis Débutant',
    'Communauté de l''est montréalais, au cœur d''une zone en plein essor. Quartiers couverts : Saint-Léonard, Anjou, Rivière-des-Prairies (RDP), Pointe-aux-Trembles (PAT), Montréal-Est. Identité locale forte, courts de quartier accessibles et parc Maisonneuve comme lieu de rassemblement sportif.',
    NULL,
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'est', 'beginner'::skill_level,
    ARRAY['Saint-Léonard','Anjou','Rivière-des-Prairies','Pointe-aux-Trembles','Montréal-Est']::TEXT[],
    'Promenades Hochelaga / Parc Maisonneuve',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-026: Promenades Smash — Tennis Intermédiaire
  v_sport_id := v_tennis_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'ntrp' AND rs.value = 3.0
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Promenades Smash — Tennis Intermédiaire',
    'Communauté de l''est montréalais, au cœur d''une zone en plein essor. Quartiers couverts : Saint-Léonard, Anjou, Rivière-des-Prairies (RDP), Pointe-aux-Trembles (PAT), Montréal-Est. Identité locale forte, courts de quartier accessibles et parc Maisonneuve comme lieu de rassemblement sportif.',
    NULL,
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'est', 'intermediate'::skill_level,
    ARRAY['Saint-Léonard','Anjou','Rivière-des-Prairies','Pointe-aux-Trembles','Montréal-Est']::TEXT[],
    'Promenades Hochelaga / Parc Maisonneuve',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-027: Promenades Smash — Tennis Avancé
  v_sport_id := v_tennis_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'ntrp' AND rs.value = 4.5
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Promenades Smash — Tennis Avancé',
    'Communauté de l''est montréalais, au cœur d''une zone en plein essor. Quartiers couverts : Saint-Léonard, Anjou, Rivière-des-Prairies (RDP), Pointe-aux-Trembles (PAT), Montréal-Est. Identité locale forte, courts de quartier accessibles et parc Maisonneuve comme lieu de rassemblement sportif.',
    NULL,
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'est', 'advanced'::skill_level,
    ARRAY['Saint-Léonard','Anjou','Rivière-des-Prairies','Pointe-aux-Trembles','Montréal-Est']::TEXT[],
    'Promenades Hochelaga / Parc Maisonneuve',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-028: Promenades Smash — Pickleball Débutant
  v_sport_id := v_pickleball_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'dupr' AND rs.value = 2.0
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Promenades Smash — Pickleball Débutant',
    'Communauté de l''est montréalais, au cœur d''une zone en plein essor. Quartiers couverts : Saint-Léonard, Anjou, Rivière-des-Prairies (RDP), Pointe-aux-Trembles (PAT), Montréal-Est. Identité locale forte, courts de quartier accessibles et parc Maisonneuve comme lieu de rassemblement sportif.',
    NULL,
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'est', 'beginner'::skill_level,
    ARRAY['Saint-Léonard','Anjou','Rivière-des-Prairies','Pointe-aux-Trembles','Montréal-Est']::TEXT[],
    'Promenades Hochelaga / Parc Maisonneuve',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-029: Promenades Smash — Pickleball Intermédiaire
  v_sport_id := v_pickleball_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'dupr' AND rs.value = 3.0
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Promenades Smash — Pickleball Intermédiaire',
    'Communauté de l''est montréalais, au cœur d''une zone en plein essor. Quartiers couverts : Saint-Léonard, Anjou, Rivière-des-Prairies (RDP), Pointe-aux-Trembles (PAT), Montréal-Est. Identité locale forte, courts de quartier accessibles et parc Maisonneuve comme lieu de rassemblement sportif.',
    NULL,
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'est', 'intermediate'::skill_level,
    ARRAY['Saint-Léonard','Anjou','Rivière-des-Prairies','Pointe-aux-Trembles','Montréal-Est']::TEXT[],
    'Promenades Hochelaga / Parc Maisonneuve',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

  -- COM-030: Promenades Smash — Pickleball Avancé
  v_sport_id := v_pickleball_id;
  SELECT rs.id INTO v_min_score_id
  FROM public.rating_score rs
  JOIN public.rating_system rsy ON rsy.id = rs.rating_system_id
  WHERE rsy.sport_id = v_sport_id AND rsy.code = 'dupr' AND rs.value = 4.0
  LIMIT 1;
  INSERT INTO public.network (
    network_type_id, name, description, cover_image_url, is_private, is_certified,
    created_by, sport_id, zone, skill_level, neighborhoods, reference_location,
    min_rating_score_id, max_members, member_count
  ) VALUES (
    v_community_type_id,
    'Promenades Smash — Pickleball Avancé',
    'Communauté de l''est montréalais, au cœur d''une zone en plein essor. Quartiers couverts : Saint-Léonard, Anjou, Rivière-des-Prairies (RDP), Pointe-aux-Trembles (PAT), Montréal-Est. Identité locale forte, courts de quartier accessibles et parc Maisonneuve comme lieu de rassemblement sportif.',
    NULL,
    FALSE, TRUE,
    v_creator_id, v_sport_id,
    'est', 'advanced'::skill_level,
    ARRAY['Saint-Léonard','Anjou','Rivière-des-Prairies','Pointe-aux-Trembles','Montréal-Est']::TEXT[],
    'Promenades Hochelaga / Parc Maisonneuve',
    v_min_score_id, NULL, 0
  )
  ON CONFLICT DO NOTHING;

END
$$;

-- =============================================================================
-- STEP 3: Verify
-- =============================================================================
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.network n
  JOIN public.network_type nt ON n.network_type_id = nt.id
  WHERE nt.name = 'community' AND n.zone IS NOT NULL;
  RAISE NOTICE 'GMA community seed: % rows with zone IS NOT NULL', v_count;
END
$$;

