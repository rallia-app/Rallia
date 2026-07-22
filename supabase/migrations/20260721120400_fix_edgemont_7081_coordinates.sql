-- Fix coordinates for the second Calgary "Edgemont" park.
--
-- Two distinct parks named "Edgemont" exist in Calgary (8 Edgebyne Crescent
-- and 7081 Edgemont Dr). The import's geocode-override file was keyed by
-- "name, city", so both received the Edgebyne coordinate. This pins the
-- 7081 Edgemont Dr facility to its own address (Google ROOFTOP result).

update facility
set latitude  = 51.11665,
    longitude = -114.15014,
    location  = extensions.ST_SetSRID(
                  extensions.ST_MakePoint(-114.15014, 51.11665),
                  4326)::extensions.geography
where slug = 'edgemont-calgary-7081'
  and latitude = 51.12692;
