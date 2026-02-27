# Reputation Calculation

## Architecture

The reputation system uses an **event-driven architecture** where every reputation-affecting action creates an immutable event. The score is calculated by summing all weighted event impacts.

## Formula

### Core Calculation

```
Base Score = 100 (starting point)

For each event:
    weighted_impact = base_impact × decay_factor(event_age)

decay_factor(age_days) = 0.5^(age_days / 180)

Final Score = clamp(Base Score + sum(weighted_impacts), 0, 100)
```

### Components

| Component    | Description                                         |
| ------------ | --------------------------------------------------- |
| Base Score   | 100 - everyone starts with good reputation          |
| base_impact  | The impact value configured for each event type     |
| decay_factor | Time-weighting function (6-month half-life)         |
| event_age    | Days since the event occurred                       |
| Final Score  | Sum of all weighted impacts, clamped to 0-100 range |

## Event Types and Impacts

### Match-Related Events

| Event Type              | Default | When Triggered                                    |
| ----------------------- | ------- | ------------------------------------------------- |
| `match_completed`       | **+12** | Player showed up and played the match             |
| `match_no_show`         | **-50** | Player didn't show up at all                      |
| `match_on_time`         | **+3**  | Player arrived on time (within 10 minutes)        |
| `match_late`            | **-10** | Player arrived more than 10 minutes late          |
| `match_cancelled_early` | **0**   | Player cancelled with adequate notice (24+ hours) |
| `match_cancelled_late`  | **-35** | Host cancelled late (graduated, see below)        |
| `match_left_late`       | **-22** | Participant left late (graduated, see below)      |

### Review-Related Events

| Event Type              | Impact  | When Triggered                        |
| ----------------------- | ------- | ------------------------------------- |
| `review_received_5star` | **+10** | Opponent gave 5-star rating           |
| `review_received_4star` | **+5**  | Opponent gave 4-star rating           |
| `review_received_3star` | **0**   | Opponent gave 3-star rating (neutral) |
| `review_received_2star` | **-5**  | Opponent gave 2-star rating           |
| `review_received_1star` | **-10** | Opponent gave 1-star rating           |

### Moderation Events

| Event Type          | Impact  | When Triggered                                      |
| ------------------- | ------- | --------------------------------------------------- |
| `report_received`   | **0**   | Someone reported this player (pending review)       |
| `report_upheld`     | **-15** | Admin confirmed the report was valid                |
| `report_dismissed`  | **+5**  | Admin dismissed the report (false accusation bonus) |
| `warning_issued`    | **-10** | Admin issued warning for behavior                   |
| `suspension_lifted` | **0**   | Player's suspension was lifted (tracked, no impact) |

### Community Events

| Event Type           | Impact | When Triggered                            |
| -------------------- | ------ | ----------------------------------------- |
| `feedback_submitted` | **+1** | Player submitted feedback for an opponent |
| `peer_rating_given`  | **+1** | Player gave a peer rating                 |

## Time Decay

Events lose impact over time, allowing reputation recovery:

| Event Age | Decay Factor | Effective Impact (example: -50 no-show) |
| --------- | ------------ | --------------------------------------- |
| 0 days    | 100%         | -50                                     |
| 1 month   | 89%          | -44.5                                   |
| 3 months  | 71%          | -35.5                                   |
| 6 months  | 50%          | -25                                     |
| 1 year    | 25%          | -12.5                                   |
| 2 years   | 6%           | -3                                      |

**Formula:** `decay_factor = 0.5^(age_days / 180)`

## Recalculation Timing

The system uses a **hybrid approach** for reputation recalculation:

### On-Event Recalculation

- Triggered immediately when any new reputation event is created
- Ensures players see instant feedback after matches
- Applies current decay factors to all existing events

### Weekly Batch Job

- Runs every Sunday at 3:00 AM UTC
- Recalculates all player reputations to apply decay
- Catches inactive players whose scores should improve via time decay
- Updates cached `player_reputation` table

### Implementation

- New events: Immediate recalculation for affected player
- Inactive players: Weekly batch ensures decay is applied
- Cache TTL: None (always read from `player_reputation` table)

## Calculation Examples

### Example 1: Perfect Match (Multiple Events)

```
Before: 85%

Events created this match:
- match_completed: +12
- match_on_time: +3
- review_received_5star: +10

Differential: +25
After: min(100, 85 + 25) = 100%
```

### Example 2: No-Show (Severe Penalty)

```
Before: 90%

Events created:
- match_no_show: -50

Differential: -50
After: max(0, 90 - 50) = 40%
```

**Note:** A single no-show can drop a player from Platinum (90%) to Bronze (40%)

### Example 3: Late Cancellation (Graduated)

```
Before: 75%

Scenario: First-time creator cancels 3 hours before match (court reserved)
- Base penalty (2–6h bracket, creator): -35
- History modifier (0 prior offenses): ×0.5
- Final: round(-35 × 0.5) = -18
- match_cancelled_late: -18

Differential: -18
After: max(0, 75 - 18) = 57%
```

### Example 3b: Repeat Offender Leaves Late

```
Before: 80%

Scenario: Participant with 2 recent offenses leaves 1 hour before match
- Base penalty (0–2h bracket, participant): -28
- History modifier (2 offenses): ×1.5
- Final: round(-28 × 1.5) = -42
- match_left_late: -42

Differential: -42
After: max(0, 80 - 42) = 38%
```

### Example 4: Typical Good Match

```
Before: 70%

Events created:
- match_completed: +12
- match_on_time: +3
- review_received_4star: +5

Differential: +20
After: min(100, 70 + 20) = 90%
```

**Note:** A typical good match provides +20 to +27 points

### Example 5: With Time Decay (6 months old)

```
Current score: 75%

Old event from 6 months ago:
- match_no_show (base: -50)
- decay_factor: 0.5^(180/180) = 0.5
- weighted_impact: -50 × 0.5 = -25

If recalculated today:
- Old no-show now only counts as -25 instead of -50
- Player's effective score improves over time
```

## Initial Calculation (First 10 Events)

New players start with **unknown** reputation until 10 reputation events have been recorded.

**First calculation (after 10th event):**

```
Starting Base = 100%

Apply all events from first 10 events:
Example:
- Match 1: completed (+12), on_time (+3), 5star (+10) = +25
- Match 2: completed (+12), on_time (+3), 4star (+5) = +20
- Match 3: completed (+12), late (-10), 3star (0) = +2
- Additional event: feedback_submitted (+1) = +1

Total differential: +48
Final Score: min(100, 100 + 48) = 100%
Result: Platinum tier (90-100%)
```

**If first events had issues:**

```
Starting Base = 100%

Example with 10 events:
- Event 1-3: Match 1: completed (+12), on_time (+3), 4star (+5) = +20
- Event 4: no_show (-50) = -50
- Event 5-7: Match 2: completed (+12), late (-10), 2star (-5) = -3
- Event 8-10: Additional events (feedback_submitted, etc.) = +3

Total differential: -20
Final Score: max(0, 100 - 20) = 80%

Note: Even with some negative events, positive events can offset them.
```

**Actual implementation:**
The starting base of 100 represents the "benefit of the doubt" - only negative events pull you down from 100, positive events are rewards. The system is designed so that:

- Perfect behavior keeps you at 100%
- Each negative event pulls you down
- Positive events help you recover

## Bounds Enforcement

```javascript
// After calculating sum of all weighted events
finalScore = Math.max(0, Math.min(100, baseScore + sumOfWeightedImpacts));
```

- **Maximum:** 100% (cannot exceed)
- **Minimum:** 0% (cannot go negative)

## Tier Assignment

After calculating the score, the tier is assigned:

```javascript
function calculateTier(score: number, eventCount: number): ReputationTier {
  if (eventCount < 10) return "unknown";
  if (score >= 90) return "platinum";
  if (score >= 75) return "gold";
  if (score >= 60) return "silver";
  return "bronze";
}
```

| Score       | Tier     |
| ----------- | -------- |
| < 10 events | Unknown  |
| 0-59%       | Bronze   |
| 60-74%      | Silver   |
| 75-89%      | Gold     |
| 90-100%     | Platinum |

## Data Collection

Reputation events are created automatically from various sources:

### From Match Closure

**Immediate Events (created when feedback is submitted):**

- **Feedback submitted:** When a player submits feedback for an opponent → Creates `feedback_submitted` event (+1)

**Closure Events (created 48 hours after match end):**

After a match ends, the post-match feedback form collects:

1. **Did your opponent show up?** (Yes/No)
   - No → Creates `match_no_show` event
   - Yes → Creates `match_completed` event

2. **Were they on time?** (On time / Late 10+ min)
   - On time → Creates `match_on_time` event
   - Late → Creates `match_late` event

3. **Rate your experience** (1-5 stars)
   - Creates corresponding `review_received_Xstar` event

### From Cancellations / Leaves

Late cancellation and leave penalties are **graduated** by timing, **role-aware**, **context-sensitive**, and **history-aware**.

#### Graduated Penalty Scale (public match with reserved court, normal history)

| Hours before match | Creator (`match_cancelled_late`) | Participant (`match_left_late`) |
| ------------------ | -------------------------------- | ------------------------------- |
| 24h+               | 0                                | 0                               |
| 12–24h             | -10                              | -7                              |
| 6–12h              | -20                              | -13                             |
| 2–6h               | -35                              | -22                             |
| 0–2h               | -45                              | -28                             |
| After start        | -45                              | -33                             |

All values capped below `match_no_show` (-50) to preserve the distinction that cancelling is still better than ghosting.

#### History Modifier (last 30 days)

| Recent offenses | Multiplier      |
| --------------- | --------------- |
| 0 (first time)  | 0.5× (leniency) |
| 1               | 1.0× (normal)   |
| 2               | 1.5×            |
| 3+              | 2.0×            |

Formula: `final = round(basePenalty × historyMod)`

#### Conditions for Penalty

All of the following must be true for a penalty to apply:

1. **Past cooling off** — player joined/created >1h ago
2. **Court is reserved** — `match.court_status = 'reserved'` (not `'to_reserve'`)
3. **Planned match** — created 24h+ before start time
4. **Within 24h of start** — hoursUntilMatch < 24
5. For participants: match is full and player was joined (not waitlisted)
6. For participants: host didn't edit the match within 24h of the player leaving

If none of these conditions are met, a `match_cancelled_early` (0 impact) event is logged instead.

### From Moderation Actions

When admin resolves a report:

```javascript
if (reportUphold) {
  createEvent('report_upheld', { impact: -15 });
} else {
  createEvent('report_dismissed', { impact: +3 }); // False report bonus
}
```

## Configuration

Event impacts are stored in the `reputation_config` table and can be adjusted without code changes:

```sql
SELECT event_type, default_impact, is_active
FROM reputation_config
WHERE is_active = true;
```

This allows the product team to tune the reputation system based on player behavior and feedback.

## Privacy & Storage

- Events are stored in `reputation_event` table with RLS blocking player access
- Only aggregated scores in `player_reputation` table are exposed to players
- Admins can view full event history for dispute resolution
- API never returns individual events to players
