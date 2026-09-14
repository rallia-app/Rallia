-- ============================================================================
-- A quick game posted from a community chat by an admin stays in that chat
-- ============================================================================
-- post_match_to_network_chats (20260901080000) seeds a match_share card into
-- every community the creator is an active member of, scoped only by sport.
-- For a regular player that is the point: their communities are the ones they
-- play in, so a game they post is welcome in each of them. Rallia admins are
-- members of every community they run, so the same rule turned one "anyone
-- for a game Thursday?" from one chat into a card in all of them, most of them
-- irrelevant to the game.
--
--  * match.origin_network_id records the community chat a quick game was
--    posted from. The feed's create flow leaves it null.
--  * When the creator is an app admin (public.admin) and the game carries an
--    origin, the card is posted only into that network's conversation. Every
--    other case keeps the existing fan-out unchanged.
--  * An admin's game created outside a chat (no origin) still fans out; that
--    path is untouched here.
-- ============================================================================

alter table public.match
  add column if not exists origin_network_id uuid
    references public.network(id) on delete set null;

comment on column public.match.origin_network_id is
  'Community or group chat the game was posted from (quick game). Null when created from the feed.';

create index if not exists idx_match_origin_network_id
  on public.match (origin_network_id)
  where origin_network_id is not null;

create or replace function public.post_match_to_network_chats()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sport_name    text;
  v_sport_display text;
  v_facility_name text;
  v_rating_label  text;
  v_place         text;
  v_metadata      jsonb;
  v_content       text;
  v_net           record;
  v_origin_only   boolean := false;
begin
  -- Nothing to share into a network the creator opted out of.
  if coalesce(NEW.visible_in_communities, true) is not true
     and coalesce(NEW.visible_in_groups, true) is not true then
    return NEW;
  end if;

  -- Admins sit in every community they run; a game they post from one chat
  -- belongs to that chat alone. Regular players keep the fan-out.
  if NEW.origin_network_id is not null
     and exists (select 1 from public.admin a where a.id = NEW.created_by) then
    v_origin_only := true;
  end if;

  select s.name, coalesce(s.display_name, s.name)
    into v_sport_name, v_sport_display
    from public.sport s where s.id = NEW.sport_id;

  if NEW.facility_id is not null then
    select f.name into v_facility_name from public.facility f where f.id = NEW.facility_id;
  end if;

  if NEW.min_rating_score_id is not null then
    select coalesce(rs.label, rs.value::text)
      into v_rating_label
      from public.rating_score rs where rs.id = NEW.min_rating_score_id;
  end if;

  v_place := coalesce(v_facility_name, NEW.location_name, NEW.location_address);

  v_metadata := jsonb_build_object(
    'kind',            'match_share',
    'silent',          true,
    'match_id',        NEW.id,
    'creator_id',      NEW.created_by,
    'sport_id',        NEW.sport_id,
    'sport_name',      v_sport_name,
    'sport_display',   v_sport_display,
    'format',          NEW.format,
    'match_date',      NEW.match_date,
    'start_time',      NEW.start_time,
    'end_time',        NEW.end_time,
    'timezone',        NEW.timezone,
    'location_type',   NEW.location_type,
    'place_name',      v_place,
    'min_rating_label', v_rating_label,
    'is_public',       (NEW.visibility = 'public')
  );

  -- Plain-text fallback for the inbox preview and for clients that don't know
  -- the card type yet.
  v_content := 'New game · ' || to_char(NEW.match_date, 'Mon DD')
               || coalesce(' · ' || v_place, '');

  for v_net in
    select n.conversation_id
    from public.network_member nm
    join public.network n  on n.id = nm.network_id
    join public.network_type nt on nt.id = n.network_type_id
    join public.conversation c on c.id = n.conversation_id
    where nm.player_id = NEW.created_by
      -- Belt and braces: an announcement conversation would fan out to every
      -- player via announcement_fanout_job, which runs ahead of the silent flag.
      and c.conversation_type <> 'announcement'
      and nm.status = 'active'
      and n.archived_at is null
      and n.conversation_id is not null
      and (
        (nt.name = 'community'    and coalesce(NEW.visible_in_communities, true))
        or (nt.name = 'player_group' and coalesce(NEW.visible_in_groups, true))
      )
      -- A network scoped to one sport only wants that sport's games.
      and (n.sport_id is null or n.sport_id = NEW.sport_id)
      -- Only the chat the game was posted from, when that is all it should reach.
      and (not v_origin_only or n.id = NEW.origin_network_id)
  loop
    insert into public.message (conversation_id, sender_id, content, message_type, metadata, status)
    values (v_net.conversation_id, NEW.created_by, v_content, 'match_share', v_metadata, 'sent');
  end loop;

  return NEW;
end;
$function$;

comment on function public.post_match_to_network_chats() is
  'Posts a match_share card into the creator''s community/player_group conversations when the match opts into that surface. An admin''s game posted from a chat (origin_network_id) is posted only there.';
