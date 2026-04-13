-- Fix 1: file.uploaded_by FK uses ON DELETE SET NULL but column is NOT NULL.
-- Change to CASCADE so files are deleted with their uploader.

ALTER TABLE public.file
  DROP CONSTRAINT IF EXISTS file_uploaded_by_fkey,
  DROP CONSTRAINT IF EXISTS files_uploaded_by_fkey;

ALTER TABLE public.file
  ADD CONSTRAINT file_uploaded_by_fkey
  FOREIGN KEY (uploaded_by) REFERENCES public.profile(id) ON DELETE CASCADE;

-- Fix 2: GoTrue (supabase_auth_admin) has search_path=auth. When cascade-
-- deleting a user, triggers on public tables fire but can't resolve references
-- to other public functions/tables. Add SET search_path = public to all
-- public-schema trigger functions so they work regardless of the caller's
-- search_path.

DO $$
DECLARE
    r RECORD;
BEGIN
    -- Set search_path on all trigger functions in public schema
    FOR r IN
        SELECT DISTINCT p.proname
        FROM pg_trigger t
        JOIN pg_proc p ON t.tgfoid = p.oid
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
          AND NOT t.tgisinternal
          AND (p.proconfig IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'
          ))
    LOOP
        EXECUTE format('ALTER FUNCTION public.%I() SET search_path = public', r.proname);
    END LOOP;
END $$;

-- Also fix the helper function called by triggers (not a trigger itself)
ALTER FUNCTION public.reevaluate_certification_for_player_rating(uuid)
  SET search_path = public;

-- Fix 3: Some trigger functions are not SECURITY DEFINER, so they run as the
-- calling role (supabase_auth_admin during cascade deletes) which lacks
-- permissions on public tables. Make them SECURITY DEFINER so they run as the
-- function owner (postgres).

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT DISTINCT p.proname
        FROM pg_trigger t
        JOIN pg_proc p ON t.tgfoid = p.oid
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
          AND NOT t.tgisinternal
          AND p.prosecdef = false
    LOOP
        EXECUTE format('ALTER FUNCTION public.%I() SECURITY DEFINER', r.proname);
    END LOOP;
END $$;
