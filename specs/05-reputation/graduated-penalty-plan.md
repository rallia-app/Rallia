# Plan: Graduated, Context-Sensitive Cancellation Penalties

## Context

Currently, the reputation penalty for late cancellations/leaves is binary (0 or -25), role-blind (creator = participant), and context-blind (no court, private game = same penalty). This overhaul makes penalties:

- **Graduated** by timing (closer to match = harsher)
- **Role-aware** (creator ~1.5x participant)
- **Context-sensitive** (no penalty without a reserved court)
- **History-aware** (first offense gets leniency, repeat offenders get escalation)
- **Distinct from no-show** (last-minute cancel capped below no-show severity)

---

## Penalty Scale (public match, court reserved, normal history)

| Hours before match | Creator (`match_cancelled_late`) | Participant (`match_left_late`) |
| ------------------ | -------------------------------- | ------------------------------- |
| 24h+               | 0                                | 0                               |
| 12–24h             | -10                              | -7                              |
| 6–12h              | -20                              | -13                             |
| 2–6h               | -35                              | -22                             |
| 0–2h               | -45                              | -28                             |
| After start        | -45                              | -33                             |

> The <2h and after-start values are capped below `match_no_show` (-50) to preserve the distinction that cancelling — even very late — is still better than ghosting.

---

## Modifiers

### History modifier (based on late cancel/leave events in last 30 days)

| Recent offenses (30 days) | Multiplier                    |
| ------------------------- | ----------------------------- |
| 0 (first time)            | 0.5x (first-offense leniency) |
| 1                         | 1.0x (normal)                 |
| 2                         | 1.5x                          |
| 3+                        | 2.0x                          |

### Formula

`final = round(basePenalty × historyMod)`

**Examples:**

- First-time creator cancels **3h** before → `-35 × 0.5 = -18`
- 3rd-offense participant leaves **1h** before → `-28 × 1.5 = -42`

---

## Conditions for penalty to apply

All of the following must be true:

1. **Past 1-hour cooling off** — If the player joined or created the match less than 1 hour ago, no penalty applies. For creators: check `match.created_at`. For participants: check `match_participant.joined_at`. This encourages sign-ups without fear of instant regret.

2. **Court is reserved** — `match.court_status = 'reserved'`. The `court_status_enum` has two values: `'reserved'` (court confirmed) and `'to_reserve'` (still needs booking). Only `'reserved'` triggers penalties since `'to_reserve'` means the match is still tentative.

3. **Planned match** — Match was created 24h+ before start (unchanged). Spontaneous/last-minute matches are exempt.

4. **Within 24h of start** — Early cancellations (24h+) get no penalty (unchanged).

5. **For participants: match is full + was a joined participant** — Waitlisted players are never penalized. Leaving a non-full match has no penalty (unchanged).

6. **For participants: host didn't edit match <24h before the player leaves** — _Changed_: previously measured relative to match start time; now measured relative to when the player leaves. If the host changed match conditions within 24h of the player leaving, the player gets a pass (they're reacting to recent changes).

---

## New event type: `match_left_late`

Currently, both creators cancelling and participants leaving use the same event type (`match_cancelled_late`). This change introduces a separate `match_left_late` event for participants, allowing independent tracking and tuning.

| Event type             | Who         | Default impact | Decay             |
| ---------------------- | ----------- | -------------- | ----------------- |
| `match_cancelled_late` | Creator     | -35            | 180-day half-life |
| `match_left_late`      | Participant | -22            | 180-day half-life |

---

## What stays the same

- Spontaneous match exception (created <24h before start → no penalty)
- Waitlist exemption (waitlisted players never penalized)
- Full-match-only rule for participants
- Time decay (180-day half-life) on all penalty events
- `match_cancelled_early` event (0 impact) still logged for tracking
- `match_no_show` (-50) unchanged and remains the harshest penalty
- Reputation tiers, base score, and public visibility threshold unchanged

---

## Timezone fix

The current penalty calculation uses naive date construction (`new Date(\`${match_date}T${start_time}\`)`) which ignores the match's timezone. This is being fixed to use the existing `getTimeDifferenceFromNow()`utility from`@rallia/shared-utils`, which correctly handles timezone-aware date math.

---

## Summary of all changes

1. Penalties now **scale with timing** — the closer to match start, the harsher the penalty (5 tiers from mild to severe)
2. **Creators get a heavier penalty** (~1.5x) than participants, since cancelling kills the entire match
3. **No penalty for cancelling an empty match** — if no other players have joined, there's no victim
4. **No penalty without a reserved court** — if the court isn't confirmed, the match is still tentative
5. **First-time offenders get leniency** (50% penalty), while **repeat offenders face escalation** (up to 2x)
6. **1-hour cooling-off window** — if you just joined or created the match, you can back out without penalty
7. **Host-edit protection** — if the host changed match details in the last 24 hours, participants can leave without penalty (they're reacting to changes)
8. Cancelling late is still **less severe than not showing up at all**, preserving the incentive to at least notify others
9. **Timezone bug fix** — penalty timing calculations now correctly account for the match's timezone
10. Creator cancellations and participant leaves are now **tracked as separate event types** for better analytics
