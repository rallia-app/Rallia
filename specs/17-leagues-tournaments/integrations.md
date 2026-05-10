# Cross-System Integrations

> Contracts between the Leagues & Tournaments system and the rest of Rallia.

## 02 Sport Modes

Each `tournaments.sport_id` and `leagues.sport_id` references exactly one row in `public.sport`. The mobile sport-mode separation in [02-sport-modes/data-separation.md](../02-sport-modes/data-separation.md) is enforced:

- L&T entities created in the Tennis universe are not visible in the Pickleball universe (and vice versa). The mobile client filters list queries by the user's currently-selected sport.
- Sport-scope on writes is enforced via the `assert_caller_plays_sport(p_sport_id)` helper documented in [permissions.md §Sport-scope enforcement](./permissions.md#sport-scope-enforcement). The helper checks `player_sport (player_id, sport_id, is_active = true)` — there is no JWT claim involved, so web sessions and mobile sessions behave identically.
- Push notifications include `sport_id` (and `sportName` for display, mirroring [02-sport-modes/interface-switching.md](../02-sport-modes/interface-switching.md)) in the payload so the deep-link opens in the correct universe.
- iCal exports include sport in the event description.

A user with both sports active sees independent lists and rankings. There is no cross-sport league or tournament in v1.

## 04 Player Rating (NTRP/DUPR)

### Seeding

When `seeding_enabled = true`, the bracket-generation algorithm reads each registrant's certified `rating_score` for the tournament's sport (from `player_sport`) and sorts seeds:

1. Organizer-assigned `seed_rank` (highest priority — overrides everything).
2. Certified `rating_score` descending.
3. Self-declared `self_declared_rank` ascending.
4. `registered_at` ascending.

If a registrant has no certified rating, their `rating_score` is treated as the league's `default_rating_for_unknown` (default `0`, configurable per league). This effectively places uncertified players at the bottom, encouraging certification.

### Rating evolution

T&L matches feed rating evolution **the same way casual matches do**:

- After a match's score is `validated`, the `match-closure` evaluation pipeline (system 04) ingests the result.
- The opponent's certified-rating-or-higher rule still applies for level evaluation.
- The M5 last-five-evaluations rule continues to apply unchanged.

This means a player who plays exclusively in tournaments still has their rating evolve, and tournament-only players don't have a divergent rating path.

### Rating gates

`tournaments.min_rating`, `tournaments.max_rating`, `leagues.min_rating`, `leagues.max_rating` reject registrations / joins outside the band. Doubles partnerships require both partners to satisfy the band individually (no team-average exemption in v1).

## 05 Reputation

### Reputation events emitted from L&T

| Source                                           | Reputation event        | Impact                |
| ------------------------------------------------ | ----------------------- | --------------------- |
| Tournament/session match `completed`             | `match_completed`       | +12                   |
| Tournament/session match `walkover` (vs no-show) | `match_no_show` (loser) | -50                   |
| Tournament/session match `retired` (mid-match)   | `match_retired`         | -3                    |
| Player declines confirmed presence < 24h before  | `match_cancelled_late`  | -7 to -45 (graduated) |
| Player no-shows confirmed presence               | `match_no_show`         | -50                   |
| Tournament withdrawal after bracket generated    | `tournament_withdrew`   | -3                    |
| Disqualification (organizer action)              | `report_upheld`         | -15                   |
| 5-star rating from opponent                      | `review_received_5star` | +10                   |
| 4-star, 3-star, 2-star, 1-star                   | corresponding events    | +5 / 0 / -5 / -10     |
| Repeat opponent in T&L match                     | `match_repeat_opponent` | +2                    |
| First match bonus (any sport)                    | `first_match_bonus`     | +5                    |

These are emitted by the `tg_emit_reputation_events` trigger on the `*_matches` tables and via RPC bodies for late-cancellation. The graduated late-cancellation logic re-uses [`reputation/reputationPenalties.ts`](../09-matches/match-lifecycle.md#late-cancellation-penalties).

### Reputation gates

`tournaments.min_reputation` and `leagues.min_reputation` reject registrations / joins for players whose current `player_reputation.score` is below the floor. Reputation `unknown` (< 5 events) is treated as 100% (benefit of the doubt) for gating purposes — same convention as casual matches.

## 06 Player Directory

### Discovery

Public tournaments and leagues appear in the directory's "Events" tab, filterable by:

- Sport
- Status
- Format (singles / doubles / mixed)
- Level / category
- Date range
- Distance from user (if anchored to a `facility_id`)

### Profile inclusion

A player's profile shows their L&T history:

- Active league memberships (with current rank if season is OPEN)
- Active tournament registrations
- Past achievements: tournament wins, top-3 season finishes (badges from system 13)

These are read from `season_rankings`, `tournament_registrations`, `tournament_matches`. A player can hide their L&T history in v2 (privacy toggle TBD).

## 07 Player Relations

### Communities own L&T

A community can own a league/tournament:

- `tournaments.network_id` / `leagues.network_id` set the owning community-network. The create RPC validates the referenced `network` row has `network_type.code = 'community'`.
- `visibility = 'community'` makes the entity visible only to active members of the community.
- Joining the community **does not** auto-join the league — joining is still gated by `join_mode`.
- Leaving the community demotes the league member to `inactive` (preserves historical ranking).

This is how clubs and tennis-addict-style communities run in-house leagues.

### Groups

Groups (private, ≤10 players) can have a "league shortcut" — anyone in a group can create a league with the group as initial roster. Implementation: a button on the group page that pre-fills the league create form with the group's members and `visibility = 'private'`. Members are auto-added (no approval needed) regardless of `join_mode`.

## 08 Communications

### Chat triggers

| Chat                                | Created when                                      | Members                        | Lifecycle                                     |
| ----------------------------------- | ------------------------------------------------- | ------------------------------ | --------------------------------------------- |
| `tournament:{id}:general`           | Bracket generated                                 | Participants + organizers      | Active until tournament archived              |
| `tournament:{id}:partnership:{pid}` | Doubles partnership confirmed                     | The two partners               | Active until tournament archived              |
| `tournament:{id}:match:{mid}`       | Match becomes `pending` with both players known   | Match's players                | Active until match in terminal state + 7 days |
| `session:{id}:general`              | Session published                                 | Confirmed members + organizers | Active until session completed + 7 days       |
| `session:{id}:match:{mid}`          | Doubles match in match sheet has both teams known | All 4 players                  | Active until match in terminal state + 7 days |

Triggers via the same chat creation path as match-chat in [chat.md](../08-communications/chat.md).

### Notifications

See [notifications.md](./notifications.md) for the full event taxonomy.

## 09 Matches

L&T matches reuse the same data shape (sets, games, retirement semantics, walkover) as casual matches. The user-facing match detail page distinguishes the two via a small badge:

- "Friendly" — casual match
- "Tournament — Quarterfinal" — tournament match
- "League — Winter 2026 Session #4" — league session match

L&T matches are stored in their own tables (`tournament_matches`, `session_matches`) rather than being shoehorned into the casual `matches` table — this keeps casual-match RLS and indexing simple — but the _displayed_ card is the same component.

## 10 Club Portal

Clubs (`organizations` of type `club`) can:

- Host leagues/tournaments by setting `facility_id` to one of their facilities.
- See organizer dashboards on the web at `/[locale]/(org)/leagues` and `/[locale]/(org)/tournaments`.
- Bulk-import members from the club's player roster.
- Allocate courts to sessions via the existing court-availability surface.

Web UI specifics in [web-organizer-ux.md](./web-organizer-ux.md).

## 11 Courts

### Venue resolution

`tournaments.facility_id` and `sessions.facility_id` reference `facility.id` (singular table — `court` FKs directly to `facility`, there is no `facility_courts` join). The mobile and web surfaces:

- Show the facility's name, address, photos, contact info.
- Open in-app navigation to the facility.
- Surface the facility's booking integration if present.

### Court allocation

Sessions can attach a list of courts via `session_courts`. The match-sheet generator reads this list and allocates one court per parallel match (round-robin if `matches > courts`). If no courts attached, organizer manually labels via `court_label` text.

### Booking integration

Tournament organizers can bulk-book courts at the venue if the facility has a booking integration (system 11). The "Book courts for this tournament" button triggers the booking flow with pre-filled dates/times.

## 12 Calendar

L&T events surface in the user calendar with this shape:

```jsonc
{
  "id": "lt:tournament_match:<matchId>",  // OR lt:session:<sessionId>
  "title": "<Tournament/League name> — <round/session name>",
  "start": "<scheduled_at>",
  "end": "<scheduled_at + duration>",
  "location": "<venue or facility name>",
  "description": "<deep link + sport>",
  "kind": "tournament_match" | "league_session"
}
```

iCal export uses the same shape; UID is the `id` above so calendar-app updates work correctly across reschedules.

## 13 Gamification

New badges:

| Badge                  | Awarded when                                                            |
| ---------------------- | ----------------------------------------------------------------------- |
| `tournament_winner`    | Final match won                                                         |
| `tournament_finalist`  | Final match lost                                                        |
| `tournament_semifinal` | Reached semi-finals                                                     |
| `season_winner`        | Rank 1 at season close                                                  |
| `season_top_3`         | Ranks 2–3 at season close                                               |
| `perfect_attendance`   | `sessions_attended == sessions_eligible` at season close (≥ 3 sessions) |
| `league_veteran`       | Member of a league that completed ≥ 4 seasons                           |
| `bracket_buster`       | Beat a top-2 seed                                                       |

Badges are inserted by the appropriate completion triggers and visible on the player profile (system 13).

## 15 Admin (GOD MODE)

Admins can:

- Read/write any L&T row (RLS bypass via `is_admin()`).
- Re-open closed seasons by direct SQL (not exposed in UI).
- Resolve disputed scores when organizer is unresponsive (via admin-only override RPC).
- Soft-delete entities for moderation (sets `deleted_at`; rows hidden from RLS).

A web admin view at `/[locale]/(admin)/leagues-tournaments` lists all entities with status, sport, organizer, participant count.

## 16 Analytics

Full PostHog event taxonomy in [analytics.md](./analytics.md).

## 18 Monetization

**Deferred from v1.** No paid flows, no reserved schema columns, no Stripe wiring. See [monetization.md](./monetization.md) for the rationale and the additive-migration plan that brings monetization back when `specs/18-monetization/` is written.

## Authentication & progressive auth

Per [principles.md](../principles.md#8-progressive-authentication-guest-first-access):

| Action                      | Auth required? |
| --------------------------- | :------------: |
| View public tournament page |       ❌       |
| View public bracket         |       ❌       |
| View public ranking         |       ❌       |
| Register for tournament     |       ✅       |
| Confirm session presence    |       ✅       |
| Submit score                |       ✅       |
| Create tournament / league  |       ✅       |

Guest users hitting an auth-required CTA see the existing bottom-sheet sign-in flow. After auth, they are restored to the original action (e.g., "Register" auto-fires after sign-up).

## i18n / bilingual content

System content (notifications, status labels, error messages) lives in `packages/shared-translations/src/locales/{en-US,fr-CA}.json` under `leaguesTournaments.*`.

User-input free text (`tournaments.name`, `tournaments.description`, `leagues.name`, etc.) is stored as a single string. The user types in their language; consumers see it as-is. There is no machine translation in v1.

For descriptions that organizers want bilingual, the recommended convention is:

```
[FR]
Description en français...

[EN]
Description in English...
```

Mobile and web render this as-is.
