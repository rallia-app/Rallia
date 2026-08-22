# Ranking System

> Per-season point calculation, tie-breakers, and the materialized `season_rankings` table.

## Rules shape

Every league carries `default_rules` (jsonb) and every season freezes a copy at OPEN.

```jsonc
{
  "matchFormat": "two_of_three", // see data-model.md match_format enum
  "gamesPerSet": 6,
  "finalSetTiebreak": "super_tb_10pt",
  "formatsAllowed": ["singles", "doubles"],

  // Points
  "pointWin": 10,
  "pointLoss": 1, // participation (loser still played)
  "pointNoShow": -5,
  "pointBye": 1, // participation when no opponent
  "pointDraw": 5, // rare; only used in time-capped leagues
  "pointRetirementWinner": 10, // winner gets full win when opponent retires
  "pointRetirementLoser": 1, // retiring player still gets participation
  "pointWalkoverWinner": 10,
  "pointWalkoverLoser": 0, // distinct from no-show: 0 ≠ -5

  // Proportional bonuses (shipped). 0 = off, which is the default.
  "pointPerSetWon": 0, // added per SET won, on top of the result
  "pointPerGameWon": 0, // added per GAME won, on top of the result

  // Discrete bonuses (v1.1, unbuilt; toggle with `enableBonuses`)
  "enableBonuses": false,
  "bonusStraightSets": 2, // win in min sets without dropping any
  "bonusShutout": 1, // 6-0,6-0 (or 11-0)
  "bonusFairPlay": 1, // organizer manually awards

  // Malus (configurable)
  "malusLateWithdraw": -3, // declined < 24h before session
  "malusForfeit": -3, // retired during match
  "malusNoShow": -5, // = pointNoShow when no-show

  // Tie-break configuration
  "tieBreakerOrder": [
    "totalPoints",
    "headToHead",
    "setDifference",
    "gameDifference",
    "participationPercent",
    "deterministicRandom",
  ],

  // Repeat-avoidance (used by AVOID_REPEAT match-sheet pairing)
  "avoidRepeatWindow": 5,

  // Format weighting (per co-founder brief: "Pondération par format")
  // Multiplier applied to points earned in each format. Default 1.0 = no weighting.
  // Example: { "singles": 1.0, "doubles": 0.8 } makes a doubles win count for 80% of a singles win.
  "formatWeights": { "singles": 1.0, "doubles": 1.0, "mixed_doubles": 1.0 },

  // Pairing / seeding helpers (optional)
  "defaultRatingForUnknown": 0,
}
```

The shape is validated at `season_open` (inline check in RPC for v1; optional JSON-schema in `supabase/functions/_shared/leagues-tournaments-schema.json` when added). RPCs reject malformed rules.

## Outcome matrix (authoritative)

Use this table everywhere points or reputation are assigned. [score-entry.md](./score-entry.md) and [match-sheet.md](./match-sheet.md) link here — do not duplicate with different defaults.

| Situation                                     | Match row signal                        | Winner gets                 | Loser gets                           | Counts as win? | Reputation (loser/special)        |
| --------------------------------------------- | --------------------------------------- | --------------------------- | ------------------------------------ | -------------- | --------------------------------- |
| Regular completed match                       | `status = completed`                    | `pointWin` (+ bonuses v1.1) | `pointLoss`                          | yes / yes      | `match_completed` both            |
| Retirement                                    | `status = retired`                      | `pointRetirementWinner`     | `pointRetirementLoser`               | yes / no       | `match_retired` on retiree        |
| Walkover (match scheduled, opponent no-show)  | `status = walkover`, both teams slotted | `pointWalkoverWinner`       | `pointWalkoverLoser` (default **0**) | yes / no       | `match_no_show` on no-show player |
| BYE (no opponent slotted at sheet gen)        | `status = walkover`, empty `team_b`     | `pointBye` (default **1**)  | —                                    | no             | none                              |
| Presence no-show (confirmed but never played) | no match / cancelled match              | —                           | `pointNoShow` / `malusNoShow`        | no             | `match_no_show`                   |
| Late decline (< 24h before session)           | n/a (presence row)                      | —                           | `malusLateWithdraw`                  | no             | `match_cancelled_late`            |
| Drill match                                   | `is_drill = true`                       | 0                           | 0                                    | no             | none                              |
| Cancelled match / session                     | `status = cancelled`                    | 0                           | 0                                    | no             | none                              |

**BYE vs walkover:** BYE = odd player count at sheet generation, no opponent row. Walkover = opponent existed but failed to appear. They use different point keys (`pointBye` vs `pointWalkover*`).

**Walkover vs presence no-show:** Walkover is decided at match time (organizer or W/O score on linked match). Presence no-show is a session-attendance penalty applied when a confirmed member never plays — configured via `pointNoShow` / `malusNoShow`, not `pointWalkoverLoser`.

## Points per match

When a `session_match` reaches a terminal state, `recalc_season_ranking` applies points per the [Outcome matrix](./ranking.md#outcome-matrix-authoritative). This section expands the common cases:

| Outcome                                | Winner side gets        | Loser side gets        | Reputation event             |
| -------------------------------------- | ----------------------- | ---------------------- | ---------------------------- |
| `completed` (regular result)           | `pointWin` + bonuses    | `pointLoss`            | `match_completed`            |
| `retired` (loser retired mid-match)    | `pointRetirementWinner` | `pointRetirementLoser` | `match_retired`              |
| `walkover` (opponent no-show)          | `pointWalkoverWinner`   | `pointWalkoverLoser`   | `match_no_show` (loser only) |
| `walkover` (BYE — no opponent slotted) | `pointBye`              | —                      | none                         |
| `cancelled` (session-level cancel)     | 0                       | 0                      | none                         |

For doubles, both players on a side receive the same point delta.

If `formatWeights[match.format]` is set to a value other than 1.0, the final point delta is multiplied by that weight. Weights apply to the base point grant, bonuses, and malus uniformly. The pre-weight value is stored in the audit log for traceability.

Drill matches (`session_matches.is_drill = true`) award **0 points** regardless of score and are excluded from `wins`/`losses`/sets/games counters. They still count toward `sessions_attended` and toward repeat-avoidance H2H weighting (since they reflect player interaction).

Three-player matches (`session_matches.is_three_player = true`, used for pickleball when capacity is odd): the lone-side player gets `pointWin` if they win and `pointLoss` if they lose; each player on the duo side gets `pointWin / 2` if they win (rounded up) and `pointLoss` if they lose. Configurable via `rules.threePlayerScoring` (`'lone_full'` default, or `'duo_full'`).

### Proportional bonuses

The organizer's scoring formula is a base plus two optional proportional
bonuses, set in the league settings and snapshotted into every season at
`season_create` (so an edit is forward-looking: it reaches the seasons created
after it, never a running one).

- **`pointPerSetWon`**: added once per set the player's side won.
- **`pointPerGameWon`**: added once per game the player's side won.

Both default to **0**, which is result-only scoring. Both are refused if
negative (`lt_assert_league_rules`): they multiply a count of things _won_.
They apply to any scored outcome, but a walkover or bye carries no score, so
`lt_parse_score` returns zeroes and neither bonus pays anything there.

Worked example, `pointWin` 10 / `pointLoss` 1 / `pointPerSetWon` 3 /
`pointPerGameWon` 1, on a 6-4 6-2: the winner takes 10 + (2 x 3) + (12 x 1) =
**28**, the loser 1 + (0 x 3) + (6 x 1) = **7**.

### Discrete bonuses (v1.1, unbuilt)

When `enableBonuses = true`:

- **Straight-set win** (`bonusStraightSets`): match was a win without losing a set. For best-of-3 = `2-0`; best-of-5 = `3-0`; pickleball single-game always qualifies; pickleball best-of-3 = `2-0`.
- **Shutout** (`bonusShutout`): every set was won 6-0 (tennis) or every game `target-0` (pickleball).
- **Fair play** (`bonusFairPlay`): organizer awards manually via `session_award_bonus(match_id, user_id, kind, points)`. Audit row written.

### Malus

- **`malusLateWithdraw`**: applied when `session_presence` flips from `confirmed` to `declined` within 24h of `scheduled_at`. Implemented by the `session_confirm_presence` RPC, which also emits a `match_cancelled_late` reputation event (graduated; see [reputation-calculation.md](../05-reputation/reputation-calculation.md#late-cancellation-penalties)).
- **`malusNoShow`**: replaces `pointNoShow` if an explicit malus is configured.

## BYE treatment

A BYE row is inserted when an odd-cardinality group can't be paired (singles), or a residue can't form a doubles team. The row has `team_a_user_ids = [user]`, `team_b_user_ids = []`, `status = 'walkover'`, `winner_team = 'a'`, and is inserted at sheet generation.

The user gets `pointBye` (default 1) — same as a participation point. They don't get a "win" credited to `wins`. This prevents BYE-padding from inflating win records while still rewarding attendance.

## Calculation procedure

`recalc_season_ranking(season_id uuid)` is idempotent. It:

1. Locks `season_rankings` rows for the season (`SELECT ... FOR UPDATE`).
2. Resets all counters to 0.
3. Iterates over completed `session_matches` in the season, in `(scheduled_at, id)` order.
4. For each match, looks up the season's frozen `rules` and applies points/bonuses/malus.
5. Updates `wins`, `losses`, `draws`, `no_shows`, `sets_won`, `sets_lost`, `games_won`, `games_lost`, `matches_played`, `sessions_attended` per player.
6. Computes `sessions_eligible` for each member: count of sessions in the season whose `published_at <= member.left_at` (or `now()` if still active) and member status was active at session time.
7. Sorts and assigns `rank` per the tie-breaker chain (below).
8. Sets `last_recalculated_at = now()`.

Performance budget: < 500ms for a season with 12 sessions × 16 members.

## Tie-breakers

Applied in the order listed in `tieBreakerOrder` (default order shown). Each next criterion only breaks ties left after the previous one.

| Step | Criterion              | Computation                                                                                                                                                                                               |
| ---- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---------------------------------------------------------------------------------------------------------------- |
| 1    | `totalPoints`          | `points` desc                                                                                                                                                                                             |
| 2    | `headToHead`           | Among tied players: subset of `session_matches` where both are involved; whoever has more wins among that subset ranks higher. If exactly two tied, simple count; if 3+, mini-table of points among them. |
| 3    | `setDifference`        | `sets_won - sets_lost` desc                                                                                                                                                                               |
| 4    | `gameDifference`       | `games_won - games_lost` desc                                                                                                                                                                             |
| 5    | `participationPercent` | `sessions_attended / sessions_eligible` desc                                                                                                                                                              |
| 6    | `deterministicRandom`  | `tiebreak_seed` ascending. Seed is `hashtext(season_id                                                                                                                                                    |     | user_id)::bigint` — same input always produces same order. The "random" tie-break is reproducible and journaled. |

Ties at every step are documented in the `final_standings` snapshot at season close so members can audit the result.

## Stored vs derived

| Concept                           | Stored?   | Where                                           |
| --------------------------------- | --------- | ----------------------------------------------- |
| `points`, `wins`, `losses`, etc.  | ✅ stored | `season_rankings` (materialized)                |
| `rank`                            | ✅ stored | `season_rankings.rank`                          |
| `participationPercent`            | computed  | `sessions_attended * 100.0 / sessions_eligible` |
| Tier badges (top 3, etc.)         | derived   | UI                                              |
| Tie-breaker resolution detail     | derived   | UI on demand from the underlying counters       |
| Final standings snapshot at close | ✅ stored | `seasons.final_standings`                       |

The stored table is the source of truth for all UI reads. We never re-compute on the fly because:

- Reads dominate writes by orders of magnitude (every member checks ranking; only sessions update it).
- Tie-breakers are non-trivial and should not run in a hot path.

## Concurrency

Two organizers can't both trigger `recalc_season_ranking` simultaneously — the function uses `pg_advisory_xact_lock(hashtext(season_id::text))` to serialize. Concurrent attempts return `RANKING_RECALC_CONFLICT` (the second caller's transaction aborts).

## Public ranking display

The mobile and web ranking page renders:

```
┌──────┬─────────────┬────────┬──────┬──────┬────────┬────┐
│ Rank │ Player      │ Points │ W    │ L    │ +/-    │ %  │
├──────┼─────────────┼────────┼──────┼──────┼────────┼────┤
│ 1    │ John D. ✓   │ 45     │ 4    │ 1    │ +12    │ 80 │
│ 2    │ Jane S.     │ 42     │ 4    │ 2    │ +8     │ 100│
│ 3    │ Bob M.      │ 38     │ 3    │ 2    │ +5     │ 60 │
└──────┴─────────────┴────────┴──────┴──────┴────────┴────┘
```

- `+/-` is the games or sets difference shown (configurable per league; default = sets).
- `%` is participation %.
- A small "audit" expand button reveals the tie-break resolution between this rank and the next.
- Member names are clickable; respect [player-visibility](../06-player-directory/player-visibility.md) rules.

### Filters on the ranking view

Per co-founder brief ("Filtres : par format (Simple/Doubles), par discipline (Tennis/Pickleball)"), the ranking view supports inline filters:

- **By format**: All / Singles only / Doubles only / Mixed only. Filter recomputes the visible rows from per-match buckets without changing the underlying `season_rankings` table — implemented as a derived view selectable on the client. Counts and W/L update accordingly.
- **By discipline**: not applicable since each league is single-sport per the [README divergence note](./README.md#deliberate-divergences-from-the-original-french-scope). Surfaced as a disabled filter when only one sport is in play.

When a filter is active, the rank column shows the _filtered_ rank (e.g., "1st in doubles") with the unfiltered rank in subscript.

## Cross-season ranking (v2)

A "lifetime" league ranking is **not** computed in v1. Each season is its own independent ranking. v2 may add a weighted lifetime score; spec deferred.

## Cross-league ranking

Out of scope for this system. The 04 player-rating system continues to be the cross-league/cross-tournament rating signal — see [integrations.md](./integrations.md#04-player-rating-ntrpdupr).
