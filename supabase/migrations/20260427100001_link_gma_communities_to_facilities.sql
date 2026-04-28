-- =============================================================================
-- Migration: Link GMA communities to existing facilities
-- Description: For each venue listed in rallia-business/go-to-market/acquisition-channels/GMA_Communautes_v2.xlsx (sheet 3),
--              find the matching facility by name (accent-insensitive) and
--              insert network_favorite_facility rows for each assigned
--              community. Unmatched venues are logged via RAISE NOTICE so they
--              can be reconciled manually.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS unaccent SCHEMA extensions;

DO $$
DECLARE
  v_facility_id UUID;
  v_network_id UUID;
  v_unmatched INTEGER := 0;
  v_links_inserted INTEGER := 0;
  v_venue RECORD;
  v_community_name TEXT;
BEGIN
  -- Drop the temp table if a prior migration attempt left it behind
  DROP TABLE IF EXISTS pg_temp.gma_venue_assignments;

  CREATE TEMP TABLE pg_temp.gma_venue_assignments (
    venue_name TEXT NOT NULL,
    venue_postal_code TEXT,
    community_names TEXT[] NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO pg_temp.gma_venue_assignments VALUES ('YMCA Cartierville', 'H4J2R5', ARRAY['Jarry Serve — Pickleball Avancé','Jarry Serve — Pickleball Intermédiaire','Jarry Serve — Pickleball Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Louis-Riel', 'H1M2H7', ARRAY['Plateau Ace — Tennis Débutant','Plateau Ace — Tennis Avancé','Plateau Ace — Tennis Intermédiaire']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Saint-Laurent', 'H1G4Y8', ARRAY['Jarry Serve — Tennis Intermédiaire','Jarry Serve — Tennis Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc-école Calixa-Lavallée', 'H1H1P9', ARRAY['Jarry Serve — Tennis Intermédiaire','Jarry Serve — Tennis Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Le Carignan', 'H1G3X9', ARRAY['Jarry Serve — Tennis Avancé','Jarry Serve — Pickleball Débutant','Jarry Serve — Pickleball Intermédiaire','Jarry Serve — Tennis Intermédiaire','Jarry Serve — Pickleball Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Ottawa', 'H1H4Z7', ARRAY['Jarry Serve — Tennis Avancé','Jarry Serve — Pickleball Débutant','Jarry Serve — Pickleball Intermédiaire','Jarry Serve — Tennis Intermédiaire','Jarry Serve — Pickleball Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Giuseppe-Garibaldi', 'H1S2X9', ARRAY['Promenades Smash — Pickleball Intermédiaire','Promenades Smash — Pickleball Débutant','Promenades Smash — Pickleball Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Carignan', 'H8T3J6', ARRAY['Fairview Smash — Tennis Intermédiaire','Fairview Smash — Tennis Avancé','Fairview Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Dixie', 'H8T3A2', ARRAY['Fairview Smash — Tennis Intermédiaire','Fairview Smash — Tennis Avancé','Fairview Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Kirkland', 'H8R1B4', ARRAY['Fairview Smash — Tennis Avancé','Fairview Smash — Tennis Débutant','Fairview Smash — Pickleball Débutant','Fairview Smash — Tennis Intermédiaire','Fairview Smash — Pickleball Intermédiaire','Fairview Smash — Pickleball Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Warren-Allmand', 'H3X3P7', ARRAY['Monkland Ace — Pickleball Avancé','Monkland Ace — Pickleball Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Avancé','Monkland Ace — Pickleball Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Martin-Luther-King', 'H3S2T3', ARRAY['Monkland Ace — Pickleball Avancé','Monkland Ace — Pickleball Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Avancé','Monkland Ace — Pickleball Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Lawrence', 'H8P2T3', ARRAY['Monkland Ace — Pickleball Avancé','Monkland Ace — Pickleball Débutant','Monkland Ace — Pickleball Intermédiaire']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Lacharité', 'H8P1B8', ARRAY['Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Jacques-Viger', 'H4C2T9', ARRAY['Monkland Ace — Pickleball Avancé','Monkland Ace — Pickleball Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Avancé','Monkland Ace — Pickleball Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc F.-X.-Garneau', NULL, ARRAY['Plateau Ace — Tennis Débutant','Plateau Ace — Tennis Avancé','Plateau Ace — Tennis Intermédiaire']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Nicolas-Viel', 'H3L2R1', ARRAY['Jarry Serve — Tennis Intermédiaire','Jarry Serve — Tennis Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Parkinson', 'H8Y3E1', ARRAY['Fairview Smash — Tennis Avancé','Fairview Smash — Tennis Débutant','Fairview Smash — Pickleball Débutant','Fairview Smash — Tennis Intermédiaire','Fairview Smash — Pickleball Intermédiaire','Fairview Smash — Pickleball Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Hillcrest', NULL, ARRAY['Fairview Smash — Tennis Avancé','Fairview Smash — Tennis Débutant','Fairview Smash — Pickleball Débutant','Fairview Smash — Tennis Intermédiaire','Fairview Smash — Pickleball Intermédiaire','Fairview Smash — Pickleball Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Greendale', NULL, ARRAY['Fairview Smash — Tennis Avancé','Fairview Smash — Tennis Débutant','Fairview Smash — Pickleball Débutant','Fairview Smash — Tennis Intermédiaire','Fairview Smash — Pickleball Intermédiaire','Fairview Smash — Pickleball Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Duval', 'H9H1Y5', ARRAY['Fairview Smash — Tennis Avancé','Fairview Smash — Tennis Débutant','Fairview Smash — Pickleball Débutant','Fairview Smash — Tennis Intermédiaire','Fairview Smash — Pickleball Intermédiaire','Fairview Smash — Pickleball Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Aragon', NULL, ARRAY['Fairview Smash — Tennis Intermédiaire','Fairview Smash — Tennis Avancé','Fairview Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc d''À-Ma-Baie', NULL, ARRAY['Fairview Smash — Tennis Intermédiaire','Fairview Smash — Tennis Avancé','Fairview Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Grier', 'H9J3P9', ARRAY['Fairview Smash — Tennis Intermédiaire','Fairview Smash — Tennis Avancé','Fairview Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Brook', 'H8Z1B8', ARRAY['Fairview Smash — Tennis Intermédiaire','Fairview Smash — Tennis Avancé','Fairview Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Munro', NULL, ARRAY['Fairview Smash — Tennis Avancé','Fairview Smash — Tennis Débutant','Fairview Smash — Pickleball Débutant','Fairview Smash — Tennis Intermédiaire','Fairview Smash — Pickleball Intermédiaire','Fairview Smash — Pickleball Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Alexander', 'H9H1Y1', ARRAY['Fairview Smash — Tennis Intermédiaire','Fairview Smash — Tennis Avancé','Fairview Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Jeanne-Mance', 'H2W2N4', ARRAY['Plateau Ace — Tennis Débutant','Plateau Ace — Tennis Avancé','Plateau Ace — Tennis Intermédiaire']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('ParcDe La Vérendrye', 'H4E4G7', ARRAY['Monkland Ace — Pickleball Avancé','Monkland Ace — Pickleball Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Avancé','Monkland Ace — Pickleball Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Marcelin-Wilson', 'H3M2T1', ARRAY['Jarry Serve — Tennis Intermédiaire','Jarry Serve — Tennis Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Complexe sportif Claude-Robillard - Terrains intérieurs', 'H2M2E7', ARRAY['Jarry Serve — Tennis Intermédiaire','Jarry Serve — Tennis Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc de la Fontaine', 'H3E1T6', ARRAY['Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Delorme', NULL, ARRAY['Promenades Smash — Tennis Avancé','Promenades Smash — Tennis Intermédiaire','Promenades Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Eugène-Dostie', 'H9C1G9', ARRAY['Fairview Smash — Tennis Intermédiaire','Fairview Smash — Tennis Avancé','Fairview Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc La Fontaine', 'H2L3A7', ARRAY['Plateau Ace — Pickleball Avancé','Plateau Ace — Pickleball Débutant','Plateau Ace — Tennis Avancé','Plateau Ace — Tennis Intermédiaire','Plateau Ace — Pickleball Intermédiaire','Plateau Ace — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Jean-Duceppe', 'H1Y3N6', ARRAY['Plateau Ace — Tennis Débutant','Plateau Ace — Tennis Avancé','Plateau Ace — Tennis Intermédiaire']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Luigi-Pirandello', NULL, ARRAY['Promenades Smash — Tennis Avancé','Promenades Smash — Tennis Intermédiaire','Promenades Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Coubertin', 'H1R1H9', ARRAY['Promenades Smash — Tennis Avancé','Promenades Smash — Tennis Intermédiaire','Promenades Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Ladauversière', NULL, ARRAY['Promenades Smash — Tennis Avancé','Promenades Smash — Tennis Intermédiaire','Promenades Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Hébert', 'H1S2Y8', ARRAY['Promenades Smash — Tennis Avancé','Promenades Smash — Tennis Intermédiaire','Promenades Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Pie-XII', 'H1R0A9', ARRAY['Promenades Smash — Tennis Avancé','Promenades Smash — Tennis Intermédiaire','Promenades Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Ferland', 'H1P2Y9', ARRAY['Promenades Smash — Tennis Avancé','Promenades Smash — Tennis Intermédiaire','Promenades Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Wilfrid-Bastien', 'H1R2A3', ARRAY['Promenades Smash — Tennis Avancé','Promenades Smash — Tennis Intermédiaire','Promenades Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Oakwood', 'H2V2N6', ARRAY['Plateau Ace — Tennis Débutant','Plateau Ace — Tennis Avancé','Plateau Ace — Tennis Intermédiaire']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Saint-Viateur', 'H2V3W5', ARRAY['Plateau Ace — Tennis Débutant','Plateau Ace — Tennis Avancé','Plateau Ace — Tennis Intermédiaire']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Joyce', 'H2V2Z3', ARRAY['Plateau Ace — Tennis Débutant','Plateau Ace — Tennis Avancé','Plateau Ace — Tennis Intermédiaire']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc de Peterborough', 'H1K5G3', ARRAY['Promenades Smash — Pickleball Intermédiaire','Promenades Smash — Pickleball Débutant','Promenades Smash — Pickleball Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Hébert - LaSalle', 'H8P2S9', ARRAY['Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Noël-Sud', 'H4R1G2', ARRAY['Jarry Serve — Tennis Intermédiaire','Jarry Serve — Tennis Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Beaubien', 'H1Y2X7', ARRAY['Plateau Ace — Pickleball Avancé','Plateau Ace — Pickleball Débutant','Plateau Ace — Tennis Avancé','Plateau Ace — Tennis Intermédiaire','Plateau Ace — Pickleball Intermédiaire','Plateau Ace — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Goncourt', 'H1K3Y2', ARRAY['Promenades Smash — Tennis Avancé','Promenades Smash — Tennis Intermédiaire','Promenades Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Clémentine-De La Rousselière', 'H1A1T9', ARRAY['Promenades Smash — Tennis Avancé','Promenades Smash — Tennis Intermédiaire','Promenades Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Marie-Claire-Daveluy', 'H1E1K1', ARRAY['Promenades Smash — Tennis Avancé','Promenades Smash — Tennis Intermédiaire','Promenades Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Dollard-Morin', 'H1E2Z2', ARRAY['Promenades Smash — Tennis Avancé','Promenades Smash — Tennis Intermédiaire','Promenades Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc de l''École secondaire de la Pointe-aux-Trembles', 'H1A3P9', ARRAY['Promenades Smash — Tennis Avancé','Promenades Smash — Tennis Intermédiaire','Promenades Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Daniel-Johnson', 'H1B3A8', ARRAY['Promenades Smash — Tennis Avancé','Promenades Smash — Tennis Intermédiaire','Promenades Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Saint-Laurent - Arr. Saint-Laurent', 'H4L1G4', ARRAY['Jarry Serve — Tennis Intermédiaire','Jarry Serve — Tennis Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Philippe-Laheurte', 'H4R0A9', ARRAY['Jarry Serve — Tennis Intermédiaire','Jarry Serve — Tennis Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Marlborough', 'H4K2G7', ARRAY['Jarry Serve — Tennis Intermédiaire','Jarry Serve — Tennis Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Hartenstein', 'H4L3G3', ARRAY['Jarry Serve — Tennis Intermédiaire','Jarry Serve — Tennis Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Painter', 'H4N1A5', ARRAY['Jarry Serve — Tennis Intermédiaire','Jarry Serve — Tennis Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Gohier', NULL, ARRAY['Jarry Serve — Tennis Intermédiaire','Jarry Serve — Tennis Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Cousineau', 'H4L3W5', ARRAY['Jarry Serve — Tennis Intermédiaire','Jarry Serve — Tennis Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Médéric-Martin', 'H2K2X9', ARRAY['Plateau Ace — Pickleball Avancé','Plateau Ace — Pickleball Débutant','Plateau Ace — Tennis Avancé','Plateau Ace — Tennis Intermédiaire','Plateau Ace — Pickleball Intermédiaire','Plateau Ace — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Complexe sportif Claude-Robillard - Terrains extérieurs', 'H2M2E7', ARRAY['Jarry Serve — Tennis Avancé','Jarry Serve — Pickleball Débutant','Jarry Serve — Pickleball Intermédiaire','Jarry Serve — Tennis Intermédiaire','Jarry Serve — Pickleball Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Jarry (Stade IGA) - Terrains de tennis intérieurs durs', 'H2R2W1', ARRAY['Jarry Serve — Tennis Intermédiaire','Jarry Serve — Tennis Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Jarry (Stade IGA) - Terrains de tennis intérieurs terre battue', 'H2R2W1', ARRAY['Jarry Serve — Tennis Intermédiaire','Jarry Serve — Tennis Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Jarry (Stade IGA) - Terrains de tennis extérieurs durs', 'H2R2W1', ARRAY['Jarry Serve — Tennis Intermédiaire','Jarry Serve — Tennis Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Sauvé', NULL, ARRAY['Jarry Serve — Tennis Intermédiaire','Jarry Serve — Tennis Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Saint-Jean-de-Matha', 'H4E3A2', ARRAY['Monkland Ace — Pickleball Avancé','Monkland Ace — Pickleball Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Avancé','Monkland Ace — Pickleball Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Ouellette', 'H8N1M9', ARRAY['Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Hayward', 'H8R0A2', ARRAY['Monkland Ace — Pickleball Avancé','Monkland Ace — Pickleball Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Avancé','Monkland Ace — Pickleball Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Leroux', 'H8P2C1', ARRAY['Monkland Ace — Pickleball Avancé','Monkland Ace — Pickleball Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Avancé','Monkland Ace — Pickleball Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Mohawk', 'H8R3N6', ARRAY['Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Lefebvre', 'H8N2P5', ARRAY['Monkland Ace — Pickleball Avancé','Monkland Ace — Pickleball Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Avancé','Monkland Ace — Pickleball Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Riverside', 'H8P2Y9', ARRAY['Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Ménard - LaSalle', 'H8R4B4', ARRAY['Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Camille', 'H4K1C8', ARRAY['Jarry Serve — Tennis Intermédiaire','Jarry Serve — Tennis Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc de Roxboro', NULL, ARRAY['Fairview Smash — Tennis Intermédiaire','Fairview Smash — Tennis Avancé','Fairview Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc LaSalle', 'H8S1W4', ARRAY['Fairview Smash — Tennis Avancé','Fairview Smash — Tennis Débutant','Fairview Smash — Pickleball Débutant','Fairview Smash — Tennis Intermédiaire','Fairview Smash — Pickleball Intermédiaire','Fairview Smash — Pickleball Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Place Roland-Proulx', 'H4C2Z9', ARRAY['Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Centre de tennis Cavelier', 'H8R2T4', ARRAY['Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Jonathan-Wilson', 'H9C2L8', ARRAY['Fairview Smash — Tennis Avancé','Fairview Smash — Tennis Débutant','Fairview Smash — Pickleball Débutant','Fairview Smash — Tennis Intermédiaire','Fairview Smash — Pickleball Intermédiaire','Fairview Smash — Pickleball Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc des Érables', NULL, ARRAY['Fairview Smash — Pickleball Intermédiaire','Fairview Smash — Pickleball Avancé','Fairview Smash — Pickleball Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Woodland', NULL, ARRAY['Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc George-Springate', 'H9A2Z2', ARRAY['Fairview Smash — Tennis Intermédiaire','Fairview Smash — Tennis Avancé','Fairview Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Gymnase de l''école Calixa-Lavallée', 'H1H3J3', ARRAY['Jarry Serve — Pickleball Avancé','Jarry Serve — Pickleball Intermédiaire','Jarry Serve — Pickleball Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc des Roseraies', 'H1M1B2', ARRAY['Promenades Smash — Tennis Avancé','Promenades Smash — Tennis Intermédiaire','Promenades Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Marcel-Laurin', 'H4R1T4', ARRAY['Jarry Serve — Tennis Intermédiaire','Jarry Serve — Tennis Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Dan-Hanganu (Elgar)', 'H3E1C9', ARRAY['Monkland Ace — Pickleball Avancé','Monkland Ace — Pickleball Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Avancé','Monkland Ace — Pickleball Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc de la Reine-Élizabeth', 'H4H2N7', ARRAY['Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Arthur-Therrien', 'H4G2A3', ARRAY['Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Roger-Rousseau', 'H1K2P3', ARRAY['Promenades Smash — Tennis Avancé','Promenades Smash — Tennis Intermédiaire','Promenades Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Wilson', 'H4H1H6', ARRAY['Monkland Ace — Pickleball Avancé','Monkland Ace — Pickleball Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Avancé','Monkland Ace — Pickleball Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc François-Perrault', 'H2A1M1', ARRAY['Jarry Serve — Tennis Intermédiaire','Jarry Serve — Tennis Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Sainte-Bernadette', 'H1X2T5', ARRAY['Plateau Ace — Tennis Débutant','Plateau Ace — Tennis Avancé','Plateau Ace — Tennis Intermédiaire']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc George-Vernot', 'H1Z3K5', ARRAY['Jarry Serve — Tennis Intermédiaire','Jarry Serve — Tennis Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Alexis-Nihon', 'H4M1M4', ARRAY['Jarry Serve — Tennis Intermédiaire','Jarry Serve — Tennis Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Lucie-Bruneau', 'H1J2X8', ARRAY['Promenades Smash — Tennis Avancé','Promenades Smash — Tennis Intermédiaire','Promenades Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Centre socioculturel de l''Île-Bizard', 'H9C1G9', ARRAY['Fairview Smash — Pickleball Intermédiaire','Fairview Smash — Pickleball Avancé','Fairview Smash — Pickleball Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Centre du Plateau', 'H2H1G4', ARRAY['Plateau Ace — Pickleball Avancé','Plateau Ace — Pickleball Débutant','Plateau Ace — Pickleball Intermédiaire']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Centre récréatif et communautaire de LaSalle', 'H8N2P5', ARRAY['Monkland Ace — Pickleball Avancé','Monkland Ace — Pickleball Débutant','Monkland Ace — Pickleball Intermédiaire']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Gymnases de l''école secondaire Monseigneur-Richard', 'H4G2A3', ARRAY['Monkland Ace — Pickleball Avancé','Monkland Ace — Pickleball Débutant','Monkland Ace — Pickleball Intermédiaire']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Aréna Saint-Louis', 'H2T1V7', ARRAY['Plateau Ace — Pickleball Avancé','Plateau Ace — Pickleball Débutant','Plateau Ace — Pickleball Intermédiaire']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Don-Bosco', 'H1E3A9', ARRAY['Promenades Smash — Pickleball Intermédiaire','Promenades Smash — Pickleball Débutant','Promenades Smash — Pickleball Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc des Hirondelles', 'H2B1L5', ARRAY['Jarry Serve — Pickleball Avancé','Jarry Serve — Pickleball Intermédiaire','Jarry Serve — Pickleball Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc De Mésy', 'H4J2P4', ARRAY['Jarry Serve — Pickleball Avancé','Jarry Serve — Pickleball Intermédiaire','Jarry Serve — Pickleball Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Centre de loisirs Saint-Denis', 'H2J2P2', ARRAY['Plateau Ace — Pickleball Avancé','Plateau Ace — Pickleball Débutant','Plateau Ace — Pickleball Intermédiaire']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Centre Pickle', 'H1N3T1', ARRAY['Plateau Ace — Pickleball Avancé','Plateau Ace — Pickleball Débutant','Plateau Ace — Pickleball Intermédiaire']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('MTL Pickleball', 'H9J2R6', ARRAY['Fairview Smash — Pickleball Intermédiaire','Fairview Smash — Pickleball Avancé','Fairview Smash — Pickleball Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Club PKL', 'H3K3K9', ARRAY['Monkland Ace — Pickleball Avancé','Monkland Ace — Pickleball Débutant','Monkland Ace — Pickleball Intermédiaire']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Club Atwater', 'H3H1Y2', ARRAY['Plateau Ace — Pickleball Avancé','Plateau Ace — Pickleball Débutant','Plateau Ace — Pickleball Intermédiaire']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Centre Récréatif Edouard-Rivet', 'H1B0C3', ARRAY['Promenades Smash — Pickleball Intermédiaire','Promenades Smash — Pickleball Débutant','Promenades Smash — Pickleball Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Club Sportif MAA', 'H3A1W6', ARRAY['Plateau Ace — Pickleball Avancé','Plateau Ace — Pickleball Débutant','Plateau Ace — Pickleball Intermédiaire']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('514 Pickleball', 'H9P2N4', ARRAY['Fairview Smash — Pickleball Intermédiaire','Fairview Smash — Pickleball Avancé','Fairview Smash — Pickleball Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Padel FVR West Island', 'H9P1J1', ARRAY['Fairview Smash — Pickleball Intermédiaire','Fairview Smash — Pickleball Avancé','Fairview Smash — Pickleball Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Padel FVR Cathcart', 'H3B5L6', ARRAY['Plateau Ace — Pickleball Avancé','Plateau Ace — Pickleball Débutant','Plateau Ace — Pickleball Intermédiaire']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Club Social Royal West Court', 'H9B2J5', ARRAY['Fairview Smash — Pickleball Intermédiaire','Fairview Smash — Pickleball Avancé','Fairview Smash — Pickleball Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Midtown Le Sporting Club Sanctuaire', 'H3S2W1', ARRAY['Monkland Ace — Pickleball Avancé','Monkland Ace — Pickleball Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Avancé','Monkland Ace — Pickleball Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Club Sportif Côte de Liesse CDL (intérieur)', 'H4T1G5', ARRAY['Jarry Serve — Tennis Avancé','Jarry Serve — Pickleball Débutant','Jarry Serve — Pickleball Intermédiaire','Jarry Serve — Tennis Intermédiaire','Jarry Serve — Pickleball Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Club Sportif Côte de Liesse CDL (exterieur)', 'H4T1G5', ARRAY['Jarry Serve — Tennis Intermédiaire','Jarry Serve — Tennis Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Club de Tennis Iles des Soeurs', 'H3E1A8', ARRAY['Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Club de Tennis de Monkland', 'H4A2M4', ARRAY['Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Club de Tennis de Montréal Ouest', 'H4X1S1', ARRAY['Fairview Smash — Tennis Intermédiaire','Fairview Smash — Tennis Avancé','Fairview Smash — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Club de Tennis de Côte Saint‐Luc', 'H4W1J1', ARRAY['Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Club De Tennis Hillside', 'H3V1B7', ARRAY['Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Club de Tennis Mont-Royal', 'H4A3N4', ARRAY['Jarry Serve — Tennis Intermédiaire','Jarry Serve — Tennis Avancé','Jarry Serve — Tennis Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Club Municipal de Tennis de Dorval', 'H9S2E5', ARRAY['Fairview Smash — Tennis Avancé','Fairview Smash — Tennis Débutant','Fairview Smash — Pickleball Débutant','Fairview Smash — Tennis Intermédiaire','Fairview Smash — Pickleball Intermédiaire','Fairview Smash — Pickleball Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Rembrandt', 'H4W', ARRAY['Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Caldwell', 'H4W1X8', ARRAY['Monkland Ace — Pickleball Avancé','Monkland Ace — Pickleball Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Avancé','Monkland Ace — Pickleball Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Hampstead', 'H3X3E3', ARRAY['Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Devon', 'H3Y1J9', ARRAY['Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc King George', 'H3Y1Y4', ARRAY['Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Stayner', 'H3Z1W5', ARRAY['Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Avancé']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Parc Westmount', 'H3Z2J7', ARRAY['Monkland Ace — Pickleball Avancé','Monkland Ace — Pickleball Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Avancé','Monkland Ace — Pickleball Débutant']::TEXT[]);
  INSERT INTO pg_temp.gma_venue_assignments VALUES ('Terrains de Tennis du Terrain d''athlétisme de Westmount (WAG)', 'H3Z1V9', ARRAY['Monkland Ace — Pickleball Avancé','Monkland Ace — Pickleball Intermédiaire','Monkland Ace — Tennis Débutant','Monkland Ace — Tennis Intermédiaire','Monkland Ace — Tennis Avancé','Monkland Ace — Pickleball Débutant']::TEXT[]);

  FOR v_venue IN SELECT * FROM pg_temp.gma_venue_assignments LOOP
    v_facility_id := NULL;

    -- Match strategy 1: exact accent-insensitive name match
    SELECT id INTO v_facility_id
    FROM public.facility
    WHERE LOWER(extensions.unaccent(name)) = LOWER(extensions.unaccent(v_venue.venue_name))
      AND is_active = TRUE
    ORDER BY created_at ASC
    LIMIT 1;

    -- Match strategy 2: postal-code-anchored substring match
    IF v_facility_id IS NULL AND v_venue.venue_postal_code IS NOT NULL THEN
      SELECT id INTO v_facility_id
      FROM public.facility
      WHERE LOWER(extensions.unaccent(name)) ILIKE '%' || LOWER(extensions.unaccent(v_venue.venue_name)) || '%'
        AND REPLACE(UPPER(COALESCE(postal_code,'')),' ','') = v_venue.venue_postal_code
        AND is_active = TRUE
      ORDER BY created_at ASC
      LIMIT 1;
    END IF;

    -- Match strategy 3: bare substring match (last resort)
    IF v_facility_id IS NULL THEN
      SELECT id INTO v_facility_id
      FROM public.facility
      WHERE LOWER(extensions.unaccent(name)) ILIKE '%' || LOWER(extensions.unaccent(v_venue.venue_name)) || '%'
        AND is_active = TRUE
      ORDER BY created_at ASC
      LIMIT 1;
    END IF;

    IF v_facility_id IS NULL THEN
      v_unmatched := v_unmatched + 1;
      RAISE NOTICE 'GMA venue not matched: %', v_venue.venue_name;
      CONTINUE;
    END IF;

    FOREACH v_community_name IN ARRAY v_venue.community_names LOOP
      SELECT n.id INTO v_network_id
      FROM public.network n
      JOIN public.network_type nt ON n.network_type_id = nt.id
      WHERE n.name = v_community_name
        AND nt.name = 'community'
        AND n.archived_at IS NULL
      LIMIT 1;

      IF v_network_id IS NULL THEN
        RAISE NOTICE 'GMA community not found: %', v_community_name;
        CONTINUE;
      END IF;

      INSERT INTO public.network_favorite_facility (network_id, facility_id)
      VALUES (v_network_id, v_facility_id)
      ON CONFLICT (network_id, facility_id) DO NOTHING;

      IF FOUND THEN
        v_links_inserted := v_links_inserted + 1;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'GMA venue linking done: % facility-community links inserted, % venues unmatched', v_links_inserted, v_unmatched;
END
$$;

