-- Auto-flag rating-proof uploads with an LLM vision triage pass.
--
-- A negative triage filter, NOT a verifier: it flags media that clearly is not a
-- plausible rating proof (selfies, memes, blank images, unrelated app screenshots).
-- Humans keep approval authority — this never changes `status`.
--
-- Flow: INSERT/file-replace on rating_proof -> dispatch trigger (pg_net) calls the
-- `flag-rating-proof` edge function -> function runs Claude vision -> writes the
-- auto_flag_* columns back via the service role.

-- 1. Status enum for the LLM verdict.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'proof_auto_flag_status_enum') THEN
    CREATE TYPE "public"."proof_auto_flag_status_enum" AS ENUM (
      'pending',      -- queued, not yet assessed
      'plausible',    -- looks like a real rating proof
      'implausible',  -- clearly not a rating proof — surface to admin
      'skipped',      -- not an image (video/document/external) — manual review
      'error'         -- assessment failed — re-runnable
    );
  END IF;
END$$;

-- 2. Flag columns on rating_proof.
ALTER TABLE "public"."rating_proof"
  ADD COLUMN IF NOT EXISTS "auto_flag_status"     "public"."proof_auto_flag_status_enum" NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "auto_flag_reason"     text,
  ADD COLUMN IF NOT EXISTS "auto_flag_confidence" numeric(3, 2),
  ADD COLUMN IF NOT EXISTS "auto_flag_media_kind" text,
  ADD COLUMN IF NOT EXISTS "auto_flag_model"      text,
  ADD COLUMN IF NOT EXISTS "auto_flagged_at"      timestamptz;

COMMENT ON COLUMN "public"."rating_proof"."auto_flag_status" IS 'LLM triage verdict. Advisory only — does not gate approval.';
COMMENT ON COLUMN "public"."rating_proof"."auto_flag_confidence" IS 'Model confidence 0.00-1.00 for the verdict.';
COMMENT ON COLUMN "public"."rating_proof"."auto_flag_media_kind" IS 'What the model thinks the media is (e.g. utr_screenshot, selfie, meme).';

-- Partial index for the admin review queue (only the rows admins act on).
CREATE INDEX IF NOT EXISTS "idx_rating_proof_auto_flag_status"
  ON "public"."rating_proof" ("auto_flag_status")
  WHERE "auto_flag_status" IN ('implausible', 'error');

-- 3. BEFORE UPDATE guard: reset the assessment when the file is replaced, and
--    block non-service callers from tampering with the auto_flag_* columns.
--    SECURITY INVOKER (default) so current_user reflects the real caller role.
CREATE OR REPLACE FUNCTION "public"."protect_rating_proof_auto_flag"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- File replaced -> reset so the new file is re-assessed.
  IF NEW.file_id IS DISTINCT FROM OLD.file_id THEN
    NEW.auto_flag_status     := 'pending';
    NEW.auto_flag_reason     := NULL;
    NEW.auto_flag_confidence := NULL;
    NEW.auto_flag_media_kind := NULL;
    NEW.auto_flag_model      := NULL;
    NEW.auto_flagged_at      := NULL;
    RETURN NEW;
  END IF;

  -- Otherwise only the service role (the edge function) may write these columns.
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    NEW.auto_flag_status     := OLD.auto_flag_status;
    NEW.auto_flag_reason     := OLD.auto_flag_reason;
    NEW.auto_flag_confidence := OLD.auto_flag_confidence;
    NEW.auto_flag_media_kind := OLD.auto_flag_media_kind;
    NEW.auto_flag_model      := OLD.auto_flag_model;
    NEW.auto_flagged_at      := OLD.auto_flagged_at;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS "trg_protect_rating_proof_auto_flag" ON "public"."rating_proof";
CREATE TRIGGER "trg_protect_rating_proof_auto_flag"
  BEFORE UPDATE ON "public"."rating_proof"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."protect_rating_proof_auto_flag"();

-- 4. Dispatch trigger: call the flag-rating-proof edge function (fire-and-forget).
--    Mirrors the canonical pg_net pattern (vault secrets + apikey header).
CREATE OR REPLACE FUNCTION "public"."dispatch_rating_proof_auto_flag"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  functions_url text;
  service_key   text;
BEGIN
  -- Only file proofs that are pending and actually have a file get assessed.
  -- External links / fileless proofs are left for manual review.
  IF NEW.proof_type <> 'file' OR NEW.file_id IS NULL OR NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO functions_url
  FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1;

  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;

  IF functions_url IS NULL OR service_key IS NULL THEN
    RAISE WARNING '[dispatch_rating_proof_auto_flag] Vault secrets not configured (functions_url: %, service_key: %)',
      CASE WHEN functions_url IS NULL THEN 'missing' ELSE 'ok' END,
      CASE WHEN service_key IS NULL THEN 'missing' ELSE 'ok' END;
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := functions_url || '/functions/v1/flag-rating-proof',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', service_key
      ),
      body := jsonb_build_object('proof_id', NEW.id::text),
      timeout_milliseconds := 5000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[dispatch_rating_proof_auto_flag] dispatch failed for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS "trg_dispatch_rating_proof_auto_flag_insert" ON "public"."rating_proof";
CREATE TRIGGER "trg_dispatch_rating_proof_auto_flag_insert"
  AFTER INSERT ON "public"."rating_proof"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."dispatch_rating_proof_auto_flag"();

DROP TRIGGER IF EXISTS "trg_dispatch_rating_proof_auto_flag_update" ON "public"."rating_proof";
CREATE TRIGGER "trg_dispatch_rating_proof_auto_flag_update"
  AFTER UPDATE OF "file_id" ON "public"."rating_proof"
  FOR EACH ROW
  WHEN (NEW.file_id IS DISTINCT FROM OLD.file_id)
  EXECUTE FUNCTION "public"."dispatch_rating_proof_auto_flag"();

-- FEATURE ON HOLD: the dispatch is committed but DISABLED, so no upload is
-- auto-assessed yet (auto_flag_status stays 'pending', the admin flag queue stays
-- empty). The BEFORE-UPDATE guard above stays ENABLED. To turn the feature on,
-- run a follow-up migration enabling both triggers, then set the ANTHROPIC_API_KEY
-- secret and deploy the flag-rating-proof function:
--   ALTER TABLE public.rating_proof ENABLE TRIGGER trg_dispatch_rating_proof_auto_flag_insert;
--   ALTER TABLE public.rating_proof ENABLE TRIGGER trg_dispatch_rating_proof_auto_flag_update;
ALTER TABLE "public"."rating_proof" DISABLE TRIGGER "trg_dispatch_rating_proof_auto_flag_insert";
ALTER TABLE "public"."rating_proof" DISABLE TRIGGER "trg_dispatch_rating_proof_auto_flag_update";

-- 5. Grants (consistent with repo convention; column privileges follow the table).
GRANT ALL ON TABLE "public"."rating_proof" TO "anon";
GRANT ALL ON TABLE "public"."rating_proof" TO "authenticated";
GRANT ALL ON TABLE "public"."rating_proof" TO "service_role";
