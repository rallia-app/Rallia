-- =============================================================================
-- Versioned policy consent — RPCs
--
-- get_pending_policy_consents() — read, security invoker. Both underlying
-- tables' RLS already permit exactly this caller's-own-rows query (policy_versions
-- is public, player_consent is scoped to auth.uid()) — there's no privilege gap
-- to bridge, so invoker is the correct (least-privilege) choice here.
--
-- accept_policy_consent(p_policy_type, p_version) — write, security definer.
-- player_consent's RLS forbids direct writes entirely (even by the row owner),
-- so the function must bypass RLS after independently validating auth.uid()
-- and the policy_type/version. Rejects a stale version (VERSION_MISMATCH)
-- rather than silently recording an out-of-date accept.
-- =============================================================================

create or replace function public.get_pending_policy_consents()
returns table (policy_type text, current_version integer)
language sql
stable
security invoker
set search_path = public
as $$
  select pv.policy_type, pv.current_version
    from public.policy_versions pv
   where auth.uid() is not null
     and pv.current_version > coalesce(
       (select max(pc.version)
          from public.player_consent pc
         where pc.player_id = auth.uid()
           and pc.policy_type = pv.policy_type),
       0
     );
$$;

comment on function public.get_pending_policy_consents() is
  'Returns the policy_type(s) the calling user has not yet accepted at the current published version. Empty result = fully consented (or no session).';

grant execute on function public.get_pending_policy_consents() to authenticated;


create or replace function public.accept_policy_consent(
    p_policy_type text,
    p_version     integer
)
returns public.player_consent
language plpgsql
security definer
set search_path = public
as $$
declare
    v_caller_id uuid := auth.uid();
    v_current   integer;
    v_row       public.player_consent;
begin
    if v_caller_id is null then
        raise exception using errcode = 'P0001', message = 'NOT_AUTHENTICATED';
    end if;

    if p_policy_type not in ('privacy', 'terms') then
        raise exception using errcode = 'P0001', message = 'INVALID_POLICY_TYPE';
    end if;

    select current_version into v_current
      from public.policy_versions
     where policy_type = p_policy_type;

    if v_current is null then
        raise exception using errcode = 'P0001', message = 'POLICY_TYPE_NOT_FOUND';
    end if;

    if p_version <> v_current then
        raise exception using errcode = 'P0001', message = 'VERSION_MISMATCH';
    end if;

    insert into public.player_consent (player_id, policy_type, version)
    values (v_caller_id, p_policy_type, p_version)
    on conflict (player_id, policy_type, version) do nothing
    returning * into v_row;

    if v_row.id is null then
        select * into v_row
          from public.player_consent
         where player_id = v_caller_id
           and policy_type = p_policy_type
           and version = p_version;
    end if;

    return v_row;
end;
$$;

comment on function public.accept_policy_consent(text, integer) is
  'Records the calling user''s acceptance of policy_type at p_version. Idempotent (re-accepting the same version is a no-op). Rejects p_version below or above the current policy_versions.current_version with VERSION_MISMATCH — callers must always pass the version they just read from get_pending_policy_consents() / policy_versions.';

grant execute on function public.accept_policy_consent(text, integer) to authenticated;
