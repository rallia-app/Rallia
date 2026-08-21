# Autonomous advancement

> How every event format advances registration, draws, rounds, phases and
> completion on its own: a sound evidence model (decide only on signals the
> system can guarantee it would have received had the player acted), a total
> resolution order per pairing, different strictness for pools and knockouts,
> and time-triggered phase gates. The organizer is an appeal court. Rallia is
> not the organizer's assistant; the calendar is the engine.

Source: product direction of 2026-08-19 ("self-service events with
deterministic, infallible arbitration and autonomous advancement") plus the
Série 1 delay diagnosis measured on prod the same day (below). This spec sits
above [round-deadlines.md](./round-deadlines.md) and
[scheduling-arbitration.md](./scheduling-arbitration.md): their mechanics
stand except where the [Amendments](#amendments-to-existing-specs) table says
otherwise, and every amendment traces to the measurement.

## What is already autonomous (do not rebuild)

| Piece                                                                         | State                                                                                                                  |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Registration close                                                            | Cron `lt-close-due-tournament-registrations`                                                                           |
| Round/phase deadlines, defaults at publish, per-match override                | Live (`20260810230000`); pool phase is one `('pool', 0)` row                                                           |
| T-48h / T-12h player nudges                                                   | Live, stamped on `tournament_matches.deadline_nudge48_at/12_at`                                                        |
| Resolution ladder (grace, extension, walkover, double walkover, dispute stop) | **Live, not dry-run**: `lt_resolve_due_tournament_matches(false)` every 15 min, paid draws included (`20260811100000`) |
| Auto-posted organizer card at pairing-ready                                   | Live (`20260809160100`), incl. `no_overlap` variant                                                                    |
| Participant custom time/place option                                          | Live (`20260812260000`)                                                                                                |
| Bracket recompute, bye/phantom cascade, derived pool standings                | Live, pure functions over recorded state                                                                               |
| Organizer nudges for the two manual gates                                     | Live (`20260811180100`), incl. `short_field` variant; **acts on nothing**                                              |

The two structural gaps: the ladder's evidence model, and the two phase gates
that still wait for a button.

## The measurement that constrains the design

Série 1, prod, measured 2026-08-19 over all 70 playable pairings:

| Fact                                                            | Consequence                                                                                                |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 100% of pairings played a real game; zero walkovers             | Delay was pacing, not abandonment                                                                          |
| 40% of pairings had **zero** in-app scheduling or chat activity | In-app silence is not evidence of disengagement; scheduling happens by text, phone, in person              |
| True ghosting (one side spoke, no reply) was 10%                | The problem the ladder targets is real but small                                                           |
| ~4 days median from pairing-known to played, all contact states | Any deadline shorter than ~5 days per round manufactures arbitration                                       |
| 53% of results were organizer-keyed with no linked game         | The scarce input is the **result**, not the schedule; recording friction is the largest organizer workload |
| Both 26-player draws overran a 13-day window by 5 and 8 days    | The calendar was under-budgeted; the players were not slow                                                 |

Had the live ladder run against Série 1 with deadlines set, the
neither-side-effort branch would have double-walked-over up to 40% of
pairings that in reality played. That is the failure mode this spec exists to
make impossible.

## Invariants

1. **Totality.** Every reachable state resolves without human action. No
   state may wait for the organizer to unblock it.
2. **Determinism.** Identical recorded states resolve identically. No seed
   preference, no coin flips visible to players, no discretion in the engine.
3. **Evidence soundness.** A resolution may only rest on signals the system
   can guarantee it would have received had the player acted: delivered
   prompts with recorded responses, scheduling actions, score entries,
   declared forfeits. Absence of an unguaranteed signal (chat, unprompted
   engagement) is never evidence.
4. **Explainability.** Every automated outcome carries a one-sentence,
   localized justification naming the rule that fired and what each side did
   or did not do, rendered on the match sheet, not only audited.
5. **Proportionality.** Bracket consequences (someone must advance) and
   personal consequences (reputation) have different evidence bars. The
   bracket may advance on exhausted prompts alone; a reputation penalty
   requires proof the player knew (an acknowledgement or any in-phase
   action).
6. **The organizer can always override, and never has to.**

## Evidence model v2

### Evidence classes

**Conclusive** (ends arbitration for the pairing, no scoring needed):

| Evidence                                      | Meaning                              | Exists today                                     |
| --------------------------------------------- | ------------------------------------ | ------------------------------------------------ |
| Attached game (`tournament_matches.match_id`) | Mutual agreement; Step 0 grace       | Yes                                              |
| Declared score (final on entry, below)        | The game happened and is resolved    | No: today a score waits on opponent confirmation |
| Declared forfeit                              | Self-resolution, cheapest of all     | Specced (`tournament_declare_forfeit`), unbuilt  |
| Mutual "cancel this game" of an attached game | Back to the ladder, override cleared | Yes                                              |

**Behavioral** (the graded S 0..6 of
[scheduling-arbitration.md](./scheduling-arbitration.md): timeliness, volume,
reactivity): admissible **only** when no conclusive evidence exists and the
prompt protocol (below) has completed. This subsumes and replaces the live
binary `lt_side_effort`; `messaged` stays removed (chat inadmissible).

**Inadmissible, restated**: chat text, read receipts (`message.read_by`),
availability grids from before the current phase, anything from a previous
round.

### The acknowledgement

New minimal signal converting silence into information. When a pairing
becomes determinate, the existing auto-posted card gains a one-tap presence
chip ("Je suis là" / "I'm in"), and the pairing-ready push deep-links to it.

```sql
CREATE TABLE tournament_match_acks (
    tournament_match_id uuid NOT NULL REFERENCES tournament_matches(id) ON DELETE CASCADE,
    player_id           uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
    acked_at            timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tournament_match_id, player_id)
);
```

RLS: SELECT for tournament readers, INSERT self only via RPC. Explicit GRANTs
per the new-table policy. Any other in-phase action (gate answer, vote,
custom option, score entry, self-forfeit) implies acknowledgement; the chip
exists for the player who schedules by text message and would otherwise
generate no admissible signal at all. It costs one tap and is asked exactly
once per pairing.

### The prompt protocol

Before any penalizing resolution, the system must have delivered, on
distinct days, over push and email where an address exists:

1. Pairing-ready (existing `tournament_match_ready` / bracket publish), with
   the ack chip.
2. T-48h nudge (existing, stamped).
3. T-12h nudge (existing, stamped).

The stamps are the record. A match whose protocol did not complete (e.g. a
deadline set under 48h out) may resolve, but only into non-penalizing
outcomes (cancellation or unpenalized advancement, below).

### Declared score is the score (decision 2026-08-19)

For tournament- and league-linked games, the first declared score is
**final on entry**. No opponent confirmation exists in the flow; the opponent
can only **contest**. Product decision of 2026-08-19, replacing the
confirm-or-auto-confirm model for L&T games (casual games keep mutual
confirmation; their rating stakes have no deadline pressure and no organizer
backstop).

- On submission, `match_result` verifies immediately; the existing sync
  trigger copies score and winner to the L&T row and advances the bracket or
  standings at once. Downstream (next pairing, round chat, card) fires the
  moment the score lands, which is exactly what autonomy wants.
- The opponent is notified with the declared score and one CTA: "Ce n'est pas
  le bon pointage? Conteste-le." Contesting uses the existing rebuttal flow
  and flips the match to `disputed`, which already stops the ladder and
  escalates to the organizer, whose override remains the last word.
- **Contest window**: 48h from declaration, closing early once the winner's
  next game is played. After it, the organizer override is the only path.
- A contest upheld by the organizer corrects the L&T row via
  `tournament_override_score` **and must correct the `match_result` row**
  (today the override deliberately leaves the casual row untouched; a false
  declaration would otherwise keep its rating effect). One reputation event
  on the false declarer (reuse `report_upheld`, -15); declaring first is a
  responsibility, not a race.
- The T-48/T-12 nudge copy gains one line naming the rule: whoever played,
  enter the score; it stands unless contested.

This deletes the pending-confirmation state for L&T games entirely, and with
it the `auto_confirm_expired_scores` cron as a prerequisite of this spec (the
uncronned function remains a casual-flow gap, out of scope here).

### Score-first entry (the missing safety valve)

New flow on the tournament/pool match sheet: "Nous avons joué, entrer le
pointage". Creates the `match` row retroactively (date picked by the
submitter, defaults to now), attaches it via the existing
`tournament_attach_match` semantics, and submits the score under the
declared-final rule above. Two taps plus the score, and the pairing is
resolved. This is the other half of the 2026-08-12 decision that kept the
card as the only pre-play path: pre-play, the card; post-play, this. Nothing
else may create tournament-linked games.

## Resolution order per pairing (supersedes ladder Step 1)

At the effective deadline, first pairing state that matches wins:

| #   | State                                    | Resolution                                                                                                                                                             |
| --- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Disputed result                          | Stop. Escalate to organizer (unchanged).                                                                                                                               |
| 1   | Attached game, not yet played            | Grace (unchanged Step 0). A declared score never reaches the ladder: it resolved the pairing on entry.                                                                 |
| 2   | A declared forfeit                       | Walkover for the other side (unchanged mechanics).                                                                                                                     |
| 3   | Both sides S >= 2                        | One automatic extension, then gap rule (unchanged from scheduling-arbitration).                                                                                        |
| 4   | Exactly one side S >= 2                  | Walkover for that side. Reputation penalty on the silent side **only if** it acked or acted in-phase; otherwise advance without a reputation event.                    |
| 5   | Neither side S >= 2, protocol complete   | **Knockout**: double walkover (unchanged cascade). **Pool**: game cancelled for both (below). Reputation per the same acked-or-acted bar, each side judged separately. |
| 6   | Neither side S >= 2, protocol incomplete | **Knockout**: advance by unpenalized double walkover, audited `protocol_incomplete`. **Pool**: cancelled. Never a reputation event.                                    |

Rows 4-6 are where the Série 1 misfire lived; the acked-or-acted bar plus
score-first entry is what removes it. A pair scheduling by text either enters
the score (row 1), or one of them acked and eats a deserved penalty at
silence, or neither ever acked and the bracket advances without branding
anyone unresponsive.

### Post-resolution reconciliation

If a real score is entered for a walked-over match before the winner's next
game is played, the organizer gets a one-tap restore
(`tournament_restore_match`, audited); the walkover, its reputation events
and its notifications are reversed. Not automatic: the bracket may already
have visible state downstream. Analytics counts these as misfires; the
misfire rate is the health metric of the whole system.

## Pools and knockouts are not equally strict

An unresolved knockout slot blocks a subtree; an unresolved pool game blocks
nobody, because standings are derived and the tie-breakers are ratios over
games actually played (this is why the format spec chose ratios). Therefore:

- **Knockout**: someone must always advance. Double walkover and its phantom
  cascade stand.
- **Pool**: the neutral outcome is **cancellation** (both sides' ratios
  simply cover one game fewer), aligning the ladder with
  [poules-puis-eliminatoires.md](./formats/poules-puis-eliminatoires.md) §6,
  which already promises "sinon partie annulée pour les deux". The live
  ladder's `W/O-W/O` + double reputation hit in pools is amended to
  cancellation, penalties only per the row 4-6 rules. One-sided pool
  walkovers (row 4) still count as wins per §8.
- **Paid draws**: unchanged from `20260811100000`. A registration that ends
  the tournament having completed zero games is disqualified and auto
  refunded minus the service fee; a cancelled pool game is a played-nothing
  contributor like a walkover was.

## Phase gates fire on time, not on a button

The two manual transitions become time-triggered, per the shape already
decided 2026-08-11 (auto-launch, never auto-cancel):

### Gate 1: registration closed -> draw published

New column `tournaments.auto_draw_at` (default `registration_closes_at +
24h`, organizer-editable, NULL disables). At `auto_draw_at`, if the field is
at or above the format floor, run the existing preview + generate path
(pools or bracket) exactly as the button would, with seeding as configured.
Below the floor: postpone start/end by 7 days, push `registration_closes_at`
and `auto_draw_at` out with them, reopen via the existing
`tournament_reopen_registration`, notify organizer and entrants. After two
automatic postponements, the third under-floor hit cancels with the standard
refund path (entrants have waited three weeks; certainty beats hope).

### Gate 2: pools settled -> knockout published

Fires at `LEAST(pool_deadline + 24h, moment all pool games settled + 24h)`.
The 24h is the organizer's review window, stated in the gate-1 publish copy.
The runner-up draw stays random and unrevealed until this moment, so
anti-tanking survives automation. Qualifiers who advance out of a shortened
pool (cancellations) enter with the placement points of the round they enter,
per the 2026-08-11 decision.

Both gates: silent while any pool game is `disputed` (dispute resolution
unblocks them), and both bump nothing the organizer holds an optimistic lock
on. The existing `tournament_action_required` nudges become "this will happen
at {date} unless you act", which is the honest version of a reminder.

## The calendar is the primary autonomy lever

Arbitration frequency is a function of deadline generosity. Defaults change
from "split the window evenly" to measurement-derived floors:

- Knockout rounds: default `max(6 days, even split)` per round.
- Pool phase: default `max(games_per_player * 5 days, even split)` (Série 2
  at pool size 4: 15 days of a 32-day window).
- `tournament_set_round_deadlines` warns (non-blocking) below 5 days per
  round; creation UI shows the implied per-round budget next to the date
  pickers ("32 jours pour 5 tours = 6 jours par partie").
- The deadline-editing UI finally ships: `useSetTournamentRoundDeadlines` is
  wired end to end but has no screen today. Organizer-facing, in the
  tournament management sheet.

## Amendments to existing specs

| Spec                                                                                        | Amendment                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [round-deadlines.md](./round-deadlines.md) § Step 1                                         | Replaced by the resolution order above: conclusive-first, behavioral second, penalties gated on acked-or-acted, protocol-incomplete never penalizes.                                                                  |
| [round-deadlines.md](./round-deadlines.md) § Double walkover                                | Pool-side double walkover becomes cancellation. Knockout unchanged.                                                                                                                                                   |
| [scheduling-arbitration.md](./scheduling-arbitration.md)                                    | Decision function S stands but moves to row 3-5 of the order; it never fires against conclusive evidence. Phase availability, proposed slot, weather, lateness, venue all unchanged.                                  |
| [poules...](./formats/poules-puis-eliminatoires.md) §6, §7                                  | "Réglée par l'organisateur" becomes "réglée par l'échéance" (organizer optional). §7's launch button gains the gate-2 timer.                                                                                          |
| [08 live-suggestions](../08-communications/match-organizer-live-suggestions.md) § Auto-post | The card carries the ack chip. An ack is not effort (it scores nothing in S); it is knowledge.                                                                                                                        |
| [score-entry.md](./score-entry.md) § Player submission flow                                 | For L&T-linked games: declared score verifies on entry; opponent confirmation replaced by a 48h contest (rebuttal) window. Upheld contests must correct `match_result`, not only the L&T row. Casual games unchanged. |
| [poules...](./formats/poules-puis-eliminatoires.md) §6                                      | "un joueur l'entre, l'adversaire le confirme (validation automatique après 72 heures)" becomes "un joueur l'entre, il fait foi; l'adversaire peut le contester (48 h)".                                               |

## Notifications

No new `notification_type_enum` values. Reused: `tournament_match_ready`
(carries the ack deep link), `tournament_action_required` (gate countdowns),
`tournament_match_walkover`, `tournament_deadline_extended`,
`tournament_bracket_published` (gate 2 fires the existing publish paths).
Cancellation of a pool game reuses `tournament_match_walkover`'s slot with
its own copy, the same trick as `lt_notify_pool_forfeit`.

## Analytics

| Event                            | Properties                                                              |
| -------------------------------- | ----------------------------------------------------------------------- |
| `tournament_match_acked`         | hours_since_ready, source (card / push)                                 |
| `tournament_score_first_entry`   | days_after_play, phase                                                  |
| `tournament_score_contested`     | hours_after_declaration, upheld, phase                                  |
| `tournament_match_auto_resolved` | extends existing: + evidence_class, protocol_complete, acked_a, acked_b |
| `tournament_walkover_overturned` | days_until_score_arrived, downstream_games_played                       |
| `tournament_gate_auto_fired`     | gate (draw / knockout), was_postponement, field_size                    |

North star unchanged: % of matches resolved without organizer action (Série
1 baseline: 47% of results were player-recorded). Guardrail: **misfire rate**
(overturned walkovers / automated walkovers) must stay under 5%; if it
climbs, loosen deadlines, never tighten evidence.

## Prerequisites and rollout

1. Declared-final scoring for L&T games (contest window replaces
   confirmation) + score-first entry + deadline-editing UI. Together these
   attack the 53% recording friction; no ladder semantics change yet.
2. Ack chip + `tournament_match_acks` + `tournament_declare_forfeit` (the
   arbitration spec's rollout step 3 lands here).
3. Resolution order v2 in the resolver, **dry-run against Série 2's pool
   phase** (audit-only alongside the live v1 ladder; diff the decisions).
   The Série 1 census query is the validation harness.
4. Resolution order v2 live; pool cancellation semantics.
5. Phase gates (`auto_draw_at`, gate 2 timer).
6. Calendar defaults + creation-time budget copy.

Step 3's dry-run diff is the acceptance test for the whole spec: v2 must
produce zero penalizing decisions on pairings that later produce a real
score.

## Open decisions

1. Ack chip copy and whether the T-48h nudge re-surfaces it for un-acked
   players (recommended yes, same notification, one extra line).
2. Postponement step for gate 1 (recommended 7 days) and the
   two-postponements-then-cancel cap.
3. Pool cancellation and Rallia Points: a cancelled game currently counts as
   a settled-but-unplayed game in the played-nothing refund test; confirm
   that interaction before step 4.
4. Contest window length (48h chosen above) and whether a contest after the
   window but before the next game is played should still be accepted
   (recommended no: the window is the promise; the organizer override covers
   genuine late discoveries).

Resolved 2026-08-19: score declaration needs no confirmation; the first
declared score stands and the opponent can only contest (see § Declared
score is the score).
