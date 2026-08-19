-- Drop permissive RLS policies fully subsumed by a surviving policy on the same table/cmd (no behavior change).

-- player SELECT: duplicate of "Anon users can view player profiles" (both: true, anon)
DROP POLICY IF EXISTS "Anonymous users can view players" ON public.player;
-- player SELECT: duplicate of "Players can view their own data" (uid = id, wider role)
DROP POLICY IF EXISTS "Users can view their own player data" ON public.player;
-- player UPDATE: both duplicates of "Players can update their own data" (uid = id)
DROP POLICY IF EXISTS "Users can update own last_seen" ON public.player;
DROP POLICY IF EXISTS "Users can update their own player data" ON public.player;

-- message SELECT: (participant AND not-blocked) OR'd with message_select_policy (participant) is inert
DROP POLICY IF EXISTS "Users can view messages in their conversations (with block filt" ON public.message;
-- message UPDATE: duplicate of message_update_policy (sender_id = uid)
DROP POLICY IF EXISTS "Users can update own messages" ON public.message;

-- notification SELECT: subsumed by notification_select_org_context (uid = user_id OR org-admin)
DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notification;
