-- Migration: Change default max_members for groups from 10 to 20
-- This provides more flexibility for group sizes by default

-- Update the column default
ALTER TABLE public.network 
ALTER COLUMN max_members SET DEFAULT 20;

-- Update existing groups that still have the old default of 10
-- Only update groups (not communities) where the value was never explicitly changed
UPDATE public.network n
SET max_members = 20
WHERE max_members = 10
  AND EXISTS (
    SELECT 1 FROM public.network_type nt 
    WHERE nt.id = n.network_type_id 
    AND nt.name = 'group'
  );

DO $$
BEGIN
  RAISE NOTICE 'Default max_members changed from 10 to 20 for groups';
END $$;
