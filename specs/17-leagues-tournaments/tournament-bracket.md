# Tournament Bracket

> Deterministic bracket generation, BYE rules, manual edits, and (v2) double-elimination.

This file specifies bracket construction precisely enough that two independent implementations produce identical brackets given the same inputs.

## Bracket size

Bracket size is the next power of 2 ≥ `participant_count` (after dropping waitlisted/withdrawn rows), capped by `max_participants`.

| `participant_count` (active) | `bracket_size` | BYEs |
| ---------------------------- | -------------- | ---- |
| 2                            | 2              | 0    |
| 3                            | 4              | 1    |
| 4                            | 4              | 0    |
| 5–7                          | 8              | 3–1  |
| 8                            | 8              | 0    |
| 9–15                         | 16             | 7–1  |
| 16                           | 16             | 0    |
| 17–31                        | 32             | 15–1 |
| 32                           | 32             | 0    |

If `participant_count < 2` at bracket-generation time, the RPC returns `INSUFFICIENT_PARTICIPANTS` and the organizer is offered a "Cancel tournament" CTA. (`BRACKET_NOT_GENERATED` is reserved for the distinct case of operating on matches _before_ the bracket exists.)

## Round count

For a single-elimination bracket of size `N`, there are `log2(N)` rounds. Round 1 is the round of `N`; the final round is round `log2(N)`.

Match count per round = `N / 2^round_number`.

Example for `N = 16`:

| Round | Name           | Matches |
| ----- | -------------- | ------- |
| 1     | Round of 16    | 8       |
| 2     | Quarter Finals | 4       |
| 3     | Semi Finals    | 2       |
| 4     | Final          | 1       |

The first round of an `N = 8` bracket is "Quarter Finals", `N = 4` starts at "Semi Finals", `N = 2` is just the "Final".

## Seed placement

Standard tournament-tree placement. Seeds are placed so that:

- Seed 1 and Seed 2 cannot meet before the final.
- Seeds 1, 2, 3, 4 cannot meet before the semi-finals.
- Seeds 1–8 cannot meet before the quarter-finals.

### Position tables

Bracket positions are 1-indexed slot numbers in round 1, top-to-bottom. The seed at position `p` advances along a deterministic path to the final.

**N = 4 (positions 1–4):**

| Seed | Position |
| ---- | -------- |
| 1    | 1        |
| 4    | 2        |
| 3    | 3        |
| 2    | 4        |

**N = 8 (positions 1–8):**

| Seed | Position |
| ---- | -------- |
| 1    | 1        |
| 8    | 2        |
| 5    | 3        |
| 4    | 4        |
| 3    | 5        |
| 6    | 6        |
| 7    | 7        |
| 2    | 8        |

**N = 16 (positions 1–16):**

| Seed | Position | Seed | Position |
| ---- | -------- | ---- | -------- |
| 1    | 1        | 3    | 9        |
| 16   | 2        | 14   | 10       |
| 9    | 3        | 11   | 11       |
| 8    | 4        | 6    | 12       |
| 5    | 5        | 7    | 13       |
| 12   | 6        | 10   | 14       |
| 13   | 7        | 15   | 15       |
| 4    | 8        | 2    | 16       |

**N = 32 (positions 1–32):**

The full table is omitted here because the visual layout is error-prone in markdown. The canonical placement is whatever `seedPositions(32)` returns from the algorithm below; unit tests at `shared-utils/src/seeding/seedPositions.test.ts` (per [rollout.md](./rollout.md#unit-tests)) assert the full 32-entry mapping with 100 % coverage.

### Algorithm

```typescript
/**
 * Returns 1-indexed bracket positions for seeds 1..N.
 * positions[i-1] is the position of seed i.
 *
 * Standard "binary placement" algorithm.
 */
function seedPositions(N: number): number[] {
  // Validate N is a power of 2
  if ((N & (N - 1)) !== 0) throw new Error('N must be a power of 2');

  // Start with seed 1 at position 1, seed 2 at position N
  let order: number[] = [1, 2];

  // Iteratively expand: at each round, fill in seeds so the highest-remaining
  // seed always faces the lowest-remaining seed in the current bracket
  for (let size = 2; size < N; size *= 2) {
    const next: number[] = new Array(size * 2);
    for (let i = 0; i < size; i++) {
      next[2 * i] = order[i];
      next[2 * i + 1] = 2 * size + 1 - order[i];
    }
    order = next;
  }

  // `order` now lists seeds in their bracket-position order (1-based to N)
  // Invert: positions[seed - 1] = position
  const positions = new Array(N);
  order.forEach((seed, idx) => {
    positions[seed - 1] = idx + 1;
  });
  return positions;
}
```

### Resolving the seed list

Implemented by `lt_tournament_seed_order(tournament_id)` (migrations
`20260822120000_lt_circuit_seeding` and `20260822140000_lt_seeding_modes`),
read by `tournament_preview_bracket`, `tournament_preview_pools`,
`tournament_generate_bracket`, `tournament_generate_pools`, and exposed to the
organizer screen as `tournament_seed_suggestions`.

`tournaments.seeding_mode` picks which ladder runs. In every mode the
organizer-assigned `seed_rank` leads (ascending, `NULL` last), then:

| Mode                | Order after `seed_rank`                                                                |
| ------------------- | -------------------------------------------------------------------------------------- |
| `circuit` (default) | Circuit Rallia points DESC, then rating DESC (`NULL` last), then `registered_at`, `id` |
| `rating`            | rating DESC (`NULL` last), then Circuit points DESC, then `registered_at`, `id`        |
| `signup`            | `registered_at`, `id`                                                                  |
| `manual`            | `registered_at`, `id` (the organizer is expected to set every `seed_rank`)             |

**Circuit points** come from the rolling-window board
(`tournament_ranked_board`) of the tournament's sport and board: singles
tournaments read the singles board, doubles and mixed read the doubles board
(same derivation as `tg_trp_set_board`). A doubles entry counts the **sum** of
both partners' points. **Rating** is read through the canonical
`player_sport.active_rating_score_id` path; a doubles entry uses the partners'
average.

### Switching modes

`tournament_set_seeding_mode(tournament_id, mode, version_was)` is organizer
only, refuses once `tournament_matches` exist, and does not bump
`tournament.version`. Two rules keep the picker honest:

- Switching to a **computed** mode (`circuit` / `rating` / `signup`) clears
  every `seed_rank`. A leftover manual order would outrank the mode the
  organizer just picked and the switch would look broken.
- Switching to **`manual`** freezes the order the previous mode was producing
  into `seed_rank`, so "I'll take it from here" starts from what was on screen.
- `tournament_set_seeds` flips the mode to `manual`: hand-ordering the field
  _is_ choosing manual.

### Stamping at publish

`tournament_generate_bracket` / `tournament_generate_pools` stamp
`seed_rank = 1..N` from the effective order when the organizer left any entry
blank, so the seeding that went into the draw is on the record rather than
recomputed later against a board that keeps moving. A field the organizer
already ordered is left untouched; the audit payload carries `auto_seeded`.

The organizer screen (`TournamentBracketSetup`) shows the mode picker, the
Circuit points and rating behind each entry (for the two modes that read
them), and lets the organizer drag any entry, which writes back through
`tournament_set_seeds`.

Not implemented: `seeding_enabled = false` (the deterministic shuffle
described in earlier drafts of this spec) and `self_declared_rank` as a
tiebreaker; `max_seeds` is not read. Every entry carries a seed number today.

### BYE placement

If `bracket_size > participant_count`, fill the highest seed positions with BYEs (i.e., the top-N seeds advance automatically in round 1).

```typescript
const byeCount = N - activeRegistrations.length;
const byePositions = []; // 1-indexed
for (let seed = 1; seed <= byeCount; seed++) {
  byePositions.push(seedPositions(N)[seed - 1]);
}
```

A BYE is represented as a `tournament_match` row with `playerX_is_bye = true` for the absent slot and `winner_registration_id` set to the present player at insertion time. The match's `status` is `walkover` and it has no `scheduled_at`. The next-round trigger advances the player normally.

### Worked example — 5 players, N=8, seeds 1, 2 with rating-derived ordering

| Seed | Player | Rating | Position |
| ---- | ------ | ------ | -------- |
| 1    | A      | 5.0    | 1        |
| 2    | B      | 4.5    | 8        |
| —    | C      | 4.0    | 4        |
| —    | D      | 3.5    | 5        |
| —    | E      | 3.0    | 3        |

BYEs needed: 3. Top 3 seed-positions are 1, 8, 4 → A, B, C all advance with BYEs in round 1.

Round 1 matches:

| Match | Position 1 | Position 2 | Result           |
| ----- | ---------- | ---------- | ---------------- |
| 1     | A          | BYE        | A advances (W/O) |
| 2     | E          | C          | played           |
| 3     | D          | BYE        | D advances (W/O) |
| 4     | BYE        | B          | B advances (W/O) |

(Match 3 has `playerX_is_bye = true` for the BYE slot but the seed-position calculation places the BYE in slot 7; the table above just shows which slot is BYE without re-numbering.)

## Bracket generation RPC

```
tournament_generate_bracket(tournament_id uuid, version_was integer)
```

Server actions, all in a single transaction:

1. Verify caller is organizer.
2. Verify status = `registration_closed`.
3. Verify `bracket_locked_at IS NULL` and no rows in `tournament_matches` for this tournament (idempotency guard).
4. Compute `bracket_size`, BYE count, seed positions.
5. Insert one `tournament_matches` row per round, per position, in `pending` state. For round-1 matches, set `playerX_registration_id` from the seeded list and `playerX_is_bye` for absent slots.
6. Wire `next_match_id` and `next_match_slot` for every non-final match: round R, position P advances to round R+1, position `ceil(P/2)`, slot `(P odd ? 1 : 2)`.
7. For each round-1 BYE match, set `winner_registration_id` and `status = 'walkover'`. The advance trigger then populates the round-2 slot.
8. Update `tournaments.status = 'in_progress'`, `tournaments.bracket_locked_at = NULL` (locked only on first _played_ completion), bump version.
9. Audit row `action = 'generate_bracket'` with full bracket payload.
10. Send `tournament_started` notification to all participants.

The RPC is **not idempotent across calls** — to regenerate, the organizer must explicitly `tournament_reset_bracket` (only allowed when no match has been played).

## Manual bracket edits

### Allowed edits

| Action        | Pre-condition                                                                           |
| ------------- | --------------------------------------------------------------------------------------- |
| Swap players  | Both involved matches are `pending` AND `tournaments.bracket_locked_at IS NULL`         |
| Move player   | Source slot's match is `pending`, target slot is empty, AND `bracket_locked_at IS NULL` |
| Insert player | Target slot is empty, target match is `pending`, AND `bracket_locked_at IS NULL`        |
| Remove player | Source match is `pending` AND `bracket_locked_at IS NULL`; slot becomes empty           |
| Replace BYE   | Target slot is BYE, target match is `pending`, AND `bracket_locked_at IS NULL`          |

Each manual edit is invoked through a dedicated RPC (e.g., `tournament_swap_players`) that:

- Re-validates pre-conditions inside the transaction.
- Writes an audit row with `payload_before` (full match snapshot) and `payload_after`.
- Increments `version` on every affected match.
- Notifies impacted players (`tournament_match_changed`).

### Confirmation requirement (UI)

Every destructive edit shows the same confirmation dialog (mirrors [match-creation.md](../09-matches/match-creation.md#impactful-change-confirmation)):

```
⚠️ This will overwrite the generated bracket. The change is logged.
   [Cancel] [Confirm]
```

### After first match plays

Once the first match transitions to a terminal state (`completed`/`walkover`/`retired`), `bracket_locked_at` is set and:

- Swap / move / insert / remove → `BRACKET_LOCKED` error.
- Score corrections and "reset match" remain available to organizer.
- "Replace withdrawn player with waitlist" remains available — implemented by deleting the registration row and inserting a new one in the same slot, then advancing/re-pairing as needed.

### Reset match

Organizer-only. Sets the target match back to `pending`, clears `winner_registration_id`, clears the score, and _recursively_ resets all downstream matches that depended on this winner. Audit row `action = 'reset_match'`. Player notifications: `tournament_match_reset`.

## Replace-on-withdraw

When a participant withdraws while the bracket is locked, several outcomes are possible. The organizer chooses via a modal:

| Option                       | Behavior                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| Award walkover (default)     | Match status `walkover`, opponent advances, no replacement                                    |
| Replace from waitlist        | Top waitlist row promoted into the same bracket slot; match returns to `pending`              |
| Replace with specific player | Organizer picks any player who has a registration row (waitlist or pending) → match `pending` |

Replacement is only offered for matches whose start has not passed. After the start, only "award walkover" is available.

## Match scheduling

Matches default to unscheduled (`scheduled_at = NULL`). The organizer can:

- Bulk-set times: "Round 1 starts Apr 10 09:00, 30 min apart per match" → server populates each round-1 match's `scheduled_at`.
- Manually drag a match to a different time slot.
- Assign a `court_id` from the venue's `court` rows (the `court` table FKs directly to `facility`; see system 11). Court conflicts are detected in the same RPC and rejected.

Rescheduling a single match emits `tournament_match_rescheduled` to the two players.

## Double elimination (v2)

Adds two parallel brackets:

- **Winners bracket** (`bracket_side = 'main'`): identical to single-elimination.
- **Losers bracket** (`bracket_side = 'losers'`): receives the loser of every winners-bracket match. Has `2 * (log2(N) - 1)` rounds.
- **Grand Final** (`bracket_side = 'grand_final'`): one or two matches between the winners-bracket champion and the losers-bracket champion.

### Losers-bracket placement

For losers from winners-bracket round `r`:

- They drop into losers-bracket round `2r - 1` (after winners' round 1) or `2r - 2` (after subsequent winners' rounds).
- Standard "double elimination" placement avoids losers facing the same opponent twice in a row.

The exact mapping is computed by `loserNextMatch(winnersRound, winnersPosition, N)` (full table generated in the migration; not reproduced here for the 32-bracket size).

### Grand Final reset rule

If the winners-bracket champion **loses** the first grand-final match, a second match is played. If they win the first or the second, they are the tournament champion.

This is implemented as two `bracket_side = 'grand_final'` matches: the second is conditionally created when the first is lost by the WB champion.

## Realtime bracket updates

Subscriptions on `tournament:{id}:bracket` receive UPDATE events for every `tournament_matches` row mutation. Mobile and web clients render diffs incrementally; full bracket reload happens on subscription open and on reconnect.

The mobile bracket viewer caps redraws at 2/sec to avoid jank when many BYEs auto-advance in sequence.

## Performance budget

| Operation                            | Target (P95) | Constraint                     |
| ------------------------------------ | ------------ | ------------------------------ |
| `tournament_generate_bracket` (N=32) | < 250 ms     | All inserts in one transaction |
| Bracket SELECT (full tree)           | < 100 ms     | Indexed on `tournament_id`     |
| Realtime fanout per row update       | < 200 ms     | Supabase platform default      |
| PDF export (N=32)                    | < 5 s        | Async via edge function        |
