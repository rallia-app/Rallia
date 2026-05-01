# Match Suggestion Algorithm

The suggestion engine surfaces personalized (opponent, court, time slot) triplets for a given player. It runs entirely in `packages/shared-services/src/matches/suggestionService.ts` and is invoked via the `useMatchSuggestions` hook.

---

## How a suggestion is built

Each suggestion represents **one opponent** with one or more compatible courts and conflict-free time slots. The caller sees the best available triplet per opponent.

---

## Step-by-step flow

### Step 1 — Score (opponent, court) pairs via SQL RPC

**RPC:** `get_match_suggestions_scored` (authenticated) or `get_match_suggestions_anon` (unauthenticated)

Returns rows sorted by `matchup_score`, each containing one `(opponent, facility)` pair along with:

| Field                           | Description                                                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `player_compatibility`          | How well the two players match (0–1). Based on shared sport, similar rating, common play history, and mutual availability periods.       |
| `facility_affinity`             | Affinity score for that court (0–1). Based on courts frequented by either player.                                                        |
| `matchup_score`                 | Composite RPC-level score.                                                                                                               |
| `overlapping_days_periods`      | Shared availability windows, e.g. `[{day: "monday", period: "morning"}]`. These come from each player's weekly availability preferences. |
| `match_type` / `match_duration` | Derived from the opponent's preferences.                                                                                                 |

The RPC fetches 4× more rows than the requested limit to ensure enough candidates survive downstream filtering.

### Step 2 — Fetch real-time court availability (parallel)

For each unique facility in the results, `fetchUnifiedAvailability` is called to get real bookable slots for the next 3 days. Facilities without a connected data provider generate synthetic slots (Step 2b below).

### Step 3 — Fetch busy slots for all players (parallel, with Step 2)

All active match participations for the caller **and** all candidate opponents are fetched for the 3-day window. These are used in Step 4 for conflict detection.

### Step 4 — Build conflict-free slots per (opponent, court)

For each `(opponent, facility)` pair:

- **Facility WITH availability source:** Real bookable slots are filtered to keep only those that fall within a shared availability period (`overlapping_days_periods`) and don't overlap with either player's existing matches.
- **Facility WITHOUT availability source:** On-the-hour slots are generated for each shared period (morning: 8–12, afternoon: 13–17, evening: 18–21) on the matching days, then conflict-filtered the same way.

Facilities with no remaining conflict-free slots are dropped from the suggestion.

### Step 5 — Re-score and rank opponents

Each surviving opponent gets a final score:

```
finalScore = playerCompatibility
           + actionabilityBoost   // more available slots = higher boost (max +0.10)
           + urgencyBoost         // sooner slot = higher boost (today/tomorrow: +0.05, day 2: +0.03, day 3: +0.01)
           + jitter               // ±3% random noise for feed freshness across sessions
```

Opponents are sorted by `finalScore` descending. A quality threshold of `0.35` is applied (at least 10 results are always returned regardless of threshold).

---

## How each attribute is chosen

| Attribute      | How it's determined                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Opponent**   | SQL RPC score — primarily `player_compatibility` (sport match, rating proximity, play history, mutual availability) + re-scored in Step 5.                                   |
| **Court**      | `facilityAffinity` from the RPC — courts one or both players have played at before. Best-affinity court is shown first per opponent.                                         |
| **Time slot**  | Earliest conflict-free slot within a shared availability period. For the card display, `pickSlotForSuggestion` picks the soonest upcoming slot.                              |
| **Duration**   | Caller's preferred match duration (`callerDuration` from `player_sport` preferences), or derived from the real slot length if a bookable slot with an end time is available. |
| **Match type** | Caller's preferred match type (`callerMatchType` — casual / competitive / both).                                                                                             |

---

## Optimization goal

The algorithm optimizes for **mutual benefit**: the slot must work for both players (shared availability period, no schedule conflict) at a court both players are familiar with. This maximizes the probability that the invite is accepted, not just sent.

---

## Tuning levers

| Lever                      | File / location                                       |
| -------------------------- | ----------------------------------------------------- |
| RPC scoring weights        | Supabase function `get_match_suggestions_scored`      |
| Quality threshold (0.35)   | `suggestionService.ts` — `QUALITY_THRESHOLD` constant |
| Urgency boost values       | `suggestionService.ts` — urgency block in Step 6      |
| Jitter range (±3%)         | `suggestionService.ts` — jitter line in Step 6        |
| Search window (3 days)     | `suggestionService.ts` — `getNextNDays(3)`            |
| Anon search radius (25 km) | `useMatchSuggestions` default `maxDistanceKm`         |
| Stale time (2 min)         | `useMatchSuggestions` — `staleTime`                   |
