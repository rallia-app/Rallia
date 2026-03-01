# Reputation System - Implementation Changes

This document summarizes the changes between the original MVP specification and the actual implementation of the reputation system.

## Date: January 2026

---

## Recent Changes

### Positive Event Impacts Reduced (Latest)

**Change:**

- All positive event impacts reduced by ~50% to slow recovery rate
- Players now need 2-3 good matches to recover from a no-show (previously 1 match)

**Rationale:**

- Prevents players from erasing bad behavior too quickly
- Encourages sustained good behavior over multiple matches
- Makes reputation recovery more meaningful and earned
- Better balance between forgiveness and accountability

**Impact:**

- Perfect match: +50 → +25 points
- Good match: +40 → +20 points
- Recovery from no-show: 1 match → 2-3 matches
- Recovery from late cancellation: 1 match → 1-2 matches

**Updated Values:**

| Event                 | Old | New |
| --------------------- | --- | --- |
| match_completed       | +25 | +12 |
| match_on_time         | +5  | +3  |
| review_received_5star | +20 | +10 |
| review_received_4star | +10 | +5  |
| match_repeat_opponent | +3  | +2  |
| first_match_bonus     | +10 | +5  |
| feedback_submitted    | +2  | +1  |
| report_dismissed      | +5  | +3  |
| suspension_lifted     | +10 | +5  |

**Negative events unchanged** (no-show: -50, late cancel: -25, etc.)

---

### Unknown Reputation Threshold Updated

**Change:**

- Unknown reputation threshold changed from **3 completed matches** to **10 reputation events**

**Rationale:**

- Provides more statistically meaningful data before reputation becomes public
- Accounts for the fact that each match can generate multiple events (completed, on_time, review, etc.)
- Ensures reputation score is based on sufficient behavioral data points
- Better protects new players from unfair judgment

**Impact:**

- Players need to accumulate 10 reputation events (not just 3 matches) before their reputation becomes visible
- Since matches typically generate 3-5 events each, this usually means 2-4 matches
- All tier criteria updated to reflect "10+ events" instead of "3+ matches"

---

## Overview

The reputation system evolved from a simple percentage-based calculation to a sophisticated **event-driven architecture** with time decay, tier-based badges, and strong privacy protections.

---

## Major Architectural Changes

### 1. Event-Driven Architecture ⭐ NEW

**Original Design:**

- Simple formula: Reputation = f(Cancellations, Show/No-show, Punctuality, Satisfaction)
- Calculated and stored as single percentage
- No historical tracking

**Implemented Design:**

- Event-driven architecture with immutable event log
- Each reputation-affecting action creates a `reputation_event` record
- Score calculated by summing all weighted event impacts
- Complete audit trail for admins
- Flexible - easy to add new event types
- Recalculable if formula changes

**New Database Tables:**

- `reputation_event` - Immutable event log (admin-only access)
- `player_reputation` - Cached scores and aggregates (public)
- `reputation_config` - Configurable event impacts

---

### 2. Time Decay Mechanism ⭐ NEW

**Original Design:**

- No time decay
- All events had permanent equal impact
- Past mistakes haunted players forever

**Implemented Design:**

- **6-month half-life decay:** `decay_factor = 0.5^(age_days / 180)`
- Old events gradually lose impact:
  - 6 months old: 50% impact
  - 1 year old: 25% impact
  - 2 years old: 6% impact
- Enables natural reputation recovery over time
- Recent behavior matters more than distant past
- Fair and forgiving system

---

### 3. Tier System (Instead of Single Badge)

**Original Design:**

- Single threshold: 90%+ = "High Reputation" badge
- Below 90%: No badge, just percentage
- Binary good/bad perception

**Implemented Design:**

- **5-tier progressive system:**
  - **Unknown:** < 10 events (gray "?")
  - **Bronze:** 0-59% (bronze shield 🥉)
  - **Silver:** 60-74% (silver shield 🥈)
  - **Gold:** 75-89% (gold shield 🥇)
  - **Platinum:** 90-100% (platinum star ⭐)

**Benefits:**

- Clear progression path for all players
- Motivation at every level
- Reduced stigma for lower scores
- Better engagement and gamification
- Matches modern app UX patterns

---

### 4. Expanded Event Types

**Original Design:**

- Last-minute cancellation
- Show/No-show
- Punctuality (10+ min late)
- Opponent satisfaction (5-star rating)

**Implemented Design:**

**Match Events:**

- `match_completed` (+12) - Showed up and played
- `match_no_show` (-50) - Didn't show up
- `match_on_time` (+3) - Arrived on time
- `match_late` (-10) - Arrived 10+ minutes late
- `match_cancelled_early` (0) - Cancelled 24+ hours ahead
- `match_cancelled_late` (-25) - Last-minute cancellation
- `match_repeat_opponent` (+2) - ⭐ NEW: Played with same opponent again

**Review Events:**

- `review_received_5star` (+10)
- `review_received_4star` (+5)
- `review_received_3star` (0)
- `review_received_2star` (-5)
- `review_received_1star` (-10)

**Moderation Events:** ⭐ NEW

- `report_received` (0)
- `report_upheld` (-15)
- `report_dismissed` (+3)
- `warning_issued` (-10)
- `suspension_lifted` (+5)

**Community Events:** ⭐ NEW

- `first_match_bonus` (+5)
- `feedback_submitted` (+1)

---

### 5. Privacy-First Design ⭐ NEW

**Original Design:**

- Not explicitly addressed
- Assumed players could see reputation details

**Implemented Design:**

**Players Can See:**

- ✅ Their own score and tier
- ✅ Other players' scores and tiers
- ✅ Aggregated stats (matches completed, average rating)
- ✅ Reputation trend (improving/stable/declining)

**Players Cannot See:**

- ❌ Individual reputation events
- ❌ Event timestamps or details
- ❌ Who caused specific events (reviews, reports)
- ❌ Event history log

**Why:**

- Prevents retaliation against players who gave negative reviews
- Reduces social pressure and awkwardness
- Maintains trust in the system
- Similar to Uber/Airbnb rating privacy

**Implementation:**

- RLS policies block player access to `reputation_event` table
- Only service_role (backend) and admins can read events
- API never exposes individual events to players
- Only aggregated `player_reputation` data is public

---

## Formula Changes

### Original Formula

```
Reputation (after party) = Reputation (before party) + Differential (party)

Differential = Cancellation (-25% or 0%) +
               Show/No-show (-50% or +25%) +
               Punctuality (-10% or +5%) +
               Satisfaction (+20% to -10%)

Starting base: 100% (after first 3 matches)
```

### Implemented Formula

```
Base Score = 100 (starting point)

For each event:
    weighted_impact = base_impact × decay_factor(event_age)

decay_factor(age_days) = 0.5^(age_days / 180)

Final Score = clamp(Base Score + sum(weighted_impacts), 0, 100)
```

**Key Differences:**

- Events, not matches, are the atomic unit
- Time decay applied to all events
- More granular event types
- Configurable impacts via `reputation_config` table
- Multiple events per match (completed + punctuality + rating + repeat)

---

## Event Impact Comparison

### Original vs Implemented Values

| Action                 | Original | Implemented | Change                    |
| ---------------------- | -------- | ----------- | ------------------------- |
| Show up                | +25%     | +12         | Reduced ~50%              |
| No-show                | -50%     | -50         | Same                      |
| On time                | +5%      | +3          | Reduced ~40%              |
| Late (10+ min)         | -10%     | -10         | Same                      |
| Last-min cancel        | -25%     | -25         | Same                      |
| Early cancel           | 0%       | 0           | Same                      |
| 5-star rating          | +20%     | +10         | Reduced 50%               |
| 4-star rating          | +10%     | +5          | Reduced 50%               |
| 3-star rating          | 0%       | 0           | Same                      |
| 2-star rating          | -5%      | -5          | Same                      |
| 1-star rating          | -10%     | -10         | Same                      |
| **Feedback submitted** | N/A      | **+1**      | ⭐ NEW (reduced from +2)  |
| **Repeat opponent**    | N/A      | **+2**      | ⭐ NEW (reduced from +3)  |
| **First match**        | N/A      | **+5**      | ⭐ NEW (reduced from +10) |
| **Report upheld**      | N/A      | **-15**     | ⭐ NEW                    |
| **Report dismissed**   | N/A      | **+3**      | ⭐ NEW (reduced from +5)  |

---

## Badge/Tier Comparison

### Original System

| Threshold | Badge                      |
| --------- | -------------------------- |
| 90-100%   | "High Reputation" badge ⭐ |
| 0-89%     | No badge                   |

**Issues:**

- No recognition for 0-89% of players
- Demotivating for most users
- Binary good/bad perception
- No clear progression path

### Implemented System

| Threshold   | Tier     | Badge            |
| ----------- | -------- | ---------------- |
| < 10 events | Unknown  | Gray "?"         |
| 0-59%       | Bronze   | Bronze shield 🥉 |
| 60-74%      | Silver   | Silver shield 🥈 |
| 75-89%      | Gold     | Gold shield 🥇   |
| 90-100%     | Platinum | Platinum star ⭐ |

**Benefits:**

- Progressive recognition for all players
- Clear milestones at 60%, 75%, 90%
- Reduced stigma (Bronze vs "bad player")
- Better gamification and engagement
- Matches expectations from other apps

---

## Most Wanted Player Integration

### Original Requirement

**From MVP_SPECS.md Section 18:**

> Players with both "High Reputation" badge (90%+) AND "Certified Level" badge receive "Most Wanted Player" super-badge

### Implemented Mapping

**Requirements remain the same, terminology updated:**

- "High Reputation" badge → **Platinum tier** (90%+)
- "Certified Level" badge → **Certified Level** (unchanged)
- Combined → **Most Wanted Player** super-badge

**No functional change, just clearer naming.**

---

## Technical Implementation Details

### New Database Schema

```sql
-- Event log (admin-only access)
CREATE TABLE reputation_event (
    id UUID PRIMARY KEY,
    player_id UUID NOT NULL,
    event_type reputation_event_type NOT NULL,
    base_impact DECIMAL(5,2) NOT NULL,
    match_id UUID,
    caused_by_player_id UUID,
    metadata JSONB,
    event_occurred_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

-- Cached reputation (public)
CREATE TABLE player_reputation (
    player_id UUID PRIMARY KEY,
    reputation_score DECIMAL(5,2) NOT NULL,
    reputation_tier reputation_tier NOT NULL,
    total_events INT NOT NULL,
    positive_events INT NOT NULL,
    negative_events INT NOT NULL,
    matches_completed INT NOT NULL,
    min_events_for_public INT NOT NULL DEFAULT 10,
    is_public BOOLEAN GENERATED ALWAYS AS (total_events >= 10) STORED,
    last_decay_calculation TIMESTAMPTZ,
    calculated_at TIMESTAMPTZ NOT NULL
);

-- Configuration (admin-editable)
CREATE TABLE reputation_config (
    id UUID PRIMARY KEY,
    event_type reputation_event_type UNIQUE NOT NULL,
    default_impact DECIMAL(5,2) NOT NULL,
    decay_enabled BOOLEAN NOT NULL DEFAULT false,
    decay_half_life_days INT,
    is_active BOOLEAN NOT NULL DEFAULT true
);
```

### New Service Functions

```typescript
// Create reputation event
createReputationEvent(playerId, eventType, options);

// Recalculate with optional decay
recalculateReputation(playerId, { applyDecay: boolean });

// Get cached reputation
getPlayerReputation(playerId);

// Batch recalculate with decay (scheduled job)
batchRecalculateWithDecay(batchSize);

// Privacy-safe summary for player's own profile
getReputationSummary(playerId);
```

---

## Migration Path

### For Existing Players

If reputation system is being added to existing app:

1. **Initialize all players** with `reputation_score = 100`, `tier = unknown`
2. **Backfill events** from historical match data if available
3. **Recalculate** all reputations from events
4. **Apply appropriate tiers** based on new thresholds
5. **Send notification** explaining the new system

### For New Players

- Start with `tier = unknown`
- After 10 events, calculate initial reputation
- Assign tier based on score
- Send welcome notification explaining tiers

---

## Key Improvements Summary

| Aspect           | Improvement                                   |
| ---------------- | --------------------------------------------- |
| **Architecture** | Simple formula → Event-driven system          |
| **Auditability** | No history → Complete event log               |
| **Flexibility**  | Hardcoded → Configurable impacts              |
| **Fairness**     | Permanent impact → Time decay (6mo half-life) |
| **Privacy**      | Not specified → Strong privacy-first design   |
| **Progression**  | Single badge → 5-tier system                  |
| **Motivation**   | Binary → Progressive recognition              |
| **Recovery**     | Difficult → Natural recovery over time        |
| **Events**       | 4 types → 17 types                            |
| **Admin Tools**  | None → Full event history & analytics         |

---

## Backward Compatibility

### Breaking Changes

⚠️ **None** - This is a new feature implementation

The tier system is MORE generous than the original spec:

- Original: Badge only at 90%+
- Implemented: Badge at every tier including 60%+

Players get MORE recognition, not less.

### Data Migration

If migrating from MVP spec implementation:

- Map "High Reputation" badge (90%+) → Platinum tier
- Map no badge → Appropriate tier based on score
- No data loss or player experience degradation

---

## Future Enhancements

The event-driven architecture enables:

1. **Decay Scheduling** - Automated decay calculation job
2. **Reputation Timeline** - Visual history for players (privacy-safe)
3. **Admin Analytics** - Event pattern analysis
4. **Dynamic Tuning** - A/B test different impact values
5. **Reputation Insurance** - Protection for good players
6. **Match Filtering** - Filter by minimum reputation tier
7. **Reputation Boost** - Temporary events (tournaments, community service)

---

## Documentation Updates

All files in `rallia-specs/specs/05-reputation/` have been updated:

- ✅ `README.md` - Overview with event-driven architecture
- ✅ `reputation-overview.md` - Tier system, time decay, privacy
- ✅ `reputation-calculation.md` - Event types, formula, decay
- ✅ `reputation-badges.md` - 5-tier system details
- ✅ `reputation-recovery.md` - Recovery with time decay

---

## References

- **Original Spec:** `rallia-specs/MVP_SPECS.md` Section 8
- **Implementation Plan:** `rallia/.cursor/plans/player_reputation_system_00812f72.plan.md`
- **Database Schema:** `rallia/packages/shared-types/src/supabase.ts`
- **Related Systems:**
  - Level Certification (requires Platinum for Most Wanted)
  - Match Closure (feeds reputation events)
  - Moderation (report events)

---

## Summary

The implemented reputation system is **significantly more sophisticated** than the MVP spec while maintaining the same core goals:

✅ Measures reliability and conduct (not skill)  
✅ Public reputation scores  
✅ Badge/tier recognition for good players  
✅ Recovery path for players with issues  
✅ Integrated with Most Wanted Player feature

**Plus new capabilities:**

⭐ Event-driven architecture for auditability and flexibility  
⭐ Time decay for fairness and natural recovery  
⭐ 5-tier progression system for better engagement  
⭐ Strong privacy protections to prevent retaliation  
⭐ Expanded event types for nuanced behavior tracking  
⭐ Configurable impacts without code changes

The system is **more fair, more engaging, and more maintainable** than originally specified.
