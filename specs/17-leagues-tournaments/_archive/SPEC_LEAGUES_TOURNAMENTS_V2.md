# RALLIA — Technical Specification: Leagues & Tournaments

## v2.0 — Comprehensive Specification

**Document Status:** Complete  
**Target:** Tennis & Pickleball Leagues and Tournaments  
**Scope:** Full feature implementation (MVP + v2)

---

# Table of Contents

1. [Overview & Definitions](#1-overview--definitions)
2. [Tournament Feature](#2-tournament-feature)
3. [League Feature](#3-league-feature)
4. [Data Models](#4-data-models)
5. [Algorithms](#5-algorithms)
6. [Edge Cases & Anomalies](#6-edge-cases--anomalies)
7. [Integration Points](#7-integration-points)
8. [Roadmap](#8-roadmap)

---

# 1. Overview & Definitions

## 1.1 Core Concepts

| Concept         | Definition                                                                    |
| --------------- | ----------------------------------------------------------------------------- |
| **Tournament**  | Single-event competition with fixed bracket, one winner, defined participants |
| **League**      | Recurring competitive structure with seasons and sessions, ongoing ranking    |
| **Session**     | Single play date within a league season (like "round" or "match night")       |
| **Season**      | Time-bounded period within a league (e.g., "Winter 2026") with ranking        |
| **Match Sheet** | Generated pairings for a session (who plays whom, when, on which court)       |
| **Bracket**     | Tournament elimination tree (single/double elimination)                       |
| **Seed**        | Pre-ranked player placed in protected bracket position                        |
| **Bye**         | Automatic advancement when no opponent available                              |

## 1.2 Supported Formats

| Format  | Sport             | Description |
| ------- | ----------------- | ----------- |
| Singles | Tennis/Pickleball | 1v1 matches |
| Doubles | Tennis/Pickleball | 2v2 matches |
| Mixed   | Tennis/Pickleball | M/F pairing |

## 1.3 Score Formats

| Format           | Description                           | Applicable             |
| ---------------- | ------------------------------------- | ---------------------- |
| 2 of 3 sets      | Best of 2 sets (must win 2)           | Tennis                 |
| 3 of 5 sets      | Best of 3 sets (must win 3)           | Tennis (championships) |
| 1 set to 6       | Single set, win by 2 games            | Tennis (fast)          |
| Super TB         | 10-point tie-break instead of 3rd set | Tennis                 |
| Play to 11/15/21 | Target score, win by 2                | Pickleball             |
| Rally scoring    | Every point scored                    | Pickleball             |

---

# 2. Tournament Feature

## 2.1 Overview

### 2.1.1 Definition

A tournament is a **single-event competition** with:

- Fixed number of participants
- Defined bracket structure
- One winner determined through elimination
- Complete lifecycle: creation → registration → bracket → matches → winner

### 2.1.2 User Roles

| Role             | Permissions                                                           |
| ---------------- | --------------------------------------------------------------------- |
| **Organizer**    | Full control: create, edit, manage participants, update scores, close |
| **Co-Organizer** | Same as organizer (assigned by organizer)                             |
| **Participant**  | Register, report scores, view bracket                                 |
| **Spectator**    | View bracket and results (if public tournament)                       |

### 2.1.3 Tournament States

```
DRAFT → REGISTRATION_OPEN → REGISTRATION_CLOSED → IN_PROGRESS → COMPLETED → ARCHIVED
```

| State               | Description                       |
| ------------------- | --------------------------------- |
| DRAFT               | Created, not visible to users     |
| REGISTRATION_OPEN   | Accepting registrations           |
| REGISTRATION_CLOSED | Full or manually closed           |
| IN_PROGRESS         | Bracket generated, matches active |
| COMPLETED           | Winner declared                   |
| ARCHIVED            | Finalized, read-only              |

## 2.2 Creation & Configuration

### 2.2.1 Required Fields

| Field           | Type     | Constraints  | Description                       |
| --------------- | -------- | ------------ | --------------------------------- |
| name            | string   | 1-100 chars  | Tournament name                   |
| startDate       | datetime | > now        | First match date                  |
| endDate         | datetime | >= startDate | Last match date                   |
| maxParticipants | integer  | 4, 8, 16, 32 | Bracket size (must be power of 2) |

### 2.2.2 Optional Fields

| Field       | Type   | Default | Description                             |
| ----------- | ------ | ------- | --------------------------------------- |
| visibility  | enum   | PRIVATE | PUBLIC / PRIVATE                        |
| venue       | string | null    | Club, address                           |
| surface     | enum   | HARD    | CLAY / GRASS / HARD / CARPET / INDOOR   |
| category    | enum[] | []      | MALE / FEMALE / MIXED / JUNIOR / SENIOR |
| level       | enum   | OPEN    | OPEN / INTERMEDIATE / BEGINNER          |
| description | string | ""      | Rules, additional info                  |
| logoUrl     | string | null    | Tournament image                        |

### 2.2.3 Format Configuration

| Field              | Type    | Default            | Options                                |
| ------------------ | ------- | ------------------ | -------------------------------------- |
| bracketType        | enum    | SINGLE_ELIMINATION | SINGLE_ELIMINATION, DOUBLE_ELIMINATION |
| matchFormat        | enum    | TWO_OF_THREE       | ONE_SET, TWO_OF_THREE, THREE_OF_FIVE   |
| gamesPerSet        | integer | 6                  | 4, 6, 8                                |
| tieBreakInFinalSet | boolean | true               | True = 7-point TB                      |
| tieBreakInLastSet  | enum    | SUPER_TB           | NONE, STANDARD_7PT, SUPER_TB (10pt)    |
| hasDoubles         | boolean | false              | Enable doubles bracket                 |
| seedingEnabled     | boolean | true               | Allow seeding                          |
| maxSeeds           | integer | 4                  | 0, 2, 4, 8                             |

### 2.2.4 Doubles Configuration (if enabled)

| Field             | Type    | Description          |
| ----------------- | ------- | -------------------- |
| teamSize          | integer | 2 = standard doubles |
| allowMixedDoubles | boolean | Allow M/F pairs      |

## 2.3 Registration

### 2.3.1 Registration Modes

| Mode        | Description                        | Use Case            |
| ----------- | ---------------------------------- | ------------------- |
| OPEN        | Users self-register                | Public tournaments  |
| INVITE_ONLY | Organizer invites                  | Private tournaments |
| APPROVAL    | Self-register + organizer approval | Limited spots       |

### 2.3.2 Registration Flow

```
1. User clicks "Register"
2. If APPROVAL → status = PENDING
3. If OPEN → status = CONFIRMED
4. If spots full → waitlist triggered
```

### 2.3.3 Waitlist

- When registration reaches maxParticipants
- New registrations go to WAITLIST (FIFO)
- If confirmed player withdraws → first waitlist player promoted automatically
- Organizer notified of waitlist position changes

### 2.3.4 Registration Fields (from user)

| Field    | Required | Description                                    |
| -------- | -------- | ---------------------------------------------- |
| userId   | yes      | Reference to user                              |
| seedRank | no       | Self-declared ranking (1, 2, 3...) for seeding |
| notes    | no       | Any notes for organizer                        |

### 2.3.5 Player Statuses

| Status       | Description             |
| ------------ | ----------------------- |
| REGISTERED   | Confirmed participant   |
| PENDING      | Awaiting approval       |
| WAITLISTED   | On waitlist             |
| WITHDRAWN    | withdrew before bracket |
| DISQUALIFIED | Removed by organizer    |

## 2.4 Bracket Generation

### 2.4.1 Trigger

Organizer clicks "Generate Bracket" after registration closes.

### 2.4.2 Generation Rules

1. **Bracket size**: Next power of 2 (4, 8, 16, 32)
   - If participants < max, use next smaller power of 2
   - If odd number, one BYE in first round

2. **Seeding algorithm**:

   ```
   a. Sort registered players by seedRank (ascending)
   b. Place seeds in positions:
      - Seed 1: Position 1 (final spot)
      - Seed 2: Position 2 (final spot)
      - Seeds 3-4: Positions 3 and 4 quadrant
      - Seeds 5-8: Positions 5-8 eighth
   c. If seeding disabled: random shuffle
   ```

3. **BYE placement**:
   - If BYEs needed, place in first round only
   - BYEs awarded to highest-seeded players
   - BYE = automatic win to next round

### 2.4.3 Bracket Types

**Single Elimination**

```
Quarter Finals → Semi Finals → Finals → Winner
(8 players: 3 rounds)
```

**Double Elimination** (v2)

```
Winners Bracket → Losers Bracket → Grand Finals
(If winner bracket winner wins first Grand Finals match, wins tournament)
```

### 2.4.4 Bracket Structure (JSON model)

```json
{
  "tournamentId": "uuid",
  "rounds": [
    {
      "roundNumber": 1,
      "matches": [
        {
          "matchId": "uuid",
          "position": 1,
          "player1": { "userId": "uuid", "seed": 1 },
          "player2": { "userId": "uuid", "seed": 8 },
          "winner": null,
          "score": null,
          "status": "PENDING"
        }
      ]
    }
  ]
}
```

## 2.5 Match Management

### 2.5.1 Score Entry

**Entry by:** Player (self-report) or Organizer

**Score formats:**

| Format    | Entry                           | Example              |
| --------- | ------------------------------- | -------------------- |
| Sets      | "games-games, games-games, ..." | 6-4, 4-6, 6-4        |
| Tie-break | "games-games [TB]"              | 6-7(2), 7-6(5)       |
| Retired   | "[score] RET"                   | 4-6 RET              |
| W/O       | "W/O"                           | Walkover ( auto-win) |

**Validation rules:**

1. Score must be valid for format
2. If 2-of-3: winner must win 2 sets
3. Winner determined automatically from score
4. Organizer can override (journal log required)

### 2.5.2 Match States

| State       | Description                        |
| ----------- | ---------------------------------- |
| PENDING     | Scheduled, not played              |
| IN_PROGRESS | Started, not completed             |
| COMPLETED   | Score validated, winner determined |
| RETIRED     | Player retired mid-match           |
| WALKOVER    | Opponent no-show                   |
| DISPUTED    | Score disputed (organizer review)  |

### 2.5.3 Auto-Advancement

When match marked COMPLETED:

1. Winner extracted from score
2. Winner placed in next round bracket position
3. Bracket updated for all viewers
4. Next match status → PENDING

### 2.5.4 Score Entry UI

```
Match: [Player A] vs [Player B]
─────────────────────────────────
Set 1: [___] - [___]
Set 2: [___] - [___]
Set 3: [___] - [___] (if applicable)
─────────────────────────────────
[ ] Retired    [ ] Walkover
[Submit Score]
```

## 2.6 Manual Modifications

### 2.6.1 Allowed Modifications (Before Match Starts)

| Action | Description                                          |
| ------ | ---------------------------------------------------- |
| Swap   | Exchange two players in different matches            |
| Move   | Drag player to different match slot                  |
| Add    | Insert player into empty slot                        |
| Remove | Remove player from slot (returns to registered list) |

### 2.6.2 Modifications (After Match Starts)

- **Score correction**: Organizer can edit any score
- **Winner override**: Organizer can change winner (recalculates bracket)
- **Match replay**: Organizer can reset match to PENDING

### 2.6.3 Confirmation Requirement

```text
⚠️ "Swapping [Player A] with [Player B] will overwrite the generated bracket. Continue?"
[Cancel] [Confirm]
```

### 2.6.4 Audit Log

All modifications logged:

```json
{
  "action": "SWAP_PLAYERS",
  "timestamp": "2026-01-15T10:30:00Z",
  "actorId": "organizer-id",
  "before": { "player1": "A", "match": 1 },
  "after": { "player1": "B", "match": 1 }
}
```

## 2.7 Completion

### 2.7.1 Winner Determination

Automatic when:

1. Final match marked COMPLETED
2. Winner populated from score

### 2.7.2 Tournament Closure

Organizer clicks "Close Tournament":

- All results finalized
- Tournament → COMPLETED state
- Participants notified
- Winner displayed on home page

### 2.7.3 Export

- Bracket PDF with all results
- Participant list with seeds and final positions

---

# 3. League Feature

## 3.1 Overview

### 3.1.1 Definition

A league is a **recurring competitive structure** with:

- Permanent membership (roster)
- Seasonal ranking periods
- Session-based match sheets
- Point-based ranking within seasons

### 3.1.2 Hierarchy

```
LEAGUE (permanent)
  └── SEASONS (temporary)
        └── SESSIONS (dates)
              └── MATCHES
```

### 3.1.3 User Roles

| Role              | Permissions                                                               |
| ----------------- | ------------------------------------------------------------------------- |
| **Organizer**     | Full control: create, configure, manage seasons/sessions, validate scores |
| **Co-Organizer**  | Same as organizer (assigned by organizer)                                 |
| **Member**        | Participate, confirm sessions, enter scores, view ranking                 |
| **Former Member** | Historical access, no participation                                       |

### 3.1.4 League States

| State  | Description                             |
| ------ | --------------------------------------- |
| ACTIVE | Open for membership, sessions scheduled |
| PAUSED | Membership closed, no new sessions      |
| CLOSED | No longer active (read-only archive)    |

## 3.2 League Creation

### 3.2.1 Required Fields

| Field       | Type   | Description                       |
| ----------- | ------ | --------------------------------- |
| name        | string | League name                       |
| visibility  | enum   | PUBLIC / PRIVATE                  |
| disciplines | enum[] | TENNIS, PICKLEBALL (both allowed) |

### 3.2.2 Optional Fields

| Field       | Default | Description                  |
| ----------- | ------- | ---------------------------- |
| venue       | null    | Club, location               |
| surfaces    | []      | Court surface preference     |
| categories  | []      | MALE / FEMALE / MIXED / etc. |
| level       | OPEN    | Skill level                  |
| description | ""      | Rules text                   |
| logoUrl     | null    | League image                 |
| groupId     | null    | Associated group             |

### 3.2.3 Default Rules

| Field         | Default      | Description                     |
| ------------- | ------------ | ------------------------------- |
| matchFormat   | TWO_OF_THREE | Score format                    |
| gamesPerSet   | 6            | Games per set                   |
| enableDoubles | false        | Allow doubles                   |
| pointWin      | 10           | Points for win                  |
| pointLoss     | 1            | Points for loss (participation) |
| pointNoShow   | -5           | Points for no-show              |
| enableBonuses | false        | Bonus points system             |

## 3.3 Membership

### 3.3.1 Join Modes

| Mode     | Description                  |
| -------- | ---------------------------- |
| OPEN     | User self-joins              |
| INVITE   | Organizer invites            |
| APPROVAL | Request + organizer approval |

### 3.3.2 Member Status

| Status    | Description                 |
| --------- | --------------------------- |
| ACTIVE    | Can participate in sessions |
| PENDING   | Awaiting approval           |
| SUSPENDED | Temporarily blocked         |
| INACTIVE  | Former member               |

### 3.3.3 Member Actions

- **Join**: Request to join league
- **Leave**: Voluntarily leave (with warning about season ranking impact)
- **Invite**: Organizer adds user

### 3.3.4 Quitting Mid-Season Impact

```
Quitting player:
- Retains ranking from completed sessions
- Marked as INACTIVE for current season
- Cannot rejoin same season
- Future seasons: can rejoin normally
```

## 3.4 Seasons

### 3.4.1 Season Definition

| Field         | Type   | Description                    |
| ------------- | ------ | ------------------------------ |
| leagueId      | uuid   | Parent league                  |
| name          | string | e.g., "Winter 2026"            |
| startDate     | date   | Season start                   |
| endDate       | date   | Season end                     |
| status        | enum   | DRAFT / OPEN / CLOSED          |
| rulesOverride | json   | Season-specific rule overrides |

### 3.4.2 Season Rules Override

Rules can be copied from league and optionally modified per season:

```json
{
  "pointWin": 10,
  "pointLoss": 1,
  "pointNoShow": -5,
  "enableBonuses": false,
  "matchFormat": "TWO_OF_THREE",
  "gamesPerSet": 6,
  "formatsAllowed": ["SINGLES", "DOUBLES"]
}
```

**Key principle:** Rules locked when season Opens. Cannot change mid-season.

### 3.4.3 Season States

| State  | Description                     |
| ------ | ------------------------------- |
| DRAFT  | Created, not started            |
| OPEN   | Active, sessions can be created |
| CLOSED | Ended, ranking final            |

### 3.4.4 Opening Season

Organizer clicks "Open Season":

1. Clone rules from league (or apply overrides)
2. Season → OPEN
3. Members notified
4. Initial ranking = empty (no matches played)

### 3.4.5 Closing Season

Organizer clicks "Close Season":

1. Final ranking calculated
2. All session results included
3. Season → CLOSED
4. Final standings exported
5. Summary generated (wins, losses, participation %)

## 3.5 Sessions

### 3.5.1 Session Definition

| Field          | Type     | Description                              |
| -------------- | -------- | ---------------------------------------- |
| seasonId       | uuid     | Parent season                            |
| name           | string   | e.g., "Session #3"                       |
| scheduledDate  | datetime | Date & time                              |
| venue          | string   | Location                                 |
| capacity       | integer  | Max players (optional)                   |
| formatsAllowed | enum[]   | SINGLES, DOUBLES (inherited or override) |
| status         | enum     | DRAFT / PUBLISHED / COMPLETED            |

### 3.5.2 Session States

| State       | Description                                |
| ----------- | ------------------------------------------ |
| DRAFT       | Created, not visible to members            |
| PUBLISHED   | Open for confirmations                     |
| IN_PROGRESS | Confirmations closed, matches being played |
| COMPLETED   | All scores entered, ranking updated        |

### 3.5.3 Confirmations

**Flow:**

```
1. Session PUBLISHED
2. Members received notification
3. Members: CONFIRM / DECLINE / PENDING
4. Organizer sets confirmation deadline
5. After deadline: auto-close confirmations
```

**Presence Statuses:**

| Status    | Description       |
| --------- | ----------------- |
| CONFIRMED | Will play         |
| DECLINED  | Will not play     |
| PENDING   | Has not responded |

### 3.5.4 Capacity Handling

If session has capacity (max players):

- Confirmations limited to capacity
- Excess confirmations → waitlist (FIFO)
- When confirmed player declines → waitlist player promoted

## 3.6 Match Sheet Generation

### 3.6.1 Algorithm Overview

This is the core league algorithm. Process:

```
INPUTS:
- Confirmed players list
- Player rankings (from season)
- Session constraints (capacity, rounds, formats)

PROCESS:
1. Filter to confirmed players
2. Determine pairing mode
3. Generate pairings
4. Apply fairness constraints
5. Generate round/court assignments

OUTPUT:
- Match sheet (list of matches)
```

### 3.6.2 Pairing Modes

| Mode         | Description                      | Algorithm                    |
| ------------ | -------------------------------- | ---------------------------- |
| RANDOM       | Shuffle all                      | Shuffle → sequential pair    |
| BY_RANK      | Highest vs lowest                | Sort by rank → pair extremes |
| AVOID_REPEAT | No H2H in last N sessions        | Filter, then random/rank     |
| SWISS        | Round-robin with pairing by rank | For larger groups            |

### 3.6.3 BY_RANK Algorithm (Default)

Recommended for MVP. Process:

```
1. Sort confirmed players by season ranking (descending)
2. Pair: #1 vs #2, #3 vs #4, etc.
3. For doubles: pair #1+#2, #3+#4, etc.

If odd number:
- One BYE (automatic participation point, no match)
- Highest-ranked gets BYE

Example (8 players):
Ranking: [A, B, C, D, E, F, G, H]
Pairs:    [AvB, CvD, EvF, GvH]
```

### 3.6.4 AVOID_REPEAT Algorithm (v2)

For repeat-avoidance:

```
1. Calculate H2H matrix for all confirmed players
2. For each potential pairing:
   - Check: has this pair played in last N sessions?
   - If yes: mark as "avoid"
3. Generate possible pairings avoiding "avoid" pairs
4. If no valid pairing exists → fall back to BY_RANK
```

### 3.6.5 Rounds and Courts

| Config        | Description                      |
| ------------- | -------------------------------- |
| rounds        | Number of rounds (typically 1-3) |
| courts        | Number of available courts       |
| matchDuration | Planned duration per match       |

**Round-robin per round:**

```
Session: 8 players, 2 courts, 2 rounds

Round 1:
- Court 1: Match 1 (Players 1,2 vs 3,4)
- Court 2: Match 2 (Players 5,6 vs 7,8)

Round 2:
- Court 1: Match 3 (Players 1,2 vs 5,6)
- Court 2: Match 4 (Players 3,4 vs 7,8)
```

### 3.6.6 Doubles Pairing (v2)

For doubles sessions:

```
Algorithm: Balanced Sums

1. Calculate each player's ranking
2. For all possible pairs (combination of 4 players):
   - Calculate "team strength" = sum of rankings
3. Generate matches with balanced sums:
   - Team A (sum=10) vs Team B (sum=10) ideal
   - Maximum difference = threshold (e.g., 3 points)
4. If no balanced pairing found → fallback to random
```

### 3.6.7 Match Sheet States

| State     | Description                       |
| --------- | --------------------------------- |
| DRAFT     | Generated, editable by organizer  |
| PUBLISHED | Sent to members, visible          |
| LOCKED    | Scores being entered (no changes) |
| COMPLETED | All scores validated              |

### 3.6.8 Manual Editing

Organizer can edit before PUBLISHED:

- Swap players between matches
- Change match format
- Add/remove matches
- Lock specific matches (preserve from auto-regen)

**Confirmation requirement for all manual edits:**

```text
⚠️ "This edit will override the generated match pairing. Continue?"
[Cancel] [Confirm]
```

### 3.6.9 Post-Publication Changes

**Allowed with notification:**

- Replace withdrawn player with waitlist player
- Re-generate non-locked matches
- Adjust timings

**Not allowed:**

- Manual edits without notification

All changes → Audit log + member notifications.

## 3.7 Score Entry

### 3.7.1 Entry Process

**Entry by:** Player (self-report) or Organizer

**Score formats:**

| Format      | Entry                      | Example  |
| ----------- | -------------------------- | -------- |
| Tennis sets | "games-games, games-games" | 6-4, 6-3 |
| Pickleball  | "points-points"            | 11-8     |
| Retired     | "[score] RET"              | 4-6 RET  |
| No-show     | "NS"                       | 0-0 NS   |

### 3.7.2 Validation

1. Score format must match session rules
2. Winner determined automatically
3. Organizer validation required

**Validation workflow:**

```
1. Player enters score
2. Status = PENDING_VALIDATION
3. Organizer reviews
4. If valid → VALIDATED
5. If invalid → REJECTED (player can resubmit)
```

### 3.7.3 Points Calculation

**Standard (MVP):**

```
Winner: +10 points
Loser: +1 point (participation)
No-show: -5 points (applies to no-show player)
```

**With Bonuses (v2):**

```
Win in 2 sets (tennis): +2 bonus
Win without losing game: +1 bonus
Fair-play: +1 bonus
```

### 3.7.4 Ranking Update

When session → COMPLETED:

```
1. For each match:
   - Award points to winner: +10
   - Award points to loser: +1
   - Apply bonuses/malus
2. Recalculate all member rankings for season
3. Publish updated ranking
4. Notify members
```

## 3.8 Ranking System

### 3.8.1 Ranking Calculation

```
Season Ranking:
  - Total points from all match results
  - Sort by points (descending)
  - Tie-breaker: Win count, then H2H, then games difference
```

### 3.8.2 Tie-Breaking (in order)

| Priority | Criterion                                |
| -------- | ---------------------------------------- |
| 1        | Total points                             |
| 2        | Head-to-head (H2H)                       |
| 3        | Set difference (sets won - sets lost)    |
| 4        | Game difference (games won - games lost) |
| 5        | Participation %                          |
| 6        | Random (journalized)                     |

### 3.8.3 Ranking Display

```
┌─────┬──────────┬────────┬─────┬─────┬────────┐
│ RANK│ PLAYER   │ POINTS │ W/L │ +/-│ PARTICIPATION │
├─────┼──────────┼────────┼─────┼─────┼────────┤
│ 1   │ John D   │ 45     │ 4/1 │ +12│ 80%       │
│ 2   │ Jane S   │ 42     │ 4/2 │ +8 │ 100%      │
│ 3   │ Bob M    │ 38     │ 3/2 │ +5 │ 60%       │
└─────┴──────────┴────────┴─────┴─────┴────────┘
```

### 3.8.4 Ranking Privacy

| League Visibility | Ranking Visible To  |
| ----------------- | ------------------- |
| PUBLIC            | Everyone            |
| MEMBERS_ONLY      | League members only |
| PRIVATE           | Organizers only     |

## 3.9 Bonuses and Malus (v2)

### 3.9.1 Configurable Bonuses

| Bonus            | Points | Condition              |
| ---------------- | ------ | ---------------------- |
| Participation    | +1     | Played match           |
| Straight Set Win | +2     | Won without losing set |
| Shutout          | +1     | 6-0, 6-0 or 11-0       |
| Fair Play        | +1     | No code violations     |

### 3.9.2 Configurable Malus

| Malus           | Points | Condition             |
| --------------- | ------ | --------------------- |
| No-show         | -5     | Did not show up       |
| Late Withdrawal | -3     | Withdrew < 24h before |
| Match Forfeit   | -3     | Retired during match  |

## 3.10 Notifications

### 3.10.1 Notification Events

| Event               | Channel       | Timing               |
| ------------------- | ------------- | -------------------- |
| Season opened       | In-app, Email | Immediate            |
| Session published   | In-app, Email | Immediate            |
| Session reminder    | In-app        | 24h before           |
| Your match starting | In-app        | 1h before            |
| Score missing       | In-app        | 2h after session end |
| Session completed   | In-app        | Immediate            |
| Ranking updated     | In-app        | Immediate            |
| League closed       | In-app, Email | Immediate            |

### 3.10.2 Notification Preferences

Users can configure:

- In-app: ON/OFF
- Email: ON/OFF
- SMS: ON/OFF (if enabled)

---

# 4. Data Models

## 4.1 Tournament Models

```typescript
interface Tournament {
  id: string;
  name: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  venue?: string;
  surface: Surface;
  categories: Category[];
  level: Level;
  description?: string;
  logoUrl?: string;

  // Config
  maxParticipants: 4 | 8 | 16 | 32;
  bracketType: 'SINGLE_ELIMINATION' | 'DOUBLE_ELIMINATION';
  matchFormat: MatchFormat;
  gamesPerSet: 4 | 6 | 8;
  tieBreakInLastSet: 'NONE' | 'STANDARD' | 'SUPER_TB';
  hasDoubles: boolean;
  seedingEnabled: boolean;
  maxSeeds: 0 | 2 | 4 | 8;

  // Lifecycle
  status: TournamentStatus;
  startDate: DateTime;
  endDate: DateTime;

  // Relations
  organizerId: string;
  coOrganizerIds: string[];
  groupId?: string;

  createdAt: DateTime;
  updatedAt: DateTime;
}

type TournamentStatus =
  | 'DRAFT'
  | 'REGISTRATION_OPEN'
  | 'REGISTRATION_CLOSED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'ARCHIVED';

interface TournamentRegistration {
  id: string;
  tournamentId: string;
  userId: string;
  status: 'REGISTERED' | 'PENDING' | 'WAITLISTED' | 'WITHDRAWN' | 'DISQUALIFIED';
  seedRank?: number;
  registeredAt: DateTime;
  position?: number; // Bracket position when generated
}

interface TournamentMatch {
  id: string;
  tournamentId: string;
  roundNumber: number;
  matchPosition: number; // 1, 2, 3... within round

  player1Id?: string;
  player2Id?: string;
  winnerId?: string;

  score?: string; // Serialized score
  matchStatus: MatchStatus;
  playedAt?: DateTime;

  nextMatchId?: string; // Winner advances to...
}

type MatchStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'RETIRED' | 'WALKOVER' | 'DISPUTED';
```

## 4.2 League Models

```typescript
interface League {
  id: string;
  name: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  venue?: string;
  surfaces: Surface[];
  categories: Category[];
  level: Level;
  disciplines: ('TENNIS' | 'PICKLEBALL')[];
  description?: string;
  logoUrl?: string;
  groupId?: string;

  // Default Rules
  defaultRules: LeagueRules;

  status: 'ACTIVE' | 'PAUSED' | 'CLOSED';

  organizerId: string;
  coOrganizerIds: string[];

  createdAt: DateTime;
  updatedAt: DateTime;
}

interface LeagueRules {
  pointWin: number;
  pointLoss: number;
  pointNoShow: number;
  enableBonuses: boolean;
  matchFormat: MatchFormat;
  gamesPerSet: number;
  enableDoubles: boolean;
  formatsAllowed: Format[]; // SINGLES, DOUBLES
}

interface LeagueMember {
  id: string;
  leagueId: string;
  userId: string;
  role: 'MEMBER' | 'ORGANIZER' | 'CO_ORGANIZER';
  status: 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'INACTIVE';
  joinedAt: DateTime;
  leftAt?: DateTime;
}

interface Season {
  id: string;
  leagueId: string;
  name: string;
  startDate: Date;
  endDate: Date;
  status: 'DRAFT' | 'OPEN' | 'CLOSED';
  rulesOverride?: Partial<LeagueRules>;
  finalStandingsSnapshot?: SeasonRanking[]; // Saved on close

  createdAt: DateTime;
  closedAt?: DateTime;
}

interface SeasonRanking {
  id: string;
  seasonId: string;
  userId: string;

  points: number;
  wins: number;
  losses: number;
  draws: number;
  setsWon: number;
  setsLost: number;
  gamesWon: number;
  gamesLost: number;

  matchesPlayed: number;
  matchesConfirmed: number;

  rank: number;
  lastUpdated: DateTime;
}

interface Session {
  id: string;
  seasonId: string;
  name: string;
  scheduledDate: DateTime;
  venue?: string;
  capacity?: number; // Max players
  formatsAllowed: Format[];
  matchFormat?: MatchFormat;

  status: 'DRAFT' | 'PUBLISHED' | 'IN_PROGRESS' | 'COMPLETED';

  createdAt: DateTime;
  publishedAt?: DateTime;
  completedAt?: DateTime;
}

interface SessionPresence {
  id: string;
  sessionId: string;
  userId: string;
  status: 'CONFIRMED' | 'DECLINED' | 'PENDING';
  confirmedAt?: DateTime;
}

interface SessionMatch {
  id: string;
  sessionId: string;
  roundNumber: number;
  courtNumber?: number;

  format: Format; // SINGLES or DOUBLES
  teamAPlayers: string[]; // 1 or 2 user IDs
  teamBPlayers: string[]; // 1 or 2 user IDs

  score?: string;
  winnerTeam?: 'A' | 'B';
  status: 'PENDING' | 'COMPLETED';
  locked: boolean; // Cannot be auto-regenerated

  playedAt?: DateTime;
}

interface MatchScore {
  id: string;
  matchId: string;
  submittedBy: string;
  validatedBy?: string;

  score: string;
  outcome: 'WIN' | 'LOSS' | 'DRAW' | 'RETIRED' | 'NO_SHOW';

  status: 'PENDING' | 'VALIDATED' | 'REJECTED';
  validatedAt?: DateTime;

  createdAt: DateTime;
}
```

## 4.3 Audit Model

```typescript
interface AuditLog {
  id: string;
  scope: 'TOURNAMENT' | 'LEAGUE' | 'SEASON' | 'SESSION' | 'MATCH';
  entityId: string;
  action: string;
  actorId: string;

  payloadBefore?: Record<string, any>;
  payloadAfter?: Record<string, any>;

  timestamp: DateTime;
}
```

---

# 5. Algorithms

## 5.1 Tournament Bracket Generation

```typescript
function generateBracket(
  participants: TournamentRegistration[],
  config: { maxSeeds: number }
): Bracket {
  // 1. Filter to confirmed participants
  const confirmed = participants
    .filter(p => p.status === 'REGISTERED')
    .sort((a, b) => (a.seedRank ?? 999) - (b.seedRank ?? 999));

  // 2. Determine bracket size (power of 2)
  const bracketSize = Math.pow(2, Math.ceil(Math.log2(confirmed.length)));

  // 3. Calculate BYEs
  const byes = bracketSize - confirmed.length;

  // 4. Placement algorithm:
  // Seeds 1 & 2 get BYEs if needed
  // Others fill by round

  const matches: Match[] = [];
  for (let round = 1; bracketSize / Math.pow(2, round) >= 1; round++) {
    const matchesInRound = bracketSize / Math.pow(2, round);
    for (let i = 0; i < matchesInRound; i++) {
      matches.push({
        round,
        position: i + 1,
        player1: determinePlayer(bracketSize, i * 2, confirmed, seeds),
        player2: determinePlayer(bracketSize, i * 2 + 1, confirmed, seeds),
      });
    }
  }

  return matches;
}
```

## 5.2 League Match Sheet Generation (MVP)

```typescript
function generateMatchSheet(
  confirmedPlayers: SeasonRanking[],
  sessionConfig: { rounds: number }
): SessionMatch[] {
  // 1. Sort by ranking (descending)
  const sorted = [...confirmedPlayers].sort((a, b) => b.points - a.points);

  // 2. Simple pairing: 1v2, 3v4, 5v6...
  const matches: SessionMatch[] = [];

  for (let round = 1; round <= sessionConfig.rounds; round++) {
    // Rotate for subsequent rounds
    const rotated = rotateArray(sorted, round - 1);

    for (let i = 0; i < rotated.length / 2; i++) {
      matches.push({
        roundNumber: round,
        courtNumber: i + 1,
        teamA: [rotated[i * 2]],
        teamB: [rotated[i * 2 + 1]],
      });
    }
  }

  return matches;
}

function rotateArray<T>(arr: T[], rotations: number): T[] {
  const splitIdx = rotations % arr.length;
  return [...arr.slice(splitIdx), ...arr.slice(0, splitIdx)];
}
```

## 5.3 Ranking Calculation

```typescript
function calculateSeasonRanking(
  seasonMatches: SessionMatch[],
  seasonMembers: LeagueMember[]
): SeasonRanking[] {
  const rankings: Map<string, SeasonRanking> = new Map();

  // Initialize
  for (const member of seasonMembers) {
    rankings.set(member.userId, {
      userId: member.userId,
      points: 0,
      wins: 0,
      losses: 0,
      // ...initialize all fields
    });
  }

  // Process matches
  for (const match of seasonMatches) {
    if (match.status !== 'COMPLETED') continue;

    const winnerTeam = match.winnerTeam === 'A' ? match.teamA : match.teamB;
    const loserTeam = match.winnerTeam === 'A' ? match.teamB : match.teamA;

    // Add points
    for (const userId of winnerTeam) {
      const r = rankings.get(userId)!;
      r.points += 10;
      r.wins++;
    }

    for (const userId of loserTeam) {
      const r = rankings.get(userId)!;
      r.points += 1;
      r.losses++;
    }
  }

  // Sort and assign ranks
  return Array.from(rankings.values())
    .sort((a, b) => b.points - a.points || b.wins - a.losses)
    .map((r, idx) => ({ ...r, rank: idx + 1 }));
}
```

---

# 6. Edge Cases & Anomalies

## 6.1 Tournament Edge Cases

| Scenario                                  | Handling                                                 |
| ----------------------------------------- | -------------------------------------------------------- |
| Player withdraws before bracket generated | Remove from registration → notify next waitlist          |
| Player withdraws after bracket generated  | Replace with BYE (auto-advance opponent)                 |
| Player no-show for match                  | Opponent wins by WALKOVER                                |
| Score discrepancy                         | Organizer override → log original + new                  |
| Player disputes match                     | Match status → DISPUTED → organizer review               |
| Tournament canceled mid-bracket           | Archive as CANCELED → retain partial results             |
| Weather/venue failure                     | Organizer can reschedule matches (keep bracket position) |
| Tie in semifinals (both want to progress) | coin flip → journalize                                   |

## 6.2 League Edge Cases

| Scenario                        | Handling                                      |
| ------------------------------- | --------------------------------------------- |
| Odd number of confirmed players | Highest ranked gets BYE (participation point) |
| Player confirms then withdraws  | Remove from sheet → notify waitlist           |
| Session too few players (<4)    | Organizer can: cancel, re-pair, or BYE all    |
| Session too many confirmations  | Waitlist → FIFO, excess notified              |
| Score entry disagreement        | Organizer validation decisive                 |
| Player quit mid-season          | Keep historical points, mark inactive         |
| Player no-show                  | -5 points, match awarded to opponent          |
| Season with 0 matches           | Ranking = empty, no tie-breakers needed       |
| Disputed score                  | Organizer review → override → log             |
| Late score entry                | Up to 48h after session → organizer validates |
| Session rescheduled             | Regenerate sheet if < 24h notice              |
| Match interrupted (weather)     | Move to next session or BYE both              |

## 6.3 Data Conflicts

| Scenario                                        | Handling                                          |
| ----------------------------------------------- | ------------------------------------------------- |
| Two organizers edit simultaneously              | Optimistic locking: last-write-wins, log conflict |
| Match sheet modified after player entered score | Alert player → re-validate                        |
| Season closed while session in progress         | Warn → complete session first or discard          |
| User in 2 leagues tries same time slot          | Allow (no cross-league locking)                   |

## 6.4 Privacy Edge Cases

| Scenario                       | Handling                         |
| ------------------------------ | -------------------------------- |
| Private league member list     | Hidden from non-members          |
| Ranked player in closed season | Snapshot preserved, not editable |
| User deletes account           | Anonymize data, keep statistics  |

---

# 7. Integration Points

## 7.1 Existing RALLIA Features

### User System

- Use existing `User` model for all user references
- Use existing authentication for all role checks

### Groups

- Option to link League/Tournament to Group
- League/Tournament can be "group-only" visibility

### Notifications

- Reuse existing notification infrastructure
- Add new event types: `LEAGUE_SESSION_REMINDER`, `TOURNAMENT_START`, etc.

### Calendar

- Sessions and tournaments should appear in user calendar
- Sync with iCal export (future)

### Matching/Lobby (existing)

- Consider reusing "Find Match" logic for league invitation

## 7.2 Future Integrations (v2+)

| Integration          | Description                   |
| -------------------- | ----------------------------- |
| Club reservation     | Auto-book courts for sessions |
| USTA/ITF sync        | Import/export rankings        |
| Video streaming      | Link to match streams         |
| Betting/gamification | Future feature                |
| Analytics dashboard  | League/Tournament statistics  |

---

# 8. Roadmap

## MVP (v1) — 8 weeks

| Feature                            | Priority |
| ---------------------------------- | -------- |
| Tournament creation (4-32 players) | P0       |
| Tournament registration            | P0       |
| Single elimination bracket         | P0       |
| Manual bracket edits               | P0       |
| Score entry                        | P0       |
| Tournament completion              | P0       |
| League creation                    | P0       |
| League membership                  | P0       |
| Season open/close                  | P0       |
| Session creation                   | P0       |
| Confirmations                      | P0       |
| Round-robin match sheet            | P0       |
| Score entry                        | P0       |
| Ranking calculation                | P0       |
| Audit logging                      | P1       |
| Notifications (in-app)             | P1       |

## v1.1 — 4 weeks

| Feature               | Priority |
| --------------------- | -------- |
| Tournament waitlist   | P0       |
| Tournament doubles    | P1       |
| Session capacity      | P0       |
| Session rounds        | P0       |
| Doubles match sheet   | P1       |
| Bonuses system        | P1       |
| Export rankings (CSV) | P1       |

## v2 — 6 weeks

| Feature                    | Priority |
| -------------------------- | -------- |
| Double elimination bracket | P1       |
| AVOID_REPEAT pairing       | P1       |
| Balanced doubles pairing   | P1       |
| Swiss system               | P2       |
| Elo rating                 | P2       |
| Season rule overrides      | P1       |
| Multiple disciplines       | P2       |
| API integrations           | P2       |

---

# Appendix A: Error Codes

| Code                  | Description              |
| --------------------- | ------------------------ |
| TOURNAMENT_FULL       | Registration at max      |
| TOURNAMENT_CLOSED     | Registration closed      |
| REGISTRATION_PENDING  | Awaiting approval        |
| SESSION_FULL          | Capacity reached         |
| SESSION_NOT_PUBLISHED | Cannot modify published  |
| MATCH_LOCKED          | Cannot edit locked match |
| SCORE_INVALID         | Format error             |
| RANKING_CONFLICT      | Simultaneous edge        |

---

# Appendix B: Glossary

| Term        | Definition                                        |
| ----------- | ------------------------------------------------- |
| BYE         | Automatic advancement without playing             |
| Seed        | Pre-ranked player with protected bracket position |
| Walkover    | Win by opponent no-show                           |
| Retirement  | Opponent stops mid-match                          |
| Super TB    | 10-point tie-break                                |
| Session     | Single play date in league                        |
| Season      | Time-bounded competitive period                   |
| Match Sheet | Generated pairings for session                    |
| Bracket     | Tournament elimination structure                  |

---

**End of Specification**
