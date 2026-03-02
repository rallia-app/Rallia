-- =============================================================================
-- Basic Facility Seed Data
-- Creates organization, facilities, courts, and facility_sport records
-- =============================================================================

-- Step 1: Create the organization
INSERT INTO organization (id, name, nature, slug, city, postal_code, country, is_active)
VALUES (
  'a0000001-0000-0000-0000-000000000001',
  'Ville de Montréal - Sports et loisirs',
  'public',
  'ville-montreal-sports',
  'Montreal',
  'H2X 1Y4',
  'Canada',
  true
) ON CONFLICT (slug) DO NOTHING;

-- Step 2: Create the 3 Montreal park facilities
INSERT INTO facility (id, organization_id, name, facility_type, slug, address, city, postal_code, latitude, longitude, country, is_active, timezone, description)
VALUES 
  (
    'b0000001-0000-0000-0000-000000000001',
    'a0000001-0000-0000-0000-000000000001',
    'Terrains de tennis du parc Jeanne-Mance',
    'park',
    'parc-jeanne-mance-tennis',
    '4999 Avenue Esplanade',
    'Montreal',
    'H2W 1S8',
    45.5150,
    -73.5873,
    'Canada',
    true,
    'America/Toronto',
    'Popular public tennis courts in the heart of the Plateau, near Mount Royal.'
  ),
  (
    'b0000002-0000-0000-0000-000000000002',
    'a0000001-0000-0000-0000-000000000001',
    'Terrains de tennis du parc La Fontaine',
    'park',
    'parc-la-fontaine-tennis',
    '3933 Avenue du Parc-La Fontaine',
    'Montreal',
    'H2L 3M6',
    45.5270,
    -73.5690,
    'Canada',
    true,
    'America/Toronto',
    'Tennis and pickleball courts in one of Montreal''s largest parks.'
  ),
  (
    'b0000003-0000-0000-0000-000000000003',
    'a0000001-0000-0000-0000-000000000001',
    'Terrains de tennis et de pickleball du parc Martin-Luther-King',
    'park',
    'parc-martin-luther-king',
    '4650 Boulevard Pie-IX',
    'Montreal',
    'H1X 2B5',
    45.5520,
    -73.5650,
    'Canada',
    true,
    'America/Toronto',
    'Public park with tennis and pickleball facilities.'
  )
ON CONFLICT (slug) DO NOTHING;

-- Step 3: Create facility_sport links and courts
DO $$
DECLARE
  tennis_id uuid;
  pickle_id uuid;
  fac_jm uuid := 'b0000001-0000-0000-0000-000000000001';
  fac_lf uuid := 'b0000002-0000-0000-0000-000000000002';
  fac_mlk uuid := 'b0000003-0000-0000-0000-000000000003';
BEGIN
  SELECT id INTO tennis_id FROM sport WHERE name = 'tennis' LIMIT 1;
  SELECT id INTO pickle_id FROM sport WHERE name = 'pickleball' LIMIT 1;
  
  IF tennis_id IS NULL OR pickle_id IS NULL THEN
    RAISE NOTICE 'Sports not found. Tennis: %, Pickleball: %', tennis_id, pickle_id;
    RETURN;
  END IF;
  
  -- Create facility_sport links
  INSERT INTO facility_sport (facility_id, sport_id)
  VALUES 
    (fac_jm, tennis_id),
    (fac_jm, pickle_id),
    (fac_lf, tennis_id),
    (fac_lf, pickle_id),
    (fac_mlk, tennis_id),
    (fac_mlk, pickle_id)
  ON CONFLICT DO NOTHING;
  
  -- Create courts for Jeanne-Mance (4 tennis, 2 pickleball)
  INSERT INTO court (facility_id, name, court_number, surface_type, lighting, indoor)
  VALUES 
    (fac_jm, 'Court 1', 1, 'hard', true, false),
    (fac_jm, 'Court 2', 2, 'hard', true, false),
    (fac_jm, 'Court 3', 3, 'hard', false, false),
    (fac_jm, 'Court 4', 4, 'hard', false, false),
    (fac_jm, 'Pickleball 1', 5, 'hard', false, false),
    (fac_jm, 'Pickleball 2', 6, 'hard', false, false)
  ON CONFLICT DO NOTHING;
  
  -- Courts for La Fontaine (6 tennis, 2 pickleball)  
  INSERT INTO court (facility_id, name, court_number, surface_type, lighting, indoor)
  VALUES 
    (fac_lf, 'Court 1', 1, 'clay', true, false),
    (fac_lf, 'Court 2', 2, 'clay', true, false),
    (fac_lf, 'Court 3', 3, 'clay', false, false),
    (fac_lf, 'Court 4', 4, 'clay', false, false),
    (fac_lf, 'Court 5', 5, 'clay', false, false),
    (fac_lf, 'Court 6', 6, 'clay', false, false),
    (fac_lf, 'Pickleball 1', 7, 'hard', false, false),
    (fac_lf, 'Pickleball 2', 8, 'hard', false, false)
  ON CONFLICT DO NOTHING;
  
  -- Courts for Martin-Luther-King (3 tennis, 2 pickleball)
  INSERT INTO court (facility_id, name, court_number, surface_type, lighting, indoor)
  VALUES 
    (fac_mlk, 'Court 1', 1, 'hard', false, false),
    (fac_mlk, 'Court 2', 2, 'hard', false, false),
    (fac_mlk, 'Court 3', 3, 'hard', false, false),
    (fac_mlk, 'Pickleball 1', 4, 'hard', false, false),
    (fac_mlk, 'Pickleball 2', 5, 'hard', false, false)
  ON CONFLICT DO NOTHING;
  
  RAISE NOTICE 'Created facility data successfully!';
END;
$$;

-- Verify
SELECT 'Organizations' as item, COUNT(*) as count FROM organization
UNION ALL
SELECT 'Facilities', COUNT(*) FROM facility
UNION ALL
SELECT 'Courts', COUNT(*) FROM court
UNION ALL
SELECT 'Facility Sports', COUNT(*) FROM facility_sport;
