# Reputation Recovery

## Overview

Players with low reputation can recover through consistent good behavior. The system is designed to be **forgiving but fair** - recent good behavior matters more than past mistakes.

## Recovery Mechanics

### Time Decay: Your Best Friend

The most powerful recovery mechanism is **time decay**. Old events gradually lose impact:

| Event Age | Decay Factor | Effective Impact  |
| --------- | ------------ | ----------------- |
| Today     | 100%         | Full impact       |
| 1 month   | 89%          | Nearly full       |
| 3 months  | 71%          | Significant decay |
| 6 months  | 50%          | Half impact       |
| 1 year    | 25%          | Quarter impact    |
| 2 years   | 6%           | Nearly gone       |

**Formula:** `decay_factor = 0.5^(age_days / 180)` (180-day half-life)

**What this means:**

- A no-show from 2 years ago has minimal impact on your current reputation
- Recent good behavior has strong positive impact
- Reputation naturally improves if you maintain good behavior
- Past mistakes gradually fade

### Positive Events per Match

If a player behaves well in a match, they can earn:

| Good Behavior        | Impact  | Notes                           |
| -------------------- | ------- | ------------------------------- |
| Show up              | **+12** | Most important - just be there! |
| Be on time           | **+3**  | Arrive within 10 minutes        |
| Get 5-star rating    | **+10** | Be pleasant and respectful      |
| Get 4-star rating    | **+5**  | Good experience                 |
| Play repeat opponent | **+2**  | Build trust over time           |

**Maximum positive differential per match:** +27 points
(show + on_time + 5star + repeat)

**Typical good match:** +20 points
(show + on_time + 4star)

## Recovery Path Examples

### Scenario 1: Recovering from No-Show

Starting from **40%** (Bronze) after a no-show:

| Match | Behavior      | Events     | Differential | New Score | Tier        |
| ----- | ------------- | ---------- | ------------ | --------- | ----------- |
| Start | -             | -          | -            | 40%       | Bronze 🥉   |
| 1     | Perfect match | +12 +3 +10 | +25          | 65%       | Silver 🥈   |
| 2     | Perfect match | +12 +3 +10 | +25          | 90%       | Platinum ⭐ |

**OR** more realistically:

| Match | Behavior    | Events     | Differential | New Score | Tier        |
| ----- | ----------- | ---------- | ------------ | --------- | ----------- |
| Start | -           | -          | -            | 40%       | Bronze 🥉   |
| 1     | Good match  | +12 +3 +5  | +20          | 60%       | Silver 🥈   |
| 2     | Good match  | +12 +3 +5  | +20          | 80%       | Gold 🥇     |
| 3     | Great match | +12 +3 +10 | +25          | 100%      | Platinum ⭐ |

**Key insight:** A player can recover from a no-show in **2-3 good matches**.

### Scenario 2: Climbing from Bronze to Platinum

Starting from **50%** (Bronze):

| Match | Behavior  | Differential | New Score | Tier        |
| ----- | --------- | ------------ | --------- | ----------- |
| Start | -         | -            | 50%       | Bronze 🥉   |
| 1     | +12 +3 +5 | +20          | 70%       | Silver 🥈   |
| 2     | +12 +3 +5 | +20          | 90%       | Platinum ⭐ |

**OR** gradual improvement:

| Match | Behavior               | Differential | New Score | Tier        |
| ----- | ---------------------- | ------------ | --------- | ----------- |
| Start | -                      | -            | 50%       | Bronze 🥉   |
| 1     | Showed, on time, 3star | +15          | 65%       | Silver 🥈   |
| 2     | Showed, on time, 4star | +20          | 85%       | Gold 🥇     |
| 3     | Showed, on time, 5star | +25          | 100%      | Platinum ⭐ |

### Scenario 3: Time Decay Recovery (Passive)

Without playing any matches, reputation improves as old events decay:

**Player with old no-show:**

```
Month 0 (no-show happened): 50% (Bronze)
Month 3: ~57% (Bronze) - old events decay
Month 6: ~65% (Silver) - half-life reached
Month 12: ~73% (Silver) - continuing decay
Month 18: ~79% (Gold) - nearly recovered
```

**Active play + time decay (recommended):**

```
Month 0: 50% (Bronze)
Month 1: Play 2 good matches → 70% (Silver)
Month 3: Old events decay further → 75% (Gold)
Month 6: Play 1 match → 85% (Gold)
Month 7: Play 1 match → 90% (Platinum)
```

### Scenario 4: Recovering from Multiple Issues

Starting from **30%** (Bronze) after multiple problems:

| Month | Actions                        | Score | Tier        |
| ----- | ------------------------------ | ----- | ----------- |
| 0     | Multiple issues accumulated    | 30%   | Bronze 🥉   |
| 1     | Play 3 good matches (+20 each) | 90%   | Platinum ⭐ |

**OR** more conservative:

| Month | Actions                   | Score | Tier        |
| ----- | ------------------------- | ----- | ----------- |
| 0     | Multiple issues           | 30%   | Bronze 🥉   |
| 1     | Play 2 matches (+20 each) | 70%   | Silver 🥈   |
| 2     | Play 2 matches (+20 each) | 100%  | Platinum ⭐ |
| 3     | Old events decay          | 100%  | Platinum ⭐ |

## Recovery Tips for Players

### In-App Guidance

Display contextual tips based on current tier:

#### Bronze Tier (0-59%) - Needs Improvement

> **Rebuild Your Reputation**
>
> Your reputation is currently **Bronze** (XX%). Here's how to improve:
>
> 1. 🎯 **Show up to every match** - Most important! (+12 per match)
> 2. ⏰ **Arrive on time** - Punctuality matters (+3)
> 3. 😊 **Be respectful** - Good attitude earns 4-5 star ratings (+5 to +10)
> 4. 📅 **Never cancel last minute** - Cancel 24+ hours ahead
> 5. 💬 **Stay responsive** - Communicate proactively with your opponent
>
> **Good news:** You can reach Silver in just 2-3 good matches!

#### Silver Tier (60-74%) - On Track

> **You're Doing Well!**
>
> Your reputation is **Silver** (XX%). Keep it up!
>
> Tips to reach Gold:
>
> - Continue your reliable behavior
> - Aim for 5-star ratings by being extra courteous
> - Build consistency over several matches
>
> **Next milestone:** Gold at 75%

#### Gold Tier (75-89%) - Very Good

> **Almost There!**
>
> Your reputation is **Gold** (XX%). You're very reliable!
>
> Tips to reach Platinum:
>
> - Maintain perfect punctuality
> - Focus on excellent sportsmanship
> - Build trust through repeat matches
>
> **Next milestone:** Platinum at 90% - unlocks Most Wanted Player eligibility!

### Reputation History & Trend

Show players their progress:

```
Your Reputation Trend: 📈 Improving

Current: 78% (Gold)
Last month: 65% (Silver)
Change: +13%

Recent matches: 5
Average rating: 4.4 ⭐
On-time rate: 100% ✓
```

**Benefits:**

- Shows progress visually
- Motivates continued good behavior
- Demonstrates that improvement is possible

### What NOT to Show (Privacy)

Never show players:

- ❌ Individual event details ("On 2024-01-15, you were late")
- ❌ Who gave what rating ("John gave you 3 stars")
- ❌ Specific match incidents ("You no-showed on Match #12345")
- ❌ Event timestamps or history log

**Why:** Prevents retaliation and maintains system trust

## Preventing Abuse

### Natural Rate Limiting

- Players can't play unlimited matches just to game reputation
- Time decay means you need sustained good behavior, not a burst of matches
- Match history is visible, suspicious patterns can be flagged

### Extreme Behavior Flagging

If a player has repeated severe issues:

| Trigger                 | System Response             |
| ----------------------- | --------------------------- |
| 3+ no-shows in 30 days  | Flag for admin review       |
| Reputation < 20%        | Automatic review trigger    |
| Multiple reports upheld | Account warning or temp ban |

### Admin Tools

Admins can:

- View full event history for investigation
- Manually adjust reputation if justified
- Issue warnings or temporary restrictions
- Permanently ban accounts for abuse

## Support for Low-Reputation Players

### No Hard Exclusions

Low-reputation players are NOT blocked from the platform:

- ✓ Can still create matches
- ✓ Can still join matches
- ✓ Other players see their reputation before accepting
- ✓ Given fair chance to recover

### Fair Second Chances

The system is designed for redemption:

- Time decay forgives old mistakes
- Clear path to improvement
- Positive reinforcement for good behavior
- No permanent "scarlet letter"

### Encouraging Messages

| Reputation Level | Message Tone | Example                                                                   |
| ---------------- | ------------ | ------------------------------------------------------------------------- |
| 80-89% (Gold)    | Encouraging  | "You're doing great! Keep it up to reach Platinum."                       |
| 60-79% (Silver)  | Neutral      | "You're reliable. A few more good matches will boost your tier."          |
| 40-59% (Bronze)  | Supportive   | "Your reputation took a hit, but you can recover quickly!"                |
| Below 40%        | Concerned    | "Your reputation needs attention. Focus on showing up and being on time." |

## Communication Best Practices

### Reputation Changed Notifications

**Tier Up:**

```
🎉 Congratulations!
You've reached Gold tier (XX%)!

Your consistent reliability is paying off. Keep it up!
```

**Tier Down:**

```
⚠️ Reputation Update
You've dropped to Silver tier (XX%)

Recent issues affected your reputation. Here's how to improve:
[Show recovery tips]
```

**Approaching Milestone:**

```
🎯 Almost There!
You're at 88% - just 2% away from Platinum!

A few more good matches will get you there!
```

### Match Request Context

When viewing a player's profile before accepting a match:

```
Reputation: 78% (Gold) 🥇

This player has:
✓ Completed 24 matches
✓ Average rating: 4.3 stars
✓ On-time rate: 92%

[Accept Match] [Decline]
```

## Long-Term Recovery Strategy

For players with very low reputation (<40%):

### Month 1: Foundation

- Play 3-5 matches with perfect behavior
- Focus on showing up and being on time
- Goal: Reach 60% (Silver)

### Month 2-3: Building Trust

- Continue consistent good behavior
- Build relationships with repeat opponents
- Goal: Reach 75% (Gold)

### Month 4-6: Excellence

- Maintain Gold tier behavior
- Let time decay work on old events
- Focus on 5-star experiences
- Goal: Reach 90% (Platinum)

### The Power of Consistency

```
Starting: 35% (Bronze)

After 10 good matches over 2 months:
- 10 matches × +20 average = +200 points (capped at 100%)
- Old events decay by ~12%
- Effective old penalty reduced
- New score: 90%+ (Platinum)

Result: Full recovery in 2-3 months of good behavior!
```

## Key Takeaways

1. **Recovery is always possible** - No permanent damage
2. **Time heals** - Old events fade automatically
3. **Consistency matters** - Regular good behavior is rewarded
4. **Quick wins available** - Can recover from one bad event in 2-3 matches
5. **Long-term improvement** - Sustained good behavior + time decay = full recovery
6. **Privacy protected** - No retaliation possible, only forward progress
