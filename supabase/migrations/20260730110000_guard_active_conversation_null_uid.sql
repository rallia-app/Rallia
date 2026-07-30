-- Fix: set_active_conversation inserted auth.uid() unguarded. Sessions without a
-- resolvable user (anon-key calls -- the function was executable by PUBLIC via
-- default privileges -- or expired JWTs) passed NULL, violating the player_id
-- not-null constraint; auth users without a player profile hit the player FK.
-- Seen recurring in prod postgres logs (e.g. 2026-07-30 03:32 and 13:36 UTC).
--
-- Notification suppression is best-effort, so both cases become silent no-ops.
-- Also lock both RPCs down to authenticated, per our function-privilege pattern.

create or replace function public.set_active_conversation(p_conversation_id uuid)
returns void
security definer
set search_path = public
language plpgsql
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- No session, or no player profile yet (onboarding not completed): nothing to
  -- suppress notifications for.
  if v_uid is null or not exists (select 1 from public.player where id = v_uid) then
    return;
  end if;

  insert into public.active_conversation (player_id, conversation_id, active_at)
  values (v_uid, p_conversation_id, now())
  on conflict (player_id)
  do update set conversation_id = excluded.conversation_id,
                active_at       = now();
end;
$$;

-- Supabase default privileges grant functions to anon explicitly as well as via
-- PUBLIC, so both must be revoked.
revoke all on function public.set_active_conversation(uuid) from public, anon;
revoke all on function public.clear_active_conversation(uuid) from public, anon;
grant execute on function public.set_active_conversation(uuid) to authenticated;
grant execute on function public.clear_active_conversation(uuid) to authenticated;
