# Onboarding minimum: the invariant every path must satisfy

Drafted 2026-08-22. Applies to every way a player can reach
`profile.onboarding_completed = true`: the mobile wizard, the web join and
booking gates, and the web onboarding funnel ([web-onboarding.md](./web-onboarding.md)).

## The invariant

A player is onboarded only if, at the moment the flag flips, all of the
following hold:

| #   | Requirement                                                                     | Where it lives                                              | Why it is non-negotiable                                                                                                                             |
| --- | ------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A postal code, geocoded to `latitude`/`longitude`                               | `player.postal_code`, `player.latitude`, `player.longitude` | Every matchmaking read (suggestions, auto-match, nearby, auto-invite distance) is location-first. Without it the player is unreachable.              |
| 2   | At least one sport, and **every** sport the player has carries an active rating | `player_sport` rows, each with `active_rating_score_id` set | Exact-rating matching and tournament/league eligibility read through `active_rating_score_id` only. An unrated sport is a dead sport.                |
| 3   | At least `MIN_FAVORITE_FACILITIES` favourite facilities **per sport**           | `player_favorite_facility` (sport-scoped)                   | The auto-invite gate requires a favourite facility shared with the game. Zero favourites means zero auto-invites, which is the main liquidity lever. |

Consent is already enforced by its own gate (`get_pending_policy_consents`
and the blocking re-consent screen) and is not part of this invariant.

### The constant

Today three different minimums exist:

- mobile wizard `favorite-sites` step: 2 per sport (hard-coded in `isStepComplete`)
- mobile `FavoriteFacilitiesSheet` (post-onboarding edit): `MIN_FAVORITES = 3`
- the parked web wizard: `z.array().min(2)`

Decision: **one exported constant, `MIN_FAVORITE_FACILITIES`, in
`@rallia/shared-utils`**, read by every client and mirrored in the SQL guard
below. Proposed value: **2**, the value onboarding already enforces; the edit
sheet's 3 becomes a "keep at least" nudge or aligns to 2 (decision flagged in
Open questions).

## Why this spec exists: the invariant is already broken

Prod snapshot, 2026-08-22, players with `onboarding_completed = true`:

| Cohort                                      | Players | No sport | No postal code | Zero favourites | All three missing |
| ------------------------------------------- | ------: | -------: | -------------: | --------------: | ----------------: |
| web-join (since 2026-06-24)                 |      10 |        0 |              0 |           **9** |                 0 |
| mobile and other, created since 2026-06-01  |     586 |   **55** |         **66** |          **61** |            **47** |
| mobile and other, created before 2026-06-01 |     269 |        0 |              2 |               6 |               n/a |

The 47 "all three missing" players are not ghosts: every one has a first name,
a self-reported acquisition channel (set in the wizard's personal step) and
availability rows. They walked through the wizard and came out with no sport,
no postal code and no favourites. 14 of them have a push token, so they are in
the app, invisible to every matchmaking path, and the
`trigger_match_generation_on_onboarding_complete` trigger fired for them anyway.

### Root causes

1. **Completion is a client-side flag flip with no server check.**
   `OnboardingService.completeOnboarding()` is a plain
   `profile.update({ onboarding_completed: true })`, called from two places:
   the wizard's final step and `PlayerAvailabilitiesOverlay`. Nothing verifies
   what was actually written.
2. **The wizard's step list depends on data that may not exist.** Rating steps
   are added only `if (hasTennis)` / `if (hasPickleball)`, resolved from the
   `player_sport` rows pre-onboarding is supposed to have saved. When those rows
   are missing (the "forced re-onboarding" incident fixed 2026-08-17 is one way
   that happened), the wizard silently drops every sport step, the favourites
   step has no sport to attach to, and the player exits "complete".
3. **The personal step does not require a postal code.** `isStepComplete('personal')`
   checks name, date of birth and gender only. Postal code arrives from
   pre-onboarding's `PostalCodeStep`, and when that hand-off fails there is no
   second ask.
4. **The web join and booking gates never collect favourites.**
   `writeWebOnboardingProfile` writes profile, player, one sport and one rating;
   neither gate calls `writeFavoriteFacilities`. 9 of 10 web-join players have
   zero favourites as a direct result.

## Enforcement: the server decides, every client obeys

### 1. `complete_onboarding()` RPC (SECURITY DEFINER, `auth.uid()` scoped)

Replaces every direct write of `onboarding_completed`. Evaluates the invariant
and either flips the flag or returns the list of what is missing:

```
complete_onboarding() returns jsonb
  -> { ok: true }
  -> { ok: false, missing: ['postal_code' | 'sport' | 'rating:<sport_id>' | 'favorites:<sport_id>'] }
```

The missing codes are stable identifiers the clients localize, never English
strings (same convention as the web join error codes). `MIN_FAVORITE_FACILITIES`
is mirrored as a SQL constant with a comment naming its TS twin; the two move
together (same rule as the GST/QST fee mirror).

Explicit GRANT to `authenticated`; the service role may call it too (the web
API routes run as service role), and it applies the same check there.

### 2. Trigger guard on `profile.onboarding_completed`

A `BEFORE UPDATE OF onboarding_completed` trigger refuses a `false -> true`
transition unless the invariant holds, regardless of caller (including the
service role and the admin dashboard). The RPC is the intended path; the
trigger is the backstop that makes bypass impossible. It raises a
`check_violation` with the same missing-code payload in the message.

No trigger on `true -> false`: we never demote a veteran (see Repair).

### 3. Each path's obligations

| Path                                                                        | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile wizard                                                               | Always include at least one sport step: if no `player_sport` rows are resolvable, show a sport-selection step instead of dropping the rating steps. Require a postal code on the personal step (or a dedicated location step) when `player.postal_code` is empty. Favourites step enforces `MIN_FAVORITE_FACILITIES` per sport from the shared constant. Final step calls `complete_onboarding()` and, on `ok: false`, jumps back to the first missing step instead of exiting. |
| `PlayerAvailabilitiesOverlay`                                               | Stops calling `completeOnboarding()`. Availability is not part of the invariant and this overlay is reachable from profile surfaces that have nothing to do with onboarding.                                                                                                                                                                                                                                                                                                    |
| Web join gate (`/join/match/[id]`) and booking gate (`/book/facility/[id]`) | Add a favourites step after location. Pre-select the game's (or booking's) facility and offer the nearest facilities to the geocoded postal code; the player confirms at least `MIN_FAVORITE_FACILITIES`. `writeFavoriteFacilities` already exists. Completion goes through `complete_onboarding()`; the `onboarding_completed: true` literal leaves `writeWebOnboardingProfile`.                                                                                               |
| Web onboarding funnel                                                       | Built to the invariant from day one; see [web-onboarding.md](./web-onboarding.md).                                                                                                                                                                                                                                                                                                                                                                                              |
| Adding a second sport later (`SportProfile`)                                | Already auto-opens the rating sheet and the favourites sheet. Make the favourites sheet's minimum the shared constant so a second sport cannot be left with fewer favourites than the first.                                                                                                                                                                                                                                                                                    |

### 4. Analytics

`onboarding_completed` events carry `source` (`mobile_wizard`, `web_join`,
`web_book`, `web_onboarding`) and, on refusal, the `missing` list. The existing
orphan-profile funnel queries key on `savePersonalInfo`; they need the web
sources added or the web cohorts read as drop-off.

## Repair: the players already inside

Do **not** flip anyone back to `onboarding_completed = false`. Re-onboarding a
player who believes they are done is worse than the gap (this is the
"fail toward the app" principle from the 2026-08-17 fix).

Instead:

- `get_onboarding_gaps()` RPC returns the same missing-code list for the
  current player without mutating anything.
- The existing `ProfileCompletionBanner` / `ProfileCompletionChecklist` on Home
  and the profile consume it and deep-link to the exact surface: location
  sheet, rating sheet, favourites sheet. One tap per gap, no wizard replay.
- For the 9 web-join players: the favourites sheet, pre-seeded with the
  facility of the game they joined.
- For the 47 mobile players with everything missing: the sport step first
  (nothing else can attach until a sport exists), then rating, then favourites,
  then location.
- Until repaired, these players stay where they effectively already are:
  excluded from suggestions, auto-match and auto-invites, which all require the
  data they lack. Nothing new breaks; the banner is the way out.

A one-off admin query (the snapshot above) is the acceptance check: the four
"missing" columns should trend to zero for new signups the day the guard ships,
and shrink for existing players as the banner does its work.

## Tests

- SQL tests (pgTAP, non-admin fixture players): the trigger refuses
  `false -> true` for each single missing requirement and accepts the full set;
  `complete_onboarding()` returns the right codes; service role is held to the
  same rule.
- Per path, one end-to-end: mobile wizard with pre-onboarding rows missing
  (must show the sport step, must not complete without postal), web join gate
  (must end with `>= MIN_FAVORITE_FACILITIES` favourites), web onboarding funnel.
- Regression for the 2026-08-17 case: a player with a profile but no
  `player_sport` rows cannot complete.

## Open questions

1. `MIN_FAVORITE_FACILITIES` value: 2 (onboarding today) or 3 (edit sheet today).
   Proposal is 2; the auto-invite gate only needs one shared facility, and each
   extra required pick costs signups.
2. Postal code on mobile: re-ask inside the personal step, or a dedicated
   location step after it? The web gates already have a separate location step;
   mirroring it keeps the two wizards parallel.
3. Whether the match-generation trigger on `onboarding_completed` should also
   re-check the invariant (cheap belt and braces) or trust the guard.
