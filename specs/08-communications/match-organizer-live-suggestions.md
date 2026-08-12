# Match Organizer: live suggestions

> Auto-posted, self-healing time/place suggestions in pairing chats. Extends the
> chat Match Organizer so the card arrives unprompted, stays current, and gives
> the player a one-tap way to say "those times are wrong" and get better ones.

## Problem

The Match Organizer already computes good options and nobody uses it.

Measured on prod 2026-08-07 against the 11 stalled playable matches in the five
live Série 1 draws:

| Signal                                                | Value                      |
| ----------------------------------------------------- | -------------------------- |
| Stalled matches with a linked game                    | 0 of 11                    |
| Organizer cards ever posted in those chats            | **0 of 11**                |
| Pairs where the engine returns options                | 11 of 11 (10 options each) |
| Pairs where every returned option is mutually free    | 9 of 11                    |
| Pairs with zero mutual availability overlap           | 1 of 11                    |
| Mutually-free day-hours per pair (excluding that one) | 9 to 64                    |
| Longest stalled thread                                | 31 messages, still no game |

The engine is not the gap. Two players exchanged 31 messages with ten valid
court-confirmed options one tap away and never found the feature, because
`postMatchOrganizerCard` has exactly one call site: a sheet a human has to open.

The one genuinely uncertain input is whether `player_availability` (self-reported
recurring day-hours) still reflects reality. This spec makes that uncertainty
cheap to correct instead of fatal.

## Scope

1. **Auto-post** the card into a pairing chat the moment the pairing becomes real.
2. **Escape hatch** on the card: "Not available at these times anymore?", which
   edits availability and regenerates the options.
3. **Refresh**: an explicit action, an availability-change trigger, and an
   ambient staleness-gated refresh when a participant opens the chat.

Applies to tournament round chats (`conversation.tournament_match_id`) and league
pairing chats (`conversation.session_match_id`). The card itself stays generic, so
casual chats inherit items 2 and 3 for free.

## Blocking prerequisite: votes are positional

`match_time_vote` is `(message_id, player_id, option_index)`. Votes index into the
options array snapshotted in `message.metadata`. Nothing in this spec can ship
until that changes, because **regenerating options in place silently re-points
every existing vote at a different slot.**

Failure case:

1. Player A votes option 3 (Tue 19:00, Jarry).
2. A refresh reorders the array. Option 3 is now Thu 09:00, Somerled.
3. A's vote now reads as agreement to Thu 09:00.
4. Player B votes option 3, mutual agreement fires, and a game is created at a
   time A never agreed to.

There is a second, related trap: `postMatchOrganizerCard` today pre-votes the
poster on **every** option. After a regeneration that pre-vote becomes blanket
agreement to a set of times the poster never saw.

### Required change

Give each option a stable identity and key votes on it:

```
option_key = md5(slot_start::text || '|' || coalesce(facility_id::text, 'none'))
```

- Add `option_key text` to `match_time_vote`, backfill from `option_index`
  against each card's current snapshot, keep `option_index` readable for one
  release, then drop it.
- Store `option_key` on each option inside the metadata snapshot.

### Re-anchoring rule on regeneration

| Case                                   | Behavior                                                              |
| -------------------------------------- | --------------------------------------------------------------------- |
| Option survives (same `option_key`)    | Keeps its votes                                                       |
| Option disappears **and has no votes** | Dropped                                                               |
| Option disappears **and has votes**    | **Pinned into the new snapshot**, flagged `stale: true` with a reason |
| New option                             | Appended, no votes                                                    |

The invariant: **a voted option is never silently removed.** If someone else
booked the court under a voted slot, the player sees "no longer available" on the
option they chose rather than watching their agreement vanish.

### Also required

Expose `free_count` from `match_organizer_options`. It is already computed in the
`avail` CTE and simply not returned, which is why the card currently cannot tell
"both of you are free" from "only you are free". See
[zero-overlap](#zero-overlap-variant), where this matters most.

## Auto-post

### Trigger points

Both already fire at the exact moment a pairing becomes determinate, and both
already hold the ids needed:

| Surface           | Hook                               |
| ----------------- | ---------------------------------- |
| Bracket round 1   | `tournament_bracket_published`     |
| Bracket rounds 2+ | `lt_notify_tournament_match_ready` |
| League pairing    | session-sheet twin of the above    |

Sequence:

1. `lt_get_or_create_tournament_round_chat` (idempotent, also covers the three
   stalled pairs that never had a chat at all).
2. `match_organizer_options(array[p1, p2], sport_id, 14, 10)`.
3. If no mutually-free option exists, post the
   [zero-overlap variant](#zero-overlap-variant) instead.
4. Insert the card message.

### Server-side poster

`postMatchOrganizerCard` is client TypeScript. Auto-posting needs a plpgsql
equivalent writing the same `match_organizer` metadata shape. Keep one canonical
serializer so the two paths cannot drift.

### Sender attribution

An auto-posted card has no human organizer. Do not attribute it to the tournament
organizer, and do not pre-vote anyone.

- `organizer_id: null`
- new metadata field `posted_by: 'system' | 'player'`
- zero rows in `match_time_vote` at post time

Pre-voting only makes sense for the existing player-initiated path, where the
poster's selection genuinely is their thumbs-up.

### Idempotency

One auto-posted card per pairing chat, enforced by a partial unique index on
`(conversation_id)` where `metadata->>'kind' = 'match_organizer'` and
`metadata->>'posted_by' = 'system'`. A player can still post their own cards.

## Availability escape hatch

Rendered on every card with at least one option.

**Copy intent** (final strings go in `packages/shared-translations`):

| Locale | String                                |
| ------ | ------------------------------------- |
| en-US  | Not available at these times anymore? |
| fr-CA  | Plus disponible à ces heures ?        |

Flow:

1. Opens a sheet wrapping `HourlyAvailabilityGrid`, the same drag-to-paint grid
   used in onboarding, the weekly check-in `AvailabilityStep`, and the profile
   availability overlay.
2. **Prefill** with the player's current availability, and visually mark the
   day-hours that appear in the card's options, so they can uncheck exactly the
   ones that are wrong instead of re-painting a whole week.
3. On save: regenerate, re-anchor votes, update the card in place.
4. Post a system line in the thread: "Alex updated their availability. New times
   below." A silent swap reads as a bug.
5. Push the opponent **only if they had already voted**, because their agreement
   may have moved.

### Opponent overlay on the grid

When the grid is opened **from a pairing context** (round-chat card CTA, the
escape hatch, or the availability gate), it also renders the opponent's current
free hours. The grid stops being a blind form and becomes the negotiation
surface: the player paints their week while seeing exactly where overlap forms.

- **No new disclosure.** `player_availability` is SELECT-open to authenticated
  users and PlayerProfile already renders other players' grids. The overlay is a
  new juxtaposition of already-visible data, scoped here to pairing contexts
  anyway.
- **Cell states**: mine / theirs / **both** / neither. "Both" is the payoff and
  gets the strongest treatment (accent fill), theirs-only renders as a light
  outline or hatch with a legend line ("Hours where Marc is free"). Implemented
  as an optional `overlay: HourGrid` + label prop on `HourlyAvailabilityGrid`;
  no behavior change for existing callers (onboarding, weekly check-in,
  profile), which never pass it.
- **Doubles**: overlay marks hours where **all other** entry participants are
  free (the intersection), consistent with `free_count` semantics.
- **Entry point**: the card holds `participant_ids`, so it opens the sheet
  directly with the opponent resolved (opponent = participants minus viewer)
  and persists through the same save path UserProfile's edit flow uses
  (diff upsert + `last_confirmed_at` stamp). The interim v1 CTA that navigates
  to UserProfile (no overlay, no pairing context) is superseded by this.
- **Gaming note**: seeing the opponent's grid also lets a bad actor paint
  deliberately disjoint hours to manufacture "no overlap". Availability edits
  are already only weak effort in the arbitration ladder, and the audit
  snapshot captures grids at resolution time, so painting-around is visible to
  an organizer adjudicating a dispute. No further mitigation in v1.

The zero-overlap card composes with this: its CTA opens the overlay grid, so
the thin-availability player lands facing the opponent's rich week and the fix
is self-evident. The [availability gate](#availability-gate-soft-forced-entry)
uses the same overlay when it offers "No, let me update".

### Required disclosure

`player_availability` is player-wide, not per-tournament (availability stays
player-wide even though check-in streaks and goals are sport-scoped). Editing from
inside a round chat changes the player's availability across the whole app,
including casual matchmaking and auto-match. The sheet must say so plainly. Without
that line, players will quietly degrade their own matchmaking to dodge one round.

## Availability gate (soft-forced entry)

The first time a player opens a pairing chat for a round, they are asked to
confirm their availability **for that round's window** before the composer
unlocks. This is the deliberate funnel into the card: instead of hoping players
find the organizer, the round starts with a question only they can answer.

### What it asks

Not "is your availability accurate?" in the abstract. That gets a reflexive yes and
teaches us nothing. It shows their declared hours inside the round window,
concretely:

> Before Aug 14 you're free Tue 19:00 to 21:00, Wed 18:00 to 20:00, Sat 09:00 to
> 12:00. Still good?

Three answers:

| Answer                      | Effect                                                                  |
| --------------------------- | ----------------------------------------------------------------------- |
| **Yes, that's right**       | Stamps a confirmation, unlocks the composer, scrolls to the card        |
| **No, let me update**       | Opens the prefilled hour grid, saves, regenerates options, then unlocks |
| **I can't play this round** | Routes to forfeit (see below)                                           |

### Hard rules

- **Never block reading the thread.** Only the composer is gated. A player opening
  the chat to read "I'm injured, I have to forfeit" must not hit a scheduling quiz
  first, and hiding an already-sent message behind a gate is how you manufacture
  unresponsiveness.
- **Always offer a way past.** A visible "Skip for now" unlocks the composer with
  no edit. Hidden or buried, it stops being a soft force and becomes a wall.
- **Ask once per player per round.** Re-ask only if the round deadline moves, or
  once more as a reminder if the round is near its deadline and the player never
  answered.
- **A confirmation is weaker evidence than an edit.** Anyone can tap yes to reach
  the composer. Weight the two differently everywhere downstream.

### The forfeit exit

"I can't play this round" is the highest-value answer on the gate and the cheapest
resolution available. A player who knows they cannot play currently has no way to
say so, so they go quiet and the bracket stalls until an organizer intervenes.
Surfacing forfeit here converts a would-be stall into a resolved match on day one
and advances the opponent immediately.

This depends on the player-declared forfeit action, which does not exist yet
(`W/O` and `DEF` are reserved in the canonical score format but nothing writes
them).

### Window comes from the round deadline

The gate asks about "the days you have left to play this round", so it needs a
round deadline to exist. This also fixes a related mismatch: the engine defaults to
a 14-day window, so without clamping it will propose times **after** the round is
due. When a deadline exists, pass `p_window_days = days until deadline`.

Consequence: per-round deadlines move from "should ship alongside" to a hard
prerequisite for the gate. The auto-posted card and the refresh mechanics do not
need them; the gate does.

### Freshness as a first-class signal

Every answer timestamps how current a player's availability is. Add
`availability_confirmed_at` to `player`, set on both confirm and edit.

This is the largest win in the whole spec and it reaches well beyond tournaments.
Today `player_availability` carries no notion of age, so a grid painted during
onboarding eight months ago and never touched is treated as equal evidence to one
confirmed this morning. With a freshness stamp, auto-match, the suggestion RPCs,
and `/find-a-match` can all weight or decay stale availability instead of trusting
it flatly.

### Recording the outcome

One row per (player, pairing) capturing `confirmed | edited | skipped | forfeited`
plus a timestamp. Needed to avoid re-asking, to measure the gate, and as an input
to automated round resolution.

That last use is the important one: a player who **asserted** they were free and
then never voted on a single option is a much clearer signal for auto-forfeit
arbitration than a player who was simply never seen. Confirming availability and
then not using it is a choice.

### Rollout

Ship behind an experiment flag with the gate off for a control slice, and read
three numbers: confirm rate, edit rate, skip rate, then game-created rate against
control. If skip rate is high and the game-created rate matches control, the gate
is theater and should be removed rather than tuned.

## Refresh

Three triggers with very different cost profiles.

| Trigger                          | Frequency                | Behavior                                |
| -------------------------------- | ------------------------ | --------------------------------------- |
| Explicit "Refresh times" tap     | user-initiated           | Synchronous regenerate                  |
| Either player edits availability | rare                     | Synchronous regenerate + system line    |
| A participant opens the chat     | every open, both players | Staleness-gated, stale-while-revalidate |

### On the chat-entry trigger

Refreshing on every chat open, as literally specified, should not be built.
`match_organizer_options` is a multi-CTE scan over `facility` joined to
`facility_availability_snapshot` with `ST_Distance` and a `generate_series` over
the window. Running it synchronously on every chat open, for every participant, is
the same shape as the load patterns that have already saturated prod.

Reuse the pattern that already exists for court snapshots, which solved exactly
this problem: `snapshot_acceptable_age()` returns 3, 5, or 10 minutes depending on
how close the slot is, and `snapshot_request_refresh` is a client-callable async
bridge.

Rule:

- On chat open, **render the existing snapshot immediately**. Never block the chat
  on the engine.
- If `options_generated_at` is older than **10 minutes**, fire an async
  regeneration and update the card in place when it lands.
- **Force** a regeneration regardless of age when any option's `slot_start` is now
  in the past. That is the one change that makes a card actively wrong rather than
  merely stale.
- Take an advisory lock on `conversation_id` so two players opening at once
  produce one regeneration, not two.
- Never regenerate a card in a terminal state (`created_match_id` or
  `confirmed_option_index` set).
- Never notify on an ambient refresh. Silent in-place update only. Eleven chats
  times two players times every open would otherwise be a notification firehose.

## Graceful degradation floor

Decided 2026-08-12, after Jean's pool_knockout test pass. Two decisions, together:

1. **The card is the only path from a pairing to a created game.** Games are
   **not** pre-created when a pairing becomes known. A game row appears only once
   the important facts (when, where) are known, which keeps "a game exists" a
   meaningful signal, and keeps the card the place where engagement is observable
   for [deadline arbitration](../17-leagues-tournaments/README.md) (`lt_side_effort`
   reads votes, cards and messages off the pairing chat).
2. **Therefore the card must never dead-end.** Forcing every pairing through one
   funnel is only safe if that funnel always terminates in a game. It did not:
   the three states below all left players with an availability edit as their
   only move.

| State                                              | Before                            |
| -------------------------------------------------- | --------------------------------- |
| Zero mutual availability overlap                   | `options: []` + "update my hours" |
| No favourited or in-range facility for the sport   | Empty card, even with overlap     |
| The pair wants a place the app does not know about | No way to express it              |

### The floor: a participant-proposed option

`match_organizer_add_custom_option(p_message_id, p_slot_start, p_facility_id, p_place_name)`
appends an option with `tier: 'custom'` to the card. A facility, a free-text
place, or neither (place genuinely TBD) are all valid. From there nothing is
special-cased: it is a normal votable option feeding mutual agreement,
`create_casual_match`, the pre-play bracket link, and effort detection.

Rules that make it safe:

- **Proposing is agreeing.** The proposer is voted onto their own slot, the same
  rationale as the player-posted card's pre-vote (and unlike a regenerated card,
  where a blanket pre-vote would be agreement to times nobody saw).
- **`free_count` stays NULL.** The engine never vetted the slot, so the card must
  not render "you are both free". The badge is suppressed and replaced by
  "Suggested by {name}".
- **Identity is the engine's formula**, `md5(epoch(slot_start) | facility|place)`,
  so proposing a slot the engine already offered dedupes onto that option and
  just records the vote instead of listing it twice. The opponent proposing the
  same slot is therefore itself a path to mutual agreement.
- **A free-text place reaches the game.** `create_casual_match` gained
  `p_location_name`; with no facility the game lands `location_type = 'custom'`
  with the name, rather than a bare `tbd`.
- **The proposal notifies.** Unlike an ambient refresh, a human proposing a time
  is exactly when the opponent should hear about it, so the system note is
  deliberately not silent.

### Regeneration must pin custom options

The engine cannot reproduce a hand-proposed option, so the
[re-anchoring rule](#re-anchoring-rule-on-regeneration) needed a fourth row:
**a custom option is always pinned, voted or not, and is never flagged `stale`**
(`stale` means a real engine option vanished, which is a different thing to tell
a player). Without this, an ambient staleness refresh silently deletes the one
option a zero-overlap pair actually agreed on. Regression cover:
`supabase/tests/match_organizer_custom_option_test.sql`, verified to fail against
the pre-fix body.

### Still open

- **No facility picker in the sheet yet.** v1 is date, time, and free text; the
  RPC already takes a `facility_id` for when one is added. A typed place name
  therefore does not benefit from court/price data or the facility's timezone
  (the slot resolves against `America/Toronto`).
- **Mutual agreement is still enforced client-side only.** `create_casual_match`
  never reads `match_time_vote`, so any conversation participant can call it with
  any slot. Tolerable while the worst case is an unwanted casual game; worth a
  server-side check that the caller has a vote on the confirmed option.
- **Doubles** shows the proposer, not an availability claim, which is correct but
  means a 4-player entry gets no signal about the other three.

## Zero-overlap variant

When no option has `free_count = n`:

- Do **not** fall back to showing options only one player can make. The engine's
  `source_a` branch joins availability on `free_count >= 1` and scores
  `court_confirmed` at +1000, so it will happily return ten bookable slots the
  opponent can never play. Auto-posting those is worse than posting nothing.
- Nuance found while testing (2026-08-09): the final `row_number() OVER
(PARTITION BY facility_id, slot_date ORDER BY score DESC)` keeps only the best
  option per facility per day, and a mutual option always outscores a one-sided
  one at the same facility and day (+200 for all-free). So one-sided options
  surface _only_ where that facility/day has no mutual alternative. The
  dangerous case is therefore not a mixed card but the all-one-sided pair, which
  this guard catches outright. The per-option label still earns its place for
  mixed cards, it is just rarer than first assumed.
- Render "No shared times found yet" plus the availability CTA for both players.
- Requires `free_count` in the engine's return (see
  [prerequisite](#also-required)).

One of the eleven stalled pairs is in exactly this state today: Série 1 Montréal
Intermédiaire position 1, zero mutual overlap, one side with 5 availability hours
declared. It is the only pair in the set where "players cannot match their
availability" is literally true.

## Notifications

| Event                          | Notification                                           |
| ------------------------------ | ------------------------------------------------------ |
| Auto-posted card               | Existing chat / `new_message` path. Do not add a type. |
| Availability-driven regenerate | Opponent only, and only if they had votes              |
| Ambient staleness refresh      | None                                                   |

Body for the auto-post, sport-neutral and no em dashes per copy rules: "3 times to
play vs Alex. Tap to pick one."

## Analytics

| Event                           | Properties                                                |
| ------------------------------- | --------------------------------------------------------- |
| `organizer_card_auto_posted`    | context (tournament / league), round                      |
| `organizer_options_generated`   | n_options, n_both_free, trigger cause, generation_ms      |
| `organizer_option_voted`        | option_key, is_both_free                                  |
| `organizer_availability_edited` | cells_added, cells_removed, options_before, options_after |
| `organizer_card_refreshed`      | cause (explicit / availability / staleness / past-slot)   |
| `organizer_match_created`       | time from card post to game created                       |

Primary success metric: pairing chat to game created to verified result. Secondary:
median time from round-ready to game created, per round. Feeds the existing
`match_filled` funnel semantics rather than a new definition of success.

## Open decisions

1. **Deadline interaction.** A card that refreshes forever with no deadline is a
   treadmill. This should ship alongside per-round deadlines, or the same eleven
   matches will simply stall with fresher options. The
   [availability gate](#availability-gate-soft-forced-entry) requires them
   outright, since it asks about the round window.
2. **Does an auto-posted card count as "effort" for auto-forfeit arbitration?**
   Recommendation: no. Only a _vote_ counts. Otherwise both players get credit for
   the system doing the work, and the responsiveness signal that drives automated
   round resolution becomes meaningless.
3. **Removing a voted option that genuinely vanished.** This spec pins and flags
   it. The alternative is remove-and-notify. Pinning is safer but leaves dead
   options on screen; revisit after the first real tournament.

## Build order

1. `free_count` in the engine return, `option_key` identity, vote re-anchoring
   migration, remove blanket pre-vote on regeneration
2. Server-side card poster (plpgsql, shared serializer)
3. Auto-post hook on pairing-ready, plus chat auto-create
4. Availability-change regenerate trigger + opponent overlay on the grid + the
   pairing-context escape hatch (this is the slice that makes the zero-overlap
   CTA loop back: edit with the opponent's hours visible, save, options appear)
5. Explicit refresh action, then staleness-gated ambient refresh with advisory lock
6. `availability_confirmed_at`, per-round deadlines, window clamping
7. Player-declared forfeit action
8. The availability gate, behind an experiment flag (needs 4, 6, and 7)

Steps 1 and 2 are prerequisites with no user-visible change. Step 3 alone would
have put ten valid options in front of all eleven stalled pairs. The gate lands
last because it depends on three things that do not exist yet, and it is the only
part of this spec that can make the experience worse if it is wrong.

## Dependencies

| System                                                          | Relationship                                      |
| --------------------------------------------------------------- | ------------------------------------------------- |
| [chat.md](./chat.md)                                            | Card lives in the message stream                  |
| [17 Leagues & Tournaments](../17-leagues-tournaments/README.md) | Pairing-chat trigger points                       |
| [11 Courts](../11-courts/README.md)                             | `facility_availability_snapshot`, staleness bands |
| [03 Settings](../03-settings/README.md)                         | `player_availability` is player-wide              |
