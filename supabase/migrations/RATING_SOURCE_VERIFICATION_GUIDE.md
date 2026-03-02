# Rating Source and Verification System - Schema Changes

## Overview
This document explains the database schema changes to support the new rating source and peer verification system.

## Problem Statement
The original schema mixed **what** (rating systems like NTRP, DUPR) with **how** (verification methods like self-assessment). We need to:
1. Separate rating systems from verification methods
2. Allow multiple ratings per player per sport with different verification levels
3. Support peer verification through match reviews
4. Track API-verified ratings from official sources (USTA, DUPR)

---

## Schema Changes

### 1. New ENUM: `rating_source_type`

```sql
CREATE TYPE rating_source_type AS ENUM (
    'self_reported',    -- User entered, not verified
    'api_verified',     -- From USTA/DUPR API (auto-verified)
    'peer_verified',    -- Verified through peer ratings
    'admin_verified'    -- Admin manually verified
);
```

**Purpose:** Distinguishes HOW a rating was obtained from WHAT rating system it uses.

---

### 2. Extended `player_review` Table

#### NEW COLUMNS:

| Column | Type | Purpose |
|--------|------|---------|
| `sport_id` | UUID | Which sport the skill rating applies to |
| `skill_rating_value` | NUMERIC | Peer-assessed skill rating (e.g., 4.5) |
| `skill_rating_score_id` | UUID | Reference to rating_score table |

#### BEFORE:
```sql
CREATE TABLE player_review (
    id UUID PRIMARY KEY,
    match_id UUID,
    reviewer_id UUID,
    reviewed_id UUID,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),  -- General review only
    comment TEXT
);
```

#### AFTER:
```sql
CREATE TABLE player_review (
    id UUID PRIMARY KEY,
    match_id UUID,
    reviewer_id UUID,
    reviewed_id UUID,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),  -- General review (1-5 stars)
    comment TEXT,
    -- NEW COLUMNS for skill rating
    sport_id UUID,                    -- Sport being rated
    skill_rating_value NUMERIC,      -- Actual NTRP/DUPR value (4.0, 4.5, etc.)
    skill_rating_score_id UUID       -- Link to rating_score
);
```

**Example Usage:**
```sql
-- After a tennis match, opponent rates player
INSERT INTO player_review (
    match_id,
    reviewer_id,
    reviewed_id,
    rating,                    -- 5 stars (great experience)
    sport_id,                  -- Tennis
    skill_rating_value,        -- 4.5 (NTRP rating)
    skill_rating_score_id      -- Reference to NTRP 4.5 in rating_score
) VALUES (...);
```

---

### 3. Extended `player_rating_score` Table

#### NEW COLUMNS:

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `source_type` | rating_source_type | 'self_reported' | How rating was obtained |
| `verification_method` | TEXT | NULL | Specific method (usta_api, video_review, etc.) |
| `peer_rating_count` | INTEGER | 0 | Number of peer ratings received |
| `peer_rating_average` | NUMERIC | NULL | Average of peer ratings |
| `is_primary` | BOOLEAN | TRUE | Primary rating to display |

#### UPDATED CONSTRAINT:

**OLD:**
```sql
UNIQUE(player_id, rating_score_id)
-- Only ONE rating per player per rating_score
```

**NEW:**
```sql
UNIQUE(player_id, rating_score_id, source_type)
-- Multiple ratings with different sources allowed
```

---

## Data Evolution Example

### Timeline: Player Rating Journey

```
┌─────────────────────────────────────────────────────────────────────────┐
│ T0: Onboarding - User enters NTRP 4.0                                   │
├──────────────────┬─────────┬────────────────┬──────────┬──────────────┤
│ rating_score_id  │ source  │ verified       │ peer_cnt │ is_primary   │
│ ntrp-4.0         │ self    │ ❌             │ 0        │ ✅           │
└──────────────────┴─────────┴────────────────┴──────────┴──────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ T1: After Match 1 - Peer rates 4.0                                      │
├──────────────────┬─────────┬────────────────┬──────────┬──────────────┤
│ rating_score_id  │ source  │ verified       │ peer_cnt │ is_primary   │
│ ntrp-4.0         │ self    │ ❌             │ 1 (4.0)  │ ✅           │
└──────────────────┴─────────┴────────────────┴──────────┴──────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ T2: After Match 5 - THRESHOLD REACHED! New entry created                │
├──────────────────┬─────────┬────────────────┬──────────┬──────────────┤
│ rating_score_id  │ source  │ verified       │ peer_cnt │ is_primary   │
│ ntrp-4.0         │ self    │ ❌             │ 5 (4.3)  │ ❌           │
│ ntrp-4.5         │ peer    │ ✅             │ 5 (4.3)  │ ✅  ← NEW!  │
└──────────────────┴─────────┴────────────────┴──────────┴──────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ T3: User fetches NTRP 4.5 from USTA API                                 │
├──────────────────┬─────────┬────────────────┬──────────┬──────────────┤
│ rating_score_id  │ source  │ verified       │ peer_cnt │ is_primary   │
│ ntrp-4.0         │ self    │ ❌             │ 5 (4.3)  │ ❌           │
│ ntrp-4.5         │ peer    │ ✅             │ 5 (4.3)  │ ❌           │
│ ntrp-4.5         │ api     │ ✅ (auto)      │ 0        │ ✅  ← NEW!  │
└──────────────────┴─────────┴────────────────┴──────────┴──────────────┘
```

---

## Verification Flows

### 1. Self-Reported → Peer-Verified

```
User enters NTRP 4.0
    ↓
Plays 5 matches, peers rate: 4.0, 4.0, 4.5, 4.5, 4.5
    ↓
Average = 4.3 → rounds to NTRP 4.5
    ↓
CREATE new entry: (ntrp-4.5, peer_verified, verified=TRUE)
    ↓
UPDATE old entry: (ntrp-4.0, self_reported, is_primary=FALSE)
```

### 2. API-Verified (Auto-Verification)

```
Fetch from USTA API → NTRP 4.5
    ↓
INSERT: (ntrp-4.5, api_verified, verified=TRUE, is_primary=TRUE)
    ↓
TRIGGER auto_verify_api_ratings() fires:
    - Sets is_verified = TRUE
    - Sets verified_at = NOW()
    - Demotes other ratings to is_primary = FALSE
```

### 3. Admin-Verified

```
Admin reviews video proof
    ↓
INSERT: (ntrp-5.0, admin_verified, verified=TRUE, verification_method='video_review')
```

---

## Helper Functions

### 1. `check_peer_verification_threshold()`

```sql
SELECT * FROM check_peer_verification_threshold('player-uuid', 'tennis-sport-id', 5);

-- Returns:
-- should_create_verified | peer_count | average_rating | recommended_rating_score_id
-- TRUE                   | 5          | 4.3            | ntrp-4.5-uuid
```

### 2. `auto_verify_api_ratings()` Trigger

Automatically runs on INSERT/UPDATE to `player_rating_score`:
- If `source_type = 'api_verified'` → set `is_verified = TRUE`
- Demote other ratings for the same sport to `is_primary = FALSE`

---

## Display Logic

### Primary Rating (What Users See First)

```sql
-- Get player's primary verified rating
SELECT 
    prs.*,
    rs.display_label,
    r.display_name as rating_type_name
FROM player_rating_score prs
JOIN rating_score rs ON prs.rating_score_id = rs.id
JOIN rating r ON rs.rating_id = r.id
WHERE prs.player_id = 'user-uuid'
  AND prs.is_primary = TRUE
ORDER BY 
    CASE prs.source_type
        WHEN 'api_verified' THEN 1
        WHEN 'admin_verified' THEN 2
        WHEN 'peer_verified' THEN 3
        WHEN 'self_reported' THEN 4
    END
LIMIT 1;
```

### All Ratings (Full Transparency)

```sql
-- Show all ratings with verification status
SELECT 
    rs.display_label,
    prs.source_type,
    prs.is_verified,
    prs.peer_rating_count,
    prs.peer_rating_average,
    prs.created_at
FROM player_rating_score prs
JOIN rating_score rs ON prs.rating_score_id = rs.id
WHERE prs.player_id = 'user-uuid'
ORDER BY prs.is_primary DESC, prs.is_verified DESC, prs.created_at DESC;
```

---

## Migration Steps

1. ✅ Run migration: `20241205000000_add_rating_source_verification.sql`
2. ✅ Verify migration completed successfully
3. 🔄 Update TypeScript types to include new columns
4. 🔄 Update SportProfile.tsx to use `source_type`
5. 🔄 Implement PeerRatingService for peer verification logic
6. 🔄 Update UI to display verification badges

---

## TypeScript Types (To Be Updated)

```typescript
// Types for new system
export type RatingSourceType = 
    | 'self_reported' 
    | 'api_verified' 
    | 'peer_verified' 
    | 'admin_verified';

export interface PlayerRatingScore {
    id: string;
    player_id: string;
    rating_score_id: string;
    source_type: RatingSourceType;
    is_verified: boolean;
    verified_at?: string;
    verified_by?: string;
    verification_method?: string;
    peer_rating_count: number;
    peer_rating_average?: number;
    is_primary: boolean;
    created_at: string;
    updated_at: string;
}

export interface PlayerReview {
    id: string;
    match_id?: string;
    reviewer_id: string;
    reviewed_id: string;
    rating: number; // 1-5 stars
    comment?: string;
    // NEW fields
    sport_id?: string;
    skill_rating_value?: number; // NTRP/DUPR value
    skill_rating_score_id?: string;
    created_at: string;
}
```

---

## Benefits of New System

✅ **Separation of Concerns**: Rating systems vs verification methods
✅ **Multiple Rating Sources**: Self-reported, peer-verified, API-verified, admin-verified
✅ **Transparency**: Users see both claimed and verified ratings
✅ **History Tracking**: Old ratings preserved when new ones are added
✅ **Auto-Verification**: API ratings automatically trusted
✅ **Peer Validation**: Community-driven verification through matches
✅ **Flexibility**: Can add new source types without schema changes

---

## Next Steps

1. Apply migration to database
2. Update TypeScript types in shared-types package
3. Update SportProfile rating save logic
4. Implement peer rating collection in post-match flow
5. Create UI components for verification badges
6. Test peer verification threshold logic
7. Implement USTA/DUPR API integration for api_verified ratings
