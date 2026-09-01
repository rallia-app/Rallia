-- $10 referral credit (Jean, 2026-08-24): a one-time 10 $ CAD credit for any
-- player who brings 5 or more players who complete onboarding, counted only
-- from the offer start — never retroactive. Redeemable only on Rallia-run
-- events (house organizer), never third-party organizers' events, so
-- redemption is a straight discount on Rallia's own revenue. This migration
-- is grant-side only; redemption lands with the payment integration.

create table public.player_credit (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profile(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'CAD',
  -- One grant per (player, source): 'referral_5_2026' is the campaign.
  source text not null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint player_credit_once_per_source unique (player_id, source)
);

comment on table public.player_credit is
  'Account credit ledger (grant side). Redemption: Rallia-run events only.';

create index idx_player_credit_player on public.player_credit (player_id);

alter table public.player_credit enable row level security;

create policy "Players can view own credits"
  on public.player_credit for select
  to authenticated
  using (player_id = (select auth.uid()));

grant select on public.player_credit to authenticated;
grant all on public.player_credit to service_role;

-- Conversions qualify once BOTH sides hold: attributed to the referrer and
-- onboarding completed, with the referred profile created on or after the
-- offer start.
create or replace function public.grant_referral_credit_if_eligible(p_referrer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer_start constant timestamptz := '2026-08-25T00:00:00-04:00';
  v_needed constant integer := 5;
begin
  if p_referrer is null then
    return;
  end if;
  if (
    select count(*)
    from public.profile
    where referred_by = p_referrer
      and onboarding_completed
      and created_at >= v_offer_start
  ) >= v_needed then
    insert into public.player_credit (player_id, amount_cents, currency, source, expires_at)
    values (p_referrer, 1000, 'CAD', 'referral_5_2026', now() + interval '12 months')
    on conflict on constraint player_credit_once_per_source do nothing;
  end if;
end;
$$;

revoke all on function public.grant_referral_credit_if_eligible(uuid) from public, anon, authenticated;
grant execute on function public.grant_referral_credit_if_eligible(uuid) to service_role;

create or replace function public.trg_referral_credit_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.grant_referral_credit_if_eligible(new.referred_by);
  return new;
end;
$$;

-- A conversion becomes qualifying on whichever side lands second: onboarding
-- finishing for an already-attributed profile, or attribution landing on an
-- already-onboarded profile (code entered post-signup).
create trigger referral_credit_on_onboarded
  after update of onboarding_completed on public.profile
  for each row
  when (
    new.onboarding_completed
    and not coalesce(old.onboarding_completed, false)
    and new.referred_by is not null
  )
  execute function public.trg_referral_credit_check();

create trigger referral_credit_on_attributed
  after update of referred_by on public.profile
  for each row
  when (new.referred_by is not null and old.referred_by is null and new.onboarding_completed)
  execute function public.trg_referral_credit_check();
