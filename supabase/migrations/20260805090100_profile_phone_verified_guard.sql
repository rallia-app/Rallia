-- =============================================================================
-- Guard profile.phone_verified against client writes
--
-- The "Users can update their own profile" policy (20241129000000) has no
-- column restriction, so any authenticated client could set
-- phone_verified = true on its own row and skip OTP entirely. This trigger
-- makes the flag trustworthy:
--   * service_role / postgres pass through untouched (the verify-phone edge
--     function is the only legitimate true-setter),
--   * a client-side phone change silently resets phone_verified to false
--     (covers PersonalInformationOverlay's whole-row update),
--   * a client-side false→true flip is silently coerced back rather than
--     raised, so existing clients that send whole-row updates keep working.
-- Client false-flips (un-verify) are allowed and harmless.
-- =============================================================================

create or replace function public.guard_profile_phone_verified()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('service_role', 'postgres') then
    return new;
  end if;

  if new.phone is distinct from old.phone then
    new.phone_verified := false;
  elsif new.phone_verified is distinct from old.phone_verified
        and new.phone_verified = true then
    new.phone_verified := old.phone_verified;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_profile_phone_verified on public.profile;
create trigger guard_profile_phone_verified
  before update on public.profile
  for each row execute function public.guard_profile_phone_verified();
