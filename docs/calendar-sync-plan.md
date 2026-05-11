# Calendar Sync Plan — Personal Webcal Feed

## Goal

Let players subscribe their phone/computer calendar to their Rallia matches once, then have new matches, reschedules, and cancellations propagate automatically. No OAuth, no per-event "Add to Calendar" mashing.

## Current state

- Match-related emails (`supabase/functions/send-notification/templates/match.ts`) include a Google Calendar URL and a `.ics` download (served by `supabase/functions/calendar-event/index.ts`).
- Both are one-shot per event — no sync, no propagation of updates.
- No OAuth, no webcal feed, no `expo-calendar` usage on mobile.
- `match` table has a `timezone` column (IANA, defaults to `UTC`); `facility` does not. The existing `calendar-event` function currently treats inputs as UTC.

## Decisions locked in

- **Feed scope**: confirmed-only (matches where the player's `match_participant.status` is `accepted`/`confirmed`). Pending invites stay out to avoid clutter.
- **UI surface**: mobile app settings only (`apps/mobile/src/screens/SettingsScreen.tsx`). Web + onboarding nudge are deferred.
- **Token model**: opaque random token stored in a `calendar_subscription` table. Easy to rotate or revoke.

## Architecture

### New table: `calendar_subscription`

- `id uuid pk`
- `player_id uuid fk unique` (one subscription per player)
- `token text unique not null` — 32+ random bytes, base64url
- `created_at timestamptz default now()`
- `revoked_at timestamptz null`
- RLS: player can read/insert/update/delete their own row; service role for the edge function lookup.

Regenerate = update `token` in place (invalidates old URL). Disconnect = set `revoked_at` (or delete the row).

### New edge function: `supabase/functions/calendar-feed/index.ts`

- Path: `/calendar-feed/<token>.ics` (token parsed from URL, no JWT).
- Lookup token → player_id with the service role; 404 if missing or revoked.
- Query matches via PostgREST join: confirmed participants for `match_date >= today - 30 days` (recent past stays visible so cancellations within window can emit `STATUS:CANCELLED` and clients remove them).
- Build the ICS string inline (duplicate the ~30 lines from `calendar-event/index.ts`; only extract a shared helper if a third consumer appears).
- Response headers:
  - `Content-Type: text/calendar; charset=utf-8`
  - `Cache-Control: private, max-age=300`

### VEVENT shape

- `UID = match-<match_id>@rallia.app` — stable, so updates replace instead of duplicating.
- `DTSTAMP` = now UTC.
- `DTSTART;TZID=<match.timezone>` and `DTEND;TZID=<match.timezone>` in local form (e.g. `20260512T180000`).
- Emit a `VTIMEZONE` block for each unique timezone in the feed (Apple Calendar requires it; Google tolerates either). This is the trickiest part of the function.
- `SUMMARY` = e.g. `"<Sport> @ <facility/location_name>"`.
- `LOCATION` = `location_name` + `location_address`.
- `DESCRIPTION` = short blurb + deep link back to the match.
- `STATUS` = `CONFIRMED`; flip to `CANCELLED` if the match is cancelled.
- `SEQUENCE` = monotonic int derived from `match.updated_at` (e.g. unix-minute since match created) so reschedules propagate.

### VCALENDAR wrapper

- `PRODID:-//Rallia//Match Feed//EN`
- `METHOD:PUBLISH`
- `X-WR-CALNAME:Rallia matches`
- `X-WR-TIMEZONE:<player default tz or UTC>`

### Helper: `subscribe_to_calendar` RPC (or small edge function)

- Upserts a `calendar_subscription` row for the calling user and returns the token (or full URL).
- Called by mobile UI on first "Add to Calendar" tap.

## Mobile UX (`apps/mobile`)

New section in `SettingsScreen.tsx`: **"Sync to your calendar"**.

States:

1. **Not subscribed**: short blurb + primary button "Add to Calendar" → calls `subscribe_to_calendar`, then `Linking.openURL('webcal://<project>.functions.supabase.co/calendar-feed/<token>.ics')` to open Apple Calendar's subscribe sheet on iOS.
2. **Subscribed**: status row + actions:
   - **Copy link** — copies the `https://` form for Google Calendar / Outlook users.
   - **Regenerate link** — rotates the token; warns that existing subscriptions will break.
   - **Disconnect** — revokes the token.

Translations in `packages/shared-translations` (en-US + fr-CA): ~6 strings.

One-line note in the UI: "Google Calendar may take up to 24 hours to refresh subscribed calendars; last-minute changes still come via push notifications."

## Ship order

1. Migration: `calendar_subscription` table + RLS + token generator helper.
2. Edge function `calendar-feed` (read-only, the bulk of the work — VTIMEZONE handling is the trickiest part).
3. `subscribe_to_calendar` RPC/function that upserts and returns the token.
4. Mobile settings UI + translations.
5. Manual QA: subscribe in Apple Calendar (iOS + macOS), Google Calendar (paste https URL), Outlook web. Verify reschedule and cancel propagate after refresh.

## Out of scope

- Google Calendar's ~12–24h refresh cadence is a known limitation — last-minute changes still rely on push notifications, not the feed.
- Web "Subscribe" button — easy follow-up reusing the same URL.
- Onboarding nudge — defer until adoption signal warrants it.
- Two-way OAuth sync (Google Calendar API, Microsoft Graph) — separate, much larger project.
- `expo-calendar` direct device-write — separate, mobile-only path.
