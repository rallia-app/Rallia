# Interview outreach sender

`send-interview-outreach.mjs` posts the user-interview outreach messages as in-app chat.
For each recipient it ensures a 3-person **group** conversation exists (the recipient
plus both founders, Mathis and Jean) and posts the cohort-appropriate message, sent from Mathis.

## Safety

- **Dry run by default.** Nothing is written unless you pass `--execute`.
- **Prod is blocked** unless you pass `--allow-prod` (it checks the project ref in `SUPABASE_URL`).
- **Idempotent.** It reuses an existing founders+recipient group thread, and skips anyone who
  already has a message from this campaign (tagged via `message.metadata.campaign`).

## Env

Uses the service_role key (bypasses RLS), so run it server-side only, never in the app.

```
export SUPABASE_URL="https://ahbaeewecdeguxtxtvhr.supabase.co"   # staging
export SUPABASE_SERVICE_ROLE_KEY="<staging service_role key>"     # Supabase dashboard > Project Settings > API
```

## Recipients

A CSV with columns `email,segment[,locale]`, or inline `--recipient email:segment[:locale]`.
Segments: `new | active | one_session | drifted`. See `recipients.sample.csv`.
Language is the recipient's `preferred_locale` (fr\* = French, else English) unless overridden.

Real recipient CSVs are git-ignored (they contain PII); only `recipients.sample.csv` is tracked.

## Waves and cohort lists

Send in waves matched to your interview capacity, not all at once. The script's idempotency
means re-running with more rows never double-messages anyone.

Lapsed is small and fixed, so it's pre-split under `waves/`:

- `waves/lapsed-wave1.csv` — pilot, 10 people (7 one_session + 3 drifted)
- `waves/lapsed-wave2.csv` — remaining 8

```
node scripts/outreach/send-interview-outreach.mjs --csv scripts/outreach/waves/lapsed-wave1.csv --allow-prod --execute
```

New and Active are moving windows, so generate them fresh right before their wave with
`build-cohort-csv.mjs` (read-only):

```
node scripts/outreach/build-cohort-csv.mjs --cohort new   --out scripts/outreach/waves/new.csv
node scripts/outreach/build-cohort-csv.mjs --cohort active --out scripts/outreach/waves/active.csv --limit 30
```

Caveat: the `active` cohort is built from `profile.last_active_at`, which undercounts real
activity (mobile sessions refresh silently). It surfaces ~80 on prod vs ~325 truly active in
PostHog. That's fine for sampling a couple dozen active users to interview; it is not a true
active-user total. For an exhaustive active list, build it from PostHog ($screen in last 30d).

## Smoke test on staging (recommended order)

Run from the repo root.

```
# 1. Preview the exact message text (no DB, no env needed)
node scripts/outreach/send-interview-outreach.mjs --preview

# 2. Dry run against staging (reads only: resolves people, plans conversations)
node scripts/outreach/send-interview-outreach.mjs --recipient someone@staging.test:one_session

# 3. Execute for ONE test recipient, then inspect the result in the app / DB
node scripts/outreach/send-interview-outreach.mjs --recipient someone@staging.test:one_session --execute

# 4. Re-run step 3 and confirm it now says "already sent (skipped)" (idempotency)
```

What to verify after step 3:

- The conversation has exactly 3 participants: the recipient + both founders.
- The message content, language, and sender (Mathis) are right.
- It shows up in the recipient's inbox and in both founders' inboxes.

The conversation title defaults to `"<recipient first name>, Jean & Mathis"` (e.g. `"Ana, Jean & Mathis"`).
Pass `--title "..."` to force a single static title for every thread instead.

Useful flags: `--csv <path>`, `--limit N`, `--title "..."`, `--sender <email>`, `--allow-missing-name`.

## Side effects

Inserting a message fires the normal DB triggers (search vector, conversation bump, realtime
broadcast, and `notify_new_message`). On a real send, recipients get a push notification, which
is the intended behavior. On staging with test accounts this is harmless.

## Real run (later, on prod)

Point `SUPABASE_URL` at prod, add `--allow-prod`, and use the lapsed CSV
(its `segment` column already uses `one_session` / `drifted`):

```
node scripts/outreach/send-interview-outreach.mjs --csv ~/Desktop/rallia_lapsed_users_2026-06-09.csv --allow-prod --execute
```
