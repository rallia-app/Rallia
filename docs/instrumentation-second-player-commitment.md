# Instrumentation spec — Second-Player Commitment funnel

**Owner:** _tbd_ · **Status:** draft · **Last updated:** 2026-06-09

## Why this exists

Analysis of prod (week of 2026-06-01, n=154 goal-setters) found that **supply is not the
bottleneck** (~88% of goal-setters have a compatible, reachable, time-overlapping pool) but
**only ~15% played any real match and ~3% hit their weekly goal.** The entire gap is **match
formation** — specifically, _getting a second player to commit to a created match_:

- Human-created matches fill **26.7%** of the time; auto-generated **2.4%**.
- Guest-invite acceptance: human **28.9%**, auto **0.8%** (80% of auto invites sit "pending" forever).
- **94–99% of cancelled matches never filled** — "cancellation" is mostly "nobody joined," not flaking.

So there is **one** metric that matters and **one** funnel we cannot currently see end-to-end.
Today we can't answer _why_ a second player doesn't commit, because the decision step is
uninstrumented (see Current State). This spec closes that.

## The one metric (north star)

**Second-Player Commitment Rate** = matches that get ≥1 _accepted_ invitee ÷ matches created
(then fill → played downstream). Tracked weekly, segmented **auto vs human**, and broken down
by the funnel below. Everything else here exists to explain movements in this number.

## Implementation status (2026-06-09)

**Shipped (PR #459):**

- **A4 commitment KPI** + **A3 human/auto invite funnel** on the admin Matches tab.
- **A2 / B2 decline reasons** — `cancellation_reason_enum` extended (`bad_timing`, `too_far`,
  `skill_mismatch`, `dont_know_player`, `cost`, `changed_mind`); persisted on decline; reason
  chips in the decline modal; `match_declined` now carries `match_id` + `decline_reason`.
- **B4 join key (P1 / P2)** — `match_id` added to `notification_received`,
  `push_notification_opened`, and `invite_to_match_sent`. **Every stage of the recipient funnel
  now carries `match_id`.**

**Join-key decision:** the recipient experience funnel joins on **`match_id` + person** (each
person has exactly one invite per match), so `match_id` — not `invite_id` — is the practical
PostHog join key, and it is now present on every stage. The delivered → opened → decided funnel
is therefore constructable today:

| Stage     | Event(s)                                     | Join key            |
| --------- | -------------------------------------------- | ------------------- |
| Delivered | `notification_received`                      | `match_id` + person |
| Opened    | `push_notification_opened` / `match_viewed`  | `match_id` + person |
| Decided   | `match_joined` / `match_declined` (+ reason) | `match_id` + person |

- **A1 transition timestamps + explicit expiry** — migration `20260609170000`:
  `responded_at` (stamped by trigger on pending→joined/declined and on time-suggestion insert),
  `joined_at` now stamped on any transition to joined, and `expired_at` stamped by an hourly
  pg_cron sweep (`expire_stale_match_invites()`) for unanswered invites whose match started or
  was cancelled — status intentionally stays `pending`, so read **no-response** as
  `status='pending' AND expired_at IS NOT NULL`. Best-effort backfill from `updated_at`
  (hosts and approved self-requesters excluded). This unlocks **time-to-respond** and makes the
  silent-ignore cohort (the largest funnel segment) explicit.

**Consciously skipped (diminishing returns — `match_id` + person already joins every stage):**

- `invite_id` on notification events (needs push payload to carry `match_participant.id`).
- Per-invitee `invite_to_match_sent` (needs `invitePlayers` to return created rows).
- B5 invite-impression event (delivered/opened approximate it).

---

## Current state (audit — build on this, don't rebuild)

### What the admin dashboard already has (DB-derived, `packages/shared-hooks/src/useAdminAnalytics.ts`)

- **Lifecycle funnel** (`components/admin/matches-tab.tsx`, `useMatchQualityAnalytics`):
  created → filled → played → quality; outcomes (cancelled / mutualCancel / fellThrough /
  pending); drop-off (no-show / late / low-rating / reported); per-sport; auto vs organic.
- **Auto-invite funnel** (`components/admin/auto-invite-funnel.tsx`, `useAutoInviteFunnel`):
  matchesCreated → invitesSent → invitesSettled → responded → {accepted, declined,
  timeSuggested} → noResponse; plus self-request approvals. **Computed from
  `match_participant.status` — i.e. current state, not events.**

> Gap 0: the **human-created** invite funnel is NOT rendered, even though the same
> `match_participant` data exists. This is the fastest win — mirror `AutoInviteFunnel` for
> `is_auto_generated = false`.

### What the DB has (`public.match_participant`)

- `status` enum — the only reliably populated invite signal:
  `requested · pending · joined · declined · refused · left · cancelled · kicked · waitlisted`.
- Lifecycle/reason columns **exist but are essentially unwritten** (prod, 4,864 rows):
  | column | populated |
  |---|---|
  | `requested_at` | 3.2% |
  | `joined_at` | 4.2% |
  | `cancellation_reason` | **0.4%** |
  | `cancellation_notes` | **0.0%** |
  | `checked_in_at` | 0.5% |
  - There is **no `responded_at` / `declined_at`** column.
  - Consequence: **no time-to-respond, no decline reason** anywhere in the DB.

### What the mobile app already captures (PostHog, `apps/mobile/src/services/analytics.ts`)

Relevant events already firing:

- Sender: `match_created` {match_id,…}, `invite_to_match_sent` {invite_count}, `match_suggestion_invite_sent` {match_id, opponent_id, source, scores…}
- Recipient: `notification_received` {type, channel}, `push_notification_opened` {type, notification_id?}, `notification_marked_read` {type, source}, `match_suggestion_shown` {opponent_id, facility_id, slot_start, scores…}, `match_viewed` {match_id, source, is_auto_generated}, `match_joined` {match_id, is_auto_generated, discovery_source?}, `match_join_requested` {match_id,…}, `match_declined` {sport_id, is_auto_generated}, `waitlist_joined` {match_id,…}
- Outcome: `match_outcome_submitted` already carries a `cancellation_reason` enum
  (`weather|court_unavailable|emergency|other`) — proof the pattern is easy; we just never
  added it to the _decline_ step.

> Client-event gaps (detailed below): no shared **invite_id** to join the funnel;
> `match_declined` has **no match_id and no reason**; `notification_received` has no
> match/invite id or source; `invite_to_match_sent` is a bare count.

---

## Gap analysis — the commitment funnel

| Funnel stage (recipient)              | DB (authoritative)                                   | PostHog (experience)                                                          | Gap to close                                                                         |
| ------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Invite created / sent                 | `status='pending'` ✓                                 | `match_suggestion_invite_sent` ✓ (auto) / `invite_to_match_sent` = count only | add `invite_id`+`match_id`+`invitee_id`+`source`+`channel` to the human send         |
| Delivered (push/in-app)               | —                                                    | `notification_received` (no ids)                                              | add `invite_id`/`match_id`/`source`; emit per invite                                 |
| Seen (impression of decision surface) | —                                                    | partial (`match_suggestion_shown`, `match_viewed`)                            | add an invite-detail impression keyed by `invite_id`                                 |
| Opened                                | —                                                    | `push_notification_opened` (no match_id), `match_viewed` ✓                    | add `invite_id`/`match_id` to push-open                                              |
| **Decision: accepted**                | `status='joined'` ✓ (`joined_at` 4%)                 | `match_joined` ✓                                                              | populate `joined_at`; add `invite_id`                                                |
| **Decision: declined (+ WHY)**        | `status in (declined/refused)` ✓ but **reason 0.4%** | `match_declined` (no match_id, no reason)                                     | **populate `cancellation_reason`; add reason + match_id + invite_id to event**       |
| Decision: time-suggested              | `status` + `match_time_suggestion` ✓                 | —                                                                             | add `match_time_suggested` event (optional)                                          |
| No-response / expired                 | inferred (`pending` past slot)                       | not emitted                                                                   | add server `invite_expired` transition + `responded_at` so "no response" is explicit |

**Root takeaway:** we have _state_ (`status`) but not _events_ (timestamped transitions) and not
_reasons_. The fix is to make every invite state-change a first-class, timestamped,
reason-bearing record server-side, and mirror the decision step client-side with a join key.

---

## Spec

### Part A — Server / DB (authoritative; source of truth for the metric)

**A1. Timestamp every invite transition.** On each `match_participant.status` change, write the
matching timestamp (and backfill columns where missing):

- `invited_at` (new) — when the pending invite is created.
- `requested_at` — already exists; write it on self-request.
- `responded_at` (new) — first accept/decline/time-suggest.
- `joined_at` — already exists; write on accept.
- `declined_at` (new, or rely on `updated_at`+status) — on decline/refuse.
- `expired_at` (new) — when an unanswered invite is closed (slot passed / match cancelled).

These enable **time-to-respond** and an explicit **no-response** bucket — neither is possible today.

**A2. Capture the decline reason (P0).** Populate `cancellation_reason` (+ optional
`cancellation_notes`) on every `declined / refused / left / cancelled`. Reuse/extend an enum
mirroring the existing outcome enum, recipient-framed:
`already_played · bad_time · too_far · skill_mismatch · dont_know_player · cost · changed_mind · other`.
The column exists and is 0.4% populated — this is the single highest-value fix.

**A3. Render the human-invite funnel (P0, no new data).** Add an `is_auto_generated=false`
variant of `AutoInviteFunnel` (or a source toggle) — the data already exists in
`useAutoInviteFunnel`'s source query. Gives the human acceptance funnel immediately.

**A4. Expose the Second-Player-Commitment metric (P0).** New RPC + KPI on the Matches tab:
`matches_created → matches_with_first_acceptance → filled → played`, segmented auto/human,
weekly. This is the number every initiative is judged against.

### Part B — Client / PostHog (experience + "why"; for what the DB can't see)

**B1. One join key: `invite_id`.** Add `invite_id` (= `match_participant.id`) **and** `match_id`,
`invite_source` (`auto|human`), `channel` (`push|in_app`) to **every** invite-related event:
`invite_to_match_sent`, `notification_received`, `push_notification_opened`, `match_viewed`,
`match_joined`, `match_declined`, `match_join_requested`. Without this the funnel cannot be
reconstructed in PostHog.

**B2. Fix `match_declined` (P0).** Add `match_id`, `invite_id`, `invite_source`, and
`decline_reason` (same enum as A2). If product wants the reason, add a lightweight
optional "why?" prompt on decline; otherwise infer where possible and default `other`.

**B3. Make `invite_to_match_sent` per-invite.** Replace the bare `{invite_count}` with one event
per invitee carrying `invite_id`, `match_id`, `invitee_id`, `channel`, `invite_source` (keep a
rollup count if useful). Mirrors the richer `match_suggestion_invite_sent`.

**B4. Enrich delivery/open.** Add `match_id`/`invite_id`/`invite_source` to `notification_received`
and `push_notification_opened` so **delivered → opened → decided** is computable per invite,
and time-to-open / time-to-decision become available client-side.

**B5. (Optional) decision-surface impression.** Fire `match_invite_viewed` {invite_id, match_id,
source} when the recipient sees the accept/decline surface, to separate "never saw it" from
"saw it, didn't act."

### Reconciliation (how the two systems are used)

- **DB = the rate.** Complete, server-truth, consent-independent → owns the commitment metric,
  acceptance %, decline-reason mix, time-to-respond.
- **PostHog = the why/where.** Delivered→seen→opened→decided experience funnel, friction,
  time-in-app, segment exploration. Joined to the DB by `invite_id` / `match_id`.
- Never compute the headline rate from client events (lossy, consent-gated).

---

## Event schema appendix

### New / changed PostHog events

```
invite_to_match_sent        (CHANGED) { invite_id, match_id, invitee_id, channel, invite_source, sport_id }
match_declined              (CHANGED) { invite_id, match_id, invite_source, decline_reason, sport_id, sport_name }
notification_received       (CHANGED) { type, channel, match_id?, invite_id?, invite_source? }
push_notification_opened    (CHANGED) { type, notification_id?, match_id?, invite_id? }
match_viewed                (CHANGED) { match_id, source, is_auto_generated, invite_id? }
match_joined                (CHANGED) { match_id, is_auto_generated, invite_id?, discovery_source? }
match_invite_viewed         (NEW)     { invite_id, match_id, invite_source }            # B5, optional
```

### DB columns (on `match_participant`)

```
invited_at      timestamptz  (NEW)   -- pending invite created
responded_at    timestamptz  (NEW)   -- first accept/decline/time-suggest
declined_at     timestamptz  (NEW)   -- or derive from updated_at + status
expired_at      timestamptz  (NEW)   -- unanswered invite closed
cancellation_reason  enum    (POPULATE)  -- extend enum per A2; currently 0.4% written
joined_at / requested_at     (POPULATE)  -- currently 4% / 3%
```

---

## Phasing

- **P0 (1 sprint, mostly existing data/columns):** A2 decline reason, A3 human funnel, A4
  commitment metric, B2 fix `match_declined`. → answers "where & why second players don't commit."
- **P1:** A1 transition timestamps + B1 `invite_id` join key + B3 per-invite send. → time-to-respond,
  explicit no-response, joinable client funnel.
- **P2:** B4/B5 delivered→seen→opened experience funnel; time-to-decision dashboards.

## Validation / QA

- Reconcile DB acceptance count vs `match_joined` event count by `invite_id` (expect DB ≥ PostHog).
- After A2/B2, decline-reason coverage should jump from 0.4% → >80% of declines.
- Sanity: Second-Player-Commitment Rate computed from the new RPC must equal the
  fill-based figures in this analysis (~27% human / ~2% auto) for the same window.

## Source references

- Mobile events: `apps/mobile/src/services/analytics.ts`
- Admin funnels: `apps/web/components/admin/{matches-tab,auto-invite-funnel}.tsx`
- Data hooks: `packages/shared-hooks/src/useAdminAnalytics.ts`
- Analysis that motivated this: `scripts/compatibility_analysis/` (calibration_validation, match_formation)
