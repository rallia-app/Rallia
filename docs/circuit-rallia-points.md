# Circuit Rallia — how tournament points are awarded

Reference for the scoring model as of 2026-07-20 (migration `20260720160000_lt_level_multiplier_wider_gap.sql`).
Every number here was read out of the live functions, not hand-computed.

## The one formula

```
points = round( base(placement) × multiplier / 10 ) × 10

multiplier = snap( draw_multiplier(size) × level_multiplier(min_rating) )
```

Two exceptions, both deliberate:

- **Participation is flat 20.** It is never multiplied, in any category.
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
| Played       | 20 (flat) |

## 2. Draw multiplier — how big the field is

`0.5 × (log2(size) − 1)`, floored at 0.25. Size is the real bracket once generated,
or `max_participants` for the "up to N pts" shown during registration.

| Draw | 4   | 8   | 16  | 32  | 64  |
| ---- | --- | --- | --- | --- | --- |
| ×    | 0.5 | 1.0 | 1.5 | 2.0 | 2.5 |

## 3. Level multiplier — how strong the field is

Driven by the tournament's `min_rating` floor. It is ×1.0 at the scale's first
intermediate rung, doubles every rung above that, and is capped at ×16.

| Tennis floor | 1.5  | 2.0  | 2.5  | **3.0**  | 3.5  | 4.0  | 4.5  | 5.0+ |
| ------------ | ---- | ---- | ---- | -------- | ---- | ---- | ---- | ---- |
| ×            | 0.25 | 0.40 | 0.63 | **1.00** | 2.00 | 4.00 | 8.00 | 16.0 |

| Pickleball floor | 1.0  | 2.0  | 2.5  | 3.0  | **3.5**  | 4.0  | 4.5  | 5.0  | 5.5+ |
| ---------------- | ---- | ---- | ---- | ---- | -------- | ---- | ---- | ---- | ---- |
| ×                | 0.25 | 0.35 | 0.50 | 0.71 | **1.00** | 2.00 | 4.00 | 8.00 | 16.0 |

A tournament with no floor is ×1.0.

**Why ×4 per full rating point.** The board is a shared, best-8 season sum. At the
old ×2 rate, eight Débutant titles (4000) outscored eight Avancé quarterfinals
(2880), so volume in an easy field beat real results in a hard one. At ×4, any
serious run in a hard field outranks a title in an easy one.

**Why the ×16 cap.** Uncapped, tennis 6.0 reached ×55.7 and a single 6.0-floor
32-draw would have paid 27,900 — more than a perfect eight-event Avancé season.
The cap lands on the 4th rung above the anchor (tennis 5.0, pickleball 5.5).

## 4. Worked example — Série 1, 32-cap tennis

| Category      | Floor | Mult | Champion | Finalist | Semi | Quarter | R16 | Played |
| ------------- | ----- | ---- | -------- | -------- | ---- | ------- | --- | ------ |
| Débutant      | 1.5   | ×0.6 | **300**  | 180      | 110  | 50      | 30  | 20     |
| Intermédiaire | 3.0   | ×2.0 | **1000** | 600      | 360  | 180     | 100 | 20     |
| Avancé        | 4.0   | ×8.0 | **4000** | 2400     | 1440 | 720     | 400 | 20     |

How to read the spread:

- An Avancé player who wins two matches then loses (400) edges a Débutant champion (300).
- An Avancé quarterfinal (720) beats two Débutant titles.
- A Débutant title (300) is worth fifteen show-ups in any category, since participation is flat at 20 everywhere.

Note that in a 32-draw the R32 rung is unreachable: losing your first match means
zero wins, which the floor turns into participation. The lower placement rungs
only come into play in 64-draws and larger.

## 5. Season score

Your season total is the **sum of your best 8 results** for that sport. Extra
events beyond eight can only help you — a bad result never subtracts.

There is one board per sport, shared across all levels, with an optional filter
by level bucket (beginner / intermediate / advanced) for reading your own tier.

## 6. Rules that decide whether a result counts

- **You must have played.** Points require at least one real match against a real
  opponent, finished `completed` or `retired`. A player whose only appearances
  were byes, walkovers or unplayed matches gets no ledger row at all: no points,
  and the event does not count toward `events_played`.
- **Byes and walkovers are not wins.** They advance you; they were never played.
  A retirement is a win for the other player.
- **Zero-win floor.** If you won no real match, you get participation (20) no
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
