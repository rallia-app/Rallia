# 05 - Reputation

> Event-driven behavioral scoring system based on player reliability and conduct.

## Overview

The reputation system measures how reliable and pleasant a player is to play with through an event-driven architecture. Unlike skill rating, reputation reflects behavior: showing up on time, not canceling last minute, being a good sport, and building trust over time.

## Sub-documents

| Document                                                 | Description                               |
| -------------------------------------------------------- | ----------------------------------------- |
| [reputation-overview.md](./reputation-overview.md)       | Concept, visibility, tiers, and privacy   |
| [reputation-calculation.md](./reputation-calculation.md) | Event types, impacts, and scoring formula |
| [reputation-badges.md](./reputation-badges.md)           | Tier system and badge criteria            |
| [reputation-recovery.md](./reputation-recovery.md)       | How to improve reputation over time       |

## User Stories

- As a player, I want to see other players' reputation tier before accepting matches
- As a reliable player, I want my good behavior recognized with a tier badge
- As a player who had issues, I want to understand how to improve my reputation
- As a player, I want my reputation to improve over time if I maintain good behavior

## Dependencies

| System                                          | Relationship                                                  |
| ----------------------------------------------- | ------------------------------------------------------------- |
| [09 Matches](../09-matches/README.md)           | Match events feed reputation data                             |
| [13 Gamification](../13-gamification/README.md) | Platinum reputation badge                                     |
| [13 Gamification](../13-gamification/README.md) | "Most Wanted Player" super-badge requires Platinum reputation |

## Key Concepts

> **Reputation ≠ Skill Level**
>
> Reputation measures reliability and conduct, NOT playing ability. This distinction must be clear to users.

> **Privacy-First Design**
>
> Individual reputation events are never exposed to players to prevent retaliation. Only aggregated scores and stats are visible.

## Architecture

The system uses an **event-driven architecture** where every reputation-affecting action creates an immutable event. These events are:

- **Auditable**: Complete history for admin review
- **Flexible**: Easy to add new event types
- **Recalculable**: Can rebuild reputation if formula changes
- **Time-weighted**: Recent events matter more (6-month decay half-life)
- **Private**: Individual events never exposed to players

## Reputation Formula

```
Base Score = 100 (starting point)

For each event:
    weighted_impact = base_impact × decay_factor(event_age)

decay_factor(age_days) = 0.5^(age_days / 180)

Final Score = clamp(Base Score + sum(weighted_impacts), 0, 100)
```

## Reputation Tiers

| Tier     | Score Range | Badge         | Description                       |
| -------- | ----------- | ------------- | --------------------------------- |
| Unknown  | N/A         | Gray "?"      | Fewer than 5 reputation events    |
| Bronze   | 0-59%       | Bronze shield | Below average reliability         |
| Silver   | 60-74%      | Silver shield | Average reliability               |
| Gold     | 75-89%      | Gold shield   | Good reliability                  |
| Platinum | 90-100%     | Platinum star | Excellent - consistently reliable |

## Key Implementation Details

### Database Tables

1. **reputation_event**: Immutable event log (admin-only access)
2. **player_reputation**: Cached scores and aggregates (public)
3. **reputation_config**: Configurable event impacts

### Event Types

- **Match Events**: completed, no_show, on_time, late, cancelled_early, cancelled_late, repeat_opponent
- **Review Events**: received_5star through received_1star
- **Moderation Events**: report_received, report_upheld, report_dismissed, warning_issued
- **Community Events**: first_match_bonus

### Privacy Guarantees

- Players can see: Their score, tier, aggregated stats
- Players cannot see: Individual events, who caused events, event timestamps
- Admins can see: Full event history for dispute resolution

## Reference

- Event-driven reputation architecture pattern
- Time-decay weighting for aging events
- Tier-based badge system for clear progression
