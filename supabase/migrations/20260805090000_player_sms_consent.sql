-- =============================================================================
-- SMS consent ledger (CASL express-consent audit trail)
--
-- One row per consent grant, written ONLY by the verify-phone edge function
-- (service_role) at the moment a phone number passes OTP verification. Stores
-- the E.164 number as a snapshot so the record proves WHICH number the consent
-- covered even after the player later changes it, plus the wording version of
-- the consent notice shown at capture (SMS_CONSENT_WORDING_VERSION constant in
-- supabase/functions/verify-phone/index.ts).
--
-- Deliberately NOT a policy_type in policy_versions/player_consent: both the
-- mobile OnboardingWizard consent step and web acceptPolicies blind-accept
-- every policy_versions row (auto-consent = CASL violation), and
-- get_pending_policy_consents() would put the whole install base behind the
-- blocking re-consent gate. SMS consent is opt-in per player, not a gating
-- document version, so it gets its own append-only ledger.
-- =============================================================================

create table public.player_sms_consent (
  id              uuid primary key default gen_random_uuid(),
  player_id       uuid not null references public.profile(id) on delete cascade,
  phone           text not null,
  wording_version integer not null check (wording_version > 0),
  source          text not null check (source in ('onboarding', 'settings')),
  granted_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index player_sms_consent_player_idx
  on public.player_sms_consent (player_id, granted_at desc);

comment on table public.player_sms_consent is
  'Append-only CASL consent ledger for SMS. One row per successful phone verification; phone is an E.164 snapshot proving which number the consent covered. Written only by the verify-phone edge function (service_role); no client read/write. Current verification state lives on profile.phone_verified, not here.';

alter table public.player_sms_consent enable row level security;

create policy player_sms_consent_no_direct_access on public.player_sms_consent
  for all using (false) with check (false);

-- Supabase is removing default Data API grants; grant explicitly.
-- service_role only — clients never touch this table.
grant all on public.player_sms_consent to service_role;
