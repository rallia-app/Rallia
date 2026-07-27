-- No client subscribes to these tables (verified against shared-services/shared-hooks),
-- yet every write to them makes the Realtime WAL poller do per-subscription RLS work.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation'
  ) then
    alter publication supabase_realtime drop table public.conversation;
  end if;

  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reaction'
  ) then
    alter publication supabase_realtime drop table public.message_reaction;
  end if;
end $$;
