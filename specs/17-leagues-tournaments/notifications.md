# Notifications

> Per-event payload schemas, channels, i18n keys, and triggers for leagues and tournaments.

All notifications are routed through the existing `supabase/functions/send-notification/` edge function. New event types are added to the `notification_type` enum and to `DEFAULT_PREFERENCES` in `supabase/functions/send-notification/types.ts`. UI preference toggles are auto-generated from the default preferences map.

## Channels

Same channels as the rest of Rallia: in-app, push, email, SMS. SMS is reserved for high-urgency events only.

Each channel respects:

- User-level toggle (Settings → Notifications).
- Per-type × per-channel toggle (mirrors [08-communications/notifications.md](../08-communications/notifications.md#per-type-settings)).
- User's `preferred_locale` for content rendering.
- Quiet hours (10pm–7am local) for push and SMS — only `urgent = true` events bypass.

## Sport context

Every payload carries `sportName`, `sport` (`tennis` | `pickleball`), and `entityKind` (`tournament` | `league` | `season` | `session` | `match`) so the renderer can include sport context in the body. Per [08 notifications](../08-communications/notifications.md#sport-context), do **not** prefix subjects with `[Tennis]`-style tags or use emojis.

## Tournament events

| Event type                         | Triggers when                                   | Recipients                                | Push | Email | SMS | i18n key prefix                             |
| ---------------------------------- | ----------------------------------------------- | ----------------------------------------- | :--: | :---: | :-: | ------------------------------------------- |
| `tournament_registration_open`     | Status → `registration_open`                    | Public watchers; community members        |  ✅  |   —   |  —  | `notifications.tournament.registrationOpen` |
| `tournament_registered`            | Player registers (status `registered`)          | The registered player                     |  ✅  |  ✅   |  —  | `notifications.tournament.registered`       |
| `tournament_pending`               | Player registers (status `pending`)             | The registered player                     |  ✅  |   —   |  —  | `notifications.tournament.pending`          |
| `tournament_approved`              | Organizer approves a `pending` registration     | The registered player                     |  ✅  |  ✅   |  —  | `notifications.tournament.approved`         |
| `tournament_rejected`              | Organizer rejects                               | The applicant                             |  ✅  |  ✅   |  —  | `notifications.tournament.rejected`         |
| `tournament_waitlisted`            | Player promoted to waitlist                     | The player                                |  ✅  |   —   |  —  | `notifications.tournament.waitlisted`       |
| `tournament_waitlist_promoted`     | Waitlist row promoted                           | The promoted player                       |  ✅  |  ✅   | ✅  | `notifications.tournament.waitlistPromoted` |
| `tournament_partner_invite`        | Doubles partnership creation                    | Invited partner                           |  ✅  |  ✅   |  —  | `notifications.tournament.partnerInvite`    |
| `tournament_partner_accepted`      | Partner accepts                                 | Both partners                             |  ✅  |   —   |  —  | `notifications.tournament.partnerAccepted`  |
| `tournament_partner_declined`      | Partner declines                                | Original requester                        |  ✅  |  ✅   |  —  | `notifications.tournament.partnerDeclined`  |
| `tournament_partner_withdrew`      | A partner withdraws after partnership confirmed | Remaining partner                         |  ✅  |  ✅   |  —  | `notifications.tournament.partnerWithdrew`  |
| `tournament_started`               | Bracket generated; status → `in_progress`       | All registered participants               |  ✅  |  ✅   |  —  | `notifications.tournament.started`          |
| `tournament_match_scheduled`       | Match `scheduled_at` set or changed             | Match's two players (or 4 in doubles)     |  ✅  |  ✅   |  —  | `notifications.tournament.matchScheduled`   |
| `tournament_match_reminder_24h`    | 24h before scheduled match                      | Match's players                           |  ✅  |  ✅   |  —  | `notifications.tournament.match24h`         |
| `tournament_match_reminder_1h`     | 1h before                                       | Match's players                           |  ✅  |   —   | ✅¹ | `notifications.tournament.match1h`          |
| `tournament_match_changed`         | Manual swap / reschedule                        | Affected players                          |  ✅  |  ✅   |  —  | `notifications.tournament.matchChanged`     |
| `tournament_match_score_submitted` | Player submits score                            | Opponent + organizer                      |  ✅  |   —   |  —  | `notifications.tournament.scoreSubmitted`   |
| `tournament_match_score_disputed`  | Player disputes opponent's score                | Organizer                                 |  ✅  |  ✅   |  —  | `notifications.tournament.scoreDisputed`    |
| `tournament_match_score_validated` | Organizer validates score                       | Both players                              |  ✅  |   —   |  —  | `notifications.tournament.scoreValidated`   |
| `tournament_match_advanced`        | Player advances to next round (auto)            | Advancing player                          |  ✅  |   —   |  —  | `notifications.tournament.matchAdvanced`    |
| `tournament_rescheduled`           | Tournament dates shifted                        | All participants                          |  ✅  |  ✅   |  —  | `notifications.tournament.rescheduled`      |
| `tournament_cancelled`             | Status → `cancelled`                            | All participants                          |  ✅  |  ✅   | ✅² | `notifications.tournament.cancelled`        |
| `tournament_completed`             | Final match completes                           | All participants + spectators (if public) |  ✅  |  ✅   |  —  | `notifications.tournament.completed`        |

¹ SMS only when match is **today** AND player has SMS enabled AND not in quiet hours.
² SMS only if cancellation occurs **within 24h** of `start_date`.

## League events

| Event type                      | Triggers when                                            | Recipients                           | Push | Email | SMS | i18n key prefix                             |
| ------------------------------- | -------------------------------------------------------- | ------------------------------------ | :--: | :---: | :-: | ------------------------------------------- |
| `league_member_invited`         | Organizer invites                                        | Invited user                         |  ✅  |  ✅   |  —  | `notifications.league.invited`              |
| `league_member_join_requested`  | Player requests to join (approval mode)                  | Organizers                           |  ✅  |   —   |  —  | `notifications.league.joinRequested`        |
| `league_member_approved`        | Organizer approves                                       | Approved member                      |  ✅  |  ✅   |  —  | `notifications.league.approved`             |
| `league_member_rejected`        | Organizer rejects                                        | Applicant                            |  ✅  |  ✅   |  —  | `notifications.league.rejected`             |
| `league_member_suspended`       | Organizer suspends                                       | Suspended member                     |  ✅  |  ✅   |  —  | `notifications.league.suspended`            |
| `league_member_kicked`          | Organizer kicks                                          | Kicked member                        |  ✅  |  ✅   |  —  | `notifications.league.kicked`               |
| `season_opened`                 | Season → `open`                                          | All active members                   |  ✅  |  ✅   |  —  | `notifications.season.opened`               |
| `season_closing_soon`           | 7 days before `end_date`                                 | All active members                   |  ✅  |   —   |  —  | `notifications.season.closingSoon`          |
| `season_closed`                 | Season → `closed`                                        | All active and former members        |  ✅  |  ✅   |  —  | `notifications.season.closed`               |
| `session_published`             | Session → `published`                                    | All active members                   |  ✅  |  ✅   |  —  | `notifications.session.published`           |
| `session_confirm_reminder`      | 48h before `confirmation_deadline_at`                    | Members with status `pending`        |  ✅  |   —   |  —  | `notifications.session.confirmReminder`     |
| `session_confirm_last_call`     | 6h before deadline                                       | Members with status `pending`        |  ✅  |  ✅   |  —  | `notifications.session.confirmLastCall`     |
| `session_confirmations_closed`  | Deadline passed                                          | Organizer                            |  ✅  |   —   |  —  | `notifications.session.confirmationsClosed` |
| `session_waitlist_promoted`     | Waitlist row promoted                                    | Promoted member                      |  ✅  |  ✅   | ✅  | `notifications.session.waitlistPromoted`    |
| `session_sheet_published`       | Match sheet generated and revealed to members            | All confirmed members                |  ✅  |  ✅   |  —  | `notifications.session.sheetPublished`      |
| `session_match_changed`         | Manual swap / regeneration                               | Affected players                     |  ✅  |   —   |  —  | `notifications.session.matchChanged`        |
| `session_reminder_24h`          | 24h before `scheduled_at`                                | Confirmed members                    |  ✅  |  ✅   |  —  | `notifications.session.reminder24h`         |
| `session_reminder_1h`           | 1h before                                                | Confirmed members                    |  ✅  |   —   | ✅¹ | `notifications.session.reminder1h`          |
| `session_match_score_submitted` | Player submits                                           | Opponent + organizer                 |  ✅  |   —   |  —  | `notifications.session.scoreSubmitted`      |
| `session_match_score_disputed`  | Player disputes                                          | Organizer                            |  ✅  |  ✅   |  —  | `notifications.session.scoreDisputed`       |
| `session_match_score_validated` | Organizer validates                                      | Both players                         |  ✅  |   —   |  —  | `notifications.session.scoreValidated`      |
| `session_completed`             | Session → `completed`                                    | All confirmed members                |  ✅  |   —   |  —  | `notifications.session.completed`           |
| `session_cancelled`             | Session → `cancelled`                                    | All confirmed and waitlisted members |  ✅  |  ✅   | ✅² | `notifications.session.cancelled`           |
| `session_rescheduled`           | `scheduled_at` changed                                   | All confirmed and pending members    |  ✅  |  ✅   |  —  | `notifications.session.rescheduled`         |
| `ranking_updated`               | After `recalc_season_ranking` if a member's rank changed | Affected members                     | ✅³  |   —   |  —  | `notifications.season.rankingUpdated`       |

¹ Subject to SMS-enabled + non-quiet-hours, mirrors tournament reminder.
² Only if cancellation occurs **within 6h** of `scheduled_at`.
³ Throttled: at most one `ranking_updated` push per member per session-completion event, even if rank changes by multiple positions.

## Payload schema

Notifications carry a JSON `payload` object inserted on the `notifications` row. The payload is what the client renderer (mobile / email template) consumes.

### Common fields

```jsonc
{
  "type": "tournament_started",
  "sport": "tennis",
  "sportName": "Tennis",
  "entityKind": "tournament",
  "tournamentId": "...", // OR leagueId / seasonId / sessionId / matchId
  "deepLink": "rallia://tennis/tournaments/<id>",
  "webLink": "https://app.rallia.app/tennis/tournaments/<id>",
}
```

### Type-specific payloads

```jsonc
// tournament_match_scheduled
{
  "type": "tournament_match_scheduled",
  "tournamentId": "...",
  "matchId": "...",
  "roundName": "Quarter Finals",
  "scheduledAt": "2026-04-12T14:00:00Z",
  "venueName": "Stade IGA",
  "courtLabel": "Court 5",
  "opponentName": "Jane S."
}

// session_published
{
  "type": "session_published",
  "leagueId": "...",
  "seasonId": "...",
  "sessionId": "...",
  "sessionName": "Session #4",
  "scheduledAt": "2026-04-15T18:00:00Z",
  "confirmationDeadlineAt": "2026-04-14T18:00:00Z",
  "venueName": "Club Mont-Royal"
}

// ranking_updated
{
  "type": "ranking_updated",
  "leagueId": "...",
  "seasonId": "...",
  "previousRank": 5,
  "newRank": 3,
  "totalPoints": 42
}
```

The full payload schema is in `supabase/functions/_shared/leagues-tournaments-payload-schema.json`.

## i18n

Every notification has both `en-US` and `fr-CA` strings in `packages/shared-translations/src/locales/{en-US,fr-CA}.json` under `notifications.{tournament,league,season,session}.<eventKey>`. Each entry has at least `title` and `body` and may have `subject` (email) and `smsBody` (SMS).

Example:

```jsonc
// en-US.json
{
  "notifications": {
    "session": {
      "published": {
        "title": "{{leagueName}} — {{sessionName}} is now open",
        "body": "Confirm your attendance for {{date}} by {{deadline}}.",
        "subject": "{{leagueName}}: confirm your spot for {{sessionName}}",
      },
    },
  },
}
```

The renderer interpolates from the payload. Locale resolution: `users.preferred_locale` (set on onboarding, editable in settings).

## Batching & throttling

- `ranking_updated`: at most 1 per recipient per `recalc_season_ranking` call (deduped on `season_id`).
- `tournament_match_changed` and `session_match_changed`: coalesced — if multiple changes within 60 seconds touch the same match, only the latest fires.
- `tournament_waitlisted` while many waitlist rows shuffle: one notification per affected user even if their position changed multiple times in <30s.
- Day-of-week reminders for sessions are clamped to one push per session per recipient regardless of cron drift.

## Triggers

Notifications are dispatched by:

1. **RPC bodies** (synchronous fan-out via `send-notification`) for actions like register, withdraw, score-submit. These are fire-and-forget after the DB transaction commits.
2. **Cron jobs** (`lt-tournament-reminders`, `lt-session-reminders`, `lt-close-confirmations`) for time-based events.
3. **Database triggers** for cascading events like waitlist promotion, status auto-transitions, ranking changes.

The pattern mirrors the existing match notifications path — see `supabase/functions/send-notification/handlers/`.

## Push payload structure

Push notifications follow Expo's APNs/FCM bridge format already in use:

```json
{
  "to": "ExponentPushToken[...]",
  "sound": "default",
  "title": "Session #4 published",
  "body": "Confirm your attendance for Apr 15 by Apr 14, 18:00.",
  "data": {
    /* the full payload above */
  },
  "categoryId": "lt_session_published",
  "channelId": "leagues-tournaments"
}
```

The `categoryId` controls iOS notification actions (e.g., "Confirm" / "Decline" inline buttons for `session_published`).

## Sample inline action: confirmation from notification

For `session_published`, iOS notification carries action buttons:

| Button id | Localized label               | Server action                                      |
| --------- | ----------------------------- | -------------------------------------------------- |
| `confirm` | "I'm in" / "Je joue"          | `session_confirm_presence(sessionId, 'confirmed')` |
| `decline` | "Can't make it" / "Pas dispo" | `session_confirm_presence(sessionId, 'declined')`  |
| `view`    | "Open" / "Ouvrir"             | Deep-link to session                               |

This lets organizers get fast confirmations without forcing app-open. Implementation uses Expo notification categories registered in `src/services/notifications.ts`.

## Email templates

Each event with `Email = ✅` has a matching template in `supabase/functions/send-email/templates/`. The shape matches the existing `notification.ts` pattern; new templates added:

- `tournament-registered.ts`
- `tournament-started.ts`
- `tournament-cancelled.ts`
- `season-opened.ts`
- `season-closed.ts`
- `session-published.ts`
- `session-rescheduled.ts`

All templates accept the localized payload object and render bilingual content per `users.preferred_locale`.
