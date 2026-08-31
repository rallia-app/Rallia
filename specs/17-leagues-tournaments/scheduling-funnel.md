# Scheduling funnel

> One funnel from "pools published" to "result declared", built so that the
> smoothest path for the player is also the chain of evidence the machine
> decides on: the pool room is the lobby, declaring availability for the phase
> is the acknowledgment and the key that opens it, the pairing room opens only
> when both sides have declared, the suggested overlaps are pre-agreed slots
> that either side books in one tap (a custom slot still takes two thumbs),
> the booking creates the linked game, and the declared score ends it. Whatever is left at the deadline is decided by
> [unplayed-match-resolution.md](./unplayed-match-resolution.md) on exactly
> these stamps.

Source: product direction of 2026-08-21 (merge availability disclosure with
the chat Match Organizer into one integrated scheduling experience, and make
players produce the chain of events arbitration relies on). Builds on
[scheduling-arbitration.md](./scheduling-arbitration.md) (phase availability
record, proposed slot, S) and
[08 match-organizer-live-suggestions](../08-communications/match-organizer-live-suggestions.md)
(the card, the options engine, the gate). Amendments at the end.

**Revised 2026-08-23 after Jean's review.** What changed here: the phase window
closes at the deadline and nothing is bookable past it, the gate collects hours
for the whole window rather than a week, "réserver" is reserved for the court,
and the extension is gone from the end-state table. Two of his constraints are
requirements on the build rather than on the logic: the pool room must live
inside the existing conversation module and be reachable in one step from the
tournament, and every heavy-consequence tap needs a confirmation naming the
consequence. He also confirmed the shelved suggestion engine as the right base
for the overlap card, which § 9 already assumes.

## 1. The idea in one line per layer

| Layer              | Player experience                                                                                                 | Evidence it produces                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Pool room          | "Here is your pool, your opponents, your deadline; give your hours to unlock it"                                  | awareness of the pairings (by the declaration below)        |
| Availability gate  | one screen: confirm or edit my hours for the whole phase window, from now to the deadline                         | **ack + timeliness + volume**, phase-scoped and snapshotted |
| Pairing room       | opens the moment both of us have answered; the app has already found our common slots                             | the pairing is live for both                                |
| Suggested overlaps | a short list of slots we are both free, each bookable in one tap, best one flagged                                | pre-agreed slots (both declared themselves free)            |
| Booking / thumbs   | one tap on a mutual slot creates the game (tentative 24 h for the other side); custom slots still take two thumbs | **reactivity**; agreement                                   |
| Custom slot / ping | propose my own time and place; nudge an opponent who has not answered                                             | initiative; still a scheduling action                       |
| Declared result    | we played, here is the score                                                                                      | conclusive; ends the pairing                                |
| Deadline           | nothing to do; the rules decide from the stamps above                                                             | see unplayed-match-resolution § 6                           |

The rule that makes it hold together: **nothing scheduling-relevant can happen
outside the funnel**. Chat text stays inadmissible; the only ways to move a
pairing forward are the gate, a booking, a thumb, a custom proposal, a
declared forfeit, and a declared result. That is what lets the machine read silence correctly.

## 2. Objects

| Object                        | Scope                                            | Created                                                             | Ends                                                   |
| ----------------------------- | ------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------ |
| **Pool room**                 | one per pool, members = pool members + organizer | at pools publish, in the same transaction as the pool rows          | read-only when the knockout is generated               |
| **Phase availability record** | one per (phase, player)                          | when the player answers the gate; upserted on edit                  | frozen when the phase is consumed                      |
| **Phase window**              | one per phase                                    | opens at publish, closes at the effective deadline                  | the deadline; nothing is collected or bookable past it |
| **Pairing room**              | one per pairing (as today)                       | when **both** sides have answered the gate                          | as today                                               |
| **Suggestion card**           | one system card per pairing room                 | with the room; regenerated on either side's edit                    | when a game is created or the pairing resolves         |
| **Vote (thumb)**              | per (card option, side)                          | on tap                                                              | with the card                                          |
| **Linked game**               | the casual `match` row                           | when one side books a mutual slot, or both sides thumb a custom one | on result, or cancellation (R3′)                       |
| **Declared result**           | on the pairing                                   | score-first entry, linked-game score, organizer                     | contest window, then final                             |

No pairing room exists before both answers. The pool room is the only place
a player sees an unanswered opponent, and what they see there is the
opponent's status, not a composer.

## 3. The funnel, stage by stage

| #       | Stage              | Trigger                                                   | What the player sees                                                                                                                                                                                                                                             | What the system does                                                                                                                                                                 | Stamps                                                                                                                   | Prompts                                                                                  |
| ------- | ------------------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| **S0**  | Published          | pools generated                                           | the pool room, **locked**: members, the phase deadline, "X of 4 have given their hours", one CTA                                                                                                                                                                 | creates pool rooms and rows; posts the welcome feed item (opponents, deadline, rule line: "donne tes dispos pour débloquer la poule")                                                | `pools_published` per player (protocol P1)                                                                               | push + email "Poules dévoilées", CTA = the gate                                          |
| **S1**  | Answered           | the player confirms or edits their hours for the window   | the room unlocks: board of the pool's pairings with status, feed, composer; their own pairings show "en attente des dispos de {name}" or "prêt"                                                                                                                  | snapshots the grid inside the window (`hours_in_window`, `grid_snapshot`, `responded_at`, outcome confirmed / edited / skipped); pool board updates for everyone                     | gate answer = **ack**, timeliness, volume                                                                                | +72 h after publish: one nudge to non-answerers; T-48 / T-12 still fire later            |
| **S2**  | Paired             | both sides of a pairing have answered                     | the pairing room appears with the suggestion card already in it: up to N mutual slots (time + venue), each bookable in one tap ("Créer la partie"), the top one flagged "Proposition de l'app", "Proposer un autre moment", "Je déclare forfait" in the overflow | runs the options engine on the **two snapshots** (admissible evidence), posts the card, posts a one-line feed item in the pool room ("A et B peuvent planifier, 3 créneaux communs") | `pairing_opened`; mutual options = pre-agreed slots; custom proposals = pending events                                   | push "Tu peux planifier contre {name}: 3 créneaux proposés" (deep link)                  |
| **S2′** | Paired, no overlap | both answered, engine finds nothing mutual                | the room opens with the card in its no-overlap state: "Aucun créneau commun. Propose un moment, ou ajuste tes dispos"; one-sided slots from each side's hours, labeled with their source                                                                         | same, flags `no_overlap`                                                                                                                                                             | `pairing_opened`, `no_overlap`                                                                                           | same push, different copy                                                                |
| **S3**  | Agreed             | one side books a mutual slot (or both thumb a custom one) | the game card replaces the suggestions: date, time, venue, "le plus proche réserve", check-in from T-2 h; tentative for 24 h while the other side answers "Ça marche" or "Proposer un autre moment"                                                              | creates the casual game, links it pre-play; pool board shows "planifiée jeu. 19 h"; reminders for this pairing stop                                                                  | `booked` (reactivity for the booker), `accepted` / `reproposed` / silence (reactivity for the other side), `game_linked` | booking push to the other side with the two answers; then game reminders as for any game |
| **S4**  | Played             | a result is declared by either side (or the organizer)    | the score on the pairing; pool standings update; feed item in the pool room ("A 8-5 B")                                                                                                                                                                          | result is final on entry, contest window opens; standings recompute                                                                                                                  | `result_declared`                                                                                                        | opponent: "Ce n'est pas le bon pointage? Conteste-le."                                   |
| **S5**  | Deadline           | effective deadline passes with no result                  | the justification on the pairing and in the feed                                                                                                                                                                                                                 | unplayed-match-resolution § 6 on the stamps above                                                                                                                                    | outcome + evidence snapshot                                                                                              | outcome notification                                                                     |

Side paths at any stage: **declare forfeit** (R1, always two taps away),
**edit my hours** (re-snapshots; cards regenerate; later edits never erase
earlier stamps), **custom proposal** (a votable option like any other),
**ping** (S1/S2: a declared player may send one system nudge to an opponent
who has not answered; rate-limited; it is an initiative stamp for the sender,
never evidence against the receiver).

## 4. The pool room

The pool room is a lobby with a feed, not a scheduling surface.

- **Board** (pinned, always current): one row per pairing of the pool with a
  status chip: waiting for hours ({names}), ready to schedule (k slots),
  scheduled ({date}), played ({score}), resolved (W/O, cancelled, forfeit). My
  own rows carry the CTA ("Planifier", "Entrer le pointage"). Standings below
  the board once a result exists.
- **Feed** (system posts only): published, "A and B can schedule", game
  scheduled, result, standings snapshot after each result, forfeit or
  withdrawal, deadline moved, pool settled with the qualifiers, outcomes of
  the deadline with their justification sentence.
- **Composer**: unlocked for members who answered the gate; organizer always.
  Pool chat is inadmissible for arbitration and says so once, in the welcome
  post.
- **Lock state** for a member who has not answered: the board and feed are
  visible (they need to know who and when), the composer and the pairing rooms
  are not. The CTA is the gate. This is the forcing function.
- **Event-wide room**: for pool tournaments it becomes announcement-style
  (organizer posts, players read) so a player carries 1 pool room + their
  pairing rooms, not a third open chat.
- **Privacy**: nobody sees anyone's grid; the board shows answered / not
  answered and the pairing room shows overlaps only.

## 5. The pairing room and the card

Same room and card as today, with four changes:

1. **Created on both answers**, not at publish. Until then the pairing has no
   room; the pool board is where its status lives.
2. **Suggestions come from the phase snapshots**, never from the live grid:
   the options are admissible evidence by construction. Either side editing
   their hours regenerates the card (bookings and thumbs survive per the
   existing pin rule; the app-proposal flag moves to the new top option if
   its slot vanished unbooked).
3. **Mutual slots are pre-agreed in principle and book in one tap.** Both
   sides declared themselves free for them, so the card does not ask for two
   thumbs: every mutual option carries both sides as "disponibles" and a
   single CTA, "Créer la partie", that either side may tap; the top one is
   flagged as the app's proposal. The tap creates and links the game on the
   spot (decision 2026-08-21: fewest steps to a created game). Custom and
   one-sided proposals keep the two-thumb rule, because only one side's
   hours back them.
4. **A fresh booking is tentative for 24 h.** The other side is notified
   ("{name} a créé la partie: jeudi 19 h au parc Jarry") with two answers: "Ça
   marche" or "Proposer un autre moment". Accepting, or saying nothing for 24
   h, makes the game an agreement (forfeit-on-cancel applies from then on);
   re-proposing inside the window cancels the tentative game with no penalty
   and posts the counter-slot as a custom option. One re-proposal per side per
   booking; after that the booking stands. This window is the other side's say
   on the time and the place, and the reason a one-tap creation is not one
   player deciding for two.

**Copy rule: "réserver" means the court, never the app.** In the app you
_create a game_ ("Créer la partie"); you _reserve a court_ with the facility,
which Rallia does not do for you and which the game card asks the nearer
player to handle ("le plus proche réserve"). Jean read "réservation" as the
court and rightly asked why we would book one before the opponent agreed. No
user-facing string may use "réserver" for the in-app action.

Card states: bookable (k ≥ 1 mutual slots) · no overlap (custom floor +
one-sided, labeled slots) · tentative (game card, awaiting the other side's
"ça marche" or 24 h) · agreed (game card) · resolved (outcome +
justification).

## 6. How the funnel feeds the decision

The states of unplayed-match-resolution § 4 map onto funnel stamps, and
nothing else:

| Evidence              | Source in the funnel                                                                                                                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ack** (awareness)   | the gate answer (confirmed, edited, or skipped). The separate "Je suis là" chip is not needed here: answering the gate is the acknowledgment.                                                                           |
| **Timeliness** (0..2) | `responded_at` relative to publish (≤ 48 h → 2; before the submission cutoff → 1; skipped → 1; never → 0)                                                                                                               |
| **Volume** (0..2)     | `hours_in_window` against the phase minimum (≥ min → 2; 1..min-1 → 1; 0 or skipped → 0)                                                                                                                                 |
| **Reactivity** (0..2) | thumbs and custom proposals against the pending events on the card (all answered within 24 h and ≥ 1 action → 2; acted, some slow → 1; never → 0); **cap**: at least one pending event and no answer at all caps S at 1 |
| **Conclusive**        | game linked (S3), check-in, declared result (S4), declared forfeit, cancellation of the linked game                                                                                                                     |
| **Protocol**          | P1 = pools published (+ gate), P2 = T-48 h, P3 = T-12 h; the +72 h gate nudge is extra, not required                                                                                                                    |

Booking a mutual slot is the strongest reactivity signal for the booker;
answering the booking ("ça marche" or a counter-slot) within 24 h is the
other side's. Silence on a booking is still acceptance for the game (the slot
was declared free), but it is an unanswered pending event for S, and a side
that never explicitly accepted and then fails to show takes the lighter
**unresponsive** event at R3, not the no-show one.

"Who moves forward when they could not find a time" is therefore not volume
alone: it is S, where volume is one of three equal signals and the reactivity
cap makes ignoring proposals fatal to engagement. A side that paints its whole
week green and never thumbs anything is P, not E. If the product wants volume
to dominate, raise its weight rather than dropping the others; recorded as an
open decision below.

### End states of a pairing at the deadline, in funnel terms

No game linked, no result, protocol complete. RR = round robin, KO = knockout.

| Who answered the gate | Overlaps | Thumbs / proposals                                                 | States                                   | RR                                                         | KO                                        | Penalty                                          |
| --------------------- | -------- | ------------------------------------------------------------------ | ---------------------------------------- | ---------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------ |
| neither               | n/a      | none possible                                                      | U/U                                      | double forfeit (8-0 both)                                  | double forfeit, bye advances              | none                                             |
| A only                | n/a      | none possible (no room)                                            | E/U                                      | walkover A                                                 | walkover A                                | none on B (knowledge unproven)                   |
| both (A skipped)      | none     | none                                                               | E/P                                      | walkover B                                                 | walkover B                                | A (acked, did nothing), if S_A ≤ 1               |
| both                  | k ≥ 1    | one side booked a mutual slot; the other accepted or stayed silent | linked game (tentative, then agreed): R3 |                                                            |                                           |                                                  |
| both                  | k ≥ 1    | nobody booked or proposed anything                                 | P/P                                      | double forfeit (8-0 both)                                  | double forfeit, bye advances              | both                                             |
| both                  | k ≥ 1    | A booked; B re-proposed inside 24 h; A never answered the counter  | E/P                                      | walkover B                                                 | walkover B                                | A (reactivity cap: ignored the counter-proposal) |
| both                  | none     | nobody proposed                                                    | E/E (if S ≥ 2 from timeliness + volume)  | gap rule Δ2 (volume and timeliness decide), else cancelled | gap rule Δ1, else cancelled, bye advances | none                                             |
| both                  | none     | A proposed a custom slot, B ignored                                | E/P                                      | walkover A                                                 | walkover A                                | B (reactivity cap)                               |
| both                  | any      | both proposed custom slots, neither accepted the other's           | E/E                                      | gap rule Δ2 on S, else cancelled                           | gap rule Δ1, else cancelled, bye advances | none                                             |

The matrix shows why the gate-before-room design pays off: the first two rows,
the ones that were 40 % of Série 1 and unreadable (17 of those 28 had
played, 11 were force-advanced with a generic score, and nothing in the
record separated them), now carry a clean signal
(one side answered, the other did not), and every later row has at least one
stamped action per side to reason from.

## 7. Knockout variant

Same funnel, same gate, same rule for the room. The only difference is where
the lobby lives, because a knockout has no pool.

- Round determinate (both feeders resolved, or a bye) → pairing-ready push +
  email with the gate CTA for **this round**. Every round asks again: the
  previous round's answer is inadmissible (stale evidence), and confirming the
  same grid is one tap. This applies from **round 1** of the knockout and to
  single-elimination draws.
- **No pairing room until both sides have answered**, exactly as in pools.
  Until then the pairing lives on the match sheet and the "Mon prochain match"
  card of the tournament overview: opponent, round deadline, "en attente de
  tes dispos" / "en attente des dispos de {name}", the gate CTA, the ping, and
  declare-forfeit in the overflow. The event-wide room carries the feed
  (bracket published, results, next pairings, outcomes).
- On the second answer the pairing room is created with the suggestion card
  already in it (engine on the two round snapshots, top mutual option flagged),
  and both sides get "Tu peux planifier contre {name}: k créneaux proposés".
- Everything else identical: thumbs, custom floor, forfeit, declared result,
  R0..R6 at the round deadline, the end-state table of § 6 read with KO
  outcomes.

A bye slot never gates anyone: the player simply waits for the next
determinate pairing, which then asks for that round's hours.

## 8. Edge cases

| Case                                    | Rule                                                                                                                                                                                                                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A player never answers                  | never unlocks; no pairing rooms; opponents who answered win by walkover at the deadline (E/U) with the forfeit score, and pairings between two silent players are double forfeits (8-0 both); no reputation event (knowledge unproven); **no refund**, the phase had opened (unplayed-match-resolution § 10) |
| A player skips the gate (no hours)      | counts as answered (ack) with timeliness 1, volume 0; rooms open; suggestions come from the opponent's hours, labeled; they are P until they thumb or propose                                                                                                                                                |
| A player edits hours after cards exist  | new snapshot, `responded_at` refreshed, cards regenerate; timeliness is scored on the **first** answer, volume on the **latest**                                                                                                                                                                             |
| Pool of 3                               | same; the phantom pairing has no room; the board shows 3 rows                                                                                                                                                                                                                                                |
| Doubles                                 | the side is the team; either member's answer unlocks the team, the team's hours are the union, either member's thumb is the team's vote                                                                                                                                                                      |
| Organizer moves the phase deadline      | only while it is still ahead, and it is the only thing that can move it; the window changes; hours already declared outside the new window are dropped from volume; the gate reopens for the added days; the pool room gets a feed item; T-48 / T-12 re-evaluate                                             |
| A slot would fall past the deadline     | not offered and not bookable: the engine clamps mutual options and custom proposals to the effective deadline, and the card explains why while offering forfeit instead. Nothing can therefore be pending at the deadline (unplayed-match-resolution, principle 7)                                           |
| Organizer                               | member of every pool room (posts are theirs, not system's), never a party to a pairing room unless playing                                                                                                                                                                                                   |
| Availability minimum                    | `min_availability_hours` (organizer-set, default 6) feeds volume only; the gate shows it ("Indique au moins 6 h de disponibilité") and never blocks                                                                                                                                                          |
| A booking the other side never answered | after 24 h the game stands (silence on a slot they declared free is acceptance); if that side then does not show, R3 records unresponsive rather than no-show, because they never explicitly accepted; an explicit "ça marche" or an earlier check-in makes it a no-show                                     |
| Long phases                             | one declaration per phase; for phases longer than 14 days, a weekly "tes dispos tiennent toujours?" confirm nudge to players with unplayed pairings (1 tap)                                                                                                                                                  |

## 9. What this changes in the existing build

- Pairing rooms and cards stop being created at publish (pools) and at
  pairing-ready (knockout rounds); they wait for two gate answers. Both
  auto-post hooks (the publish trigger and `lt_notify_tournament_match_ready`)
  move to the second gate answer; the ready push keeps firing at determinate,
  with the gate as its CTA. The match sheet gains the gate state.
- The gate ships phase-scoped and snapshotted (`tournament_phase_availability`
  from scheduling-arbitration) and becomes the ack.
- The options engine reads the snapshots, not `player_availability`.
- New: pool rooms (group conversation keyed by tournament + pool), the board,
  the feed poster, the lock state, the ping.
- Mutual options render with both sides pre-marked "disponibles" and a one-tap "Créer la partie" (the existing `create_casual_match` + `tournament_attach_match_pre_play` path, called by one side); the game card gains a tentative state with "Ça marche" / "Proposer un autre moment" for 24 h. Custom options keep thumbs; the top mutual option carries the proposal flag.
- The event-wide tournament room becomes announcement-style for pool
  tournaments.

## 10. Amendments to existing specs

| Spec                                               | Amendment                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| autonomous-advancement § The acknowledgement       | The ack is the gate answer. The presence chip is not built; "any other in-phase action implies acknowledgement" stands.                                                                                                                                                                                                                                                            |
| scheduling-arbitration § Phase availability record | Collection is the key to the room, not a side prompt; submission cutoff unchanged (phase start + 72 h or the deadline); skip = ack with volume 0                                                                                                                                                                                                                                   |
| scheduling-arbitration § The proposed slot         | No one-sided proposal before both have answered (the room does not exist). After both answered, mutual options are pre-agreed in principle (both declared themselves free) and book in one tap, which replaces "never auto-voted"; Jean's non-finality survives as the 24 h tentative window with one free counter-proposal. One-sided labeled slots only in the no-overlap state. |
| 08 live-suggestions § Auto-post                    | The system card posts on the second gate answer, not at publish; the engine runs on snapshots                                                                                                                                                                                                                                                                                      |
| unplayed-match-resolution § 4.2 / § 4.3            | Ack := gate answer; the reactivity cap is load-bearing here (see § 6)                                                                                                                                                                                                                                                                                                              |
| poules-puis-éliminatoires § 12                     | "Partie de poule prête à organiser" fires when both sides have answered, with the slot count                                                                                                                                                                                                                                                                                       |

## 11. Build status (2026-08-31)

The funnel is built end to end and the resolver is live, but only where the
funnel is on: `tournaments.scheduling_funnel_enabled` still defaults false, and
the ladder refuses to act on an event without it, because such an event has no
gate answers and every side would score U. No live event runs the funnel yet.

| Piece                                                         | State                                    |
| ------------------------------------------------------------- | ---------------------------------------- |
| Phase availability gate (RPC + snapshot)                      | Shipped, 20260826200000                  |
| Pairing rooms wait for both gate answers                      | Shipped, 20260826210000                  |
| Pool room, membership, composer lock                          | Shipped, 20260826230000                  |
| Gate sheet, docked CTA, reopen to adjust                      | Shipped, mobile                          |
| Pool room UI: board, locked composer, welcome, inbox naming   | Shipped, mobile + 20260829170000         |
| Options come from the phase snapshots                         | Shipped, 20260829180000                  |
| One-tap booking of a mutual slot, tentative 24 h, "ça marche" | Shipped server-side, 20260829190000      |
| Card UI: one tap, tentative band, counter-offer               | Shipped, mobile                          |
| "Proposer un autre moment" (one per side per pairing)         | Shipped, 20260829210000                  |
| Two-tap forfeit, the nudge                                    | Shipped, 20260829230000                  |
| Evidence model: S, E/P/U, the reactivity cap                  | Shipped, 20260831120000                  |
| Ladder R0..R6 on it; resolver LIVE, funnel events only        | Shipped, 20260831130000 / 20260831140000 |
| One-way score registration (§ 3, S4)                          | Not built: still mutual confirm/rebuttal |
| Restore a late result over an automated decision (§ 9)        | Not built: organizer override only       |
| Pool evening card                                             | Roadmap (decision 6)                     |

## 11. Decisions

Settled by Mathis on 2026-08-21 unless marked otherwise.

1. **Lock: strict.** No pairing room until both sides have answered the gate;
   the ping is the release valve.
2. **What the lock hides: composer and pairing rooms only.** The pool board
   and the feed stay visible to a member who has not answered.
3. **Weights: equal thirds** (timeliness, volume, reactivity) with the
   reactivity cap; Δgap stays 2.
4. **Tentative window: 24 h, silence = acceptance.** A side that never
   explicitly accepted and then fails to show takes `unresponsive`, not
   no-show.
5. **Ping** (default, not debated): one per opponent per 48 h, push only;
   counts as initiative for the sender, nothing for the receiver.
6. **Pool evening card: yes, later.** When the engine finds a slot where 3 or
   4 pool members overlap, propose one evening for two games in the pool
   room; thumbs from all four create two linked games. Roadmap, not v1.
7. **Leagues** (default, not debated): same funnel per session once the
   pool-room role is played by the league room.
