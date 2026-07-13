# Mobile navigation & Home information architecture

Decided 2026-07-02 (IA work session). Goal: make Home the hub that answers
"what's next for me, what needs my action" first, then dispatches to the rest
of the app — and give tournaments/leagues a stable navigation anchor before
they are un-gated from admin-only rollout.

## Diagnosis (state before this spec)

1. **Competitive surfaces are homeless.** `Tournaments`, `Leagues`,
   `MyTournaments`, `MyLeagues`, `Leaderboard` are root-stack screens with no
   tab anchor. Entry points: admin-gated quick-nav buttons on Home (in a
   horizontally scrolling row — buttons 3–4 are offscreen on first render)
   and buttons inside the Community tab.
2. **The player's commitments are fragmented** across `PlayerMatches`,
   `MyTournaments`, `MyLeagues`. No unified chronological agenda exists.
3. **Banner noise.** Six banner types (billing, references, cross-sport,
   weekly check-in, second sport, profile completion) compete at the top of
   Home and collapse into a horizontal carousel when several fire, hiding all
   but the first. Actionable items (scores to confirm, join requests) are
   buried as in-card badges or behind the notification bell.
4. **Semantic mismatch.** Community tab is a junk drawer (players + groups +
   communities + shared lists + gateway to compete features). Home tab is
   internally labeled `navigation.matches`.
5. **Tournaments have chrome but no content presence** — reachable only via
   buttons, never surfaced as feed content anywhere.

## Decisions

- **Tab bar unchanged** (Home / Courts / + / Community / Chat). No reshuffle
  at current scale; revisit with usage data. Optional relabel:
  Community → "Players".
- **Compete hub screen** (new root screen): segmented
  Tournaments | Leagues | Leaderboard. Replaces three disconnected root
  screens as the destination; the existing screens become its segments.
  Tab-promotion-ready later without another redesign.
- **My schedule: unify on Home first.** Home's "Up next" rail merges casual
  games + tournament matches + league sessions chronologically.
  `PlayerMatches` / `MyTournaments` / `MyLeagues` stay as drill-downs for
  now; a full unified My Schedule screen is phase 3.
- **Single priority banner slot.** Only the highest-priority banner renders:
  billing > weekly check-in > references > profile completion > cross-sport >
  second sport. Actionable ones also surface as "needs attention" chips.

## Target Home hierarchy (top → bottom)

1. Header (unchanged: avatar, sport switch, bell, gear)
2. Priority banner — one slot
3. **Up next** — unified agenda rail (games + tournament matches + league
   sessions), "needs attention" chips (score to confirm, join requests),
   "My schedule" view-all
4. **Play** — fixed 2×2 dispatch grid, no horizontal scroll:
   Find a game / Tournaments / Leagues / Book a court.
   (Leaderboard moves into the Compete hub's third segment.)
5. **Just for you** — unchanged
6. **Happening near you** — tournaments/league seasons as content cards
   (registration deadline, level range, spots left)
7. **Open at your favorites** — unchanged

## Phasing

- **Phase 1 (ships with tournament un-gating):** Home hierarchy — fixed 2×2
  Play grid, single banner slot, Up next rail (can start from the three
  existing queries composed client-side).
- **Phase 2:** Compete hub screen + "Happening near you" rail.
- **Phase 3:** Unified My Schedule screen absorbing
  PlayerMatches / MyTournaments / MyLeagues as filters.

## Implementation notes

- Home is `apps/mobile/src/screens/Home.tsx` (2.2k lines); banners are built
  in `renderListHeader`'s `bannerCards` bucket — the priority slot replaces
  the `length > 1` carousel branch with a pick-first-by-priority.
- Quick-nav row (`QuickNavButton`, `quickNavStyles.row`) becomes the fixed
  grid; drop the `isAdmin` gating along with tournament un-gating.
- Navigators live in `apps/mobile/src/navigation/AppNavigator.tsx`; the
  Compete hub is a new root-stack screen, existing
  Tournaments/Leagues/Leaderboard screens become its segments.
- Copy rule: user-facing strings say "games"/"parties", never
  "matches"/"matchs".
