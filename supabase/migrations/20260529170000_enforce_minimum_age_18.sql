-- Enforce minimum age of 18 on profile.birth_date.
-- Client-side validation lives in the mobile onboarding wizard, but anyone
-- with an authenticated session can hit PostgREST directly, so we guard at
-- the database level too. Rule: birth_date, when set, must be at least 18
-- years before today.

create or replace function public.enforce_profile_minimum_age()
returns trigger
language plpgsql
as $$
begin
  if new.birth_date is not null
     and new.birth_date > (current_date - interval '18 years')::date then
    raise exception 'Users must be at least 18 years old.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_profile_minimum_age on public.profile;

create trigger enforce_profile_minimum_age
before insert or update of birth_date on public.profile
for each row
execute function public.enforce_profile_minimum_age();
