# Match Sheet Generation

> Pairing algorithms used by `session_generate_sheet` and `session_regenerate_sheet`.

This file specifies the pairing algorithms precisely enough that two implementations produce identical sheets given the same inputs (modulo deterministic RNG seeded on `session.id`).

## Inputs

| Input               | Source                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Confirmed players   | `session_presence` rows where status = `confirmed` (includes guests with `is_guest = true`) |
| Player rankings     | `season_rankings` (current as of generation time)                                           |
| Pre-paired partners | `session_presence.preferred_partner_id` (doubles only)                                      |
| Session config      | `sessions.rounds`, `formats_allowed`, `match_format`, `pairing_mode`                        |
| Court inventory     | `session_courts` join with `court`                                                          |
| H2H history         | `session_matches` aggregated for last `N` sessions of season                                |
| Locked rows         | `session_matches` where `locked = true`                                                     |
| Deterministic seed  | `hashtext(session_id::text)::bigint` for reproducible RNG                                   |

## Output

A list of `session_matches` rows with `team_a_user_ids`, `team_b_user_ids`, `round_number`, optional `court_id`, `scheduled_at`. Status defaults to `pending`. The output is upserted into the table; locked rows are preserved untouched.

## Pre-processing

1. Drop pre-paired pairs from the active player set if their preferred partner also confirmed.
2. If `cardinality(confirmed) % 2 == 1` and format is `singles`: highest-ranked player gets a BYE row (`team_a_user_ids = [user]`, `team_b_user_ids = []`, status = `walkover`, `winner_team = 'a'`). Per [ranking.md](./ranking.md#bye-treatment), a BYE awards participation points (default `pointLoss = 1`) but no win.
3. If `cardinality(confirmed) % 4 != 0` and format is `doubles`: by default, highest-ranked players matching the residue get BYE rows.

### Pickleball odd-cardinality alternatives

For pickleball sessions where odd-cardinality is common (3 confirmed, 5 confirmed, etc.), the co-founder brief permits two alternatives the organizer can opt into per session via `session.odd_cardinality_mode`:

| Mode            | Behavior                                                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bye` (default) | Highest-ranked extra player(s) get a BYE row                                                                                                                            |
| `three_player`  | Insert a 3-player match (1 vs 2). The lone side and the duo side play to a target score; scoring per [ranking.md](./ranking.md#points-per-match) `is_three_player` rule |
| `drill`         | Insert a `is_drill = true` match for the residue players; no points awarded; surfaced as "Practice court" in UI                                                         |

The organizer chooses the mode at session creation; `BALANCED_DOUBLES` and `BY_RANK` both honor it. Tennis sessions default to `bye` and lock the alternatives off (3-player tennis is non-standard).

## Pairing modes

### `RANDOM`

```typescript
function random(players: Ranking[], rng: SeededRNG): Pairing[] {
  const shuffled = shuffle(players, rng);
  return chunk(shuffled, 2).map(([a, b]) => ({ teamA: [a.userId], teamB: [b.userId] }));
}
```

Deterministic given `rng` seed.

### `BY_RANK` (default)

Highest-ranked plays second-highest, etc. Mirrors v1 spec but with explicit tiebreaks.

```typescript
function byRank(players: Ranking[]): Pairing[] {
  const sorted = [...players].sort(rankingCompare); // see ranking.md tie-breakers
  return chunk(sorted, 2).map(([a, b]) => ({ teamA: [a.userId], teamB: [b.userId] }));
}
```

For multi-round sessions, subsequent rounds rotate to avoid immediate rematches:

```typescript
function rotateForRound(sortedPlayers: Ranking[], round: number): Ranking[] {
  // Keep #1 fixed; rotate everyone else by (round - 1) positions
  const [head, ...tail] = sortedPlayers;
  const rotated = [...tail.slice(round - 1), ...tail.slice(0, round - 1)];
  return [head, ...rotated];
}
```

This is the standard "round-robin" rotation. With `K` players, every player has played every other player exactly once after `K - 1` rounds.

### `AVOID_REPEAT` (v2)

Minimum-cost matching that penalizes recent H2H pairings.

#### Cost function

For a candidate pair `(a, b)`:

```
recent_meetings = count of session_matches in the last N sessions
                  where {a, b} ⊆ (teamA ∪ teamB) and the match was completed

rank_distance = abs(rank(a) - rank(b))

partner_recency = 0 if never paired in the last N sessions
                  else (N - sessions_since_last_meeting) / N    // 0..1

cost(a, b) = 100 * recent_meetings + rank_distance + 50 * partner_recency
```

`N` defaults to 5 sessions, configurable per league rules (`avoidRepeatWindow`).

#### Algorithm

```typescript
function avoidRepeat(
  players: Ranking[],
  history: SessionMatch[],
  config: { window: number }
): Pairing[] {
  // Build a complete graph; edge weight = cost(a, b)
  // Solve minimum-weight perfect matching (Blossom algorithm)
  const matching = minWeightPerfectMatching(players, (a, b) => cost(a, b, history, config));

  return matching.map(([a, b]) => ({ teamA: [a.userId], teamB: [b.userId] }));
}
```

Implementation note: with ≤ 32 players, the O(V³) Blossom algorithm runs in < 50ms. We use a TypeScript port of [Edmonds' algorithm](https://en.wikipedia.org/wiki/Blossom_algorithm) lifted from `shared-utils/src/matching/`.

#### Fallback

If no perfect matching exists with finite cost (shouldn't happen, but defensive), fall back to `BY_RANK`.

### `SWISS` (v2)

Swiss-system tournaments pair players who currently have the same score. After each round the standings update; round R+1 pairs based on round R's scores.

```typescript
function swissPair(players: Ranking[], round: number, history: SessionMatch[]): Pairing[] {
  // Bucket by current points (computed including in-session results)
  const buckets = groupBy(players, p => p.points);

  // For each bucket, pair high vs low within bucket; "float" odd-out player to next-lower bucket
  const pairs: Pairing[] = [];
  for (const bucket of bucketsByPointsDesc(buckets)) {
    while (bucket.length >= 2) {
      const a = bucket.shift()!;
      const opponentIdx = findOpponent(bucket, a, history); // first who hasn't played a
      const b = bucket.splice(opponentIdx, 1)[0];
      pairs.push({ teamA: [a.userId], teamB: [b.userId] });
    }
    // float odd player to next bucket
    if (bucket.length === 1) floatTo(nextBucket, bucket[0]);
  }
  return pairs;
}
```

Swiss requires the session config `rounds > 1`; round 1 falls back to `BY_RANK` since no in-session points exist yet.

### `BALANCED_DOUBLES` (v1.1, doubles-only)

For doubles, build teams of 2 with similar combined skill, then match teams of similar combined skill.

#### Step 1: Pair partners

If players supplied `preferred_partner_id` and the preference is mutual, lock those pairs. For remaining players:

```typescript
function partnerByBalance(unpaired: Ranking[]): Pair[] {
  // Sort descending by ranking
  const sorted = [...unpaired].sort((a, b) => b.points - a.points);
  // Pair top with bottom: this maximizes intra-team balance and total team-strength variance,
  // which we then minimize across teams in step 2
  const N = sorted.length;
  const pairs: Pair[] = [];
  for (let i = 0; i < N / 2; i++) {
    pairs.push([sorted[i], sorted[N - 1 - i]]);
  }
  return pairs;
}
```

Each pair's "team strength" = sum of its two players' season points (or rating points if season has < 3 sessions played).

#### Step 2: Match teams

Pair the resulting teams using minimum-cost matching where cost is `|teamStrength(A) - teamStrength(B)|`.

#### No-rematch constraint

If the league's `default_rules.avoidRepeatWindow` is set, the matching also penalizes rematches in the last `N` sessions, with weight `100 * sessionsSinceLastMeeting^-1`.

#### Worked example

8 doubles players ranked 100, 95, 80, 75, 60, 55, 30, 20.

- Step 1 partner-pair (top↔bottom): (100, 20), (95, 30), (80, 55), (75, 60).
- Team strengths: 120, 125, 135, 135.
- Step 2 match teams (minimize strength diff): (120 vs 125), (135 vs 135) — both pairings differ by ≤ 5 points.

## Round assignment

For multi-round sessions, the same algorithm runs once per round. For round `r`:

- `BY_RANK`: rotate per `rotateForRound`.
- `AVOID_REPEAT`: include earlier rounds of the same session in the H2H weight.
- `SWISS`: use intra-session standings.
- `BALANCED_DOUBLES`: same partners across rounds (don't re-pair partners every round); only opponent matching changes.

## Court assignment

After pairings exist, allocate courts.

```typescript
function assignCourts(matches: SessionMatch[], courts: Court[]): SessionMatch[] {
  // Group by round; round R uses up to courts.length matches simultaneously
  const grouped = groupBy(matches, m => m.roundNumber);
  for (const [round, roundMatches] of grouped) {
    roundMatches.forEach((m, idx) => {
      m.courtId = courts[idx % courts.length]?.id;
      m.scheduledAt =
        roundStart(round) + Math.floor(idx / courts.length) * matchDurationMinutes * 60_000;
    });
  }
  return matches;
}
```

If no `session_courts` rows exist, `court_id` is left null and the organizer can label courts manually post-generation (`court_label` column).

## Locked matches

A match with `locked = true`:

- Is preserved by `session_regenerate_sheet`.
- Counts against pairing inputs as a fixed pairing — its players are removed from the active set before regeneration.
- Can only be unlocked by the organizer; unlocking does **not** trigger regen automatically.

## Manual edits

After generation, organizer can:

| Edit                         | RPC                        | Effect                                                                       |
| ---------------------------- | -------------------------- | ---------------------------------------------------------------------------- |
| Swap players between matches | `session_swap_players`     | Updates `team_a_user_ids` / `team_b_user_ids`; both matches flagged in audit |
| Lock match                   | `session_lock_match`       | Sets `locked = true`                                                         |
| Add match                    | `session_add_match`        | Insert new row at `round_number, court_id`; warns about uneven rounds        |
| Remove match                 | `session_remove_match`     | Delete row; warns players                                                    |
| Change format                | `session_set_match_format` | Per-match `format` override (rare)                                           |

Every manual edit shows the same confirmation dialog and writes an audit row. Members of affected matches are notified via `session_match_changed`.

## Regeneration rules

`session_regenerate_sheet`:

- Allowed only in `published` status.
- Preserves `locked` matches.
- Recomputes `pending` matches from the _current_ confirmed roster (which may differ from the original generation if someone declined or got promoted from waitlist).
- If any non-locked match has `status != 'pending'` (i.e., already in progress or completed), regeneration is rejected with `SHEET_LOCKED`.

## Performance budget

| Operation                                | Target (P95) |
| ---------------------------------------- | ------------ |
| `BY_RANK` for 32 players                 | < 20 ms      |
| `AVOID_REPEAT` for 32 players, window=5  | < 80 ms      |
| `BALANCED_DOUBLES` for 32 players        | < 100 ms     |
| `session_generate_sheet` end-to-end (32) | < 250 ms     |
