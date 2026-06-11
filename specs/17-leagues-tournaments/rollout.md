# Rollout

> Feature flag, beta cohort, performance budgets, observability, and the test plan for shipping leagues & tournaments.

## Feature flag

Single PostHog feature flag controls visibility:

| Key                           | Type    | Default | Used by                                         |
| ----------------------------- | ------- | ------- | ----------------------------------------------- |
| `leagues_tournaments_enabled` | boolean | `false` | Mobile nav, web `(org)` routes, RPC entrypoints |

The flag is checked at three layers:

1. **Mobile nav**: `apps/mobile/src/navigation/AppNavigator.tsx` hides the L&T entries.
2. **Web routes**: `(org)/leagues` and `(org)/tournaments` 404 unless the flag is on for the user.
3. **RPC entrypoints**: Each L&T RPC begins with `IF NOT lt_feature_enabled(auth.uid()) THEN RAISE EXCEPTION 'NOT_AVAILABLE' END IF;`. The function `lt_feature_enabled` reads the user's PostHog payload from a JWT claim mirrored by the auth hook.

Flag rollout strategy:

| Phase | Cohort                                       | Duration | Exit criteria                                               |
| ----- | -------------------------------------------- | -------- | ----------------------------------------------------------- |
| 1     | Internal (Rallia team + 5 friend organizers) | 2 weeks  | No P0/P1 bugs in 1 week; positive feedback on creation flow |
| 2     | GMA communities (mirroring zone-auto-join)   | 4 weeks  | < 5 % support-ticket rate per active organizer              |
| 3     | All Quebec users                             | 4 weeks  | Same                                                        |
| 4     | All Canada users                             | rolling  | —                                                           |

## Implementation phasing (vertical slices)

Implementation ships in vertical slices: each slice delivers one user-visible flow end-to-end (migration + RPC + hook + screen) before the next slice starts. Stub RPCs / placeholder screens are explicitly avoided — anything we build, we ship as something a real user can click. The foundation slices (schema, RLS) are the only horizontal layers; everything after them is feature-by-feature.

| Slice                                      | Scope                                                                                                                                                                                                                                        | Migration files                                        | UI                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------- |
| **F1 — Schema**                            | Enums, tables, indexes, `updated_at` triggers. No business logic.                                                                                                                                                                            | `<ts>_leagues_tournaments_schema.sql`                  | None                                     |
| **F2 — RLS**                               | Helper functions (`is_tournament_organizer`, `is_league_organizer`, `is_active_league_member`, `assert_caller_plays_sport`), RLS enabled on all tables, SELECT policies, deny-direct-write on children. Reuses existing `public.is_admin()`. | `<ts>_leagues_tournaments_rls.sql`                     | None                                     |
| **V1 — Tournament create**                 | `tournament_create` RPC. Mobile + web create form. Detail screen with read-only view of the draft.                                                                                                                                           | `<ts>_lt_tournament_create_rpc.sql`                    | Tournament-create + draft-detail screens |
| **V2 — Open registration & self-register** | `tournament_open_registration`, `tournament_register`, `tournament_close_registration`, `tournament_withdraw`. Registration list view.                                                                                                       | `<ts>_lt_tournament_registration_rpcs.sql`             | Registration CTA + list                  |
| **V3 — Bracket**                           | `tournament_generate_bracket`, `tournament_reset_bracket`, `tournament_swap_players`, score validators in `shared-utils`. Bracket viewer.                                                                                                    | `<ts>_lt_tournament_bracket_rpcs.sql`                  | Bracket render + organizer edit          |
| **V4 — Score entry & completion**          | `tournament_submit_match_score`, `tournament_validate_score`, `tournament_override_score`, `tournament_dispute_score`, advance-winner trigger. Score-entry sheet.                                                                            | `<ts>_lt_tournament_scoring_rpcs.sql` (+ trigger)      | Score-entry + result display             |
| **V5 — Tournament cancel / archive**       | `tournament_cancel`, `tournament_archive`, `tournament_reschedule`, audit emit on organizer mutations. Cancel CTA + archive cron.                                                                                                            | `<ts>_lt_tournament_lifecycle_rpcs.sql`                | Cancel button + archive banner           |
| **V6 — League create + season open**       | `league_create`, `league_join`, `league_approve_member`, `season_create`, `season_open`. League list + season toggle.                                                                                                                        | `<ts>_lt_league_create_rpcs.sql`                       | League create + member list              |
| **V7 — Session publish + confirmations**   | `session_create`, `session_publish`, `session_confirm_presence`, `lt-close-confirmations` cron. Confirmation push.                                                                                                                           | `<ts>_lt_session_lifecycle_rpcs.sql` (+ edge function) | Session detail + confirm CTA             |
| **V8 — Match sheet (BY_RANK only)**        | `session_generate_sheet`, `session_regenerate_sheet`, BY_RANK pairing in `shared-utils`. Match-sheet viewer.                                                                                                                                 | `<ts>_lt_session_sheet_rpcs.sql`                       | Sheet display + lock toggle              |
| **V9 — League scoring + ranking**          | `session_submit_match_score`, `session_validate_score`, `recalc_season_ranking`. Ranking screen with tie-breakers 1–4.                                                                                                                       | `<ts>_lt_league_scoring_rpcs.sql`                      | Score-entry + ranking display            |
| **V10 — Notifications + analytics**        | All notification payloads from notifications.md wired up. PostHog events from analytics.md emitted.                                                                                                                                          | (no schema)                                            | Notification action handlers             |

Each `V*` slice is an independent commit-and-ship unit. The user-visible deliverable at the end of every slice is verifiable in the running app — no unwired RPCs, no half-built screens, no speculative stubs.

Slices not in this list (waitlist, invite links, doubles, BALANCED_DOUBLES, exports, etc.) ship as v1.1 vertical slices following the same pattern. The "Phasing" table in [README.md](./README.md#phasing) lists the v1.1 / v2 capability set; this table is the implementation-order plan within v1.

### Per-slice flow

For every `V*` slice:

1. Migration: only the schema/RPC objects this slice needs.
2. Apply locally via `npx supabase migration up`; smoke-test the RPC via psql / Supabase Studio.
3. Add the React Query hook in `packages/shared-hooks` or `apps/<app>/src/hooks` consuming the RPC.
4. Build the screen / dialog / button. Reuse the [initialData dialog pattern](../../.claude/projects/-Users-mathis-dev-startups-rallia-rallia/memory/MEMORY.md) where applicable.
5. Manually verify the flow in the running app (mobile sim or web dev server).
6. Commit. Move on.

## Migration deployment

Each slice's migration is deployed the same way:

1. `npx supabase migration up` locally; verify the migration applies cleanly and the next slice's smoke test passes.
2. `npx supabase migration up` on staging.
3. Apply to prod via `npx supabase migration up`.
4. (Once flag is wired: toggle PostHog for the next cohort.)

All migrations are non-destructive — they only add objects. There is no backfill from existing data.

## Backfill

None required. Existing matches in the casual `matches` table are not retroactively associated with leagues or tournaments. A future "add to league" feature could associate them; out of scope for v1.

## Performance budgets

End-to-end targets, measured via PostHog Web Vitals + Sentry transactions:

| Operation                                         | P50      | P95      | P99      |
| ------------------------------------------------- | -------- | -------- | -------- |
| `tournament_register` RPC                         | < 100 ms | < 300 ms | < 500 ms |
| `tournament_generate_bracket` (N=32)              | < 150 ms | < 250 ms | < 500 ms |
| `session_generate_sheet` (32 players)             | < 150 ms | < 250 ms | < 500 ms |
| `recalc_season_ranking` (12 sessions, 16 members) | < 250 ms | < 500 ms | < 1 s    |
| Bracket SELECT (full tree, N=32)                  | < 50 ms  | < 100 ms | < 200 ms |
| Mobile bracket FCP (cached → realtime)            | < 600 ms | < 1 s    | < 2 s    |
| Web bracket-editor LCP (N=32)                     | < 1.5 s  | < 2.5 s  | < 4 s    |
| Realtime fanout per row update                    | < 200 ms | < 500 ms | < 1 s    |

Performance regressions trigger PagerDuty if the P95 exceeds budget for > 30 minutes.

## Observability

### Sentry

- All RPC calls instrumented via `@sentry/supabase` integration; errors carry `tournament_id` / `league_id` / `session_id` tags.
- Mobile: existing Sentry setup carries new tags for L&T screens.
- Web: existing Sentry setup carries new tags for `(org)` routes.

Critical alerts:

- `BRACKET_LOCKED` raised > 5×/hour (signal of organizer confusion).
- `OPTIMISTIC_LOCK_CONFLICT` raised > 20×/hour (signal of UI not refetching).
- Score validation errors > 50×/hour (signal of validator bug or i18n issue in instructions).

### PostHog

- All events from [analytics.md](./analytics.md) flow into PostHog.
- Dashboards configured per analytics.md.

### Structured logs

Edge functions and triggers log structured JSON via `console.log({ ... })` consumed by Supabase Logflare:

```json
{
  "scope": "lt-tournament-bracket-gen",
  "tournament_id": "...",
  "participant_count": 12,
  "duration_ms": 187,
  "outcome": "ok"
}
```

Logs are queryable in Supabase dashboard; alarms wire into the existing Slack alerts.

## Test plan

### Unit tests

Run via `npm test --workspaces`. Coverage targets:

| Module                                      | Coverage |
| ------------------------------------------- | -------- |
| `shared-utils/src/score/`                   | 95 %     |
| `shared-utils/src/matching/` (Blossom)      | 90 %     |
| `shared-utils/src/seeding/` (seedPositions) | 100 %    |
| `shared-utils/src/ranking/`                 | 90 %     |

Mandatory test cases:

- `seedPositions(N)` for N ∈ {2, 4, 8, 16, 32} matches the position tables in [tournament-bracket.md](./tournament-bracket.md#position-tables).
- Score validator accepts every valid example and rejects every invalid example documented in [score-entry.md](./score-entry.md).
- Tie-breakers produce expected rank for canonical fixtures.

### Integration tests

Run against a local Supabase instance via `npx supabase test db`:

- Create tournament → register 12 players → generate bracket → play through to completion.
- Same as above but with 1 doubles partnership withdraw at round 2.
- Create league → open season → publish 3 sessions with confirmations and scores → close season → assert ranking matches expected.
- RLS smoke tests: every table has policies that block cross-tenant access.
- Optimistic lock test: two parallel `tournament_update` calls, one succeeds, one returns `OPTIMISTIC_LOCK_CONFLICT`.

### E2E tests

Detox (mobile) and Playwright (web):

| Mobile E2E                                                 | Web E2E                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------- |
| Create tournament → open registration → register self      | Web organizer creates league → invites members          |
| View bracket realtime updates after opponent submits score | Web organizer generates bracket → drags to swap players |
| Confirm session presence from notification action button   | Web organizer overrides a disputed score                |
| Submit score → validate via mutual confirm                 | CSV export downloads with correct content               |

### Load test

Synthetic load via k6 or Artillery:

- 100 concurrent `tournament_register` calls.
- 50 concurrent `session_generate_sheet` calls.
- 1000 spectators on a single `tournament:{id}:bracket` channel — measure server CPU + Realtime fan-out lag.

Target: no error rate spike; P95 RPC latency stays within budget.

## Rollback plan

If a P0 bug is discovered post-launch:

1. Toggle PostHog flag off for the affected cohort. Mobile UI hides L&T immediately.
2. Existing tournaments / leagues remain accessible (data not deleted) but cannot be modified.
3. Hotfix is shipped via the next mobile release (TestFlight → App Store) and matching web deploy.
4. Flag toggled back on per Phase plan.

We do not roll back the migration unless the bug is data-corrupting; in that case, admin (system 15) intervention restores last-known-good state from PITR backup.

## Documentation

- This spec folder is the source of truth.
- Organizer-facing help docs at `https://help.rallia.app/leagues-tournaments` (separate doc effort, not in this spec).
- Engineering runbook at `docs/runbooks/leagues-tournaments.md` (not yet created; tracked).

## Owners

| Area                | Owner             |
| ------------------- | ----------------- |
| Spec                | Product + Mathis  |
| Backend (DB / RPCs) | Backend           |
| Mobile UI           | Mobile            |
| Web organizer UI    | Web               |
| Notifications       | Backend + Mobile  |
| Analytics           | Product           |
| Rollout / flagging  | Product + Backend |

## Co-founder brief alignment

The original `_archive/SPEC_LEAGUES_TOURNAMENTS_V2.md` was derived from `SCOPE LIGUES & TOURNOIS.docx` written by the co-founding team. Items in the brief that are _intentionally_ deferred or diverged from in this spec are documented in:

- [README — Deliberate divergences](./README.md#deliberate-divergences-from-the-original-french-scope) — single-sport-per-entity; single-bracket-per-tournament.
- [tournaments — registration → Shareable invite links](./tournaments.md#shareable-invite-links) — covers "Lien : L'organisateur peut partager un lien".
- [leagues — League capacity & member waitlist](./leagues.md#league-capacity--member-waitlist) — covers "Limites/quotas".
- [leagues — Guest invitations to sessions](./leagues.md#guest-invitations-to-sessions) — covers "invité hors classement".
- [match-sheet — Pickleball odd-cardinality alternatives](./match-sheet.md#pickleball-odd-cardinality-alternatives) — covers "match à 3" and drill modes.
- [ranking — `formatWeights`](./ranking.md#rules-shape) — covers "Pondération par format".
- [score-entry — INT modifier](./score-entry.md#modifiers) — covers "Score non terminé".
- [mobile-ux — Mode Édition indicator](./mobile-ux.md#mode-édition-indicator) — covers organizer "Mode Édition" requirement.
- [mobile-ux — Draft persistence](./mobile-ux.md#draft-persistence-auto-save) — covers "Sauvegarde automatique".
- [analytics — Competitiveness & fairness metrics](./analytics.md#competitiveness--fairness-metrics) — covers KPIs from §14 of the brief.
- [web-organizer-ux — Exports](./web-organizer-ux.md#exports) — covers CSV/XLSX/PDF.
- [edge-cases](./edge-cases.md) — covers all anomaly scenarios from §12 of the brief.

Items deferred to v2 by mutual agreement:

- **Pools / poules** for very large sessions.
- **Internal Elo rating** alongside points-based ranking.
- **Public API integrations** (calendar, third-party booking).
- **Cross-format weighting UI** (the `formatWeights` rule is in the schema; the editor surface ships in v1.1).
- **Tournament 64 / 128 brackets** wait for the chunked bracket renderer.

If the co-founder reviews this spec and disagrees with any divergence, the discussion happens before Phase 1 of the [rollout plan](#feature-flag) starts.

## Definition of done (V1 launch)

- [ ] Migration applied to prod
- [ ] Mobile build with L&T tabs shipped via TestFlight + Play Store
- [ ] Web `(org)` routes deployed
- [ ] PostHog flag enabled for Phase 1 cohort
- [ ] Notifications wired and verified in fr-CA + en-US
- [ ] CSV / PDF exports working
- [ ] At least 3 organizers ran a complete tournament-or-season end-to-end on the staging environment
- [ ] Sentry + PostHog dashboards green for 7 days at Phase 1
- [ ] Help-center article published

After all checkboxes, advance to Phase 2.
