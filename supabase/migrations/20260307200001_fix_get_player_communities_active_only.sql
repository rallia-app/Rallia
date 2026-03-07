-- Migration: Fix get_player_communities to only return active memberships
-- Previously, this function returned communities where the user had ANY membership status
-- (including 'pending'), which caused pending join requests to appear in "My Communities"
-- Now it only returns communities where the user is an ACTIVE member

CREATE OR REPLACE FUNCTION public.get_player_communities(p_player_id uuid)
 RETURNS TABLE(id uuid, name text, description text, cover_image_url text, is_private boolean, member_count integer, created_by uuid, created_at timestamp with time zone, membership_status text, membership_role text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    n.id,
    n.name,
    n.description,
    n.cover_image_url,
    n.is_private,
    n.member_count,
    n.created_by,
    n.created_at,
    nm.status::TEXT as membership_status,
    nm.role::TEXT as membership_role
  FROM public.network n
  JOIN public.network_type nt ON n.network_type_id = nt.id
  JOIN public.network_member nm ON nm.network_id = n.id AND nm.player_id = p_player_id
  WHERE nt.name = 'community'
    AND nm.status = 'active'  -- Only return communities where user is an ACTIVE member
  ORDER BY n.name ASC;
END;
$function$;

DO $$
BEGIN
  RAISE NOTICE 'get_player_communities now only returns active memberships';
END $$;
