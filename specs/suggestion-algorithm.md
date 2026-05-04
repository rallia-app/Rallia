# Match Suggestion Algorithm

The suggestion engine surfaces personalized (opponent, court, time slot) triplets for a given player. It runs entirely in `packages/shared-services/src/matches/suggestionService.ts` and is invoked via the `useMatchSuggestions` hook.

---

## How a suggestion is built

Each suggestion represents **one opponent** with one or more compatible facilities and conflict-free time slots. The caller sees the best available triplet per opponent.

---

## Step-by-step flow

### Step 1 — Score (opponent, facility) pairs via SQL RPC

**RPC:** `get_match_suggestions_scored` (authenticated) or `get_match_suggestions_anon` (unauthenticated)

Returns rows sorted by `matchup_score`, each containing one `(opponent, facility)` pair along with:

| Field                           | Description                                                                                                                                                                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `player_compatibility`          | How well the two players match (0–1). Composite of match-type alignment (30%), rating proximity weighted by badge confidence (30%), duration preference alignment (5%), mutual availability overlap (15%), and reputation score (20%). |
| `facility_affinity`             | Affinity score for that facility (0–1). Facilities come from the opponent's favorites; score is: caller also favorited it (40%) + proximity to caller (30%) + proximity to opponent (30%).                                             |
| `matchup_score`                 | Composite RPC-level score: 70% `player_compatibility` + 30% `facility_affinity`.                                                                                                                                                       |
| `overlapping_days_periods`      | Shared availability windows, e.g. `[{day: "monday", period: "morning"}]`. These come from each player's weekly availability preferences.                                                                                               |
| `match_type` / `match_duration` | The **opponent's** preferred match type and duration from their `player_sport` record.                                                                                                                                                 |

The RPC fetches `max(50, 4× limit)` rows to ensure enough candidates survive downstream filtering.

### Step 2 — Fetch real-time court availability (parallel)

For each unique facility in the results, `fetchUnifiedAvailability` is called to get real bookable slots for the next 3 days. Facilities without a connected data provider receive synthetic slots generated in Step 4.

### Step 3 — Fetch busy slots for all players (parallel, with Step 2)

All active match participations (status: `joined`, `requested`, `pending`, `waitlisted`) for the caller **and** all candidate opponents are fetched for the 3-day window. Cancelled matches are excluded. These are used in Step 4 for conflict detection.

### Step 4 — Build conflict-free slots per (opponent, facility)

For each `(opponent, facility)` pair:

- **Facility WITH availability source:** Real bookable slots are filtered to keep only those that fall within a shared availability period (`overlapping_days_periods`) and don't overlap with either player's existing matches.
- **Facility WITHOUT availability source:** On-the-hour slots are generated for each shared period (morning: 8–12, afternoon: 13–17, evening: 18–21) on the matching days within the 3-day window, then conflict-filtered the same way. Past hours on "today" are excluded.

Facilities with no remaining conflict-free slots are dropped from the suggestion.

### Step 5 — Re-score and rank opponents

Each surviving opponent gets a final score:

```
finalScore = playerCompatibility
           + actionabilityBoost   // more available slots = higher boost (max +0.10, formula: min(0.1, (totalSlots - 1) × 0.012))
           + urgencyBoost         // sooner slot = higher boost (today/tomorrow: +0.05, day 2: +0.03, day 3: +0.01)
           + jitter               // ±3% random noise for feed freshness across sessions
```

Opponents are sorted by `finalScore` descending. A quality threshold of `0.35` is applied (at least `min(10, limit)` results are always returned regardless of threshold). The final list is capped to `limit`.

> **Note:** The `playerCompatibility` field on the returned suggestion objects contains the adjusted `finalScore`, not the raw RPC value.

---

## How each attribute is chosen

| Attribute      | How it's determined                                                                                                                                                                                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Opponent**   | SQL RPC score — primarily `player_compatibility` (match-type alignment, rating proximity, duration preference, mutual availability, reputation) + re-scored in Step 5.                                                                                                                             |
| **Court**      | `facilityAffinity` from the RPC — opponent's favorite facilities, scored higher when also favorited by the caller and close to both players. Best-affinity facility is listed first per opponent.                                                                                                  |
| **Time slot**  | Earliest conflict-free slots within shared availability periods. For the card display, `pickSlotForSuggestion` (in `useUnifiedMatchFeed`) picks a **random slot from the soonest available day** on the best-affinity facility, seeded by opponent ID for render stability.                        |
| **Duration**   | The suggestion carries the opponent's preferred duration from the RPC. When **creating** a match from a suggestion, the caller's own `preferred_match_duration` is used (via `useSuggestionInviteHandler`), or derived from the real slot length if a bookable slot with an end time is available. |
| **Match type** | The suggestion carries the opponent's preferred match type from the RPC. When **creating** a match, the caller's own `preferred_match_type` is used (via `useSuggestionInviteHandler`).                                                                                                            |

---

## Optimization goal

The algorithm optimizes for **mutual benefit**: the slot must work for both players (shared availability period, no schedule conflict) at a court both players are familiar with. This maximizes the probability that the invite is accepted, not just sent.

---

## Tuning levers

| Lever                           | File / location                                        |
| ------------------------------- | ------------------------------------------------------ |
| RPC scoring weights             | Supabase function `get_match_suggestions_scored`       |
| Quality threshold (0.35)        | `suggestionService.ts` — `QUALITY_THRESHOLD` constant  |
| Urgency boost values            | `suggestionService.ts` — urgency block in Step 5       |
| Actionability boost formula     | `suggestionService.ts` — actionability block in Step 5 |
| Jitter range (±3%)              | `suggestionService.ts` — jitter line in Step 5         |
| Search window (3 days)          | `suggestionService.ts` — `getNextNDays(3)`             |
| RPC headroom (max(50, 4×limit)) | `suggestionService.ts` — `rpcLimit` constant           |
| Anon search radius (25 km)      | `useMatchSuggestions` default `maxDistanceKm`          |
| Stale time (2 min)              | `useMatchSuggestions` — `staleTime`                    |
| GC time (5 min)                 | `useMatchSuggestions` — `gcTime`                       |
