-- ============================================================================
-- Onboarding minimum: server-side invariant
-- specs/01-authentication/onboarding-minimum.md
--
-- A player is onboarded only if they have a geocoded postal code, at least one
-- sport, an active rating on every sport, and min_favorite_facilities()
-- favourites per sport. Until now completion was a client-side flag flip with
-- no check; this adds the two RPCs every path calls instead.
--
--   get_onboarding_gaps(p_player_id)  read-only, returns the missing codes
--   complete_onboarding(p_player_id)  flips onboarding_completed only if none
--
-- Codes are stable identifiers the clients localize:
--   'postal_code' | 'sport' | 'rating:<sport_id>' | 'favorites:<sport_id>'
--
-- The hard trigger guard on profile.onboarding_completed is a later migration,
-- once the mobile wizard that handles the refusal is in a store build.
-- ============================================================================

-- Mirror of MIN_FAVORITE_FACILITIES in @rallia/shared-utils
-- (packages/shared-utils/src/onboarding/index.ts). Change both together.
create or replace function public.min_favorite_facilities()
returns integer
language sql
immutable
parallel safe
set search_path = public
as $$ select 2 $$;

comment on function public.min_favorite_facilities() is
  'Minimum favourite facilities per sport for onboarding. Mirror of MIN_FAVORITE_FACILITIES in @rallia/shared-utils.';

revoke all on function public.min_favorite_facilities() from public, anon;
grant execute on function public.min_favorite_facilities() to authenticated, service_role;


create or replace function public.get_onboarding_gaps(p_player_id uuid default null)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_target uuid := coalesce(p_player_id, auth.uid());
  v_gaps   text[] := '{}';
  v_player record;
  v_sport  record;
  v_favs   integer;
begin
  if v_target is null then
    raise exception 'get_onboarding_gaps: no player' using errcode = '42501';
  end if;

  -- Self, service role, or an admin may read another player's gaps.
  if v_target is distinct from v_caller
     and coalesce(auth.role(), '') <> 'service_role'
     and not (v_caller is not null and public.is_admin(v_caller)) then
    raise exception 'get_onboarding_gaps: not allowed' using errcode = '42501';
  end if;

  select postal_code, latitude, longitude
    into v_player
  from public.player
  where id = v_target;

  if not found then
    return array['postal_code', 'sport'];
  end if;

  if v_player.postal_code is null or btrim(v_player.postal_code) = ''
     or v_player.latitude is null or v_player.longitude is null then
    v_gaps := array_append(v_gaps, 'postal_code');
  end if;

  if not exists (select 1 from public.player_sport ps where ps.player_id = v_target) then
    v_gaps := array_append(v_gaps, 'sport');
    return v_gaps;
  end if;

  for v_sport in
    select ps.sport_id, ps.active_rating_score_id
    from public.player_sport ps
    where ps.player_id = v_target
    order by ps.is_primary desc nulls last, ps.sport_id
  loop
    if v_sport.active_rating_score_id is null then
      v_gaps := array_append(v_gaps, 'rating:' || v_sport.sport_id::text);
    end if;

    select count(*) into v_favs
    from public.player_favorite_facility f
    where f.player_id = v_target and f.sport_id = v_sport.sport_id;

    if v_favs < public.min_favorite_facilities() then
      v_gaps := array_append(v_gaps, 'favorites:' || v_sport.sport_id::text);
    end if;
  end loop;

  return v_gaps;
end;
$$;

comment on function public.get_onboarding_gaps(uuid) is
  'Missing onboarding-minimum requirements for a player: postal_code, sport, rating:<sport_id>, favorites:<sport_id>. Empty when complete.';

revoke all on function public.get_onboarding_gaps(uuid) from public, anon;
grant execute on function public.get_onboarding_gaps(uuid) to authenticated, service_role;


create or replace function public.complete_onboarding(p_player_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_target uuid := coalesce(p_player_id, auth.uid());
  v_gaps   text[];
begin
  if v_target is null then
    raise exception 'complete_onboarding: no player' using errcode = '42501';
  end if;

  -- Only the player themselves or the service role (web API routes) may
  -- complete. Admins read gaps; they do not complete on a player's behalf.
  if v_target is distinct from v_caller
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'complete_onboarding: not allowed' using errcode = '42501';
  end if;

  v_gaps := public.get_onboarding_gaps(v_target);

  if cardinality(v_gaps) > 0 then
    return jsonb_build_object('ok', false, 'missing', to_jsonb(v_gaps));
  end if;

  update public.profile
     set onboarding_completed = true
   where id = v_target
     and onboarding_completed is distinct from true;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.complete_onboarding(uuid) is
  'Flips profile.onboarding_completed only when get_onboarding_gaps() is empty; otherwise returns {ok:false, missing:[...]}. Idempotent.';

revoke all on function public.complete_onboarding(uuid) from public, anon;
grant execute on function public.complete_onboarding(uuid) to authenticated, service_role;
