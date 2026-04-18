-- Create raffle_entry table for the Wimbledon tickets raffle landing page
create table if not exists public.raffle_entry (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  created_at timestamptz default now() not null
);

-- Enable RLS
alter table public.raffle_entry enable row level security;

-- Only service role can insert (no public access)
create policy "Service role can insert raffle entries"
  on public.raffle_entry
  for insert
  to service_role
  with check (true);

-- Only service role can read raffle entries
create policy "Service role can read raffle entries"
  on public.raffle_entry
  for select
  to service_role
  using (true);
