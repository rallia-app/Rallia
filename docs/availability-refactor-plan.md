# Player Availability Refactor — 6-Block Weekly Grid with Freshness

## Context

Player availability today is stored as one of three coarse periods (`morning` / `afternoon` / `evening`) per day. Two problems:

1. **Staleness** — players set it once on onboarding, never revisit. After weeks or months, the data no longer reflects reality, but matchmaking still trusts it.
2. **Precision** — "Tuesday morning" can mean 6 AM or 11 AM. Matches at very different real times look identical to the scoring engine, so suggestions surface that can't actually happen.

This refactor solves both in one ship:

- Replace the 3-period enum with **6 time blocks** (`early`, `morning`, `midday`, `afternoon`, `evening`, `late`).
- Add a **`last_confirmed_at` freshness timestamp** that the UI exposes as a staleness banner and a weekly push notification refreshes via a "tap save without edits" gesture.
- Auto-migrate existing rows so no one is forced through re-onboarding.

Out of scope (V2): per-week record history, implicit availability inference from decline reasons, "free now" beacon.

---

## Locked Design Decisions

1. **6 time blocks:** `early` (6–9), `morning` (9–12), `midday` (12–14), `afternoon` (14–17), `evening` (17–20), `late` (20–23). Weighted toward the evening side of the day where most amateur play actually happens.
2. **Freshness:** single recurring weekly pattern (no per-week records); `last_confirmed_at` column; weekly Monday push notification "Confirm your week"; tapping Save with or without edits refreshes the timestamp.
3. **Backfill:** auto-migrate `morning → early + morning`, `afternoon → midday + afternoon`, `evening → evening + late`. All rows get `last_confirmed_at = NULL` so every user is prompted to refine on next visit.
4. **Compact widget:** 7 days × 2 stacked rows on `PlayerCard` — top row = AM cluster (early/morning/midday), bottom row = PM cluster (afternoon/evening/late). Full 6-row grid on profile screens.
5. **i18n:** additive — add new keys for `early`/`midday`/`late`, keep existing keys to avoid breaking old app builds in the wild.

---

## Verified Current State

- Live table is `public.player_availability` with columns `id, player_id, day, period, is_active, created_at, updated_at`. **No `sport_id`** (lost in the singular-tables consolidation at `supabase/migrations/20251208000000_consolidate_to_singular_tables.sql:178-185`).
- Live enums: `day_enum` (mon–sun), `period_enum` (`morning` / `afternoon` / `evening`). The unused 4-value `time_period` enum is dead legacy — leave it alone.
- Suggestion overlap saturation in `get_match_suggestions_scored` is `/7.0` not `/21` (verified at `supabase/migrations/20260515190000_suggestion_disputed_penalty.sql:424`). Doubling block granularity to 6 will inflate scores unless we move the denominator to `/14.0`.
- Cron pattern to model after: `supabase/migrations/20260429100000_add_morning_digest.sql` + `supabase/functions/send-morning-digest/index.ts` (RPC of eligible users → `insert_notifications` → push dispatcher).
- `player_interest.weekly_availability JSONB` (web `/play` lead form) is schemaless; no DB migration required for it, just the UI.
- Latent bug: `supabase/migrations/20260204000000_add_auto_match_generation.sql:211,222,239` references the dropped `day_of_week` / `time_period` column names. Function is dead today (disabled by `20260321100000_disable_auto_match_generation_for_beta.sql`) but the file gets touched during the refactor — fix in-flight.

---

## Migration Strategy

**Single PR, three migrations, atomic schema swap.** PostgreSQL doesn't allow `DROP VALUE` from an enum, so the only clean path is: create new enum → backfill rows → swap column type → drop old enum. Done in one transaction. The table is small (beta scale ≪ 10k rows), so the brief lock is fine.

### M1 — `YYYYMMDD000000_availability_6block_enum_and_backfill.sql`

Atomic schema change in a single transaction:

1. `CREATE TYPE period_enum_v2 AS ENUM ('early','morning','midday','afternoon','evening','late')`
2. `ALTER TABLE player_availability ADD COLUMN last_confirmed_at TIMESTAMPTZ` (nullable)
3. Backfill with `INSERT ... ON CONFLICT DO NOTHING`:
   - For each existing row where `period = 'morning'`, insert sibling `(player_id, day, 'early', is_active, NULL)`
   - For each `period = 'afternoon'`, insert sibling `(player_id, day, 'midday', ...)`
   - For each `period = 'evening'`, insert sibling `(player_id, day, 'late', ...)`
4. Set `last_confirmed_at = NULL` on every row in the table (simpler than partial) — everyone gets the staleness banner once.
5. `ALTER TABLE player_availability ALTER COLUMN period TYPE period_enum_v2 USING period::TEXT::period_enum_v2`
6. `DROP TYPE period_enum CASCADE` (only dependents are now-rebuilt RPCs in M2)
7. `ALTER TYPE period_enum_v2 RENAME TO period_enum`
8. Verify the partial indexes `idx_player_availability_active_lookup` and `idx_player_availability_player_active` survive (Postgres preserves indexes across `ALTER COLUMN TYPE`); if `DROP CASCADE` took them, recreate.
9. Don't forget explicit `GRANT` statements on the table per project convention.

### M2 — `20260515220100_suggestion_rpcs_6block_saturation.sql` (shipped)

RPC rewrites for the two **live** suggestion functions only. Both are CREATE OR REPLACE with the full body cloned from the latest version, with single-constant adjustments to keep scoring well-calibrated after the row doubling from backfill.

- **`get_match_suggestions_scored`** — cloned from `supabase/migrations/20260515190000_suggestion_disputed_penalty.sql`. Single change: `score_overlap` saturation `/ 7.0` → `/ 14.0`. Saturation point stays at the same real-time density (~2.3 fully-overlapping days) under the doubled row count.
- **`get_match_suggestions_anon`** — cloned from `supabase/migrations/20260515160000_suggestion_score_bookability.sql`. Single change: `opp_avail_density` denominator `/ 21.0` → `/ 42.0`. Keeps density in [0,1] against the new 7×6 grid ceiling.

Deliberately **not** changed in M2:

- **`search_players_nearby`** — its `pa.period::TEXT = p_availability` predicate works identically against any enum value (string compare). Leaving the signature as `TEXT` (not `TEXT[]`) avoids a breaking change for production mobile clients in the friends-and-family cohort. The Phase E macro AM/PM filter is handled client-side instead.
- **`get_time_slot_starts`** + **`generate_weekly_matches_for_player`** — dead code today (auto-match cron disabled by `20260321100000_disable_auto_match_generation_for_beta.sql`). Both reference the old `day_of_week` / `time_period` column names. Touching them risks introducing a regression if they're ever reactivated; should be rewritten as part of an auto-match-generation revival, not here.

### M3 — `YYYYMMDD000200_availability_freshness_cron.sql`

Weekly refresh infrastructure:

1. `ALTER TABLE profile ADD COLUMN IF NOT EXISTS last_availability_refresh_sent_at TIMESTAMPTZ` (dedup sentinel, mirrors `last_morning_digest_sent_at`).
2. `ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'availability_refresh_reminder'`.
3. `CREATE FUNCTION get_availability_refresh_eligible_users()` — returns users where:
   - `onboarding_completed = TRUE`
   - at least one `player_availability` row exists for the player
   - `MAX(last_confirmed_at)` across their rows is `NULL` or `< NOW() - INTERVAL '14 days'`
   - `last_availability_refresh_sent_at IS NULL OR < NOW() - INTERVAL '6 days'` (don't double-send if cron runs twice)
4. `cron.schedule('send-availability-refresh-weekly', '0 14 * * 1', ...)` — Monday 14:00 UTC ≈ 10 AM EDT. Same `net.http_post` template as the morning digest migration.
5. `GRANT EXECUTE` to `service_role`.

---

## Per-Phase Execution Order

Each numbered item maps to ~one file change or one commit. Phases A through G should land in one PR but in this order.

### Phase A — Backend schema + RPCs + types

1. Write **M1** migration (above).
2. Write **M2** migration (above).
3. Run locally: `npx supabase migration up`. Verify with:
   - `SELECT period, COUNT(*) FROM player_availability GROUP BY 1` (all 6 values appear)
   - `SELECT COUNT(*) FROM player_availability WHERE last_confirmed_at IS NULL` (= total row count)
   - `SELECT enumlabel FROM pg_enum WHERE enumtypid = 'period_enum'::regtype` (6 values, old enum gone)
   - `EXPLAIN ANALYZE SELECT * FROM get_match_suggestions_scored(...)` — partial index still used.
4. Regenerate Supabase types: `supabase gen types typescript --linked > packages/shared-types/src/supabase.ts`.

### Phase B — Shared services (typed chokepoint)

5. **`packages/shared-services/src/players/playerService.ts:128`** — broaden `AvailabilityPeriod` union from 3 to 6 values. Change `searchPlayersForSport`'s availability arg from `string | undefined` to `string[] | undefined`; helper to map UI filter → array lives next to the type. `PlayerSearchResult.availability` shape is unchanged (the JSONB aggregator already emits whatever values exist).
6. **`packages/shared-services/src/database.ts:1067-1095`** (`saveAvailability`) — add `last_confirmed_at: new Date().toISOString()` to every upsert payload. This is the **single chokepoint** that enforces freshness on every write path. Also collapse the deletion+reinsert sequence currently in `apps/mobile/src/screens/UserProfile.tsx:703-740` to call `saveAvailability` instead of writing directly — so the timestamp can never be skipped.
7. **`packages/shared-services/src/database.ts:732-746`** (`getPlayerAvailability`) — currently `select('*')`; types alone update via codegen. Verify callers can read `last_confirmed_at`.

### Phase C — Mobile UI (write path)

8. **`apps/mobile/src/features/onboarding/components/wizard/steps/AvailabilitiesStep.tsx`** — replace `TimeSlot = 'AM' | 'PM' | 'EVE'` (line 30) with the 6-value union; expand `TIME_SLOTS`, `SLOT_TO_I18N_KEY`, and the `dayAvailability` defaults at lines 82, 131-133. Transpose layout to 6 rows × 7 days for vertical readability on phones. Bump minimum-selections validation if desired (keep at 3 — easier to clear with 6 options).
9. **`apps/mobile/src/features/onboarding/components/overlays/PlayerAvailabilitiesOverlay.tsx`** — same union expansion at lines 120-135. Drop the AM→morning / PM→afternoon / EVE→evening translation (UI key set now matches DB enum 1:1). Add a staleness banner in the header that renders when `last_confirmed_at` is `NULL` or > 14 days. Wire the Save button to call `saveAvailability` even on no-op so `last_confirmed_at` advances — this is the "tap save without edits" UX. Keep existing `SheetManager` lifecycle (await hide before show).
10. **`apps/mobile/src/features/onboarding/components/wizard/OnboardingWizard.tsx:848`** — drop the AM/PM/EVE → enum map.

### Phase D — Mobile UI (read path)

11. **`apps/mobile/src/screens/UserProfile.tsx`** — at `fetchAvailabilities` (lines 495-540) include `last_confirmed_at` in selection (auto via `select('*')`). Render 6-row grid at lines 1580-1650. The `timeMap` at line 723 needs the 6 values. Replace the inline delete+insert write path at lines 703-740 with a `saveAvailability` call (the Phase B chokepoint refactor).
12. **`apps/mobile/src/screens/PlayerProfile.tsx`** — render full 6-row read-only grid at lines 663-673 / 2353. Privacy gate (`privacy_show_availability`) unchanged. Optional: small "Last confirmed N weeks ago" caption when stale.
13. **`apps/mobile/src/features/community/components/AvailabilityGrid.tsx`** — replace the `PERIODS = ['morning','afternoon','evening']` constant (line 18) with two arrays: `TOP_ROW = ['early','morning','midday']`, `BOTTOM_ROW = ['afternoon','evening','late']`. Each day cell shows two stacked dots — top filled if any TOP_ROW block is active that day, bottom filled if any BOTTOM_ROW block is active. Same footprint as today, conveys the 6-block reality at AM/PM granularity.
14. **`apps/mobile/src/features/community/components/PlayerCard.tsx:306-314`** — no logic change; verify the widget rerenders correctly with the new aggregation.

### Phase E — Mobile filter bar (client-side macro filter)

15. **`apps/mobile/src/features/community/components/PlayerFiltersBar.tsx`** — keep dropdown density. Replace `AvailabilityFilter = 'all'|'morning'|'afternoon'|'evening'` (line 31) with `'all'|'am'|'pm'`. Update `AVAILABILITY_OPTIONS` and i18n key map at lines 142-147. Granular 6-value filter is a follow-up.
16. **`apps/mobile/src/screens/Community.tsx`** — call sites pass `p_availability = NULL` to `searchPlayersForSport` whenever the filter is `am` or `pm` (since the RPC signature is unchanged from M2). Apply the macro filter client-side by inspecting the returned `availability` JSONB on each result. Small dataset, fine for V1; revisit if the directory paginates large pages.

### Phase F — Web

17. **`apps/web/components/player-interest-form.tsx`** — replace `PERIODS` (line 47) with the 6-value list. Expand the grid (lines 240-300) from 3 rows to 6. Min-3-selections rule at line 408 stays.
18. **`apps/web/app/api/submit-player-interest/route.ts`** — no logic change. The JSONB validator at lines 50-65 only checks shape `{day, period}`, not enum values, so it accepts the new strings naturally.

### Phase G — i18n + analytics + freshness cron

19. **`packages/shared-translations/src/locales/en-US.json` + `fr-CA.json`** — additive keys (must read both files before editing):
    - `onboarding.availabilityStep.early`, `.midday`, `.late` (with hour-range tooltips)
    - `playerDirectory.filters.availabilityAm`, `.availabilityPm` (macro filter labels)
    - `playerDirectory.periods.early`, `.midday`, `.late`
    - `playerAvailability.staleHint`, `.lastConfirmed`, `.confirmCta`
    - `notifications.availabilityRefresh.title`, `.body`
    - Keep existing `morning/afternoon/evening`, `am/pm/eve` keys untouched (old builds still reference them).
20. **`apps/mobile/src/services/analytics.ts`** — extend the existing `availability_schedule_updated` event with a `was_refresh_only` boolean (true when the save call advanced `last_confirmed_at` without changing any toggles). Optional new event `availability_refresh_confirmed` for cleaner PostHog funnels.
21. Write **M3** migration (above).
22. Create **`supabase/functions/send-availability-refresh/index.ts`** — model after `send-morning-digest/index.ts`: call `get_availability_refresh_eligible_users()`, batch through `insert_notifications` RPC with type `'availability_refresh_reminder'` and payload `{ deeplink: 'rallia://profile/availability' }`. Update `last_availability_refresh_sent_at` per user after dispatch.
23. Verify the deeplink handler in the mobile app routes `rallia://profile/availability` to `PlayerAvailabilitiesOverlay`. Search `apps/mobile/src/services/notifications` (or wherever push payload routing lives) — wire if missing.

---

## Backwards Compatibility — Old Builds in the Wild

- **Display paths** iterate hardcoded period arrays; unknown server values silently drop. Old apps under-display (early/midday/late invisible) but don't crash. Acceptable.
- **Write paths** through `OnboardingService.saveAvailability` still write only `morning/afternoon/evening` from old builds — those values remain valid in the new enum. Acceptable.
- **RPC signature change** is the only real break. Mitigate by keeping `p_availability TEXT DEFAULT NULL` as a backwards-compatible overload alongside the new `p_availability TEXT[]` — adds ~4 lines. Old clients keep working; they just can't filter by the new blocks.

No force-update required.

---

## Verification Plan

### Local SQL (pre-merge)

- `npx supabase migration up` (NOT `db push`).
- Run M1 inside `BEGIN; ... ROLLBACK;` once to inspect row-count growth: every pre-existing row should produce exactly 2 rows post-backfill.
- `SELECT enumlabel FROM pg_enum WHERE enumtypid = 'period_enum'::regtype` shows the 6 values.
- `EXPLAIN ANALYZE` `get_match_suggestions_scored` on seeded data — confirm `idx_player_availability_active_lookup` still chosen.

### TypeScript

- `npm run typecheck` across the monorepo. The codegen-regenerated supabase.ts will surface every `'morning'|'afternoon'|'evening'` string literal as a type error — work the list to zero.

### End-to-end manual

1. Fresh user → onboarding → AvailabilitiesStep → pick `early + midday + evening` on Tuesday → submit. Query `SELECT * FROM player_availability WHERE player_id = ?` — 3 rows with new enum values and fresh `last_confirmed_at`.
2. Second user in the same area → Community → filter by `AM` macro → first user surfaces only when AM cluster overlaps.
3. Tap first user's profile from `PlayerCard`: compact widget shows top dot filled (AM cluster present), bottom partially (only evening, no afternoon/late).
4. Open full profile: 6-row grid renders. Privacy toggle still hides correctly.
5. `get_match_suggestions_scored` between both users → confirm `overlapping_days_periods` JSONB contains new period names.
6. Backdate `last_confirmed_at` to NOW() - 20 days; open own UserProfile → staleness banner appears.
7. Invoke the cron manually: `SELECT net.http_post(...)` against the eligible-users RPC. Verify a row appears in `notification`, the dispatcher fires, push lands on simulator.
8. Tap the notification → opens `PlayerAvailabilitiesOverlay` → tap Save with no edits → `last_confirmed_at = NOW()` on every row; banner disappears.

### PostHog (project_id 329229 "Rallia App")

- `availability_schedule_updated` fires on both real edits and refresh-only saves; the new `was_refresh_only` dimension lets us split rates.
- Community `availability_filter` event property shows the new `am`/`pm` values arriving.

---

## Risks & Rollback

| Phase                   | Failure mode                                                            | Detection                                                | Rollback                                                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 enum swap / backfill | Row violates UNIQUE constraint or unexpected value                      | Transaction aborts                                       | Automatic; fix and retry                                                                                                                                                        |
| M2 overlap retuning     | Suggestion accept rate drops 48h post-deploy                            | PostHog accept-rate trend on `match_suggestion_*` events | Redeploy previous `get_match_suggestions_scored` body verbatim — RPCs are enum-agnostic at the join level, so reverting the `/14.0` change does not require touching the schema |
| M2 search signature     | RPC errors on old clients                                               | Sentry RPC errors                                        | Already mitigated via dual-overload (`TEXT` + `TEXT[]`)                                                                                                                         |
| Phase C/D mobile UI     | Build crashes on enum mismatch                                          | EAS preview channel smoke test                           | Standard mobile rollback (OTA / app-store)                                                                                                                                      |
| M3 cron                 | Edge function 500s                                                      | `get_logs` on `send-availability-refresh`                | `cron.unschedule('send-availability-refresh-weekly')` — data is unaffected                                                                                                      |
| Notification spam       | First cron run targets every user (all have `last_confirmed_at = NULL`) | Eligible-users query count                               | RPC already filters on `last_availability_refresh_sent_at`; add a `LIMIT 500` per run if needed                                                                                 |

---

## Out of Scope

- True per-week record history (separate row per ISO week) — V2.
- Implicit availability inference (decline reasons → un-set blocks) — V2.
- "Free now" beacon — needs liquidity, post-launch.
- Per-sport availability (table has no `sport_id` after consolidation; not re-adding).
- Granular 6-value filter dropdown on Community (sticking with `AM`/`PM` macro).
- Backfilling historical `player_interest.weekly_availability` JSONB rows — leaving as-is.

---

## Critical Files

- `supabase/migrations/20251208000000_consolidate_to_singular_tables.sql:178-185` — current schema (post-rename)
- `supabase/migrations/20260515190000_suggestion_disputed_penalty.sql:415-426` — overlap formula
- `supabase/migrations/20260515160000_suggestion_score_bookability.sql` — anon suggestion RPC template
- `supabase/migrations/20260515120000_search_players_include_availability.sql:101-198` — search RPC template
- `supabase/migrations/20260429100000_add_morning_digest.sql` — cron + edge function template
- `supabase/functions/send-morning-digest/index.ts` — edge function template
- `packages/shared-services/src/database.ts:1067-1095` — `saveAvailability` chokepoint (freshness write)
- `packages/shared-services/src/players/playerService.ts:128` — `AvailabilityPeriod` union (TS chokepoint)
- `apps/mobile/src/features/onboarding/components/overlays/PlayerAvailabilitiesOverlay.tsx:120-135` — main write-path UI
- `apps/mobile/src/features/community/components/AvailabilityGrid.tsx` — compact widget
- `apps/mobile/src/features/community/components/PlayerFiltersBar.tsx:31,142-147` — filter bar
- `apps/web/components/player-interest-form.tsx:33-47,240-300` — web lead form grid
- `packages/shared-translations/src/locales/{en-US,fr-CA}.json` — i18n strings (read both before editing)
