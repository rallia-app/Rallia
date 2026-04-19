create table public.donations (
  id                            uuid        primary key default gen_random_uuid(),
  stripe_checkout_session_id    text        not null unique,
  amount_cents                  integer     not null check (amount_cents >= 50),
  currency                      text        not null default 'cad',
  status                        text        not null default 'pending'
                                  check (status in ('pending', 'succeeded', 'expired')),
  donor_name                    text,
  donor_email                   text,
  donor_message                 text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create index donations_checkout_session_id_idx
  on public.donations (stripe_checkout_session_id);

alter table public.donations enable row level security;
