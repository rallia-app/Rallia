-- ============================================================================
-- Seed a "new game" card into the creator's community / group chats
-- ============================================================================
-- Games created by a member are only discoverable today via the network detail
-- screen's games tab, which barely gets opened. This posts a match_share card
-- straight into the network's conversation so the game shows up where members
-- already are.
--
--  * Gated on the match's own sharing columns: visible_in_communities drives
--    community networks, visible_in_groups drives player_group networks. A
--    creator who unticks either one stays out of that surface (this is also why
--    create_casual_match's private games, which set both to false, never post).
--  * Auto-generated (weekly check-in) games are excluded via the trigger WHEN
--    clause, matching the two sibling match-created triggers.
--  * The card is SILENT: metadata.silent suppresses the per-participant
--    notification fan-out. A 167-member community would otherwise emit 166
--    pushes per game created.
--
-- Carried over from feat/match-share-network-chats (dc86bc93, 2026-08-11),
-- which never merged. That commit also rewrote notify_new_message to add the
-- silent guard; that half is deliberately DROPPED here. 20260812250000 landed
-- the same guard a day later and placed it ahead of the announcement branch, so
-- silent means silent even in an announcement conversation. Re-applying the
-- older copy would have moved the check back below that branch.
-- ============================================================================

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
begin
  -- Nothing to share into a network the creator opted out of.
  if coalesce(NEW.visible_in_communities, true) is not true
     and coalesce(NEW.visible_in_groups, true) is not true then
    return NEW;
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
  loop
    insert into public.message (conversation_id, sender_id, content, message_type, metadata, status)
    values (v_net.conversation_id, NEW.created_by, v_content, 'match_share', v_metadata, 'sent');
  end loop;

  return NEW;
end;
$function$;

drop trigger if exists match_post_to_network_chats on public.match;
create trigger match_post_to_network_chats
  after insert on public.match
  for each row
  when (new.is_auto_generated is distinct from true)
  execute function public.post_match_to_network_chats();

comment on function public.post_match_to_network_chats() is
  'Posts a match_share card into the creator''s community/player_group conversations when the match opts into that surface.';
