# Web onboarding: create the account on the web, play in the app

Drafted 2026-08-22. Companion to [onboarding-minimum.md](./onboarding-minimum.md),
which defines what every onboarding path must collect; this document covers
the web funnel specifically.

## Decision

The web is Rallia's **account-creation and attribution surface**. The app
stays the product. A visitor who arrives on the web (landing page, a friend's
invite link, a game invite, a court or event page) can create a complete,
app-valid player account there, then install the app, sign in once, and land
on Home with no wizard.

This is deliberately **not** the player web app. The `/app` shell stays
parked behind `PLAYER_APP_ENABLED` (commit `9d08d101`). The onboarding funnel is
a standalone public route with an install hand-off as its end state; it must
not depend on, link into, or be gated by the player shell.

In-app onboarding stays exactly as it is. A player who never touches the web
still creates a full profile in the app; a player who did the web funnel skips
it because `profile.onboarding_completed` is already true.

## Why

1. **Attribution moves from the device to the account.** The App Store strips
   the referrer. Today's bridge is a signed clipboard token (`/api/attribution/sign`,
   15-minute window, paste prompt), best-effort by construction. When the
   account is created on the web, `acquisition_channel`, `referred_by`,
   `referral_invitation_type`, `referral_target_id` and the five `utm_*`
   columns on `profile` are written server-side before any install happens.
   Deterministic, and the clipboard token becomes a fallback for people who
   skip the web.
2. **A web-captured account is a re-engageable lead; an App Store bounce is
   gone.** With an email and a half-built profile we can send "finish in the
   app" nudges. With a bounce we have nothing.
3. **The hop sticks.** Web-join is this exact flow for one entry point. Of the
   10 accounts it has created (2026-06-24 to 2026-08-17): 7 installed the app,
   and all 7 went on to join more games in-app than the one they came for (3 to
   27 participations, still active weeks later). The 3 who did not install were
   never seen again. The cliff is entirely at "did not install", which is the
   group the lead capture lets us chase. The sample is tiny and high-intent
   (invited by a friend to a specific game); a cold landing-page cohort will
   convert lower. The shape is what matters: nobody installed and churned.
4. **Most of it exists.** `writeWebOnboardingProfile`, `writeFavoriteFacilities`,
   `writePlayerAvailability`, the consent RPC, `landing-attribution`,
   `referral-tracking`, the clipboard hand-off, and the parked wizard's steps.
   This is a re-point with one new route, not a build.

## Non-goals

- Any in-app feature on the web (games, chat, courts, compete). See the parity
  decision: web is acquisition and desk tooling, not a second product.
- Replacing in-app onboarding.
- Photo, playing hand, travel distance on the web. These are post-install
  moments where the app has the map, the location permission and a committed
  user. Every web step before the install is a drop-off point before we have
  them in the app. Availability is the one deliberate exception; see step 7.

## The funnel

### Entry points

All of these lead into the same route, carrying their context:

| Entry                                                     | Today                                 | After                                                                                                                          |
| --------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Landing page (`/`)                                        | store badges                          | primary CTA "Create your account", store badges secondary                                                                      |
| `/invite/[code]` (referral)                               | store badges + iOS clipboard hand-off | CTA into the funnel with `referred_by` resolved from the code; badges + hand-off stay for people who prefer to install first   |
| `/join/[code]` (community / group)                        | same                                  | same, with `referral_invitation_type`                                                                                          |
| `/join/match/[matchId]` (web-join)                        | its own gate                          | becomes a variant of the funnel: same steps, plus the game join at the end and the game's facility pre-selected as a favourite |
| `/book/facility/[id]` (booking gate)                      | its own gate                          | same treatment as web-join                                                                                                     |
| `/play`, `/play/courts/[slug]`, `/events`, `/player/[id]` | store badges                          | CTA into the funnel; the court page pre-selects that court as a favourite                                                      |

`getLandingContext` already captures UTM and referral context on these pages;
it is threaded into the funnel and persisted on the account, not only into the
clipboard token.

### Route

`/get-started` (fr-CA: same path, localized copy), under the `(marketing)`
group. Public, `robots: noindex`, not under `(player)`, not gated by
`PLAYER_APP_ENABLED`. If a signed-in, already-onboarded player lands on it, it
skips straight to the hand-off page.

### Steps

Lean by design: exactly what creates an app-valid account under the
onboarding-minimum invariant, plus attribution.

| #   | Step                 | Collects                                                    | Notes                                                                                                                                      |
| --- | -------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Sign in / sign up    | auth identity                                               | Apple, Google, email OTP. Same provider set as the app's `AuthWizard` so the second sign-in is the same tap. See "The second sign-in".     |
| 2   | Consent              | privacy + terms at current versions                         | `accept_policy_consent` RPC, same as mobile.                                                                                               |
| 3   | About you            | first name, last name, date of birth, gender                | Pre-fill from the provider when available. Minimum age enforced (`meetsMinimumAge`).                                                       |
| 4   | Where you play       | postal code, geocoded to city/province/lat/lng              | Required. Address optional.                                                                                                                |
| 5   | Your sport and level | one sport, self-reported rating                             | One sport on the web; a second sport is an in-app moment.                                                                                  |
| 6   | Your courts          | `>= MIN_FAVORITE_FACILITIES` favourites for that sport      | Nearest facilities to the postal code, entry-point facility pre-selected. Keyed by the shared constant.                                    |
| 7   | When you play        | weekly availability grid, `>= MIN_AVAILABILITY_CELLS` cells | Same constant and same minimum as the mobile wizard (6 cells). Reuses the parked wizard's availability step and `writePlayerAvailability`. |
| 8   | Done                 |                                                             | `complete_onboarding()` RPC; hand-off page.                                                                                                |

Steps 2 to 4 already exist in `use-web-onboarding.ts`; the writers for steps 6
and 7 exist; the parked wizard's sport, favourites and availability steps are
reusable. Only the parked wizard's photo step is dropped from the web.

Availability is kept on the web because it is what makes the account useful on
day one: the auto-match and suggestion paths read it, so a web-created player
can receive a real game proposal before they even open the app, which is the
strongest possible reason to install. It is a wizard requirement, like on
mobile, not part of the server invariant in onboarding-minimum. It is also the
first step to move in-app if its drop-off proves to cost more than it yields;
measure it on its own.

### What gets written

Through `writeWebOnboardingProfile` and `writeFavoriteFacilities`, then
`complete_onboarding()` (never a direct `onboarding_completed: true`):

- `profile`: names, birth date, locale, **`acquisition_channel = 'web'`**
  (new value; `web_join` and a `web_book` value stay for the two gates so the
  cohorts remain distinguishable), `referred_by`, `referral_invitation_type`,
  `referral_target_id`, `utm_*`.
- `player`: postal code, city, province, lat/lng, gender, default travel
  distance and playing hand.
- `player_sport` + `player_rating_score`: the `auto_activate_first_player_rating`
  trigger promotes the rating to `active_rating_score_id` (verified on prod for
  all 10 web-join players).
- `player_favorite_facility`: the chosen courts, sport-scoped.
- `player_availability`: the grid cells, via `writePlayerAvailability`.
- `player_consent`: via the RPC.

### Hand-off page

The end state of the web funnel. It must do four things:

1. Say clearly that the account is ready and that the app is where games
   happen. No dead-end "thank you".
2. Store badges (existing `TrackedStoreBadges`) plus the iOS clipboard
   hand-off (existing `IOSCodeHandoff`) as belt and braces for attribution.
3. State the sign-in method they just used ("Sign in with Google in the app,
   same as here") so the second sign-in is a recognition, not a decision.
4. Send a confirmation email with a store link through the `/api/go` bouncer,
   so the hand-off survives a closed tab and works on a desktop visit
   (open the email on the phone).

### The second sign-in

The session does not transfer from web to app. The funnel survives this only
if the second sign-in is one tap and lands on the **same** account.

- Same provider set on both sides: Apple, Google and email OTP exist on both
  today (web also has Facebook; keep it off the funnel unless the app has it).
- Same identity: Apple on the web and Apple on iOS resolve to the same Supabase
  user; Google likewise; email OTP by address. Supabase identity linking on a
  matching verified email covers the cross-provider case, but this must be
  verified end-to-end on staging before launch, including Apple's
  relay-email case, or we create duplicate accounts at exactly the moment we
  are trying to prove continuity.
- The app's pre-onboarding stays unchanged (it runs before auth and cannot
  know who the visitor is). After sign-in, `checkOnboardingStatus` reads the
  flag and goes to Home.

### Re-engagement

If the account has no app sign-in signal (`player.expo_push_token` null and no
app session) after 24 hours, one email: "your account is ready, finish in the
app", CTA through the bouncer. One more at 72 hours. Then stop. This is the
lever web-join never had and the reason the 3 non-installers were lost.

## Measurement

Events, all tagged `source = 'web_onboarding'` and the entry point:

- `web_onboarding_started`, `_step_completed(step)`, `_completed`
- `web_onboarding_app_signed_in` (first app session for a web-created account)
- time from web completion to first app sign-in; to first game joined

Targets, to be set after the first 100 completions:

- web completion to app sign-in: web-join's 7/10 is the ceiling for invited
  users; the cold landing-page cohort will sit below it. Compare against the
  direct App Store cohort's onboarding completion, not against 100 %.
- share of new accounts with deterministic attribution (any of
  `referred_by`, `utm_source`, `referral_target_id` set) before vs after.

## Phasing

1. **Foundation.** `complete_onboarding()` RPC and the trigger guard from
   onboarding-minimum; `MIN_FAVORITE_FACILITIES` in shared-utils; the two
   existing gates call the RPC and gain the favourites step. This fixes the
   live invariant breach independently of the funnel.
2. **The route.** `/get-started` with the eight steps, the hand-off page, the
   `'web'` channel, UTM/referral persisted on the account. Landing-page CTA
   only. Staging verification of same-account sign-in for Apple, Google, OTP.
3. **Entry points.** `/invite/[code]`, `/join/[code]`, `/play`, `/events`,
   `/player/[id]` point into the funnel with their context. Web-join and the
   booking gate become variants.
4. **Re-engagement.** The 24 h / 72 h emails.

The parked `(player)` app and its flag are untouched throughout.

## Open questions

1. `MIN_FAVORITE_FACILITIES`: 2 or 3 (see onboarding-minimum).
2. Should the web also offer the _second_ sport when the visitor plays both?
   Proposal: no, one sport on the web; the app's cross-sport banner already
   handles it.
3. Facebook on the funnel: only if the app keeps it; otherwise it is a
   continuity trap.
4. Whether desktop visitors get a QR code on the hand-off page in addition to
   the email. Cheap, probably yes; decide with the first desktop-share number.
