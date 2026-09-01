# Round deadlines & automated resolution

> Per-round deadlines on tournament brackets, countdown surfacing, escalating
> nudges, and a deterministic resolution ladder that advances the bracket at the
> deadline whatever the players did — with the organizer as appeal court, not
> engine.

Source: Jean's Série 1 feedback (unresponsiveness "de loin le plus gros
problème"; "l'organisateur doit pouvoir mettre des deadlines pour chaque tour";
"un décompte horaire"; "arbitrage automatique ... intervention minimale de
l'organisateur").

## Problem

Nothing in the schema knows when a round is supposed to be finished. `tournaments`
has `start_date` / `end_date`; `tournament_matches` has `scheduled_at` (a planned
play time, almost never set). There is no deadline, so there is nothing to count
down to, nothing to nudge against, and no moment at which the system is entitled
to resolve a stalled match.

Measured on prod 2026-08-07, five Série 1 draws in progress:

| Signal                                         | Value                              |
| ---------------------------------------------- | ---------------------------------- |
| Playable matches stalled in round 3            | 11                                 |
| Days since those pairings became real          | ~10 (bracket published 2026-07-28) |
| Resolved matches decided by organizer override | 35 of 56 (62%)                     |
| Resolved matches decided by player score entry | 21 of 56                           |

The 35 overrides are the manual labor this spec automates. The target state: the
organizer never _has_ to intervene; every intervention is optional.

## Scope

- Single-elimination main bracket only (matches what is live; the seeded draws
  are single-elim and doubles tournaments are blocked at create).
- Tournaments only. League sessions have their own confirmation-deadline crons;
  a session twin can follow the same pattern later.
- Double elimination: deferred. The model keys on `(bracket_side, round_number)`
  so nothing here forecloses it.

## Data model

### `tournament_round_deadlines`

```sql
CREATE TABLE tournament_round_deadlines (
    tournament_id  uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    bracket_side   text NOT NULL DEFAULT 'main',
    round_number   smallint NOT NULL,
    deadline_at    timestamptz NOT NULL,
    PRIMARY KEY (tournament_id, bracket_side, round_number)
);
```

RLS: SELECT for anyone who can read the tournament (same predicate as
`tournament_matches`); writes only through RPCs. Explicit GRANTs per the
new-table policy.

### Per-match override

```sql
ALTER TABLE tournament_matches ADD COLUMN deadline_override_at timestamptz;
```

**Effective deadline** = `COALESCE(deadline_override_at, round row)`. The
override exists so one match can get more time for an exceptional reason
(injury, weather) without sliding the whole round. It is set by the organizer
only, and only while the deadline is still ahead: nothing in the system stamps
it automatically any more.

No effective deadline (round row absent and no override) means no automation for
that match. This is no longer reachable in practice: generation always seeds
default deadlines, falling back to a week per round when `end_date` is unusable,
so a draw with pairings always has a clock.

## Defaults & organizer control

### At publish

`tournament_generate_bracket` seeds one row per round, splitting the time
between publish and `end_date` evenly:

```
deadline(r) = publish_time + r * (end_date - publish_time) / n_rounds
```

The pre-publish flow (`TournamentBracketSetup`) shows the computed dates and
lets the organizer adjust before publishing. Editing after publish goes through
the RPC below and re-triggers the availability gate for affected players (see
[gate spec](../08-communications/match-organizer-live-suggestions.md)).

### RPCs

| RPC                                                               | Who             | Behavior                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tournament_set_round_deadlines(p_tournament_id, p_rounds jsonb)` | organizer/admin | Upserts round rows. Validates strictly increasing across rounds and `> now()` for rounds with unresolved matches. Values past `end_date` are allowed with a warning return field (end_date is informational; a hard cap would block legitimate overruns). Audited.                                              |
| `tournament_extend_match_deadline(p_tm_id, p_deadline_at)`        | organizer/admin | Sets `deadline_override_at`. The new date must be `> now()`, **and the pairing's current effective deadline must not have passed** (`DEADLINE_PASSED`), matching the phase-wide RPC: once a deadline expires the pairing belongs to the resolver, and the way back is restore or override. Audited with reason. |

Both notify affected players (`tournament_deadline_changed`). Moving a deadline
earlier than 48h from now is rejected (`DEADLINE_TOO_SOON`) — players were
promised a window; shrinking it under them mid-round is an organizer-side
foot-gun.

## Countdown surfacing

Deadlines ride along with the bracket read (the round table is RLS-readable, no
new RPC). Client-side rendering:

| Surface                    | Display                                                                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tournament overview header | Countdown to the **current round's** deadline (min round with unresolved playable matches). `> 48h`: date. `< 48h`: hours. `< 12h`: urgent styling. |
| "My match" card            | Countdown to **my** match's effective deadline (may differ via override).                                                                           |
| Round chat organizer card  | "Play by {date}" line; the options engine window is clamped to the deadline (`p_window_days` = days remaining, see gate spec).                      |
| Bracket slot               | Small deadline chip on unresolved matches.                                                                                                          |

Countdown alone only pressures players already in the app, so:

## Nudges

Targeted at whoever hasn't acted, not broadcast:

| When  | Who                                                          | Content                                                                |
| ----- | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| T-48h | each player of an unresolved match with no attached game     | "48h left to play your round-{r} game vs {opponent}."                  |
| T-12h | same, and only those with **no votes** on the organizer card | "Last chance: your game is forfeited tomorrow unless you pick a time." |

New notification types `tournament_round_deadline_soon` (both firings, payload
carries the tier). Localized via the existing `lt_user_is_fr` pattern. No email
in v1; the push + the countdown are the pressure Jean asked for, and the T-12h
copy says the consequence out loud.

## Resolution ladder

A pure-SQL cron (`lt_resolve_due_tournament_matches()`, every 15 min, same
pattern as `lt_close_due_tournament_registrations`) evaluates every unresolved
`tournament_matches` row whose effective deadline has passed, in a tournament
that is `in_progress`.

### The ladder itself: see unplayed-match-resolution.md

**Superseded 2026-08-31.** What used to sit here (Step 0's automatic 72h grace
on a scheduled game, the effort split read partly from chat messages, and the
one automatic extension when both sides had effort) has been **removed from the
product**, not moved. The ladder that ships is R0..R6 in
[unplayed-match-resolution.md](./unplayed-match-resolution.md) § 6, and it
differs from the text this replaces on three points that matter:

- **The machine grants itself no time.** There is no grace, no extension, and
  no waiting for a game booked past the deadline. The deadline is a hard stop:
  at it, the pairing is decided. Jean's objection (2026-08-31) was that a
  system whose whole purpose is to enforce a deadline cannot then hand out
  72-hour reprieves; only an organizer moves a date, and only while it is still
  in the future.
- **Effort is never read from chat.** Sides are scored from recorded scheduling
  acts (availability answers, bookings, responses to them), because a message
  cannot be judged fairly by a machine and a declared hour can. See § 4 of the
  resolution spec for the signal model.
- **Two engaged sides that cannot converge are not extended.** They are
  separated by the gap rule, or the game is cancelled with nobody at fault.

The organizer's appeal path is unchanged and is the only accommodation left:
move the deadline before it expires, override the outcome, or restore a
decision the machine got wrong.

### Double walkover mechanics

New helper `lt_advance_double_walkover(p_tm_id)`:
`status='walkover'`, no winner, `score='W/O–W/O'`, then mark the fed slot of
`next_match_id` as a bye (`playerX_is_bye = true`) and let the existing
phantom-fed auto-complete machinery walk the bracket — reusing the same
propagation the generator already has for byes. If **both** feeder matches
double-walkover, the next match auto-completes as a bye-vs-bye phantom and the
walkover cascades, which is correct: a whole dead sub-bracket resolves without
organizer touch. If the **final** double-walkovers, the tournament completes
with no champion (`champion_registration_id` null) — display "no winner
declared"; do not invent one.

### Side effects

- **Reputation**: walkover loser gets a new event `tournament_unresponsive`.
  Suggested weight between `tournament_withdrew` (-3) and `match_no_show`
  (-50) — recommend **-15**, matching `report_upheld`; final number is a
  product call. Double walkover applies it to both. No event on the winner.
- **Rating**: none. No verified `match_result` exists; walkovers must never
  synthesize one (same philosophy as `tournament_override_score` not touching
  the casual match row).
- **Ranking points**: `W/O` advancement counts for Rallia Points per the
  existing ranking rules on walkover statuses.
- **Notifications**: `tournament_match_walkover` to both players (localized,
  states why); the round-3 opponent learns via the existing
  `tournament_match_ready` when their slot fills.
- **Audit**: every automated action writes to `leagues_tournaments_audit`
  (`action` ∈ `auto_walkover`, `auto_double_forfeit`, `auto_cancel`; the
  retired `auto_grace` and `auto_extension` may appear on historical rows)
  with the signal evidence snapshot in the payload — the
  organizer adjudicating a complaint needs to see exactly why the machine
  decided.

### Paid tournaments

A double walkover in a paid draw means two players paid and got zero games. The
resolution cron must not ship to paid tournaments until the policy is chosen:
no refund (they had their window — defensible, harsh), automatic refund minus
the non-refundable service fee (consistent with
[paid-registration](./monetization.md) mechanics), or organizer-discretion
credit. Recommend the automatic-refund-minus-fee default with an
organizer-visible toggle at creation. **v1 of the cron runs only on free
tournaments**; the flag gate lifts when the refund path is wired.

## Dependencies & interactions

| Dependency                                                                                   | Why                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~`auto_confirm_expired_scores` cronned~~                                                    | Moot: Step 0's grace is gone, and a declared score is final on entry with a 48h contest window rather than waiting on a confirmation.                                                                      |
| [Match-organizer live suggestions](../08-communications/match-organizer-live-suggestions.md) | Effort signals (`match_time_vote`, gate outcomes) feed the ladder; the gate needs deadlines for its round-window question; the engine clamps its window to the deadline. Ship deadlines first or together. |
| Player-declared forfeit                                                                      | The gate's "I can't play this round" exit resolves a match _before_ the ladder ever fires — the cheapest resolution of all.                                                                                |
| [tournament-bracket.md](./tournament-bracket.md)                                             | Bye/phantom propagation reused by double walkover.                                                                                                                                                         |

## Analytics

| Event                            | Properties                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `tournament_round_resolved`      | round, n_matches, n_played, n_walkovers, n_double_walkovers, n_cancelled, n_org_overrides, n_restores |
| `tournament_deadline_nudge_sent` | tier (48h/12h), had_votes, had_game                                                                   |
| `tournament_match_auto_resolved` | outcome, effort_p1, effort_p2, days_stalled                                                           |

North star: **% of matches resolved without organizer action** (today: 38%).
Second: median days from pairing-ready to resolution. If the cancelled branch
fires often (two engaged sides who could not converge), that is the
availability-matching problem
resurfacing — fix upstream, don't tighten the ladder.

## Rollout

1. DDL + RPCs + publish-time defaults + countdown surfacing (no cron). Organizer
   sets deadlines on the live Série 1 draws manually via RPC — no backfill
   magic on in-flight tournaments.
2. Nudges.
3. Resolution cron on **free** tournaments, dry-run mode first (logs the
   decision it _would_ take to the audit table for one round without acting) —
   the 11 currently stalled matches are the validation set.
4. Live mode; paid tournaments after the refund-policy decision.

## Open decisions

1. `tournament_unresponsive` reputation weight (recommended -15).
2. Extension length for the both-effort branch (recommended half the round
   length, min 48h).
3. Paid-draw double-walkover refund policy (recommended auto-refund minus
   service fee, org toggle).
4. Whether the T-12h nudge should also email. Recommend push-only until the
   nudge open-rate says otherwise.
