# Mobile UX

> Screen inventory, navigation, key flows, and visual specs for the mobile (Expo / React Native) app.

This file specifies the mobile surface area at the level of detail of [match-creation.md](../09-matches/match-creation.md). All screens live under the active sport universe and respect [02-sport-modes/visual-differentiation.md](../02-sport-modes/visual-differentiation.md) (color, iconography).

## Navigation entry points

L&T are surfaced from three places in the mobile app:

1. **Sport home tab → "Events" carousel**: shows upcoming tournaments and active leagues for the user. Cards link to detail.
2. **Hamburger menu → "Leagues & Tournaments"**: dedicated stack navigator with `LeaguesTournamentsScreen` (list) → detail screens.
3. **Calendar tab**: confirmed sessions and scheduled tournament matches appear inline.

There is no bottom-tab dedicated to L&T in v1 (avoids tab clutter).

## Screen inventory

### Tournament screens

| Screen                         | Route                                 | Purpose                                               |
| ------------------------------ | ------------------------------------- | ----------------------------------------------------- |
| `TournamentListScreen`         | `/leagues-tournaments/tournaments`    | Filterable list of tournaments                        |
| `TournamentDetailScreen`       | `/tournaments/:id`                    | Tabs: Bracket / Participants / Info / Audit           |
| `TournamentCreateWizard`       | `/tournaments/new`                    | 3-step wizard (Format / Dates / Visibility)           |
| `TournamentEditScreen`         | `/tournaments/:id/edit`               | Edit form respecting state-based gating               |
| `TournamentRegisterScreen`     | `/tournaments/:id/register`           | Single or doubles registration                        |
| `TournamentBracketScreen`      | `/tournaments/:id/bracket`            | Full-bleed pinch-zoom bracket viewer                  |
| `TournamentMatchDetailScreen`  | `/tournaments/:id/matches/:mid`       | Match card + score entry                              |
| `TournamentScoreEntryScreen`   | `/tournaments/:id/matches/:mid/score` | Modal score input with sport-aware fields             |
| `TournamentParticipantsScreen` | `/tournaments/:id/participants`       | Roster with seed and bracket position                 |
| `TournamentOrganizerDashboard` | `/tournaments/:id/organize`           | Organizer-only controls (gen bracket, swap, override) |
| `TournamentAuditScreen`        | `/tournaments/:id/audit`              | Read-only audit log                                   |

### League screens

| Screen                     | Route                                      | Purpose                                     |
| -------------------------- | ------------------------------------------ | ------------------------------------------- |
| `LeagueListScreen`         | `/leagues-tournaments/leagues`             | Filterable list of leagues                  |
| `LeagueDetailScreen`       | `/leagues/:id`                             | Tabs: Ranking / Sessions / Members / Info   |
| `LeagueCreateWizard`       | `/leagues/new`                             | 3-step (Sport+Visibility / Rules / Members) |
| `LeagueEditScreen`         | `/leagues/:id/edit`                        | Edit form                                   |
| `LeagueJoinScreen`         | `/leagues/:id/join`                        | Join flow with gates and review             |
| `LeagueMembersScreen`      | `/leagues/:id/members`                     | Member list with roles and statuses         |
| `SeasonDetailScreen`       | `/leagues/:id/seasons/:sid`                | Tabs: Ranking / Sessions / Standings        |
| `SeasonCreateScreen`       | `/leagues/:id/seasons/new`                 | Create season form                          |
| `SessionDetailScreen`      | `/leagues/:id/seasons/:sid/sessions/:ssid` | Tabs: Match Sheet / Confirmations / Info    |
| `SessionCreateScreen`      | `/leagues/:id/seasons/:sid/sessions/new`   | Create session form                         |
| `SessionConfirmScreen`     | `/sessions/:id/confirm`                    | Confirmation + optional partner pick        |
| `SessionMatchDetailScreen` | `/sessions/:id/matches/:mid`               | Match card + score entry                    |
| `SessionScoreEntryScreen`  | `/sessions/:id/matches/:mid/score`         | Modal score input                           |
| `LeagueOrganizerDashboard` | `/leagues/:id/organize`                    | Organizer-only controls                     |
| `LeagueAuditScreen`        | `/leagues/:id/audit`                       | Read-only audit log                         |

## Tournament create wizard

3-step horizontal-slide wizard, mirrors the [match-creation pattern](../09-matches/match-creation.md#wizard-structure). Swipe is disabled (button-only progression) for Android-scroll friendliness.

### Step 1 — Format

| Field              | Default                                        | Notes                                    |
| ------------------ | ---------------------------------------------- | ---------------------------------------- |
| Tournament name    | empty                                          | Required, 1–100 chars                    |
| Sport              | active sport (locked)                          |                                          |
| Max participants   | 8                                              | Segmented control: 4 / 8 / 16 / 32       |
| Bracket type       | `single_elimination`                           | Locked in v1; v2 adds double-elimination |
| Match format       | `two_of_three` (tennis) / `to_11` (pickleball) |                                          |
| Games per set      | 6 (tennis only)                                |                                          |
| Final set tiebreak | `super_tb_10pt` (tennis only)                  |                                          |
| Entry format       | `singles`                                      | Doubles available v1.1                   |
| Seeding enabled    | true                                           |                                          |
| Max seeds          | 4                                              |                                          |

### Step 2 — Dates & venue

| Field                  | Default                          |
| ---------------------- | -------------------------------- |
| Start date             | today + 7 days                   |
| End date               | start + 1 day                    |
| Registration opens at  | now                              |
| Registration closes at | start - 24h                      |
| Venue                  | preferred facility from settings |

Surface integration: same facility/court selector as `match-creation` Step 1.

### Step 3 — Visibility & gates

| Field             | Default |
| ----------------- | ------- |
| Visibility        | private |
| Community         | none    |
| Registration mode | open    |
| Min rating        | none    |
| Max rating        | none    |
| Min reputation    | none    |
| Description       | empty   |
| Logo              | none    |

After save: success screen with CTA "Open registration" or "Save as draft".

## League create wizard

3-step. Step 1 captures sport, name, visibility, join_mode. Step 2 lets the organizer adjust default rules (point system, formats allowed, bonuses toggle). Step 3 invites initial members (from favorites, groups, contacts).

## Tournament detail screen

Hero card + status pill + tab bar.

```
┌─────────────────────────────────────────────────┐
│  ← Back      [share icon]  [organize button]    │
├─────────────────────────────────────────────────┤
│  [logo]  Spring Open 2026                       │
│  Tennis · Singles · Best of 3 · Hard            │
│  [In progress · Round of 8]                     │
├─────────────────────────────────────────────────┤
│  Apr 10 – Apr 12 · Stade IGA · Court 5–8        │
│  Organizer: Jean D. (badge)                     │
├─────────────────────────────────────────────────┤
│  [ Bracket ] [ Participants ] [ Info ] [ Audit ]│
├─────────────────────────────────────────────────┤
│  …tab content…                                  │
└─────────────────────────────────────────────────┘
[ Bottom CTA: "Register" / "View bracket" / "Score Entry" ]
```

The audit tab is shown only to organizer/co-organizer.

## Bracket viewer

Full-bleed; horizontal-scroll between rounds; vertical-scroll within a round.

- Match cards are 280 × 80, tappable.
- BYE matches are visually muted.
- Players advance with a small slide-in animation when realtime updates arrive.
- Pinch-to-zoom (0.5×–1.5×). Above 1.0× shows full names; below shows initials only.
- Currently-playing match has a pulsing dot.

The bracket renders from `tournament:{id}:bracket` realtime channel; falls back to polling every 30s if subscription drops.

## Score entry modal

Bottom-sheet (using `react-native-actions-sheet`, with the [sheet-to-sheet transition rule](../../README.md) of awaiting `SheetManager.hide()` before `show()` for chained sheets).

Layout:

```
┌─────────────────────────────────────────────────┐
│              Match: A vs B                      │
│              Round of 8                         │
├─────────────────────────────────────────────────┤
│ Set 1   [ 6 ] - [ 4 ]                           │
│ Set 2   [ 4 ] - [ 6 ]                           │
│ Set 3   [ 7 ] - [ 6 ]   TB: [ 5 ]               │
│ + Add set                                        │
├─────────────────────────────────────────────────┤
│ ⊙ Regular   ○ Retired   ○ Walkover              │
│ Retiring side: [ A | B ]    (only when Retired) │
├─────────────────────────────────────────────────┤
│  Preview: 6-4, 4-6, 7-6(5)    Winner: A          │
│                                                  │
│  [ Submit ]   ← disabled until valid             │
└─────────────────────────────────────────────────┘
```

The set rows are dynamic: a third row only appears once Set 1 is `6-x` or `x-6` and split. Pickleball matches show a single "Game" row by default with toggle for "Best of N".

The preview line uses the same canonical-score rendering as the persistence layer ([score-entry.md](./score-entry.md)) so what users see equals what gets saved.

## Confirmation dialogs

All destructive actions show the standard confirmation:

```
⚠️ This will overwrite the generated bracket. The change is logged.
[Cancel]  [Confirm]
```

For impactful tournament edits (date, venue, bracket type if still allowed), the confirmation includes a list of impacted matches/participants — mirrors [match-creation impactful-change confirmation](../09-matches/match-creation.md#impactful-change-confirmation).

## League detail screen

Tabs: Ranking / Sessions / Members / Info. Same hero pattern as tournament.

The Ranking tab uses the table from [ranking.md](./ranking.md#public-ranking-display). Tapping a row opens that player's profile (system 06).

## Session detail screen

Tabs: Match Sheet / Confirmations / Info.

### Match Sheet tab

```
Round 1 — Court 1
─────────────────
A. Smith vs B. Jones        [ Submit Score ]
6-4, 4-6, 7-6(5)            [ Validated ]

Round 1 — Court 2
─────────────────
C. Lee vs D. Park           [ Pending ]

Round 2 — Court 1
─────────────────
A. Smith / B. Jones (winner) vs C. Lee  [ Pending ]
```

Each match card is tappable → `SessionMatchDetailScreen`.

### Confirmations tab

For organizer:

```
Confirmed (8)
- A. Smith ✓
- B. Jones ✓
…

Pending (3)
- E. Brown
…

Declined (2)
- F. Wilson

Waitlist (1)
- G. Taylor (#1)
```

For member:

```
Your status: Confirmed (you'll play)  [ Change ]

8 players confirmed · 3 pending · 1 on waitlist
```

The "Change" button opens a half-sheet with `Confirmed` / `Declined` / `Pending` choices.

## Organizer dashboard

Single screen with cards for each organizer task. Tournament:

```
Spring Open 2026 — Organizer Dashboard

┌─ Registration ────────────────────────────────┐
│ 12 of 16 spots filled · 2 on waitlist          │
│ [Open registration]  [Close registration]       │
│ [View applicants]    [Invite players]           │
└────────────────────────────────────────────────┘

┌─ Bracket ─────────────────────────────────────┐
│ Not yet generated                              │
│ [Generate bracket]                              │
└────────────────────────────────────────────────┘

┌─ Matches ─────────────────────────────────────┐
│ 0 played · 0 disputed · 0 awaiting validation  │
│ [Schedule matches]   [View bracket]             │
└────────────────────────────────────────────────┘

┌─ Communication ───────────────────────────────┐
│ [Open chat]   [Send announcement]               │
└────────────────────────────────────────────────┘

┌─ Settings ────────────────────────────────────┐
│ [Edit details]   [Cancel tournament]            │
└────────────────────────────────────────────────┘
```

League dashboard analogous, with cards for Members, Active Season, Sessions, Rules.

## "Mode Édition" indicator

Per the co-founder brief ("Possède un bouton 'Mode Édition' ou un indicateur visuel pour savoir quand il est en train de modifier le tournoi"), every screen that contains organizer-only mutating controls displays a persistent banner at the top:

```
┌─────────────────────────────────────────────────┐
│ ✎  Organizer mode — your changes will be logged │
└─────────────────────────────────────────────────┘
```

- Color: warning amber (sport-aware: tennis-amber or pickleball-amber).
- Tappable: opens a half-sheet listing recent organizer actions in the audit trail.
- Dismissible per-session (banner reappears on next app open).

The banner shows whenever the user is on a screen where they have organizer or co-organizer privileges over the current entity.

## Draft persistence (auto-save)

Per co-founder brief ("Sauvegarde automatique : Pour la saisie des scores, prévoir une sauvegarde automatique en brouillon pour éviter la perte de données en cas de coupure"):

| Form / surface                     | Auto-save policy                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| Tournament create wizard (3 steps) | Save on each step completion to AsyncStorage; resume on next open with prompt       |
| League create wizard               | Same                                                                                |
| Score entry sheet                  | Save current input every 5s while sheet is open; restore on reopen if not submitted |
| Session create form                | Save on field blur                                                                  |
| Match sheet edits (organizer)      | Save each drag-drop result locally; commit batch on "Save changes"                  |

Drafts are sport- and entity-scoped (e.g., draft for "create tennis tournament" is independent of "create pickleball tournament"). Drafts older than 7 days are GC'd. The pattern reuses the existing `useDraft` hook in `apps/mobile/src/features/matches/`.

## Empty / loading / error states

| Surface             | Empty                                                         | Loading        | Error                                  |
| ------------------- | ------------------------------------------------------------- | -------------- | -------------------------------------- |
| Tournament list     | Illustration + "No tournaments. Create one or browse public." | Skeleton cards | Inline retry banner                    |
| Bracket             | "Bracket will appear after registration closes."              | Skeleton tree  | "Couldn't load bracket. Tap to retry." |
| Ranking             | "No matches played yet."                                      | Skeleton table | Inline retry banner                    |
| Members             | "No members yet."                                             | Skeleton list  | Inline retry banner                    |
| Score entry preview | "Enter at least one set."                                     | n/a            | Inline validation error                |

Empty-state copy is in `packages/shared-translations` under `leaguesTournaments.empty.*`.

## Offline behavior

| Action                   | Offline support                                         |
| ------------------------ | ------------------------------------------------------- |
| View bracket / ranking   | Read from React Query cache; show "Offline" banner      |
| Submit score             | Queue mutation; retry on reconnect                      |
| Confirm session          | Queue mutation; retry on reconnect                      |
| Realtime updates         | Disabled offline; reconnect refreshes from query cache  |
| Create tournament/league | Blocked (requires server validation of user/sport/etc.) |

The mutation queue mirrors the existing match-creation offline path in `apps/mobile/src/features/matches`.

## Accessibility

- All interactive elements have `accessibilityLabel`s with localized strings.
- Bracket lines (SVG) carry `accessibilityRole="image"` with a description like "Round 1, match 3, A. Smith vs B. Jones, A. Smith advanced".
- Color is never the sole indicator of state — pills carry text labels.
- Min font size 14pt; respects `Settings → Display → Larger Text`.
- Score entry numeric pads use `keyboardType="number-pad"` and announce "Set 1, side A, games" via `accessibilityLabel`.

## Components

New components in `apps/mobile/src/features/leagues-tournaments/components/`:

- `BracketViewer` — pinch-zoomable SVG tree with realtime diff merge.
- `MatchCard` — reusable card; shared by tournament and session matches.
- `ScoreEntrySheet` — bottom-sheet with set rows.
- `ConfirmationStrip` — confirm/decline/pending pill row.
- `RankingTable` — sortable, virtualized list.
- `OrganizerActionCard` — gridable card with title, subtitle, primary CTA.

## Hooks

- `useTournament(id)`, `useTournamentBracket(id)` — `@tanstack/react-query`-backed.
- `useLeague(id)`, `useLeagueRanking(seasonId)`.
- `useSession(id)`, `useSessionMatchSheet(id)`.
- `useSubmitScore(matchId)` — mutation with offline queueing.
- `useConfirmPresence(sessionId)` — mutation.
- `useTournamentRealtime(id)`, `useLeagueRealtime(id)` — Supabase Realtime hookups.

## Localization keys (selected)

```
leaguesTournaments.tournament.create.title
leaguesTournaments.tournament.detail.bracket.empty
leaguesTournaments.tournament.detail.audit.tabLabel
leaguesTournaments.session.confirm.optionConfirmed
leaguesTournaments.session.confirm.optionDeclined
leaguesTournaments.session.confirm.partnerPickerLabel
leaguesTournaments.errors.bracketLocked
leaguesTournaments.errors.matchLocked
leaguesTournaments.errors.scoreFormatInvalid
```

All keys exist in both `en-US.json` and `fr-CA.json`.

## Performance budgets (mobile)

| View                               | Target FCP | Notes                                                  |
| ---------------------------------- | ---------- | ------------------------------------------------------ |
| `TournamentDetailScreen`           | < 800 ms   | Cached query → realtime hookup after mount             |
| `TournamentBracketScreen` (N=16)   | < 600 ms   | SVG render incremental; first paint shows round 1 only |
| `LeagueDetailScreen` (Ranking tab) | < 500 ms   | `season_rankings` is a single indexed query            |
| Score-entry sheet open             | < 200 ms   | All-local; sheet-to-sheet transition awaits hide       |
