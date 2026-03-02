-- Migration: Email sign-in should leave first_name and display_name NULL for onboarding
-- Created: 2026-02-04
-- Description: For email OTP signups, do NOT pre-populate first_name or display_name with the email.
--              The user fills these in during the onboarding wizard. Only OAuth signups get names
--              from provider metadata (and fallbacks for first_name when required).

-- ============================================================================
-- UPDATE handle_new_user FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  provider text;
  full_name_raw text;
  first_name_val text;
  last_name_val text;
  display_name text;
  avatar_url text;
  user_email text;
BEGIN
  -- Determine provider (could be null for email/password)
  provider := COALESCE(new.raw_app_meta_data->>'provider', 'email');
  
  -- Default values
  full_name_raw := NULL;
  first_name_val := NULL;
  last_name_val := NULL;
  display_name := NULL;
  avatar_url := NULL;
  user_email := new.email;
  
  -- If user came from OAuth (Google or Microsoft), try to populate fields
  IF provider IN ('google', 'azure', 'microsoft') THEN
    IF new.raw_user_meta_data IS NOT NULL THEN
      full_name_raw := new.raw_user_meta_data->>'full_name';
      display_name := COALESCE(
        new.raw_user_meta_data->>'preferred_username',
        new.raw_user_meta_data->>'name',
        new.raw_user_meta_data->>'email'
      );
      avatar_url := new.raw_user_meta_data->>'avatar_url';
      
      -- Try to get first_name and last_name from metadata if available
      first_name_val := new.raw_user_meta_data->>'given_name';
      last_name_val := new.raw_user_meta_data->>'family_name';
    END IF;
  END IF;
  
  -- For email OTP signups: do NOT set display_name or first_name from email.
  -- Leave them NULL so the user fills them in during onboarding.
  
  -- If first_name not available from metadata (OAuth path), try to split full_name
  IF first_name_val IS NULL AND full_name_raw IS NOT NULL THEN
    IF position(' ' IN full_name_raw) > 0 THEN
      first_name_val := split_part(full_name_raw, ' ', 1);
      last_name_val := COALESCE(last_name_val, substring(full_name_raw FROM position(' ' IN full_name_raw) + 1));
    ELSE
      first_name_val := full_name_raw;
    END IF;
  END IF;
  
  -- Only ensure first_name is set for OAuth (profile may require non-null in some flows; use fallback only for OAuth)
  -- For email signups, first_name stays NULL for the user to fill in during onboarding.
  IF provider IN ('google', 'azure', 'microsoft') AND (first_name_val IS NULL OR first_name_val = '') THEN
    first_name_val := COALESCE(
      NULLIF(display_name, ''),
      NULLIF(split_part(new.email, '@', 1), ''),
      'User'
    );
  END IF;
  
  -- Insert into profile table
  -- Use ON CONFLICT to handle case where profile might already exist
  INSERT INTO public.profile (
    id,
    email,
    first_name,
    last_name,
    display_name,
    profile_picture_url,
    is_active,
    created_at,
    updated_at
  )
  VALUES (
    new.id,
    user_email,
    first_name_val,
    last_name_val,
    display_name,
    avatar_url,
    true,
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(EXCLUDED.email, profile.email),
    updated_at = now();
  
  RETURN new;
EXCEPTION
  WHEN others THEN
    RAISE WARNING 'Error in handle_new_user: % - SQLSTATE: %', SQLERRM, SQLSTATE;
    RETURN new;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS 'Handles new user signup by creating profile and player records. For social auth (Google, etc.): extracts first_name, last_name, display_name, and avatar from OAuth metadata. For email OTP: only populates email field, leaves first_name and display_name as NULL for user to fill in during onboarding.';
