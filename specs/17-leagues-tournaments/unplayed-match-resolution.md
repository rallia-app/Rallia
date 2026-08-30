# Unplayed match resolution

> The complete decision logic for a pairing (two sides, opponents known) in a
> round-robin or knockout phase whose game is not played, or not recorded, by
> its deadline: the evidence the system may read, the total order of rules it
> applies, what every outcome does to standings, bracket, reputation and money,
> and how a decision is undone. Normative for every event built from pools and
> brackets (pool_knockout, single elimination); league sessions twin later.

This is the detailed logic behind
[autonomous-advancement.md § Resolution order per pairing](./autonomous-advancement.md#resolution-order-per-pairing-supersedes-ladder-step-1).
Evidence definitions come from [scheduling-arbitration.md](./scheduling-arbitration.md),
mechanics from [round-deadlines.md](./round-deadlines.md), format consequences
from [poules-puis-eliminatoires.md](./formats/poules-puis-eliminatoires.md).
Where this spec refines any of them, the [Amendments](#13-amendments-to-existing-specs)
table says so.

**Revised 2026-08-23 after Jean's review** of the short French version of this
spec, and completed 2026-08-25. Three of his rulings change the logic rather
than complete it, and they are marked at their site: the deadline is absolute
(principle 7, and R2 is gone), a forfeit is a defeat carrying the format's
score (§ 5), and no refund is automatic once the pools or the draw have opened
(§ 10). The three calls his rule needed and did not itself answer are settled
in § 5: which ledgers the defeat reaches (standings yes, rating never, Rallia
Points unchanged), what happens when there is no winner to give the score to
(fault decides: two defeats, or a cancellation), and Δgap dropping to 1 in KO.
Nothing about the rule is open.

## 1. Scope and vocabulary

| Term                   | Meaning                                                                                                                                                                                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pairing**            | A playable row with two real sides. A side is a registration: a player in singles, a team in doubles. Byes and phantoms are not pairings and never enter this logic.                                                                                                                         |
| **Phase**              | A round-robin (RR) phase, where every pool game shares one deadline, or a knockout (KO) round, with one deadline per round. Single elimination is a KO phase from round 1.                                                                                                                   |
| **Effective deadline** | The organizer's per-pairing override if one was set before it expired, else the phase/round deadline. Nothing else moves it: the machine never grants itself more time (§ 2.7). No effective deadline means no automation for that pairing: the feature is opt-out by not setting deadlines. |
| **Played**             | A result is declared on the pairing (score-first entry, linked game, organizer entry). What happened on court does not matter to the machine until a result exists.                                                                                                                          |
| **Unplayed**           | No declared result at the effective deadline, whatever the reason: never agreed, agreed and never met, met and never recorded, cancelled.                                                                                                                                                    |
| **Determinate**        | The moment both sides of the pairing are known (pools published; previous KO round resolved). Every clock below starts here; nothing before it is admissible.                                                                                                                                |
| **In-phase**           | Timestamped after the pairing became determinate and before it resolved.                                                                                                                                                                                                                     |

The problem the logic solves: at the effective deadline the machine must end
the pairing without a human, without guessing, and without punishing people
for things it cannot prove.

### The reasons a game is unplayed when time is up, and where each lands

The question in plain terms: the clock ran out, the game was not played, why
not, and what now so the event keeps moving. Every reason maps to one rule of
§ 6; the rest of this spec is the precise version of this table.

| Why the game was not played                                         | What the machine can see               | What happens (round robin / knockout)                                                                           | Rule |
| ------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---- |
| Nobody ever got in touch, or they arranged by text and never played | no game, no actions, maybe no ack      | double forfeit: both take the 8-0, nobody penalized in reputation unless a side acked and then did nothing      | R6   |
| One side tried, the other never answered                            | one side acted, the other silent       | walkover to the one who tried; the silent side is penalized only if it had acknowledged the pairing             | R5   |
| Both tried, could not find a time                                   | both sides acted                       | the more engaged side wins if the gap is clear, else cancelled with nothing on either record                    | R4   |
| They agreed a time that falls after the deadline                    | impossible by construction             | a slot past the deadline cannot be booked; the card stops offering them as the deadline approaches              | § 8  |
| They agreed, the day came, one did not show                         | a linked game, one check-in            | walkover to the one who showed, no-show event on the other                                                      | R3   |
| They agreed and met, nobody entered the score                       | a linked game, time passed, no result  | prompt to declare or concede, before the deadline; then as "both tried"                                         | R3   |
| They agreed, then one cancelled                                     | a cancelled linked game, one canceller | walkover to the other (cancelling after agreeing is a forfeit); a weather cancel returns to the ladder          | R3′  |
| They agreed, then both called it off                                | a cancelled linked game, both          | back to the ladder as "both tried"                                                                              | R3′  |
| One side gave up (injury, vacation, quit)                           | a declared forfeit                     | walkover to the other, immediately, no penalty for unresponsiveness                                             | R1   |
| One side left the whole event                                       | a withdrawal or organizer forfeit      | every open game of that side is a walkover to the opponent, outside the ladder                                  | § 10 |
| They played, one entered a score, the other disagrees               | a contested result                     | frozen; the organizer decides                                                                                   | R0   |
| They played and declared it, late                                   | a result after the deadline            | not unplayed: a declared result always stands; a double forfeit auto-restores, anything else the organizer does | § 9  |

Two things hold in every row: the round-robin answer is never "someone wins by
default" unless one side provably tried harder, and the knockout answer always
leaves someone in the next slot, even if that someone is a bye.

## 2. Principles

1. **Totality.** Every reachable state resolves without organizer action.
2. **Determinism.** Same recorded state, same decision. No seed preference, no
   randomness, no discretion inside the machine.
3. **Evidence soundness.** A decision rests only on signals the system can
   guarantee it would have received had the side acted: delivered prompts with
   recorded responses, scheduling actions, check-ins, score and forfeit
   declarations. Absence of an unguaranteed signal (chat, unprompted activity)
   is never evidence of anything.
4. **Proportionality.** Bracket consequences (someone advances) and personal
   consequences (reputation) have different bars. The bracket may move on
   exhausted prompts alone; a reputation event requires proof the side knew.
5. **Explainability.** Every automated outcome carries a justification naming
   the rule that fired and what each side did or did not do, shown on the
   match sheet and in the notification, not only audited.
6. **The organizer can always override, and never has to.**
7. **The deadline is absolute.** At the effective deadline a decision is taken,
   always, on the state recorded at that instant. The machine never holds,
   never extends, never waits for a game booked past it: an unresolved pairing
   delays the whole draw, and every attempt to make players react therefore
   belongs before the deadline, saying what happens at it. Only the organizer
   moves a deadline, only while it is still in the future (§ 9).

## 3. Timeline of a pairing

```
determinate ─► prompts ─► (agreement ─► game ─► play ─► declared result) ─► resolved
     │            │                                                    ▲
     │            └─ ready (+ack chip) · T-48h · T-12h                  │
     │                                                                 │
     └────────────── effective deadline ──────────────────► resolution ─┘
                                                                  │
                                              post-resolution window: contest / restore / override
```

- **Prompts** are the protocol record (§ 4.4). They are stamped on the pairing.
- **Agreement** is a created game linked to the pairing (when and where are
  known). It is the only pre-play path to a game.
- **Declared result** ends the pairing whenever it lands, before or after the
  deadline; the ladder never runs against a declared result.
- **Resolution** is the ladder of § 6, run once, at the effective deadline.
- **Post-resolution window** is where a late score, a contest or an organizer
  override can still change the outcome (§ 9).

## 4. Evidence

### 4.1 Conclusive events

Conclusive events end or redirect arbitration without weighing behavior.

| Event                              | Produced by                                     | Proves                             | Ladder effect                                     |
| ---------------------------------- | ----------------------------------------------- | ---------------------------------- | ------------------------------------------------- |
| Game created and linked (pre-play) | both sides voting the same slot / custom option | agreement on when and where        | hold (R2), then check-in split (R3)               |
| Check-in at the court              | geofenced tap on the linked game                | presence at the agreed time/place  | no-show split (R3)                                |
| Declared result                    | either side, or the organizer                   | the game happened and how it ended | resolves the pairing; opens the contest window    |
| Declared forfeit                   | either side                                     | concession                         | walkover to the other side (R1)                   |
| Cancellation of the linked game    | one side (unilateral), both (mutual), weather   | agreement withdrawn                | R3′                                               |
| Contest of a declared result       | the opponent, inside the contest window         | the result is disputed             | dispute: ladder stops, organizer decides (R0)     |
| Event exit (withdrawal, forfeit)   | the side or the organizer                       | the side has left the event        | every open pairing of that side → walkover (§ 10) |

### 4.2 Awareness: the ack

A side is **aware** of a pairing when it has acknowledged it: the one-tap
presence chip on the pairing card ("Je suis là"), or any in-phase action on
the pairing (a vote, a custom option, a gate answer, a check-in, a declaration).
Awareness proves knowledge; it is never effort and scores nothing in S. It is
the bar for personal consequences (principle 4).

### 4.3 Engagement: the score S

Per side, three graded signals read only from in-phase scheduling records, each
0 / 1 / 2, total **S ∈ 0..6** (definition from scheduling-arbitration):

| Signal         | 2                                                              | 1                                            | 0                               |
| -------------- | -------------------------------------------------------------- | -------------------------------------------- | ------------------------------- |
| **Timeliness** | availability prompt answered within 48 h of the phase start    | answered later, before the submission cutoff | never, or after the cutoff      |
| **Volume**     | admissible hours ≥ the phase minimum (default 6)               | some, under the minimum                      | none                            |
| **Reactivity** | every pending event answered within 24 h, and ≥ 1 action taken | acted, but at least one answer took longer   | never engaged with any proposal |

A **pending event** for side X is an opponent action awaiting X's answer: the
proposal flag landing, an opponent vote on an option X has not voted, an
opponent custom option. X's answer is any scheduling action.

**Reactivity cap (refinement).** If side X had at least one pending event and
answered none of them, S_X is capped at 1, whatever its timeliness and volume.
Filing a rich availability grid and then ignoring every concrete proposal is
the unresponsiveness the whole system exists to sanction; it must not read as
engagement.

Three side states follow, and the ladder only ever needs these:

| State | Definition                       | Reading                          |
| ----- | -------------------------------- | -------------------------------- |
| **E** | engaged: S ≥ 2                   | tried to make the game happen    |
| **P** | passive: aware (§ 4.2) and S < 2 | knew, did not act (or barely)    |
| **U** | unreached: not aware and S = 0   | the machine cannot prove it knew |

A side that only tapped the ack is P. A side that voted one proposal within
24 h is E (reactivity 2). A side with a full grid that ignored every proposal
is P (cap). Doubles: a side's signals are the union of its members' actions.

Until the availability prompt exists, timeliness and volume are 0 for everyone
and S reduces to reactivity; the states still work (one timely answer to a
proposal makes a side E). This keeps the logic valid through the rollout.

### 4.4 Protocol completeness

Before any **penalizing** outcome, the system must have delivered, on distinct
days, by push and by email where an address exists:

1. pairing-ready (with the ack chip),
2. the T-48 h reminder,
3. the T-12 h reminder.

The delivery stamps are the record. A pairing whose protocol did not complete
(typically a deadline set, or moved, to under 48 h out) may still resolve, but
only into non-penalizing outcomes: no reputation event on anyone, whatever
their state.

### 4.5 Inadmissible

Chat text and message counts, read receipts, availability grids from before the
phase, anything from a previous round or phase, the organizer's opinion of who
is at fault. None of it is read by the machine.

## 5. Outcomes

| Outcome            | Round robin                                                                                         | Knockout                                                                                                             | Reputation                                                       | Rating     | Money                             | Notification                          | Audit                 |
| ------------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------- | --------------------------------- | ------------------------------------- | --------------------- |
| **Walkover to X**  | a win for X carrying the format's forfeit score; Y takes a played defeat, counted like any other    | X advances; Y is out                                                                                                 | on Y per § 6 penalty rule                                        | none       | none                              | both, with the justification sentence | `auto_walkover`       |
| **Double forfeit** | both sides take the forfeit-score defeat; the game is settled and stays in the denominator          | same, and neither advances: the fed slot becomes a bye, two dead feeders cascade, a dead final ends with no champion | per side per § 6 penalty rule                                    | none       | none                              | both, with the justification sentence | `auto_double_forfeit` |
| **Cancelled**      | no result; the game leaves the denominator (settled count, set and game ratios); both stay eligible | neither advances, nothing is recorded against either side; the fed slot becomes a bye exactly as above               | per side per § 6 penalty rule                                    | none       | none                              | both                                  | `auto_cancel`         |
| **Escalation**     | pairing frozen, organizer notified                                                                  | same                                                                                                                 | none                                                             | none       | none                              | organizer                             | `dispute_escalated`   |
| **Override**       | organizer's result is authoritative                                                                 | same, while the next match has no result                                                                             | organizer's call; an upheld contest penalizes the false declarer | per result | none                              | both                                  | `override_score`      |
| **Restore**        | the automated outcome is reversed and the late result applied                                       | same, while the advanced side's next game has no result                                                              | events reversed                                                  | per result | refund reversed if one was queued | both                                  | `restore`             |

**A walkover is a defeat, and it looks like one.** Jean's rule, 2026-08-23: in
pools as in the draw, a forfeit is a defeat with the same consequences as any
other, and it carries the format's forfeit score (8-0, or 6-0 6-0), the only
exception being a game cancelled for exceptional reasons. So the outcome writes
a real, explicitly-flagged forfeit score: the winner is credited as in any win,
the loser takes the defeat in the standings, and the record still says forfeit
rather than pretending a game was played. This replaces the earlier "0 sets and
0 games for the ratios", which kept a no-show off the loser's record entirely.

In KO an unresolved slot blocks a subtree, so **someone must advance**, and
where nobody can, the bye that both no-winner outcomes leave behind is what
lets the bracket move. `lt_advance_double_walkover` is that mechanic and is
unchanged by any of this: what changed is only what gets written on the two
players' records.

**Which ledger "the same consequences as any other defeat" reaches** (decided
2026-08-25). "Classement" names four different things here and the rule does
not apply to all four:

| Ledger                                  | A forfeit defeat                                                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pool standings and bracket placement    | **Counts**, with the forfeit score, ratios included. This is what the rule is about                                                                       |
| Rating (la cote)                        | **Never touched.** A score nobody played is a bad measurement of level, and the anti-sandbagging ceiling already reads the same history                   |
| Rallia Points (season board, per sport) | **Unchanged**: `award_tournament_ranking_points` pays by placement × multiplier, so a side that advances by forfeit banks the round it reached, as before |
| League session points                   | Out of scope here and already consistent: `pointWalkoverWinner` 10, `pointWalkoverLoser` 0                                                                |

**When nobody wins, fault decides which of the two no-winner outcomes fires**
(decided 2026-08-25). One line separates them, and it is the exception Jean
named: a game cancelled for exceptional reasons.

- **Both at fault → double forfeit.** Nobody showed, nobody engaged, or both
  conceded. Both take the 0-8. The reason is the incentive: under a plain
  cancellation, _not playing beats losing_, since a side that expects to lose
  can stay silent and have the game erased from its record instead of taking a
  defeat. That is the Série 1 disease pointed the other way. A symmetric defeat
  removes the gain, and it keeps every player in the pool on the same
  denominator, so set and game ratios stay comparable between pool members
  instead of quietly moving who qualifies.
- **Neither at fault → cancelled.** The R4 stalemate, a weather cancellation,
  an organizer cancellation. Two sides that answered the gate, proposed, and
  answered each other, and still have no overlapping hour, have not defaulted
  on anything: punishing that is the fastest way to teach players that engaging
  with the funnel is a trap. Note how narrow this is once the reactivity cap is
  in force: a side that ignores proposals is P, not E, so a true E/E stalemate
  essentially means k = 0 mutual slots, two calendars that genuinely do not
  intersect.

U/U takes the double forfeit like any other both-at-fault row, and this does
not contradict proportionality (principle 4): standings consequences ride on
exhausted prompts, personal ones need proof of knowledge, and the reputation
event still fires on nobody here.

**The guard this needs.** The Série 1 census is why the resolver sits in
dry-run: 40 % of pairings carried zero in-app signals and at least a third of
those were really played. A double forfeit writes a defeat on both records, so
a misfire is expensive. Therefore **a real score declared late auto-restores a
double forfeit, with no organizer action** (§ 9). It is the one outcome both
sides want corrected, and the contest window already guards against a fake.

## 6. The resolution procedure

Run at the effective deadline for every unresolved pairing of an in-progress
event. First matching rule wins; rules are evaluated on the state recorded at
that moment.

| #       | Condition                              | Round robin                                                                                                                                                                         | Knockout                   | Penalty rule                                                                                      | Justification key                              |
| ------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **R0**  | The pairing carries a contested result | stop, escalate                                                                                                                                                                      | stop, escalate             | none                                                                                              | `disputed`                                     |
| **R1**  | One side declared a forfeit            | walkover to the other side                                                                                                                                                          | walkover to the other side | none for unresponsiveness; the declaring side takes the forfeit event (§ 12)                      | `declared_forfeit`                             |
|         | Both sides declared a forfeit          | double forfeit                                                                                                                                                                      | double forfeit             | none for unresponsiveness; each declaring side takes the forfeit event                            | `mutual_forfeit`                               |
| **R3**  | A game is linked, no result declared   | check-in split, then fall through with both sides deemed E                                                                                                                          | same                       | one side checked in, the other did not → walkover to the present side, no-show on the absent side | `no_show` / `unrecorded`                       |
| **R3′** | The linked game was cancelled          | unilateral: walkover to the other side (forfeit on cancel); weather-attested: detach, then the ladder with both sides deemed E; mutual: detach, the ladder with both sides deemed E | same                       | unilateral canceller takes the forfeit event; none otherwise                                      | `cancel_forfeit` / `weather` / `mutual_cancel` |
| **R4**  | Both sides E                           | gap rule                                                                                                                                                                            | same                       | none: both sides tried                                                                            | `gap_rule` / `stalemate`                       |
| **R5**  | Exactly one side E                     | walkover to the E side                                                                                                                                                              | walkover to the E side     | the other side takes `unresponsive` iff it is P and the protocol is complete                      | `one_sided`                                    |
| **R6**  | No side E                              | double forfeit                                                                                                                                                                      | double forfeit             | each side separately takes `unresponsive` iff it is P and the protocol is complete                | `no_effort`                                    |

**R2 is gone.** It held the deadline open for a game booked past it. Under
principle 7 no such game exists (§ 8 refuses the booking) and nothing holds the
deadline anyway, so a linked game with no result at the deadline is simply R3.
The numbering is kept: R3..R6 are referenced by [scheduling-funnel.md](./scheduling-funnel.md)
and by `lt_resolve_due_tournament_matches`, and renumbering would silently
rewrite both.

**Gap rule** (R4, at the deadline): if |S_A − S_B| ≥ Δgap, walkover to the
higher side; else **cancelled**, in RR and in KO alike, because neither side is
at fault (§ 5). This is also the rule that settles two players who keep
counter-proposing without ever converging: the machine does not arbitrate the
calendar, it reads who moved. No reputation event either way: both sides are E
by construction.

**Δgap is 2 in RR and 1 in KO** (decided 2026-08-25). In a pool, cancelling
costs nothing, so the machine should only pick a winner on an unambiguous gap.
In a bracket the alternative is eliminating two sides that both tried, the
harshest thing the system can do, so it decides on any difference at all and
only a perfect tie in S ends the pairing with nobody through. Seed preference
is still refused (§ 13): advancing the higher seed on a tie would pay the
higher seed to stall.

**"Deemed E"** (R3, R3′): an agreement is the strongest scheduling act there is.
A side that agreed a game is treated as S ≥ 2 from that point, whatever its
earlier signals; the agreement does not raise S above what it already was for
the gap rule.

**Penalty rule, stated once.** A reputation event for unresponsiveness lands on
a side only when all three hold: the outcome went against it (walkover lost,
double forfeit, cancellation), it was **P** (aware and not engaged), and the
protocol was **complete**. U is never penalized (knowledge unproven), E is
never penalized (it tried), and an incomplete protocol protects everyone. The
no-show event (R3) and the forfeit event (R1, R3′) are different events with
their own weights and do not go through this rule.

## 7. The matrix

Every combination of conclusive state and behavioral pair, at the first
deadline unless stated. Behavioral pairs are unordered (E/P means one side E,
the other P). "pen." names who takes an unresponsiveness event when the
protocol is complete; with an incomplete protocol nobody does.

| Conclusive state at the deadline                    | Sides | Round robin                              | Knockout                                 | pen. (protocol complete)     |
| --------------------------------------------------- | ----- | ---------------------------------------- | ---------------------------------------- | ---------------------------- |
| **Contested result**                                | any   | escalate                                 | escalate                                 | none                         |
| **Forfeit declared by X**                           | any   | walkover to Y                            | walkover to Y                            | none (forfeit event on X)    |
| **Forfeit declared by both**                        | any   | double forfeit                           | double forfeit                           | none (forfeit event on both) |
| **Game linked, no result, X checked in, Y did not** | any   | walkover to X                            | walkover to X                            | no-show on Y                 |
| **Game linked, no result, otherwise**               | any   | → as E/E                                 | → as E/E                                 | none                         |
| **Game cancelled by X alone**                       | any   | walkover to Y                            | walkover to Y                            | none (forfeit event on X)    |
| **Game cancelled, weather-attested**                | any   | → as E/E                                 | → as E/E                                 | none                         |
| **Game cancelled by both**                          | any   | → as E/E                                 | → as E/E                                 | none                         |
| **No game, no declaration**                         | E/E   | gap rule (Δgap 2): walkover or cancelled | gap rule (Δgap 1): walkover or cancelled | none                         |
|                                                     | E/P   | walkover to E                            | walkover to E                            | P                            |
|                                                     | E/U   | walkover to E                            | walkover to E                            | none                         |
|                                                     | P/P   | double forfeit                           | double forfeit                           | both                         |
|                                                     | P/U   | double forfeit                           | double forfeit                           | P                            |
|                                                     | U/U   | double forfeit                           | double forfeit                           | none                         |
| **Side has left the event** (§ 10)                  | any   | walkover to the opponent, immediately    | walkover to the opponent, immediately    | per the exit path, not here  |

Reading the bottom block: awareness alone never wins a game (P/U is not a
walkover to P), effort alone always does (E beats P and U alike), and the only
place the machine weighs two efforts against each other is the gap rule, where
the justification shows the exact signals. The bottom four rows also show the
fault line at work: every row where nobody engaged ends in two defeats, and the
one row where both engaged ends with nothing on either record.

## 8. Before the deadline

| Moment                                              | Who                                                            | What                                                                                                                                                                                  |
| --------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Determinate                                         | both sides                                                     | pairing-ready push + email, deep-linking to the card; the card carries the app's proposed slot and the ack chip; the round chat exists                                                |
| Phase start + 72 h (or the deadline if sooner)      | sides with no availability answer                              | one action-required nudge; not answering is not a forfeit, it lowers timeliness                                                                                                       |
| T-48 h                                              | both sides, unless a game is linked                            | reminder naming the opponent and the consequence                                                                                                                                      |
| T-12 h                                              | sides that have not acted on the card, unless a game is linked | last-chance reminder                                                                                                                                                                  |
| Any time                                            | either side                                                    | declare a forfeit (two taps, card overflow and match sheet); propose a custom slot; declare the result once played (score-first entry)                                                |
| Linked game cancelled for weather, deadline < 48 h  | both sides                                                     | one concede prompt ("Pas le temps de rejouer? Tu peux concéder.") wired to declare-forfeit                                                                                            |
| Linked game played, no result, deadline still ahead | both sides                                                     | one declare-or-concede prompt as soon as the game time passes; the ladder runs at the deadline if nobody does either                                                                  |
| Any slot offer, any custom proposal                 | either side                                                    | slots past the effective deadline are not offered and cannot be booked; the card says why ("il ne reste plus de créneau avant l'échéance") and offers forfeit and custom-slot instead |
| Before a heavy-consequence tap                      | the acting side                                                | a confirmation naming the consequence in words, on: cancelling after a firm agreement (= forfeit, the opponent wins), declaring a forfeit, leaving the event                          |

The countdown to the effective deadline and the sentence "what happens if
nothing is done" are always visible on the pairing card and the match sheet.
Everything meant to make a side react lives in this section, by construction:
after the deadline there is only a decision (principle 7).

## 9. After a resolution

| Situation                                       | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A result is declared after an automated outcome | **Restore window.** RR: until the phase is consumed (knockout generated, or final standings frozen). KO: until the advanced side's next pairing has a declared result. Inside the window the organizer gets a one-tap restore that reverses the outcome, its reputation events, its refund if queued, and notifications; the declared result then resolves the pairing normally. Outside the window: organizer override only, subject to the downstream guard. Every restore is counted as a misfire. **A double forfeit restores automatically**, inside the same window, on either side declaring a real score, with no organizer action: it is the only outcome that convicts both sides at once, both therefore want it corrected, and the contest window is what guards the declaration. Every other outcome keeps the organizer tap. |
| A declared result is contested                  | Contest window Δcontest from declaration, closing early once the winner's next game is played (KO) or the phase is consumed (RR). A contest flips the pairing to disputed (R0): ladder stops, organizer decides by override, which must also correct the underlying game result; an upheld contest penalizes the false declarer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| The organizer overrides                         | Always allowed on an unresolved, resolved or disputed pairing while the downstream match has no result; after event completion, inside the correction window only. The override is the appeal court; it needs no justification from the machine and writes its own. It sets an **explicit outcome** (walkover to X, retirement, cancellation, forfeit) or a real score, never one disguised as the other: in Série 1 the only field was a score, so the organizer typed a generic 8-6 (or 1-0, 8-0) to move 27 of 70 pairings on without a game, and the record can no longer tell a played game from an advance.                                                                                                                                                                                                                          |
| The organizer moves a deadline                  | Unilateral and always available **while the deadline is still in the future**, phase-wide or per pairing: it is the only way to accommodate an exceptional situation, and it replaces the grace and extension the machine used to grant itself. Later: prompts re-evaluate against the new date (T-48/T-12 may fire again; protocol stamps are per delivery, not per deadline). Earlier: refused under 48 h from now, so nobody loses a window they were promised. **Once the deadline has passed it cannot be moved**: the pairing is decided, and the way back is restore or override, not a rewritten clock.                                                                                                                                                                                                                            |

## 10. Interactions

| Interaction                                                                                           | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A side leaves the event** (withdraws, is forfeited by the organizer, a doubles team loses a member) | Outside the ladder, immediately: every open pairing of that side is a walkover to the opponent; played results stand. RR: the side is **ranked last in its pool whatever its points**, and ineligible to qualify. The rule is a sort override, not an arithmetic outcome: a pool leader who is injured in week two and quits finishes last even though his played results would seat him first (Jean, 2026-08-23). Several sides out of the same pool keep their point order among themselves, below everyone still in. KO: the opponent advances; if the side was already placed in a later round, that slot resolves the same way. No refund once the phase has opened (§ Paid events below). |
| **Pool → knockout gate**                                                                              | The RR phase is settled when every pool pairing is resolved (result, walkover, double forfeit, cancelled). Cancelled games are settled. The gate never waits on a pairing the ladder cannot resolve: with R3 and R3′ in place, the only pairing the ladder leaves alone is a contested one, and the gate is silent while one exists.                                                                                                                                                                                                                                                                                                                                                            |
| **Deadline unset**                                                                                    | No automation for that pairing or phase; prompts that key on the deadline do not fire. Opt-out by design.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Paid events, refunds**                                                                              | **No automatic refund once the pools or the draw have opened** (Jean, 2026-08-23), whatever the side went on to play or not play: the seat was sold, the event started, and an exceptional case is settled by hand, outside the machine. Refunds stay automatic only on the paths that run before that moment (pre-draw removal, cancelled event, eviction). This retires the zero-games rule, which refunded any side ending with no played game and which the § 5 forfeit scores would have made nearly unreachable anyway: a side that answers nothing now collects defeats, not cancellations.                                                                                              |
| **Points and placement**                                                                              | Walkovers count as wins for RR standings and as advancement for KO placement, and now carry the format's forfeit score on both sides of the ledger (§ 5), so the loser's set and game ratios move like any defeat; a double forfeit writes that defeat on both sides and stays in the denominator; cancelled games still count for nothing and leave it; a qualifier out of a shortened pool enters the bracket with the placement points of the round it enters. Rating and Rallia Points follow the ledger table in § 5.                                                                                                                                                                      |
| **Doubles**                                                                                           | The side is the team; awareness and S are the union of both members; the forfeit, check-in and declaration of either member bind the team.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## 11. Worked examples

1. **Arranged by text, played, nobody declared.** No game in the app, no votes, no ack. Protocol complete. U/U → double forfeit, 8-0 against both, no reputation events (nobody's knowledge is proven). Next day one of them uses score-first entry: the double forfeit **auto-restores**, no organizer involved, the real result stands and the misfire is logged. This is the Série 1 case, the most common one in the census, and the auto-restore is what makes it survivable.
2. **A proposes twice, B never answers, never acked.** E/U → walkover to A, no penalty on B. If B had tapped "Je suis là" and then ignored the proposals: E/P → walkover to A, `unresponsive` on B.
3. **Both active, cannot converge.** E/E at the deadline, S_A = 5, S_B = 2: gap 3 ≥ 2 → walkover to A with the forfeit score, no penalty on B, justification lists both breakdowns. S_A = 3, S_B = 2 → RR cancelled, nothing on either record; in KO that same gap of 1 clears Δgap and A advances. Nothing is extended: the two weeks they had were the two weeks they had.
4. **Game agreed for Saturday, deadline Sunday night; Sunday afternoon, still no score.** The declare-or-concede prompt went out Saturday evening, when the game time passed. Only A checked in → walkover to A, no-show on B. Both checked in and neither declared → at the deadline as E/E, gap rule (S equal → cancelled, in RR and KO alike: they met, so neither is at fault). Neither checked in → same. A score arriving Monday goes through restore (§ 9), not through a rule.
5. **Game agreed, B cancels it for rain with the weather reason.** Detach, concede prompt to both, and the organizer may push the phase deadline if the weather hit the whole pool. Nobody concedes and the deadline is not moved → at the deadline as E/E.
6. **Game agreed, B cancels it with no reason.** Forfeit on cancel: walkover to A, forfeit event on B, no ladder.
7. **Deadline set 36 h before it fires.** Protocol incomplete. P/U → double forfeit, and nobody takes a reputation event: the standings consequence rides on the deadline, the personal one needs the three prompts. E/P → walkover to E, nobody penalized.

## 12. Parameters

| Parameter          | Default                                                                    | Notes                                                                    |
| ------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| forfeit score      | 8-0, or 6-0 6-0, by format                                                 | written explicitly flagged as a forfeit, never as a played score         |
| E threshold        | S ≥ 2                                                                      |                                                                          |
| Δgap               | RR 2, KO 1                                                                 | RR can afford to cancel; in KO the alternative is eliminating two triers |
| prompts            | ready, T-48 h, T-12 h, distinct days, push + email                         | stamps are the protocol record                                           |
| declare-or-concede | when the linked game's start time passes                                   | one prompt, always before the deadline; the ladder runs at the deadline  |
| Δcontest           | 48 h from declaration                                                      | closes early once the next game is played / the phase consumed           |
| restore window     | RR: until the phase is consumed; KO: until the advanced side's next result | organizer one-tap                                                        |
| `unresponsive`     | −15, decaying                                                              | only per the § 6 penalty rule                                            |
| no-show            | existing no-show weight                                                    | R3 check-in split only                                                   |
| forfeit event      | existing withdrew weight (−3)                                              | R1 and unilateral R3′                                                    |
| correction window  | 24 h after event completion                                                | organizer override only                                                  |

## 13. Amendments to existing specs

| Spec                                       | Amendment                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| autonomous-advancement § Resolution order  | Made total: R3 (linked game with no result at the deadline, check-in split, "deemed E"), R3′ (cancellation outcomes), mutual forfeit, and the single penalty rule replace the per-row wording. The spec was silent on a linked game that reaches the deadline without a result.                                                                                                                                |
| autonomous-advancement § Proportionality   | Generalized: the protocol gate protects every side in every penalizing outcome, not only the neither-side rows; the gap-rule loser is never penalized (it is E).                                                                                                                                                                                                                                               |
| scheduling-arbitration § Decision function | Reactivity cap: ignoring every pending event caps S at 1. Walkover from the gap rule carries no reputation event.                                                                                                                                                                                                                                                                                              |
| scheduling-arbitration § Forfeit on cancel | Requires the detach of the linked game from the pairing; mutual and weather cancels return to the ladder with both sides deemed E.                                                                                                                                                                                                                                                                             |
| round-deadlines § Step 0                   | **Grace and extension are removed**, not redefined: the machine grants itself no time at all (principle 7). Only the organizer moves a deadline, only before it expires. The declare-or-concede prompt moves to the linked game's start time so it still lands before the decision.                                                                                                                            |
| round-deadlines § Organizer surface        | Shipped 2026-08-25: the `tournament-deadlines` sheet on the tournament overflow menu, one row per phase. The machinery already existed and simply had no caller, which is why Jean reported that an organizer could not enter a deadline. `tournament_set_round_deadlines` now also refuses `DEADLINE_PASSED` and `DEADLINE_TOO_SOON`, so principle 7 and § 9 are enforced server-side, not only in the sheet. |
| poules-puis-éliminatoires § scoring        | A forfeit is a defeat with the format's forfeit score (8-0 / 6-0 6-0), in pools and in the draw alike, and it moves the loser's ratios like any defeat.                                                                                                                                                                                                                                                        |
| monetization § refunds                     | No automatic refund after the pools or the draw open; the zero-games refund is retired. Pre-draw removal, cancelled event and eviction keep their automatic paths. Shipped 2026-08-29: the resolver's disqualify-to-refund branch is removed (20260829150000); a zero-games double-walkover side keeps its registration and its entry releases to the organizer at completion.                                 |
| poules-puis-éliminatoires § 6              | "Réglée par l'organisateur : forfait contre le joueur fautif sinon partie annulée" becomes the R5 / R6 outcomes, decided by the machine, organizer optional.                                                                                                                                                                                                                                                   |
| score-entry § Organizer override flow      | `tournament_override_score` and the record-score sheet gain explicit outcome kinds (walkover to X, retirement, cancelled, forfeit) beside the score; standings and placement read the kind, never a fake score. Série 1 lesson: with a score as the only field, the organizer typed placeholder scores to advance rounds.                                                                                      |
| poules-puis-éliminatoires § 9              | "Si aucun des deux n'est fautif, le mieux classé au sortir des poules avance" is **not** adopted: seed preference violates determinism-without-discretion and pays the higher seed to stall. The bracket resolves on effort instead, with Δgap 1 in KO so any difference in S decides, and only a perfect tie leaves the slot to a bye.                                                                        |

## 14. Open decisions

Jean's rule of 2026-08-23 ("le forfait est une défaite avec les mêmes impacts
que toute autre défaite") is fully applied as of 2026-08-25 and nothing about
it is open any more. The two questions it left, the no-winner score and the
stalemate, were decided together on the fault line in § 5: both at fault means
two defeats, neither at fault means a cancellation, and Δgap drops to 1 in KO
so the machine rarely has to eliminate two sides that both tried. Which ledgers
the rule reaches is in § 5 as well: standings yes, rating never, Rallia Points
unchanged. Jean should be told these three, they are not questions for him.

1. **Forfeit event weight.** Parked on 2026-08-21 ("not for now"): declared forfeit and unilateral cancel reuse the
   withdrew weight (−3) above; whether a forfeit declared inside T-12 h should
   weigh more (it strands the opponent late) is a product call.
2. **Check-in as evidence** assumes players check in; if adoption is low the
   R3 split rarely fires and most linked games with no result fall to E/E. The
   check-in promotion from scheduling-arbitration (primary action from T-2 h on
   tournament games) is the lever.
3. **Reactivity cap** is a refinement of the approved decision function;
   confirm with Jean that a full grid plus silence on proposals should not
   count as engagement.
4. **Restore in RR** after the phase is consumed is organizer override only;
   whether a late pool result should still be allowed to re-seed an
   already-generated bracket (it cannot) or merely correct the record is
   settled here as "record only".
