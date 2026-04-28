# Notifications

## Overview

Multi-channel notification system for match updates, messages, and system alerts.

## Notification Channels

| Channel | Use Case                 | Timing               |
| ------- | ------------------------ | -------------------- |
| Push    | Real-time alerts         | Immediate            |
| Email   | Confirmations, summaries | Immediate or batched |
| SMS     | Urgent reminders         | Immediate            |
| In-App  | All notifications        | When app is open     |

## Notification Types

### Match Notifications

| Event                   | Push | Email | SMS      |
| ----------------------- | ---- | ----- | -------- |
| New match invitation    | ✅   | ✅    | Optional |
| Match accepted          | ✅   | ✅    | -        |
| Match declined          | ✅   | -     | -        |
| Match cancelled         | ✅   | ✅    | ✅       |
| Match reminder (24h)    | ✅   | ✅    | -        |
| Match reminder (day of) | ✅   | -     | ✅       |
| Feedback request        | ✅   | ✅    | -        |

### Social Notifications

| Event                   | Push | Email | SMS |
| ----------------------- | ---- | ----- | --- |
| New message             | ✅   | -     | -   |
| Added to group          | ✅   | -     | -   |
| Community join approved | ✅   | ✅    | -   |
| Level certified         | ✅   | ✅    | -   |
| Badge earned            | ✅   | ✅    | -   |

### System Notifications

| Event                    | Push | Email | SMS |
| ------------------------ | ---- | ----- | --- |
| Weekly match suggestions | ✅   | ✅    | -   |
| New Most Wanted Players  | -    | ✅    | -   |
| Account updates          | -    | ✅    | -   |

## Sport Context

Match notifications carry `payload.sportName` so the renderer can include sport context in the title or body where it adds value. **Do not** wrap subjects with bracketed tags like `[Tennis]` or use emojis in any notification surface (push, email, SMS) — keep all copy as plain prose.

### Examples

**Push notification:**

```
New game invitation from Jean D.
Jean D. wants to play tennis tomorrow at 3pm.
```

**Email subject:**

```
Your tennis game on Saturday is confirmed
```

**SMS:**

```
Rallia: Your tennis game with Jean starts in 2h
```

## Notification Preferences

Users can control notifications:

### Global Settings

| Setting             | Options  |
| ------------------- | -------- |
| Push Notifications  | On / Off |
| Email Notifications | On / Off |
| SMS Notifications   | On / Off |

### Per-Type Settings

Per `notification_type × delivery_channel` toggles in the in-app preferences screen. All types are user-controllable; defaults are defined in `supabase/functions/send-notification/types.ts` (`DEFAULT_PREFERENCES`).

### Per-Conversation Settings

- Mute individual chats
- Mute specific groups/communities

## Match Reminders

| Timing          | Channel      | Content                     |
| --------------- | ------------ | --------------------------- |
| 24 hours before | Push + Email | Full match details          |
| Day of match    | Push + SMS   | Time and location reminder  |
| 2 hours before  | Push         | "Get ready for your match!" |

## Sport-Based Filtering

The in-app Notifications screen filters notifications by the currently selected sport.

### Filtering Rules

| Notification Category                                           | Filtering Behavior                                                               |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Match** (invitations, join requests, updates, feedback, etc.) | Filtered by `payload.sportName` — only shown when the matching sport is selected |
| **Social** (chat, messages, rating verified)                    | Always shown regardless of selected sport                                        |
| **System** (reminders, payments, support)                       | Always shown regardless of selected sport                                        |

### Implementation

- All match-related notifications include a `sportName` field in their `payload` JSONB (lowercase: `"tennis"`, `"pickleball"`)
- Filtering is applied client-side on already-fetched data
- Notifications without a `sportName` in their payload are always displayed (system/social)
- Unread counts per sport are queried server-side for badge indicators (see [Cross-Sport Pending Actions Alert](../02-sport-modes/interface-switching.md#cross-sport-pending-actions-alert))

## Technical Notes

- Push delivered via Expo Push API (which uses APNs for iOS and FCM for Android)
- Email via transactional service (Resend) with branded org templates rendered server-side
- SMS via Twilio
- All copy lives in `packages/shared-translations/src/locales/{en-US,fr-CA}.json` under `notifications.*`. Edge functions import the same source — never duplicate strings.

## Future work (deferred)

The following were considered for the initial launch but are deferred:

- **Quiet hours** — per-user, timezone-aware suppression window. Will require `profile.quiet_hours_start/end` and dispatch-time checks in `send-notification`.
- **Batching for fan-out events** — nearby/group match-created notifications currently fire 1:1 per recipient. A daily digest or per-user-per-day cap is desirable once volume warrants it.
- **Popular-player invitation batching** — for users who receive many invitations, batch into a periodic summary with an opt-in to individual notifications.
