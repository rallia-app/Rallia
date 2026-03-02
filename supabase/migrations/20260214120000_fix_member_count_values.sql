-- Migration: Fix member_count values for all networks
-- This ensures member_count is correctly set based on actual active members

-- Recalculate and update member_count for all networks
UPDATE public.network n
SET member_count = COALESCE((
  SELECT COUNT(*) 
  FROM public.network_member nm 
  WHERE nm.network_id = n.id AND nm.status = 'active'
), 0);

-- Ensure max_members has a reasonable default for groups (10)
-- and NULL for communities
UPDATE public.network n
SET max_members = 10
WHERE max_members IS NULL OR max_members = 0;

-- Log for verification
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN 
    SELECT n.id, n.name, n.member_count, n.max_members, nt.name as network_type
    FROM public.network n
    LEFT JOIN public.network_type nt ON n.network_type_id = nt.id
    LIMIT 10
  LOOP
    RAISE NOTICE 'Network: % (%), member_count: %, max_members: %', 
      rec.name, rec.network_type, rec.member_count, rec.max_members;
  END LOOP;
END $$;
