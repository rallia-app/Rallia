-- Link Stade IGA outdoor hard courts to ActivityMessenger package 1153
-- ("Extérieur - Régulier").
--
-- The previous fix (20260418000000) only wired up the indoor facilities
-- (packages 630 / 631), so outdoor courts at Parc Jarry never surfaced any
-- bookable slots in Rallia even though they are reservable on the Stade IGA
-- platform itself.

UPDATE facility
SET
  data_provider_id = (SELECT id FROM data_provider WHERE name = 'ActivityMessenger - Stade IGA' LIMIT 1),
  external_provider_id = '1153'
WHERE name = 'Parc Jarry (Stade IGA) - Terrains de tennis extérieurs durs'
  AND data_provider_id IS NULL;
