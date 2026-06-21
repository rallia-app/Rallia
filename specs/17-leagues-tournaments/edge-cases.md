# Edge Cases

> Consolidated anomaly handling for tournaments, leagues, sessions, and matches.

This file collects every "what if" the engineering team should not have to invent on the fly. Each row links to the file that owns the canonical resolution.

## Tournament edge cases

| Scenario                                                           | Resolution                                                                                                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Player withdraws before bracket generated                          | Row deleted; waitlist promotes; notify next-in-line. See [tournaments.md](./tournaments.md#withdrawals)                                                      |
| Player withdraws after bracket generated                           | Organizer modal: walkover OR replace from waitlist OR replace with specific player. See [tournament-bracket.md](./tournament-bracket.md#replace-on-withdraw) |
| Player no-shows for match                                          | Opponent wins by walkover; reputation event `match_no_show` (-50)                                                                                            |
| Score discrepancy between players                                  | Match → `disputed`; organizer override decides. See [score-entry.md](./score-entry.md#disputes)                                                              |
| Player loses internet mid-score-submit                             | Mutation queued; retried on reconnect. See [mobile-ux.md](./mobile-ux.md#offline-behavior)                                                                   |
| Tournament canceled mid-bracket                                    | All `pending`/`in_progress` matches → `cancelled`; partial results retained for audit                                                                        |
| Weather / venue failure                                            | Organizer reschedules tournament dates; matches retain bracket positions; participants notified                                                              |
| Tie at retirement (both played the same sets, can't decide winner) | Reject the score with `SCORE_RULES_INVALID`; organizer must enter a clarified score                                                                          |
| Doubles partner withdraws after partnership confirmed              | Remaining partner has 24h to find new partner; otherwise moved to waitlist or withdrawn                                                                      |
| Doubles partner withdraws after bracket generated                  | Both partners withdrawn (the partnership is the entry); slot replaced or BYE per organizer modal                                                             |
| Two players claim same canonical seed                              | Seed conflict resolved by `seed_unique_per_tournament` exclusion constraint; organizer picks one                                                             |
| Last seed dropped because they fail rating gate                    | Organizer notified; manual override available ("grandfather this player")                                                                                    |
| Player's rating changes mid-tournament                             | Bracket positions are fixed at generation time; rating drift does not re-seed                                                                                |
| Bracket size mismatch (e.g., 17 registrants for max=16)            | Top-N kept by seed; rest go to waitlist; the 1 over-cap player is notified                                                                                   |
| Mid-tournament reschedule conflicts with player calendar           | Player can withdraw without late-cancellation penalty (`host_edited_at` exception)                                                                           |
| Public bracket viewed by guest, then privacy flipped               | Cached page may briefly show; realtime invalidation pushes guest to login wall                                                                               |
| Player blocks another player who is in the same bracket            | Both still play (block doesn't override participation); chats are blocked between them                                                                       |
| Account deletion mid-tournament                                    | Player auto-withdrawn; bracket replaced per organizer modal; PII anonymized to "Deleted player"                                                              |
| Organizer account deleted                                          | Co-organizer auto-promoted; if no co-org, admin (system 15) takes over and prompts to assign a new organizer                                                 |

## League edge cases

| Scenario                                                         | Resolution                                                                                                                                                                              |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Odd number of confirmed players (singles)                        | Highest ranked gets BYE (participation point per [ranking.md](./ranking.md#bye-treatment))                                                                                              |
| Cardinality not divisible by 4 (doubles)                         | Top players matching the residue get BYEs                                                                                                                                               |
| Player confirms then declines                                    | Sheet regen; waitlist promotes if capacity-bound. See [leagues.md](./leagues.md#capacity--waitlist)                                                                                     |
| Session has too few confirmed (< 4 for doubles, < 2 for singles) | Organizer modal: cancel session, allow singles instead, or BYE all                                                                                                                      |
| Session has too many confirmations                               | Waitlist FIFO; excess notified                                                                                                                                                          |
| Score entry disagreement                                         | Organizer validation decisive; both submissions retained for audit                                                                                                                      |
| Player quits mid-season                                          | Historical points kept; member status `inactive`; cannot rejoin same season                                                                                                             |
| Player no-shows                                                  | -5 points (default `pointNoShow`); match awarded to opponent; reputation event `match_no_show` (-50)                                                                                    |
| Season has 0 matches played                                      | Ranking exists but all rows have `points = 0`; rank is null                                                                                                                             |
| Disputed score with no organizer response                        | Admin (system 15) override available; surfaced after 5 days unresolved                                                                                                                  |
| Late score entry (> 48h after match)                             | Player path closed; organizer override available                                                                                                                                        |
| Session rescheduled within 24h notice                            | Sheet regenerated; confirmations reset to `pending`; members re-confirm                                                                                                                 |
| Match interrupted (weather)                                      | Organizer choice: cancel match (no points), reschedule to next session, or award by current score                                                                                       |
| Member suspended mid-match                                       | Match continues to terminal state; suspension takes effect for _next_ session                                                                                                           |
| Member's rating change crosses league `min_rating`               | Existing membership grandfathered; cannot confirm for **new sessions** if now outside band (sheet generation rejects)                                                                   |
| Two organizers edit session simultaneously                       | Optimistic locking → `OPTIMISTIC_LOCK_CONFLICT`; second client reloads and re-applies                                                                                                   |
| Match sheet modified after player entered score                  | Player's score retained but flagged for re-validation; player notified                                                                                                                  |
| Season closed while session in progress                          | `SEASON_HAS_OPEN_SESSIONS` blocks the close; organizer must finish or cancel the session                                                                                                |
| User in two leagues with overlapping sessions                    | Allowed; user manages their own calendar conflicts (no cross-league locking)                                                                                                            |
| Pickleball session with 5 confirmed (odd cardinality)            | Organizer chose `odd_cardinality_mode` at creation: `bye`, `three_player`, or `drill` (per co-founder brief)                                                                            |
| Guest player no-shows                                            | Same as member no-show: `match_no_show` reputation event for the guest; no impact on member rankings                                                                                    |
| Guest player wins a match                                        | Match recorded; opponent gets full points; **guest's stats are NOT added to season ranking**; audit row notes guest status                                                              |
| Match interrupted by weather (5 minutes from finish)             | Score saved with `INT` modifier; organizer chooses `award_by_score` / `reschedule` / `void` (per co-founder brief)                                                                      |
| 64-player or 128-player tournament                               | Bracket viewer falls back to chunked render (round-by-round); PDF export switches to multi-page layout                                                                                  |
| Organizer wants both Singles and Doubles in one tournament       | Not supported in v1: create two paired tournaments with a "Companion tournament" link (per [README divergence note](./README.md#deliberate-divergences-from-the-original-french-scope)) |
| Large session (50+ players) wants pool play (poules)             | Deferred to v2; in v1 the organizer creates multiple sessions on the same day or uses multi-round Swiss                                                                                 |
| Co-organizer leaving league                                      | Demoted to `member` first; if last organizer, leave is blocked (must transfer or close)                                                                                                 |
| League visibility changes from public to private                 | Public rankings cached on CDN purged; spectators lose access on next refresh                                                                                                            |

## Score entry edge cases

| Scenario                                            | Resolution                                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Player enters tennis score for pickleball match     | `SCORE_FORMAT_INVALID` (sport-aware validator rejects)                                    |
| Score has 4 sets in a best-of-3                     | `SCORE_RULES_INVALID`                                                                     |
| Tiebreak `7-6(8)` (loser scored 8)                  | Rendered as `9-7` and validated as standard 7-point TB extending; canonical form `7-6(8)` |
| Set ends `8-6` (no tiebreak) but format requires TB | `SCORE_RULES_INVALID`                                                                     |
| Player submits `RET` but no leading score is clear  | `SCORE_RULES_INVALID` with explanation                                                    |
| Both players submit conflicting valid scores        | Match → `disputed`; both submissions retained                                             |
| Both players submit identical scores                | Mutual confirm → both validated, no organizer action needed                               |
| Organizer overrides a previously validated score    | New row inserted; old one preserved; ranking re-computed                                  |

## Privacy

| Scenario                                                | Resolution                                                                             |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Private league member list                              | Hidden from non-members (RLS in [permissions.md](./permissions.md))                    |
| Ranked player in closed season                          | Snapshot preserved in `final_standings`; not editable                                  |
| User deletes account                                    | Anonymize to "Deleted player"; statistics retained for ranking integrity               |
| User wants to hide rank within visible league           | Not supported in v1; v2 may add member-level "hide rank" toggle                        |
| Tournament archived but player wants their data deleted | Anonymize that player's row; rank/standing recalculated to fill in "Deleted player"    |
| Guest views public bracket                              | Last names masked per [player-visibility](../06-player-directory/player-visibility.md) |
| Email export including a member who opted out           | Skip that member's email; CSV row shows "(email hidden)"                               |

## Concurrency & race conditions

| Scenario                                         | Resolution                                                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Two waitlist promotions fire simultaneously      | Trigger uses row-level lock on `tournament_waitlist`; second promotion fails and re-checks           |
| Two organizers cancel the same tournament        | Optimistic lock → `OPTIMISTIC_LOCK_CONFLICT`; second sees the cancel and confirms                    |
| Score submission lands during organizer override | RPC takes advisory lock per match; second mutation re-tries                                          |
| `recalc_season_ranking` invoked twice            | `pg_advisory_xact_lock` serializes; second call returns `RANKING_RECALC_CONFLICT` (caller retries)   |
| Bracket generation invoked twice                 | Idempotency guard — second call returns `SESSION_ALREADY_GENERATED` (or `BRACKET_ALREADY_GENERATED`) |

## Date/timezone

| Scenario                                            | Resolution                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Tournament spans DST transition                     | All scheduled times use `timestamptz` (UTC under the hood); displayed in user's local time |
| Session created in tz X, member views in tz Y       | Stored as UTC; rendered with user's `preferred_timezone` (system 03 setting)               |
| Confirmation deadline crosses midnight in user's tz | Reminder cron fires at 6h and 24h relative to UTC, so user receives at correct local time  |

## Anti-abuse

| Scenario                                               | Resolution                                                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Same person creating multiple alt accounts to register | RLS only sees `auth.uid()`; admins can detect via shared phone/email/device fingerprint              |
| Player colluding with opponent to inflate scores       | Reputation system penalizes patterns; admin review path                                              |
| Spam tournament creation                               | Rate limit 5 / user / 24h enforced in `tournament_create` RPC                                        |
| Public-bracket scrape via Realtime                     | Subscription rate-limit 50 / IP at Supabase edge                                                     |
| Bot mass-registers                                     | Rallia BotID-equivalent (Cloudflare Turnstile) on the registration form for guest→authenticated path |

## Notification edge cases

| Scenario                                                   | Resolution                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| User has push disabled, only email                         | Send email only (no push); falls through preferences map                         |
| Multiple ranking changes in a single recalc                | One `ranking_updated` per recipient (deduped on `season_id`)                     |
| User in quiet hours receives "match starting in 1h"        | Suppress push; SMS still fires if enabled (urgent reminder bypasses quiet hours) |
| Locale mismatch (user has `fr-CA` but key only in `en-US`) | Fall back to `en-US` with a logged warning to Sentry                             |

## Realtime edge cases

| Scenario                                                     | Resolution                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Subscription drops during bracket update                     | Client falls back to 30s polling; on reconnect, full refresh from cache       |
| 100 spectators on a public bracket                           | Server publishes once per row UPDATE; CDN-style fanout from Supabase Realtime |
| Subscriber on stale channel name (e.g., archived tournament) | Subscription accepted but produces no events; client cleans up after 60s idle |
