# Circuit Rallia — how tournament points are awarded

Reference for the scoring model as of 2026-07-20 (migrations `20260720170000_lt_level_multiplier_x5_per_point.sql`, `20260720180000_lt_award_participation_ten.sql`).
Every number here was read out of the live functions, not hand-computed.

## The one formula

```
points = round( base(placement) × multiplier / 10 ) × 10

multiplier = snap( draw_multiplier(size) × level_multiplier(min_rating) )
```

Two exceptions, both deliberate:

- **Participation is flat 10.** It is never multiplied, in any category.
- `snap()` rounds the combined multiplier to steps of 0.2, so a champion's points always land on a multiple of 100.

Three functions own this and nothing else recomputes it: `lt_draw_multiplier`,
`lt_min_rating_level_multiplier`, `lt_snap_ranking_multiplier`.

## 1. Base points — how far you got

| Placement    | Base      |
| ------------ | --------- |
| Champion     | 500       |
| Finalist     | 300       |
| Semifinal    | 180       |
| Quarterfinal | 90        |
| Round of 16  | 50        |
| Round of 32  | 30        |
| Round of 64  | 25        |
| Played       | 10 (flat) |

## 2. Draw multiplier — how big the field is

`0.5 × (log2(size) − 1)`, floored at 0.25. Size is the real bracket once generated,
or `max_participants` for the "up to N pts" shown during registration.

| Draw | 4   | 8   | 16  | 32  | 64  |
| ---- | --- | --- | --- | --- | --- |
| ×    | 0.5 | 1.0 | 1.5 | 2.0 | 2.5 |

## 3. Level multiplier — how strong the field is

Driven by the tournament's `min_rating` floor. It is ×1.0 at the scale's first
intermediate rung, climbs ×5 per full rating point above that (√5 ≈ ×2.24 per
half-point rung), and is capped at ×16.

| Tennis floor | 1.5  | 2.0  | 2.5  | **3.0**  | 3.5  | 4.0  | 4.5   | 5.0+ |
| ------------ | ---- | ---- | ---- | -------- | ---- | ---- | ----- | ---- |
| ×            | 0.20 | 0.34 | 0.59 | **1.00** | 2.24 | 5.00 | 11.18 | 16.0 |

| Pickleball floor | 1.0  | 2.0  | 2.5  | 3.0  | **3.5**  | 4.0  | 4.5  | 5.0   | 5.5+ |
| ---------------- | ---- | ---- | ---- | ---- | -------- | ---- | ---- | ----- | ---- |
| ×                | 0.20 | 0.30 | 0.45 | 0.67 | **1.00** | 2.24 | 5.00 | 11.18 | 16.0 |

A tournament with no floor is ×1.0.

**Why ×5 per full rating point.** The board is a shared, best-8 sum. At a
×2 rate, eight Débutant titles outscored eight Avancé quarterfinals, so volume
in an easy field beat real results in a hard one. ×5 makes any serious run in a
hard field outrank a title in an easy one, by a wide margin.

**What bounds the width.** The combined multiplier bottoms out at the snap floor
of ×0.2, so the lowest category's win rungs stop shrinking while the flat
participation rung stays put. Push the curve far enough and they sink beneath it,
which would mean winning two matches pays less than losing your first. With
participation at 10 the Débutant R16 exit pays 20 — double the floor — so there
is roughly one more doubling of headroom before that becomes the constraint
again.

**Why the ×16 cap.** Uncapped, tennis 6.0 would reach ×125 and a single 6.0-floor
32-draw would pay six figures — more than a perfect eight-event Avancé year,
which makes the board meaningless. The cap binds at tennis 5.0 and
pickleball 5.5, holding the largest possible event at 16,000.

## 4. Worked example — Série 1, 32-cap tennis

| Category      | Floor | Mult  | Champion | Finalist | Semi | Quarter | R16 | Played |
| ------------- | ----- | ----- | -------- | -------- | ---- | ------- | --- | ------ |
| Débutant      | 1.5   | ×0.4  | **200**  | 120      | 70   | 40      | 20  | 10     |
| Intermédiaire | 3.0   | ×2.0  | **1000** | 600      | 360  | 180     | 100 | 10     |
| Avancé        | 4.0   | ×10.0 | **5000** | 3000     | 1800 | 900     | 500 | 10     |

How to read the spread:

- An Avancé player who wins two matches then loses (500) beats two Débutant titles (400).
- An Avancé quarterfinal (900) beats a Débutant title and an Intermédiaire final combined.
- A Débutant title (200) is worth twenty show-ups in any category, since participation is flat at 10 everywhere.
- The Débutant R16 exit (20) is the lowest win anywhere, and still pays double the participation rung. No result ever pays less than showing up.

Note that in a 32-draw the R32 rung is unreachable: losing your first match means
zero wins, which the floor turns into participation. The lower placement rungs
only come into play in 64-draws and larger.

## 5. Your score

Your total is the **sum of your best 8 results** for that sport, taken over a
**rolling 52-week window**. Extra events beyond eight can only help you — a bad
result never subtracts. A year of pure attendance and no wins therefore tops out
at 8 × 10 = 80, negligible against a single title.

**Nothing resets.** Each result counts from the day its tournament completes
until 52 weeks later, then ages out on its own. This is how the ATP rankings
work, and it replaced a hard semi-annual reset: on a base this thin, wiping
every player to zero twice a year left the board empty for weeks and erased the
standing of anyone who entered only a couple of events.

Expiry is evaluated at read time off `tournament_ranking_points.earned_at` (the
tournament's `completed_at`), so nothing sweeps or rewrites the ledger. The
window length lives in `lt_ranking_window()`.

Seasons still exist as an **archive**: `ranking_season` is still populated and
every ledger row still carries a `season_id`, so passing a season code to
`get_tournament_leaderboard` returns that season's final standings. The live
board is the rolling one, and it is what the wrappers return by default.

There is one board per sport, shared across all levels, with an optional filter
by level bucket (beginner / intermediate / advanced) for reading your own tier.

## 6. Rules that decide whether a result counts

- **You must have played.** Points require at least one real match against a real
  opponent, finished `completed` or `retired`. A player whose only appearances
  were byes, walkovers or unplayed matches gets no ledger row at all: no points,
  and the event does not count toward `events_played`.
- **Byes and walkovers are not wins.** They advance you; they were never played.
  A retirement is a win for the other player.
- **Zero-win floor.** If you won no real match, you get participation (10) no
  matter how far the draw carried you.
- **Certified organizers only.** A tournament awards Points Rallia only if its
  organizer has `is_certified_organizer`. Otherwise no points are written.
- **Doubles partners each take the full team result.** Points are not split.
- **Entering up is impossible; entering down is unprofitable.** `tournament_register`
  hard-rejects anyone below `min_rating`, so a weak player cannot farm a strong
  field. A strong player may enter a lower category, but it now pays far less
  than their own — so the wider spread cannot be gamed from either direction.

## Where advertised points come from

- **Before the bracket exists:** `tournaments.ranking_points_ceiling`, stamped by
  trigger — the champion's points at full capacity. This is the "up to N pts" on
  the card.
- **After the bracket generates:** the firm `tournaments.ranking_multiplier` stamp.
  The stamp is the price: the award reads it back rather than recomputing, so the
  card and the ledger cannot drift.
