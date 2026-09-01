# Scheduling arbitration

> How a tournament match goes from "pairing known" to "scheduled or resolved"
> with zero organizer labor: per-phase availability collection with its own
> deadline, an app-proposed default slot on the auto-posted organizer card, a
> graded and fully explainable decision function, and the surrounding rules
> (weather exemption, forfeit-on-cancel, lateness, venue suggestions, score
> conventions for the 8-game format).

Source: Jean's written responses of 2026-08-14 to the rules-adoption proposal
(the "Fisher rules" review). His conditions are binding. This spec extends
[round-deadlines.md](./round-deadlines.md) and
[match-organizer-live-suggestions.md](../08-communications/match-organizer-live-suggestions.md);
where it contradicts them, this spec wins and the amendment is listed in
[Amendments](#amendments-to-existing-specs).

## Jean's conditions, mapped

| Condition (2026-08-14)                                                              | Satisfied by                                                                        |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Collect dispos at pool start and at each knockout round                             | [Phase availability record](#phase-availability-record)                             |
| Dispos must cover the whole phase window, with a submission deadline                | Gate asks about the round window; [submission deadline](#phase-availability-record) |
| Optional minimum number of dispos                                                   | `tournaments.min_availability_hours`                                                |
| Stale dispos are inadmissible                                                       | [Admissibility rule](#admissibility-no-stale-evidence)                              |
| Auto-create the match with a default proposed slot                                  | [The proposed slot](#the-proposed-slot) (card-level, game not pre-created)          |
| Proposal must always read as non-final; either side counter-proposes, no precedence | Proposal is a votable option; custom-option floor                                   |
| No agreement by deadline: decide on time-to-provide, volume, reactivity             | [Decision function](#the-decision-function)                                         |
| Cancelling after an accepted agreement is a de facto forfeit                        | [Forfeit on cancel](#forfeit-on-cancellation-after-agreement)                       |
| Unilateral forfeit always available                                                 | [Player-declared forfeit](#player-declared-forfeit)                                 |
| UI always shows time left and consequences of inaction                              | [Countdown surfacing](./round-deadlines.md#countdown-surfacing) + consequence lines |
| Auto decisions display a clear justification                                        | [Justification](#justification-shown-not-just-audited)                              |
| Only in-app scheduling actions count; chat is inadmissible                          | `messaged` signal removed from `lt_side_effort`                                     |
| Weather criteria, adjusted from Fisher's numbers                                    | [Weather exemption](#weather-exemption)                                             |
| Score conventions adapted to 1 set of 8 games                                       | [Score conventions](#score-conventions-for-short-formats)                           |
| Lateness penalties + check-in by design                                             | [Lateness and check-in](#lateness-and-check-in)                                     |
| Suggest 3 optimal courts; closest player books                                      | [Venue suggestions](#venue-suggestions)                                             |

## Problem

The resolution ladder is live (`lt_resolve_due_tournament_matches`, cron every
15 min) but its evidence model is thin. `lt_side_effort` is binary and counts
`messaged` (any message in the round chat), which Jean has now ruled
inadmissible: only actions inside the scheduling flow may influence a decision.
Nothing collects availabilities per phase, so the ladder can be fed by a grid
painted at onboarding months ago. No default time is ever proposed, so the
first move is always on the players. And when the machine does decide, the
player learns the outcome (`tournament_match_walkover`) but not the reasoning,
which is where disputes come from.

## Scope

- Tournaments (`pool_knockout` and single-elim), same as the ladder. League
  sessions can twin later.
- Free draws first, per the ladder's paid-tournament gate. The decision
  function changes nothing about the paid-draw refund policy.
- The availability gate from the 08 spec is not yet built; this spec upgrades
  its outcome record to phase scope before it ships, so nothing is migrated.

## Phase availability record

The gate answer becomes a durable, phase-scoped record:

```sql
CREATE TABLE tournament_phase_availability (
    tournament_id  uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    bracket_side   text NOT NULL,
    round_number   smallint NOT NULL,   -- ('pool', 0) covers the whole pool phase
    player_id      uuid NOT NULL,
    outcome        text NOT NULL CHECK (outcome IN ('confirmed','edited','skipped','forfeited')),
    responded_at   timestamptz NOT NULL DEFAULT now(),
    hours_in_window smallint NOT NULL,  -- available hours inside the phase window at response time
    grid_snapshot  jsonb NOT NULL,      -- the (day, hour) cells, frozen for audit
    PRIMARY KEY (tournament_id, bracket_side, round_number, player_id)
);
```

RLS: SELECT for tournament readers, writes only through the gate RPC. Explicit
GRANTs per the new-table policy.

- **Collection points.** Pool phase: once, when pools are generated (the phase
  key is `('pool', 0)`, matching the shared pool deadline row). Knockout: once
  per round, when `lt_notify_tournament_match_ready` fires. These are exactly
  the moments the auto-posted card and round chat already exist.
- **Window.** The gate asks about the player's declared hours inside the
  phase's effective window (from `tournament_round_deadlines`), per the 08
  spec. A response therefore always covers the whole period left to play.
- **Submission deadline.** Derived, not stored:
  `LEAST(phase_start + 72h, effective deadline)`. Not answering by then is not
  an instant forfeit; it degrades the timeliness signal below and triggers one
  `tournament_action_required` nudge (existing type, so no new enum
  registration).
- **Minimum volume.** New nullable column `tournaments.min_availability_hours`
  (organizer-set at creation, suggested default 6). Null means no minimum.
  Feeding the volume signal only; never a hard block.
- **Snapshot, not reference.** `hours_in_window` and `grid_snapshot` are
  computed at response time. Later edits to `player_availability` produce a new
  gate answer (upsert, `responded_at` refreshed), never a silent drift of the
  recorded evidence.

### Admissibility: no stale evidence

The decision function reads **only**:

1. `tournament_phase_availability` rows for the current `(bracket_side,
round_number)` phase,
2. scheduling actions (`match_time_vote`, custom options, card posts, game
   creation, forfeit declarations) timestamped after the phase began.

`player_availability.last_confirmed_at`, answers from earlier phases, and
anything read from chat text are inadmissible. A knockout round is a fresh
slate: qualifying out of pools with a rich grid earns nothing in round 2.

## The proposed slot

Jean asked that the match be auto-created with a default slot. The card stays
the only path to a created game (decided 2026-08-12; a `match` row still means
"when and where are agreed"). What changes: the auto-posted card now carries
exactly one option flagged as **the app's proposal**, so every pairing starts
with a concrete time on the table instead of a menu and silence.

- **Mutual overlap exists**: the engine's top-ranked mutually-free option
  (`free_count = n`, highest score) gets `proposed: true` in the metadata
  snapshot.
- **No mutual overlap yet**: as soon as the **first** player of the pairing
  files an in-phase gate answer, regenerate and flag the top-ranked slot drawn
  from that player's hours, labeled as one-sided: "D'après les dispos de
  {name}". This amends the zero-overlap variant, which currently posts no
  options at all. Being first to provide dispos earns the anchor proposal,
  which is the "stimulate fast action" design Jean asked for. If neither
  player has answered the gate, no proposal is shown (nothing admissible to
  base it on).
- **Presentation.** The proposed option renders with a "Proposition de l'app"
  badge and is never auto-voted for anyone. Copy must make non-finality
  explicit: "Proposé par l'app. Accepte ou propose une autre plage." Accepting
  is just voting it; when both sides vote, the existing mutual-agreement path
  (`create_casual_match` + `tournament_attach_match_pre_play`) fires
  unchanged.
- **Counter-proposal** is the existing custom-option floor
  (`match_organizer_add_custom_option`), first come first served, no
  precedence between players.
- **Re-anchoring.** `proposed: true` follows the option's `option_key` through
  regenerations. If the proposed option vanishes and was voted, the existing
  pin rule already covers it; if it vanishes unvoted, the flag moves to the new
  top-ranked eligible option.

## The decision function

Runs inside `lt_resolve_due_tournament_matches` at the effective deadline,
replacing the binary effort split of
[round-deadlines.md § Step 1](./round-deadlines.md#step-1--effort-split).
Step 0's automatic grace is **removed** (2026-08-31): an attached game no longer
buys 72 hours past the deadline, and an agreed-but-unplayed game is decided on
the same signals as any other. See
[unplayed-match-resolution.md](./unplayed-match-resolution.md) § 6, R3.

Per side, three graded signals, each scored 0 / 1 / 2, total **S ∈ 0..6**:

| Signal         | 2                                                                     | 1                                                     | 0                                    |
| -------------- | --------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------ |
| **Timeliness** | Gate answered (confirm or edit) within 48h of phase start             | Answered after 48h but before the submission deadline | Never answered, or answered after it |
| **Volume**     | `hours_in_window >= min_availability_hours` (or >= 6 if unset)        | 1 to threshold-1 hours                                | 0 admissible hours                   |
| **Reactivity** | Every pending scheduling event answered within 24h, >= 1 action taken | Acted, but some response took > 24h                   | Never engaged with any proposal      |

A **pending scheduling event** for side X is an opponent action awaiting X's
answer: the proposal flag landing, an opponent vote on an option X has not
voted, an opponent custom option. X's answer is any scheduling action (vote,
custom option, gate edit). All timestamps come from `match_time_vote`,
`message.metadata`, and `tournament_phase_availability`; chat text is never
read.

At the deadline:

| Situation                    | Resolution                                                                                                                                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One side S >= 2, other S < 2 | Walkover for the higher side (existing mechanics: `status='walkover'`, `score='W/O'`, advance, reputation event on loser).                                                                                                                         |
| Both S < 2                   | Double walkover (existing `lt_advance_double_walkover`).                                                                                                                                                                                           |
| Both S >= 2                  | **Gap rule, at the deadline itself**: if `abs(S_a - S_b) >= Δgap`, walkover for the higher side; else the game is cancelled with nobody at fault. Δgap is 2 in a round robin, 1 in a knockout. There is no extension: the deadline is a hard stop. |

The gap rule is the deliberate change from the earlier "never pick more
effort" stance: Jean explicitly wants the stalemate branch decided on
timeliness, volume and reactivity. The threshold of 2 keeps the old caution:
the machine only picks a winner when the behavioral gap is unambiguous, and
the justification (below) shows exactly which signals made the difference.
Scores are computed once, at the deadline: there is no second window to wake up
in, because the two weeks they had were the two weeks they had.

### Justification, shown, not just audited

The audit snapshot already exists (`leagues_tournaments_audit`, effort payload).
What is new is the player-facing rendering:

- The `tournament_match_walkover` notification body states the reason class in
  one sentence (localized, no new type): "Match perdu par forfait: aucune
  action de planification de ta part avant la date limite."
- The resolved match sheet gains a "Pourquoi cette décision" section rendering
  the per-signal breakdown for both sides from the audit payload: when each
  player provided dispos, how many hours, how fast each responded. Same
  predicate as reading the bracket; no new RPC, the payload rides on the match
  read.
- Copy rule: descriptive, never accusatory, and it must name the rule that
  fired, not just the outcome.

## Forfeit on cancellation after agreement

An accepted agreement is a created game (that is what a `match` row means). If
a participant cancels that game:

- **Unilateral cancel** by one tournament participant: immediate walkover
  against the canceller. No ladder, no grace. Exception: a cancellation
  qualifying under the [weather exemption](#weather-exemption), which instead
  clears the Step 0 override and reschedules.
- **Mutual cancel** (both confirm cancellation in-app): the match returns to
  the ladder; the Step 0 override is cleared and the ordinary deadline
  applies again, consistent with today's behavior.

Requires the cancel path on the linked game to record the cancelling
participant (today cancellation does not reliably attribute an actor on the
`match` row; implementation must add that attribution before this rule can
fire). The pre-cancel UI must state the consequence: "Annuler cette partie =
forfait" on tournament-linked games.

## Player-declared forfeit

New RPC `tournament_declare_forfeit(p_tournament_match_id)`, callable by either
participant at any time: sets walkover for the opponent through the same
mechanics as the ladder, notifies both, audits with `action='self_forfeit'`.
Surfaced in two places: the gate's "I can't play this round" exit (specced in
08, unbuilt: `W/O` is reserved but nothing writes it) and the tournament match
sheet overflow. This is the cheapest resolution in the whole system and must
never be more than two taps away.

## Weather exemption

Objective criteria under which a scheduled game may be cancelled without the
forfeit-on-cancel rule. Rallia's thresholds (deliberately not Fisher's
numbers):

- Measurable rain at the court in the 2h before start, or precipitation
  probability >= 50% for the match window, checked within 3h of start.
- Temperature below 6 °C, or humidex above 38.
- Sustained wind above 28 km/h.
- Court unplayable or lighting insufficient (attested).

v1 is **attested**: the cancelling player picks the weather reason, the
opponent is notified with the criteria shown, and the claim is audited with a
timestamp (verifiable after the fact against historical data if disputed). No
weather provider is integrated today; automated verification joins the
existing weather-integration decision (Momentum Harvesting) rather than
forcing it.

Effect of a qualified weather cancel:

- The linked game is cancelled without penalty, and **the deadline does not
  move**: the automatic `cancelled_slot + 72h` override this once specified is
  removed with the rest of the grace (2026-08-31). Cancelling for weather
  protects the pair from a forfeit ruling, not from the clock. If the round
  genuinely cannot be replayed in time, the organizer moves the deadline while
  it is still ahead, which is the one accommodation left.
- **Near-deadline case** (Jean's 2.a): if the effective deadline is less than
  48h away at cancel time, both players are prompted once: "Pas le temps de
  rejouer? Tu peux concéder le match." wired to `tournament_declare_forfeit`.
  If neither concedes, the ladder decides at the deadline as usual.
  The decision process stays visible on the match sheet throughout.

## Score conventions for short formats

Match format is per-tournament config, not a platform constant:
`match_format` (default `two_of_three` for tennis), `games_per_set` and
`final_set_tiebreak` ([tournaments.md](./tournaments.md)). Jean runs Série 1 as
`one_set` with `games_per_set = 8`, with the final as 2 sets plus a super
tie-break. The conventions below are therefore written against the config, and
the one-set case is the one that is currently broken.

The canonical string rules in [score-entry.md](./score-entry.md) stand; what
changes is the **statistics derivation** feeding `tournament_pool_standings`
(sets_won/lost, games_won/lost drive pool tie-breakers):

- **W/O and DEF**: already generalized as `target_sets * games_per_set`, which
  resolves correctly to 1-0 sets / 8-0 games under Série 1's config. No change.
- **RET when `match_format = 'one_set'`**: the current rule ("completed sets
  count, the in-progress set does not") yields 0-0 sets and 0-0 games for every
  retirement, because there is no completed set to count. Pool tie-breakers
  (sets ratio, then games ratio) therefore read a retirement as if nothing
  happened. Amendment: the non-retiring side is credited the win threshold
  (`games_per_set` games, 1 set); the retiring side keeps their actual games.
  Under an 8-game set, `5-3 RET` counts as 8-3 for standings while the stored
  canonical string stays `5-3 RET` (no data loss, no invented score on the
  record).
- **Multi-set formats** (`two_of_three`, and Série 1's final): at least one
  completed set exists in any realistic retirement, so the existing rule holds
  unchanged.

## Lateness and check-in

The evidence base exists: `match_participant.checked_in_at` is a per-player,
geofence-gated arrival timestamp on the linked game, with a T-2h reminder
cron. Design moves:

- **Check-in by design** (Jean's 4): on tournament-linked games the check-in
  CTA is promoted to the primary action on the match card from T-2h, and the
  existing `match_check_in_available` reminder must demonstrably fire for
  tournament-linked games (they are ordinary `match` rows, so this is
  verification, not construction). Copy states the point: "Ton check-in fait
  foi en cas de litige."
- **The lateness ladder is rules copy, not automation**, in v1: one game
  penalty per 5 full minutes of lateness, forfeit at 20 minutes, the clock
  starting at the scheduled time once at least one player has checked in at
  the court, warm-up included in the grace. Players apply it themselves; the
  organizer adjudicates disputes from the two `checked_in_at` timestamps. No
  automated game-penalty enforcement until score entry can express it.

## Venue suggestions

The engine already ranks facilities by distance midpoint, favorites and court
state for both players. Two adjustments (Jean's 5):

- **Facility diversity**: the returned option set must span at least 3
  distinct facilities whenever 3+ are in range for the pair (today the
  per-facility/day dedup can concentrate options on one venue). Implemented in
  `match_organizer_options` final selection, not a new RPC.
- **Closest books**: the created game's detail and the card footer carry the
  line "{name} est le plus proche: à toi de réserver." computed from the same
  distance data. Rules copy states the convention: closest player books, court
  fees split.

## Amendments to existing specs

| Spec                                                                                                   | Amendment                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [round-deadlines.md](./round-deadlines.md) § Step 1                                                    | Effort split replaced by the graded decision function. `messaged` is removed from `lt_side_effort` (chat is inadmissible evidence). The both-effort stalemate now ends with the gap rule instead of an unconditional double walkover.              |
| [round-deadlines.md](./round-deadlines.md) § Step 0                                                    | Unilateral cancellation of the attached game no longer merely clears the override: it forfeits the canceller (weather excepted). Mutual cancel keeps today's behavior.                                                                             |
| [08 live-suggestions](../08-communications/match-organizer-live-suggestions.md) § Zero-overlap variant | May now surface one flagged one-sided proposal, but only from an in-phase gate answer, labeled with its source.                                                                                                                                    |
| [08 live-suggestions](../08-communications/match-organizer-live-suggestions.md) § Availability gate    | Gate outcome record becomes `tournament_phase_availability` (phase-scoped, snapshotted) instead of one row per (player, pairing). Open decision 2 of that spec is resolved: an auto-posted card counts as effort for nobody, votes and answers do. |
| [score-entry.md](./score-entry.md) § Sets won / lost                                                   | RET statistics amendment for the one-set format, above.                                                                                                                                                                                            |

## Notifications

No new `notification_type_enum` values (a new type costs 14 registration
sites). Reused: `tournament_action_required` (dispo nudge),
`tournament_match_walkover` (carries the justification sentence),
`tournament_deadline_extended`, `match_check_in_available`, and the chat
`new_message` path for proposal and counter-proposal activity.

## Analytics

| Event                            | Properties                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `tournament_gate_answered`       | phase, outcome, hours_in_window, hours_since_phase_start                       |
| `tournament_slot_proposed`       | kind (mutual / one_sided), accepted_by_both, time_to_agreement                 |
| `tournament_match_auto_resolved` | outcome, score_a, score_b, signals breakdown, days_stalled (extends existing)  |
| `tournament_self_forfeit`        | source (gate / match_sheet / weather_prompt), phase                            |
| `tournament_weather_cancel`      | criteria_claimed, hours_to_deadline, led_to (reschedule / concession / ladder) |

North star unchanged: % of matches resolved without organizer action.
Secondary, new: % of pairings where the app's proposed slot became the played
slot; median time from phase start to gate answer.

## Rollout

1. `tournament_phase_availability` + gate ships phase-scoped (08 build order
   step 8 lands here), `min_availability_hours`, dispo nudge.
2. Proposed-slot flag on the auto-card, including the one-sided variant.
3. `tournament_declare_forfeit` + gate exit + cancel-attribution on linked
   games + forfeit-on-cancel with its warning copy.
4. Decision function swapped into the resolver cron, dry-run first (audit-only
   decisions for one round, same validation pattern as the ladder rollout),
   with the justification surfacing.
5. Weather exemption (attested v1) + near-deadline concession prompt.
6. Lateness copy + check-in promotion; venue diversity + closest-books line.

Steps 1, 2, 3 each stand alone and improve the funnel even if later steps
slip. Step 4 must not go live before 1 (it would decide on inadmissible
evidence).

## Open decisions

1. `min_availability_hours` default (recommended 6) and whether organizers can
   set it per tournament at creation or it stays a global constant in v1.
2. ~~Gap-rule threshold and whether the extension is skipped~~ **Decided
   2026-08-31**: Δgap is 2 in a round robin and 1 in a knockout, and there is
   no extension at all. Jean's position is that a system built to enforce a
   deadline cannot also hand out reprieves, so the question of when to skip the
   extension became moot when the extension was removed.
3. Final weather thresholds and the provider question (joins the Momentum
   Harvesting weather decision).
4. Whether `skipped` gate outcomes should cost a timeliness point relative to
   never answering at all (recommended: skip counts as answered-late, never as
   silence; skipping is at least a signal of life).
