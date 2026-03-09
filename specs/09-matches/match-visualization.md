# Match Visualization

## Overview

How users view and browse matches in the mobile app. Match visualization is split across three main screens:

1. **Home Screen** — Quick access to user's upcoming matches and nearby public matches
2. **Player Matches Screen** — Full view of all user's matches (upcoming and past)
3. **Public Matches Screen** — Browsable/searchable list of all joinable public matches

## Home Screen

The home screen provides a quick overview with two main sections for authenticated users.

### My Matches Section

A horizontal scrollable carousel showing the user's upcoming matches (limited to 5).

```
┌─────────────────────────────────────────────┐
│ My Matches                      [View All >]│
├─────────────────────────────────────────────┤
│ ┌─────────┐ ┌─────────┐ ┌─────────┐         │
│ │ Match 1 │ │ Match 2 │ │ Match 3 │  →      │
│ │ Today   │ │ Tomorrow│ │ Sat 10am│         │
│ └─────────┘ └─────────┘ └─────────┘         │
└─────────────────────────────────────────────┘
```

**Features:**

- Horizontal scroll with compact match cards (`MyMatchCard`)
- Shows date/time prominently
- "View All" button navigates to Player Matches screen
- Empty state shown when user has no upcoming matches

### Soon & Nearby Section

A vertical list of public matches near the user's location.

```
┌─────────────────────────────────────────────┐
│ Soon & Nearby                   [View All >]│
├─────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────┐ │
│ │ Tomorrow 3pm • Jean D. • NTRP 4.0      │ │
│ │ Parc Jarry • 2.3 km • Singles          │ │
│ └─────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────┐ │
│ │ Saturday 10am • Marie L. • NTRP 3.5    │ │
│ │ Club XYZ • 4.1 km • Doubles            │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

**Features:**

- Uses player's `maxTravelDistanceKm` preference for filtering
- Filters out matches where user is creator or participant
- "View All" button navigates to Public Matches screen
- Infinite scroll with pagination
- Pull-to-refresh support

## Match Sorting & Relevance Scoring

Both the **Home Screen** (Soon & Nearby) and the **Public Matches Screen** use the same two-tier sorting strategy to order matches.

### Sorting Strategy

**Primary sort: Chronological (soonest first)**

Matches are ordered by `match_date ASC`, then `start_time ASC`. This ordering is applied on the server (PostGIS RPC `search_matches_nearby`) and preserved through pagination. The client-side sort mirrors this to handle any edge cases where order may not be preserved after data enrichment.

**Secondary sort (tiebreaker): Relevance score**

When two or more matches share the same date **and** time, they are ranked by a 0–100 relevance score (highest first). This ensures the most interesting matches appear first within a given time slot without breaking pagination across pages.

### Relevance Score Factors

The relevance score is computed client-side from the player's preferences and the match attributes. Weights sum to 100:

| #   | Factor                 | Weight | Best Score                    | Description                                                                                              |
| --- | ---------------------- | ------ | ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | **Spots left**         | 25     | 1 spot left                   | Fewer spots = more urgent. Full matches score 0.                                                         |
| 2   | **Match tier**         | 20     | Coveted player + court booked | Rewards high-value matches (certified players, reserved courts).                                         |
| 3   | **Rating fit**         | 15     | Min rating ≥ player rating    | Matches at or above the player's level score highest. Below-level matches are penalized proportionally.  |
| 4   | **Distance**           | 12     | Very close                    | Linear decay: `1.0 − (distance / maxTravelDistance)`.                                                    |
| 5   | **Duration match**     | 8      | Exact match                   | Compares match duration to player's preferred duration. Each step off reduces score.                     |
| 6   | **Preferred facility** | 7      | At favorite                   | 1.0 if the match is at one of the player's favorite facilities, 0 otherwise.                             |
| 7   | **Format/type**        | 5      | Exact match                   | Casual/competitive alignment with player preference.                                                     |
| 8   | **Cost**               | 4      | Free                          | Free courts score 1.0. Paid courts are normalized against the most expensive match in the current batch. |
| 9   | **Gender**             | 4      | Gender matches                | Alignment between player gender and match's `preferred_opponent_gender`.                                 |

### Data Flow

```
Server (PostGIS RPC)
  → ORDER BY match_date ASC, start_time ASC
  → LIMIT/OFFSET pagination
        ↓
Service Layer (matchService)
  → Enriches with profiles, ratings, distance_meters
  → Preserves chronological order
        ↓
Client (useSortedNearbyMatches hook)
  → Sorts by date+time ASC (preserves server order)
  → Tiebreaks by relevance score DESC (same time slot only)
        ↓
Render
```

### Why Server-First Chronological Sort

Sorting primarily by relevance on the client would break paginated results — a high-relevance match on page 2 might rank above a low-relevance match on page 1, leading to inconsistent ordering across pages. By keeping the primary sort chronological (which the server already provides), pagination remains deterministic. The relevance score only reorders matches within the same time slot, which is bounded and safe.

### Unauthenticated User View

Non-authenticated users see:

- Sign-in prompt card instead of My Matches section
- Soon & Nearby section still visible (encouraging engagement)

## Player Matches Screen

Dedicated screen for viewing all of the user's matches with tabbed navigation.

### Tab Structure

```
┌─────────────────────────────────────────────┐
│ ┌─────────────┐ ┌─────────────┐             │
│ │  Upcoming   │ │    Past     │             │
│ └─────────────┘ └─────────────┘             │
├─────────────────────────────────────────────┤
│ TODAY                                       │
│ ─────────────────────────────────────────── │
│ 3:00 PM • Jean D. • Singles                 │
│ Parc Jarry • 1h                             │
│ ─────────────────────────────────────────── │
│ TOMORROW                                    │
│ ─────────────────────────────────────────── │
│ 10:00 AM • Pierre M. • Doubles              │
│ Club XYZ • 2h                               │
├─────────────────────────────────────────────┤
│ THIS WEEK                                   │
│ ...                                         │
└─────────────────────────────────────────────┘
```

### Date Sections

Matches are grouped into intuitive date sections:

**Upcoming Tab Sections:**
| Section | Description |
|---------|-------------|
| Today | Matches scheduled for today |
| Tomorrow | Matches scheduled for tomorrow |
| This Week | Within the next 7 days |
| Next Week | Within the next 14 days |
| Later | Beyond 14 days |

**Past Tab Sections:**
| Section | Description |
|---------|-------------|
| Today | Matches that ended earlier today |
| Yesterday | Matches from yesterday |
| Last Week | Within the past 7 days |
| Earlier | Beyond 7 days ago |

**Past Match Display:**

- Completed matches show feedback status (pending feedback, feedback submitted)
- Closed matches show aggregated star ratings (your rating, their rating)
- Mutually cancelled matches show "Cancelled" badge
- See [Match Closure](./match-closure.md) for the post-match UI specification

### Features

- **SectionList** with sticky section headers (optional)
- **Infinite scroll** with pagination (20 matches per page)
- **Pull-to-refresh** for updating match data
- **Empty states** with appropriate icons and messaging
- **Match cards** open detail sheet on tap

## Public Matches Screen

Full browsing experience for discovering joinable public matches.

### Search & Filter UI

```
┌─────────────────────────────────────────────┐
│ ┌─────────────────────────────────────────┐ │
│ │ 🔍 Search matches...                  ✕ │ │
│ └─────────────────────────────────────────┘ │
├─────────────────────────────────────────────┤
│ ┌─────┐ ┌───────┐ ┌─────┐ ┌────────┐  →    │
│ │Reset│ │ All   │ │Today│ │ Morning│       │
│ │ (3) │ │ 5km   │ │     │ │        │       │
│ └─────┘ └───────┘ └─────┘ └────────┘       │
├─────────────────────────────────────────────┤
│ 12 matches found                            │
├─────────────────────────────────────────────┤
│ [Match Cards...]                            │
└─────────────────────────────────────────────┘
```

### Filter Options

Filters are displayed as horizontally scrollable chip groups:

| Filter          | Options                                   | Default |
| --------------- | ----------------------------------------- | ------- |
| **Distance**    | All, 2 km, 5 km, 10 km                    | All     |
| **Date Range**  | All, Today, This Week, This Weekend       | All     |
| **Time of Day** | All, Morning ☀️, Afternoon ⛅, Evening 🌙 | All     |
| **Format**      | All, Singles, Doubles                     | All     |
| **Match Type**  | All, Casual, Competitive                  | All     |
| **Skill Level** | All, Beginner, Intermediate, Advanced     | All     |
| **Gender**      | All, Male, Female                         | All     |
| **Cost**        | All, Free ✓, Paid 💵                      | All     |
| **Join Mode**   | All, Direct, Request                      | All     |

### Filter Features

- **Active filter indicator**: Dot appears next to filter group labels when non-default value selected
- **Reset button**: Appears when any filter is active, shows count of active filters
- **Debounced search**: 300ms delay on search input to prevent excessive API calls
- **Results count**: Shows number of matches found (singular/plural form)
- **Loading indicator**: Shown during search/filter updates

### Match Filtering Logic

The following matches are excluded from results:

- Matches created by the current user
- Matches where the user is already a participant

### Empty States

| State                     | Icon | Message                                              |
| ------------------------- | ---- | ---------------------------------------------------- |
| No matches (with filters) | 🔍   | "No matches found" + suggestion to adjust filters    |
| No matches (no filters)   | 🎾   | "No matches available" + encouragement to create one |

### Features

- **Search bar** with real-time filtering
- **Filter chips** with grouped organization and horizontal scroll
- **Edge fade gradient** indicating scrollable filter area
- **Infinite scroll** with pagination
- **Pull-to-refresh** for updating data
- **Results count** display
- **Haptic feedback** on filter interactions

## Match Card Display

All screens use the `MatchCard` component showing:

- **Creator info**: Name, avatar, skill level
- **Schedule**: Date and time
- **Location**: Facility name and distance from user
- **Format**: Singles/Doubles indicator
- **Match type**: Casual/Competitive badge
- **Participant count**: Spots filled vs. available

The Home screen's My Matches section uses a compact `MyMatchCard` variant optimized for horizontal display.

## Match Detail Sheet

When a match card is tapped, a bottom sheet opens showing comprehensive match information and available actions.

### Layout

```
┌─────────────────────────────────────────────┐
│ ─────  (handle indicator)                   │
├─────────────────────────────────────────────┤
│ 📅 Today • 14:00 - 16:00              [✕]  │
├─────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────┐ │
│ │ ⏳ Your request is pending approval     │ │  ← Status banner (conditional)
│ └─────────────────────────────────────────┘ │
├─────────────────────────────────────────────┤
│ [Court Booked ✓] [Competitive 🏆] [4.0+]   │  ← Match badges
├─────────────────────────────────────────────┤
│ 👥 Participants (2/4)                       │
│ ┌──┐ ┌──┐ ┌──┐ ┌──┐                         │
│ │⭐│ │👤│ │+ │ │+ │  ← Avatars with host badge
│ └──┘ └──┘ └──┘ └──┘                         │
│ Jean  Marc                                  │
│ 2 spots left                                │
├─────────────────────────────────────────────┤
│ 📍 Parc Jarry - Court 3                  >  │  ← Tappable, opens maps
│    123 Main St, Montreal                    │
│    2.3 km away                              │
├─────────────────────────────────────────────┤
│ 💵 Estimated Cost                           │
│    $5 per person                            │
├─────────────────────────────────────────────┤
│ 📝 Notes                                    │
│    "Looking for rally practice"             │
├─────────────────────────────────────────────┤
│ ┌─────────────────────────────┐ ┌────┐      │
│ │        Join Now             │ │ ↗️ │      │  ← Sticky footer
│ └─────────────────────────────┘ └────┘      │
└─────────────────────────────────────────────┘
```

### Match Badges

Displayed when applicable:

| Badge                 | Condition                              | Color             |
| --------------------- | -------------------------------------- | ----------------- |
| Court Booked ✓        | `court_status === 'reserved'`          | Secondary (coral) |
| Competitive 🏆        | `player_expectation === 'competitive'` | Accent (amber)    |
| Casual 😊             | `player_expectation === 'casual'`      | Primary (teal)    |
| Skill Level           | `min_rating_score` set                 | Primary (teal)    |
| Men Only / Women Only | `preferred_opponent_gender` set        | Neutral           |
| Request to Join       | `join_mode === 'request'`              | Neutral           |
| Public / Private      | Visibility (shown to creator only)     | Primary/Neutral   |

### Participants Section

- **Avatar grid**: Shows host (with ⭐ badge), joined participants, and empty slots (with + icon)
- **Names**: First name displayed under each avatar
- **Spots indicator**: "2 spots left" or "1 spot left"

#### For Match Hosts

Additional management features:

**Pending Requests** (when `join_mode === 'request'`):

- List of players requesting to join
- Each shows: avatar, name, skill rating
- Actions: View Details 👁️, Accept ✓, Reject ✗
- "Match full" indicator when no spots available
- Collapsible when > 3 requests

**Invitations Sent**:

- List of invited players (pending and declined)
- Status badge: "Pending" or "Declined"
- Actions: Resend 🔄, Cancel ✗

**Kick Participant**:

- Remove button on each participant avatar (not host)
- Hidden if participant joined more than 24 hours ago (based on `joined_at`)
- Hidden during `in_progress` or after match has ended

### Status Banners

Contextual banners shown at top of sheet:

| User State               | Banner Message                     | Color           |
| ------------------------ | ---------------------------------- | --------------- |
| Pending request          | "Your request is pending approval" | Warning (amber) |
| Waitlisted (match full)  | "You're on the waitlist"           | Info (blue)     |
| Waitlisted (spot opened) | "A spot opened up! Join now"       | Success (green) |

### Action Buttons

The footer shows context-appropriate actions. The rendering order determines priority — the first matching condition wins:

| Priority | User Role / Condition                    | Match State            | Action Displayed                      |
| -------- | ---------------------------------------- | ---------------------- | ------------------------------------- |
| 1        | Anyone                                   | Cancelled              | "Match cancelled" (status message)    |
| 2        | Participant (score needs confirmation)   | Completed (has result) | Dispute Score + Confirm Score         |
| 3        | Participant (already responded to score) | Completed (has result) | Provide Feedback (if not completed)   |
| 4        | Participant (result exists, all done)    | Completed (has result) | "Match completed" (status message)    |
| 5        | Anyone                                   | Expired (not full)     | "Match expired" (status message)      |
| 6        | Participant (no score yet)               | Completed (within 48h) | Submit Score + Provide Feedback       |
| 7        | Participant (feedback done)              | Completed (within 48h) | "Match completed" (status message)    |
| 8        | Anyone                                   | Completed (past 48h)   | "Match closed" (status message)       |
| 9        | Participant (needs check-in)             | Check-in window        | Check In                              |
| 10       | Anyone                                   | In Progress            | "Match in progress" (status message)  |
| 11       | Creator / Participant (checked in)       | Scheduled              | "You are checked-in" (status message) |
| 12       | Creator                                  | Scheduled              | Edit + Cancel Match                   |
| 13       | Pending requester                        | Scheduled              | Cancel Request                        |
| 14       | Invited (match full)                     | Scheduled              | Decline + Join Waitlist               |
| 15       | Invited (request mode)                   | Scheduled              | Decline + Request to Join             |
| 16       | Invited (direct mode)                    | Scheduled              | Decline + Accept Invitation           |
| 17       | Waitlisted (match full)                  | Scheduled              | Leave Waitlist                        |
| 18       | Waitlisted (spot opened, request mode)   | Scheduled              | Request to Join                       |
| 19       | Waitlisted (spot opened, direct mode)    | Scheduled              | Join Now                              |
| 20       | Participant (checked in)                 | Scheduled              | "You are checked-in" (status message) |
| 21       | Participant (joined)                     | Scheduled              | Leave Match                           |
| 22       | Non-participant (match full)             | Scheduled              | Join Waitlist                         |
| 23       | Non-participant (request mode)           | Scheduled              | Request to Join                       |
| 24       | Non-participant (direct mode)            | Scheduled              | Join Now                              |

**Share Button**: Visible to everyone before match starts (not cancelled). Allows sharing match details via native share sheet.

**Check-in Window**: 10 minutes before start_time to end_time, only for full matches with a confirmed location (facility or custom). Requires device location permission.

**Score Actions** (Completed matches only):

- **Submit Score**: Shown when no score has been submitted yet (`!hasResult`) and within 48h feedback window
- **Confirm/Dispute Score**: Shown to participants who did not submit the score, when the score is unverified and undisputed

**Feedback Button** (Completed matches only):

- Shown to participants when match status is `completed` AND `feedback_completed = false` AND within 48h window
- Hidden when `feedback_completed = true` or match is `closed` (past 48h)
- Opens the Feedback Wizard modal
- See [Match Closure](./match-closure.md) for the feedback wizard flow

### Confirmation Modals

Destructive actions require confirmation:

- **Leave Match**: "Are you sure you want to leave?"
- **Cancel Match**: "This will notify X participants"
- **Reject Request**: "Reject this player's request?"
- **Kick Participant**: "Remove this player from the match?"
- **Cancel Invitation**: "Cancel this invitation?"
- **Cancel Request**: "Cancel your join request?"

### Location Integration

- Tapping the location row opens native maps app
- Uses coordinates when available, falls back to address search
- Platform-specific URL schemes (iOS Maps, Google Maps on Android)

### Technical Details

- **Component**: `MatchDetailSheet` (bottom sheet modal)
- **Snap point**: 95% screen height
- **Hook**: `useMatchActions` for all match operations
- **State updates**: Optimistic UI with server confirmation
- **Haptic feedback**: On all user interactions

## Navigation Flow

```
Home Screen
├── My Matches Section
│   ├── [Match Card] → Match Detail Sheet
│   └── [View All] → Player Matches Screen
├── Soon & Nearby Section
│   ├── [Match Card] → Match Detail Sheet
│   └── [View All] → Public Matches Screen
│
Player Matches Screen
├── [Tab: Upcoming | Past]
└── [Match Card] → Match Detail Sheet
│
Public Matches Screen
├── [Search & Filters]
└── [Match Card] → Match Detail Sheet
│
Match Detail Sheet (Modal)
├── [Join/Request/Leave] → Action with confirmation
├── [Edit] → Match Creation Wizard (edit mode)
├── [Location] → Native Maps App
└── [Share] → System Share Sheet
```

## Technical Implementation

### Data Fetching

| Screen/Component   | Hook                     | Key Parameters                                  |
| ------------------ | ------------------------ | ----------------------------------------------- |
| Home (My Matches)  | `usePlayerMatches`       | `timeFilter: 'upcoming'`, `limit: 5`            |
| Home (Nearby)      | `useNearbyMatches`       | `maxDistanceKm`, `sportId`, `userGender`        |
| Home (Nearby sort) | `useSortedNearbyMatches` | Chronological + relevance tiebreaker            |
| Player Matches     | `usePlayerMatches`       | `timeFilter: 'upcoming' \| 'past'`, `limit: 20` |
| Public Matches     | `usePublicMatches`       | All filter params, `debouncedSearchQuery`       |
| Public (sort)      | `useSortedNearbyMatches` | Chronological + relevance tiebreaker            |
| Match Detail Sheet | `useMatchActions`        | `matchId`, action callbacks                     |

### Match Actions

The `useMatchActions` hook provides all match operations:

| Action         | Method                                     | Description                      |
| -------------- | ------------------------------------------ | -------------------------------- |
| Join           | `joinMatch(playerId)`                      | Join directly or request to join |
| Leave          | `leaveMatch(playerId)`                     | Leave the match or waitlist      |
| Cancel         | `cancelMatch(playerId)`                    | Cancel match (host only)         |
| Accept Request | `acceptRequest({participantId, hostId})`   | Accept join request              |
| Reject Request | `rejectRequest({participantId, hostId})`   | Reject join request              |
| Cancel Request | `cancelRequest(playerId)`                  | Cancel own join request          |
| Kick           | `kickParticipant({participantId, hostId})` | Remove participant               |
| Cancel Invite  | `cancelInvite({participantId, hostId})`    | Cancel pending invitation        |
| Decline Invite | `declineInvite(playerId)`                  | Decline pending invitation       |
| Resend Invite  | `resendInvite({participantId, hostId})`    | Resend invitation                |
| Check In       | `checkIn({playerId, latitude, longitude})` | Check in at match location       |

### Pagination

All list screens support infinite scroll:

- Initial page size: 20 matches
- `onEndReached` threshold: 0.3 (30% from bottom)
- Loading indicator shown during page fetch

### Refresh

All screens support pull-to-refresh:

- Uses React Native's `RefreshControl`
- `isRefetching` state controls spinner visibility
- Themed spinner colors (primary brand color)

### Context Providers

| Context                   | Purpose                                           |
| ------------------------- | ------------------------------------------------- |
| `MatchDetailSheetContext` | Manages sheet open/close state and selected match |
| `ActionsSheetContext`     | Opens match creation wizard (for edit mode)       |

### UI Components

| Component               | Library                | Usage                                       |
| ----------------------- | ---------------------- | ------------------------------------------- |
| `BottomSheetModal`      | `@gorhom/bottom-sheet` | Match detail sheet                          |
| `ConfirmationModal`     | Custom                 | Destructive action confirmations            |
| `RequesterDetailsModal` | Custom                 | View requester profile before accept/reject |
