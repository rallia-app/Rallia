alter table public.donations
  rename column stripe_checkout_session_id to stripe_payment_intent_id;

drop index if exists donations_checkout_session_id_idx;

create index donations_payment_intent_id_idx
  on public.donations (stripe_payment_intent_id);
