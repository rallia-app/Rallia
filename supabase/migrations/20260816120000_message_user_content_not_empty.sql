-- Chat duplicate-send hardening, part 2 (part 1 is the client-generated
-- message id in shared-services, which dedupes network-replay inserts on the
-- existing primary key).
--
-- Defense in depth: user-authored messages must carry non-blank content.
-- Soft-deleted rows are exempt (deleteMessage clears content to '' on
-- purpose), as are structured card messages (message_type <> 'user').
-- All existing rows satisfy this (verified on prod: every blank-content row
-- is soft-deleted), so the constraint is added NOT VALID then validated to
-- avoid a long lock while still ending up fully enforced.

ALTER TABLE public.message
  ADD CONSTRAINT message_user_content_not_empty
  CHECK (
    message_type <> 'user'
    OR deleted_at IS NOT NULL
    OR btrim(content) <> ''
  ) NOT VALID;

ALTER TABLE public.message VALIDATE CONSTRAINT message_user_content_not_empty;
