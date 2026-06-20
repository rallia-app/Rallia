# Responsiveness indicator — metric spec

Status: draft · Owner: TBD · Last updated: 2026-06-20

A positive-only signal that rewards players who actually respond to game
invitations, surfaced as a badge on the player card / profile and (phase 2) as a
ranking input. Goal: make "being responsive" a visible, desirable trait so
responsive players attract more games, and so the join-side bottleneck (invites
dying in silence) gets a market correction.

This spec is grounded in real prod data (pulled 2026-06-20). The thresholds below
are derived from the actual distribution, not guessed.

---

## 1. What we measure (and what we deliberately don't)

**Signal: response to host-sent game invitations.** The `match_participant`
lifecycle is clean and already instrumented (timestamps added 2026-06-09):

- `created_at` — invite sent
- `responded_at` — first response (accept / decline / time-suggestion). NULL = never responded.
- `expired_at` — pending invite lapsed (match started or was cancelled).

A response is a response whether they **accept or decline** — a fast clean "no"
keeps the funnel healthy and is responsive behaviour. Only **silence** (expired
with `responded_at IS NULL`) is the negative signal.

**Not in v1:**

- **Chat messages.** Noisy: most messages don't need a reply, "first reply" is
  ambiguous, group chats, read-but-no-reply is fine. Measuring chat response rate
  naively punishes normal behaviour. Revisit only as a secondary booster later.
- **Self-requests** (`requested_at IS NOT NULL`). That's the player reaching out,
  not responding. Excluded.
- **Reliability** (no-shows, lateness). Different concept — already covered by
  `reputation_event`. Keep distinct; they pair well but measure different things.

---

## 2. The two mandatory exclusions (without these the metric is garbage)

Prod data proved both of these are make-or-break:

### 2a. Exclude auto-generated invites (`match.is_auto_generated = true`)

Auto-match-gen floods players with machine invites they rationally ignore.

| Invite source        | Responded | Ignored (expired) | Response rate (resolved) |
| -------------------- | --------- | ----------------- | ------------------------ |
| Auto-generated       | 265       | 5,046             | **5.0%**                 |
| Human (host-created) | 205       | 419               | 32.9%                    |

Counting auto-invites makes _everyone_ look unresponsive and the badge
unattainable. Responsiveness is computed on **human invites only**.

### 2b. Exclude expiries from cancelled matches (`match.cancelled_at IS NOT NULL`)

Of 419 ignored human invites, **263 (63%) belonged to matches the host later
cancelled** — the invite became moot through no fault of the invitee. Median
invite was live ~17 days before expiring, so "didn't have time" is a non-issue;
cancellation is the whole distortion.

Effect of the filter on the honest base rate:

- Raw (all human invites): 205 / 624 = **32.9%**
- Fair (cancelled-match expiries removed): 205 / 361 = **56.8%**

**Resolution rules (per invite):**

```
responded  := responded_at IS NOT NULL
ignored    := responded_at IS NULL AND expired_at IS NOT NULL AND match.cancelled_at IS NULL
unresolved := responded_at IS NULL AND expired_at IS NULL          -- still pending, not counted
excluded   := match.is_auto_generated OR (ignored-but match.cancelled_at IS NOT NULL)

resolved   := responded OR ignored
```

(If a player responded to an invite whose match was _later_ cancelled, it still
counts as `responded` — they were responsive.)

---

## 3. The metric

### Eligible population (per recipient player, rolling window)

```sql
match_participant mp JOIN match m ON m.id = mp.match_id
WHERE mp.is_host = false
  AND mp.requested_at IS NULL          -- host-invited, not self-request
  AND m.is_auto_generated = false      -- exclusion 2a
  AND mp.created_at >= now() - interval '90 days'
```

### Quantities

- `invites_resolved` = responded + ignored (per §2 rules; cancelled-match expiries
  not counted as ignored → exclusion 2b)
- `invites_responded` = count with `responded_at IS NOT NULL`
- `response_rate` = invites_responded / invites_resolved
- `median_response_seconds` = median(`responded_at - created_at`) over responded invites

### Why rate is the headline ("fast" must be measured against lead time)

Methodological caveat (caught in review): the raw "97% of responses within 24h"
does **not** prove speed. `expired_at` is stamped at game start, and a response
must land before expiry — so if games start soon, "responded within 24h" only
means "responded before the game," not "responded fast." The absolute stat is
censored by the deadline. Speed only means something **relative to the lead time**
(invite sent → game start).

Measured correctly (human invites, 90d):

- **Lead time** (invite → game start): p50 ≈ 15–22h; ~55–69% of games start within
  24h, ~86% within 72h. Most games do start within a day, but there's a real
  multi-day tail.
- **Response delay as a fraction of available lead**: p50 = 1.3%, p75 = 14%,
  p90 = 55%. The median responder still had **~20h of runway left** when they
  answered; only 6% cut it to under 1h of slack.

So even after removing the censoring, responders are genuinely fast — they answer
after using a sliver of the window. The conclusion stands, now honestly: **rate is
the discriminating signal; time does not separate good responders from bad ones.**
The badge therefore does **not** gate on time. Typical response speed is shown on
the profile as descriptive flavour only.

---

## 4. Badge definition (launch)

**A player earns the "Responsive" badge when, over the trailing 90 days:**

1. `invites_resolved >= 3` (sample floor), **and**
2. `response_rate >= 0.67` (answers ≥2 of every 3)

No timing gate. Measured against lead time, response speed doesn't separate good
responders from bad ones (median responder leaves ~20h of runway — see §3), so
gating on it would only add noise. Typical response time is surfaced on the profile
as descriptive copy, never as a badge condition.

### What the data says this yields (prod, today)

Fair population, 90-day window: 150 players with ≥1 resolved invite, 39 with ≥3,
23 with ≥5. Average response rate among the ≥3 cohort = 55%.

| Floor       | Rate threshold | Players who'd earn it |
| ----------- | -------------- | --------------------- |
| ≥3 resolved | ≥67%           | **16**                |
| ≥3 resolved | ≥80%           | 10                    |
| ≥5 resolved | ≥67%           | 6                     |
| ≥5 resolved | ≥80%           | 5                     |

**Recommended launch = ≥3 / ≥67% → ~16 badged players** (~41% of the ≥3 cohort,
~10% of all active recipients). Rare enough to be desirable, common enough to
actually appear while browsing. `67%` is well above the 55% average and trivially
explainable ("answers 2 out of 3").

### Visibility rule (positive-only)

- Below threshold → **show nothing**. No "slow", no low score, ever. A negative
  signal scares off new/casual players and works against the desirability goal.
- Mirror the existing reputation gate: `ReputationDisplay.isVisible` only surfaces
  once there's enough data. `responsiveness.is_visible` follows the same idea
  (floor met + threshold cleared).
- New players with no invites simply have no badge — neutral, not penalised.

---

## 5. Continuous score (phase 2, for ranking)

The badge is binary and — given current human-invite volume — **rare (~16
players)**. To make sparse data still useful, compute a continuous
`responsiveness_score` (0–100) for **ranking/sorting and match-suggestion
weighting**, even for players below the badge threshold.

Use the **Wilson lower bound** of the response rate (95%), not the raw rate, so
small samples are penalised and volume is rewarded:

- 2/3 (67%, n=3) → Wilson LB ≈ 0.21
- 8/12 (67%, n=12) → Wilson LB ≈ 0.39

`responsiveness_score = round(100 * wilson_lower_bound(responded, resolved))`.

This is the real lever: if responsive players surface higher in the directory and
get weighted in match suggestions, the join-side bottleneck gets fixed
_mechanically_, not just informationally. Badge = the visible carrot; ranking =
the payoff. Ship the badge first, wire the score into ranking once it's trusted.

---

## 6. Storage & compute (mirror `player_reputation`)

**Do not compute inline in `search_players_nearby`.** Suggestion/search RPCs
already hit 8s timeouts at ~250 players; a windowed aggregate per row makes it
worse. Precompute, exactly like reputation does.

New table `player_responsiveness`:

| column                    | type             | notes                         |
| ------------------------- | ---------------- | ----------------------------- |
| `player_id`               | uuid PK → player |                               |
| `invites_resolved`        | int              | trailing-90d, fair population |
| `invites_responded`       | int              |                               |
| `response_rate`           | numeric          | responded / resolved          |
| `median_response_seconds` | int              | null if 0 responded           |
| `responsiveness_score`    | int              | Wilson LB × 100 (phase 2)     |
| `is_responsive`           | bool             | badge earned (§4)             |
| `is_visible`              | bool             | floor met                     |
| `window_start`            | timestamptz      |                               |
| `calculated_at`           | timestamptz      |                               |
| `updated_at`              | timestamptz      |                               |

Refresh via `recalculate_all_responsiveness()` on a daily `pg_cron` job (low
churn — daily is plenty; the badge doesn't need to be real-time). Follow the
`recalculate_player_reputation` pattern. Remember the explicit GRANTs on the new
public table (Supabase is removing default Data API grants).

---

## 7. Wiring into the app

1. **`PlayerSearchResult`** (`packages/shared-services/src/players/playerService.ts`)
   — add fields next to the reputation ones:
   `responsiveness_is_responsive: boolean`, `response_rate: number | null`,
   `responsiveness_is_visible: boolean`.
2. **`search_players_nearby()`** + the profile RPC — `LEFT JOIN player_responsiveness`
   and return the precomputed columns (no aggregation in the RPC).
3. **`ResponsivenessBadge`** — new component beside
   `apps/mobile/src/components/ReputationBadge.tsx`; render it in the badges row of
   `PlayerCard.tsx` (next to `RatingBadge` / `ReputationBadge`) and in
   `PlayerProfile.tsx`.
   - Card: compact chip only when `is_responsive` (e.g. ⚡ "Répond vite").
   - Profile: richer line, e.g. "Répond à la plupart des invitations, souvent en
     moins d'une heure." Only when visible.

### Copy (follow repo conventions)

- User-facing, FR: "Répond vite". Québécois tone OK, no em dashes.
- EN: "Responsive" / "Quick to reply".
- No 🎾 (both sports served) — use ⚡ / 💬 / ✅.
- Keep `match` in code/DB identifiers; "invitations"/"parties" in copy.

---

## 8. Edge cases & traps

- **Decline counts as a response** — don't punish a fast "no".
- **Cancelled-match expiries excluded** (§2b) — 63% of "ignores" were this.
- **Auto-invites excluded** (§2a) — would tank everyone to ~5%.
- **Min sample + rolling window** — `>=3 resolved`, 90 days. Avoids one unlucky
  invite defining a badge; rewards _current_ behaviour.
- **Short-lead invites** — measured against game start, ignored invites had median
  lead ~15h, and 23% were for games starting within 6h of the invite — but the same
  23% holds among _responded_ invites, so short lead doesn't predict ignoring. No
  exclusion needed now; revisit if last-minute invites grow (a game set to start in
  <2h that goes unanswered is borderline "didn't see it", not "ignored").
- **Gaming** — low risk (rewards a behaviour we want). Watch auto-accept-then-no-show;
  that's caught by reputation no-show events, not here.

---

## 9. Rollout & what to watch

1. Ship `player_responsiveness` table + daily cron (no UI).
2. Verify the badged set looks right (~16 players) and stable across refreshes.
3. Add badge to card + profile behind the visibility gate.
4. Phase 2: wire `responsiveness_score` into directory sort + suggestion weighting.
5. Measure: do invites to badged players get answered more / convert to filled
   games at a higher rate? Does badge presence correlate with profile→invite CTR?

### Open knobs (data-backed defaults chosen; revisit as volume grows)

- Window: 90d (chosen for sample; instrumentation only goes back to ~Apr 2026).
- Floor: 3 resolved. Raising to 5 cuts the badged set to ~6 — too few for launch.
- Threshold: 67%. 80% gives a tighter ~10-player "top responder" tier if you'd
  rather it read as elite.
- As human-invite volume grows (esp. as "find a match" displaces auto-gen), the
  badged population grows without changing thresholds.

```

```
