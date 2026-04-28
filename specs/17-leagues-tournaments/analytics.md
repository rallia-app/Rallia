# Analytics

> PostHog event taxonomy, user/group properties, and key funnels for leagues and tournaments.

All events are emitted via the existing PostHog client wired in `apps/mobile/src/services/analytics.ts` and `apps/web/lib/posthog.ts`. The PostHog project is **Rallia App** (id 329229).

## Naming conventions

- Events: `lt.<entity>.<verb>` (e.g., `lt.tournament.created`).
- Properties: camelCase.
- All events include common properties: `sport`, `entityKind`, `entityId`, `userRole`.

## Tournament events

| Event                                 | Trigger                                         | Properties                                                    |
| ------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------- |
| `lt.tournament.created`               | Tournament created (DRAFT)                      | `maxParticipants`, `bracketType`, `entryFormat`, `visibility` |
| `lt.tournament.registration_opened`   | Status → `registration_open`                    | `currentRegistrations`                                        |
| `lt.tournament.registered`            | Player registers                                | `seedPreference`, `partnerProvided`, `gateUsed`               |
| `lt.tournament.waitlisted`            | Registration → waitlist                         | `waitlistPosition`                                            |
| `lt.tournament.withdrew`              | Registration withdrawn                          | `bracketGenerated`, `daysBeforeStart`                         |
| `lt.tournament.bracket_generated`     | `tournament_generate_bracket` succeeded         | `bracketSize`, `byes`, `seededCount`                          |
| `lt.tournament.bracket_edited`        | Manual swap / move / insert / remove            | `editKind`, `bracketLocked`                                   |
| `lt.tournament.match_score_submitted` | Player submits score                            | `roundName`, `wasMutualConfirm`                               |
| `lt.tournament.match_score_validated` | Organizer validates                             | `roundName`, `wasOverride`                                    |
| `lt.tournament.match_disputed`        | Player disputes                                 | `roundName`                                                   |
| `lt.tournament.match_advanced`        | Auto-advance trigger                            | `roundName`                                                   |
| `lt.tournament.cancelled`             | Cancellation                                    | `fromStatus`, `participantCount`                              |
| `lt.tournament.completed`             | Status → `completed`                            | `participantCount`, `roundsPlayed`, `durationDays`            |
| `lt.tournament.archived`              | Status → `archived`                             | `participantCount`                                            |
| `lt.tournament.viewed`                | Detail page viewed                              | `tab` (bracket/participants/info), `userRole`                 |
| `lt.tournament.shared`                | Share intent (deep link copied or social-share) | `medium` (link/native/sms/email)                              |

## League events

| Event                              | Trigger                                | Properties                                        |
| ---------------------------------- | -------------------------------------- | ------------------------------------------------- |
| `lt.league.created`                | League created                         | `joinMode`, `visibility`, `defaultPointWin`       |
| `lt.league.member_joined`          | Member status → `active`               | `viaInvite`, `gateUsed`                           |
| `lt.league.member_pending`         | Member status → `pending`              | —                                                 |
| `lt.league.member_left`            | Member status → `inactive` (self)      | `seasonsAttended`                                 |
| `lt.league.member_kicked`          | Member status → `inactive` (organizer) | `reason`                                          |
| `lt.season.created`                | Season created                         | `hasOverride`                                     |
| `lt.season.opened`                 | Season → `open`                        | `memberCount`                                     |
| `lt.season.closed`                 | Season → `closed`                      | `sessionsCompleted`, `topRankUserId`              |
| `lt.session.created`               | Session created                        | `pairingMode`, `rounds`, `formats`                |
| `lt.session.published`             | Session → `published`                  | `memberCount`                                     |
| `lt.session.confirmed`             | Member confirms                        | `partnerProvided`, `daysBeforeSession`            |
| `lt.session.declined`              | Member declines                        | `daysBeforeSession`                               |
| `lt.session.sheet_generated`       | Match sheet generated                  | `algorithm`, `confirmedCount`, `byeCount`         |
| `lt.session.sheet_regenerated`     | Sheet regenerated                      | `lockedCount`                                     |
| `lt.session.match_score_submitted` | Score submitted                        | `wasMutualConfirm`                                |
| `lt.session.match_score_validated` | Score validated                        | `wasOverride`                                     |
| `lt.session.completed`             | Session → `completed`                  | `matchCount`, `disputedCount`                     |
| `lt.session.cancelled`             | Session → `cancelled`                  | `confirmedCount`, `daysBeforeSession`             |
| `lt.season.ranking_recalculated`   | After RPC                              | `playersRanked`, `topPoints`                      |
| `lt.league.viewed`                 | Detail page viewed                     | `tab` (ranking/sessions/members/info), `userRole` |

## Funnels

### Tournament conversion funnel

1. `lt.tournament.viewed` (detail page seen)
2. `lt.tournament.registered` or `lt.tournament.waitlisted`
3. First match's `lt.tournament.match_score_submitted`
4. `lt.tournament.completed` (reached final or eliminated)

### League activation funnel

1. `lt.league.viewed`
2. `lt.league.member_joined`
3. First `lt.session.confirmed`
4. First `lt.session.match_score_submitted`
5. Second `lt.session.confirmed` (retention)

### Organizer effectiveness

1. `lt.tournament.created`
2. `lt.tournament.registration_opened`
3. `lt.tournament.bracket_generated`
4. `lt.tournament.completed`

Drop-off at each step is the primary signal for organizer-friction work.

## Competitiveness & fairness metrics

Per co-founder brief ("Compétitivité : écart moyen de niveaux par match, % matchs serrés"; "Équité : distribution des adversaires (répétitions)"). These are computed offline by the `lt-analytics-rollup` daily edge function and surfaced in PostHog and the league dashboard.

### Competitiveness

| Metric                      | Formula                                                                          |
| --------------------------- | -------------------------------------------------------------------------------- |
| **Avg level gap per match** | mean of `abs(team_a_avg_rating - team_b_avg_rating)` across all matches in scope |
| **% close matches**         | matches where final-set / final-game margin ≤ 2 / total matches                  |
| **% blowouts**              | matches where margin ≥ 6 games (tennis) or ≥ 8 points (pickleball)               |
| **Tie-break rate**          | matches with at least one tie-break / total tennis matches                       |
| **Mean match duration**     | derived from `played_at - scheduled_at` if both present                          |

Emitted as PostHog events `lt.metrics.competitiveness` daily per league with these properties.

### Fairness

| Metric                  | Formula                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------- |
| **Opponent diversity**  | for each member: distinct opponents / total opponents-faced (Shannon entropy variant) |
| **Repeat-pair rate**    | pairs faced ≥ 2× in window / unique pairs                                             |
| **Court-time fairness** | stddev of total minutes-played across active members                                  |
| **Format split**        | per-member breakdown of singles / doubles / mixed minutes                             |

Emitted as `lt.metrics.fairness`. The league dashboard surfaces these as a "Health" tab so organizers can spot pairing dysfunction (e.g., one cluster always plays itself).

## User & group properties

PostHog person properties updated on any L&T event:

- `lt_total_tournaments_played`
- `lt_total_leagues_active`
- `lt_total_matches_played`
- `lt_last_tournament_at`
- `lt_last_session_at`

PostHog group properties (`group_type = 'league'` or `'tournament'`):

- `name`, `sport`, `visibility`, `participant_count`, `created_at`.

This enables PostHog group analytics — e.g., funnel conversion segmented by league.

## Dashboards

Dashboards created in PostHog for the product team:

| Dashboard               | Panels                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| **L&T overview**        | Active tournaments, active leagues, registrations / day, match-completion / day            |
| **Tournament funnel**   | Conversion from view → register → match-played → complete; segmented by sport              |
| **League funnel**       | Activation funnel; segmented by sport and visibility                                       |
| **Organizer health**    | Tournaments created vs. completed; sessions published vs. cancelled; org-to-org comparison |
| **Score-entry quality** | Mutual-confirm rate; override rate; dispute rate; time from match end to validated score   |
| **Sport split**         | Tennis vs pickleball event distribution                                                    |

Each dashboard uses PostHog's native filters; no custom HogQL required for v1.

## Cohorts

| Cohort            | Definition                                                                     | Use                              |
| ----------------- | ------------------------------------------------------------------------------ | -------------------------------- |
| L&T users         | Anyone with `lt_total_tournaments_played > 0` OR `lt_total_leagues_active > 0` | Retention/engagement comparisons |
| Active organizers | Created or organized ≥ 1 tournament/league in last 90 days                     | Product-led-growth campaigns     |
| Lapsed organizers | Organizer of ≥ 1 entity, no `lt.session.published` in 60 days                  | Re-engagement                    |
| Top performers    | Top-3 in any closed season                                                     | Featured-player nominations      |

## Surveys

PostHog surveys triggered:

- After 3rd `lt.tournament.completed`: NPS survey for tournament feature.
- After 1st `lt.season.closed`: organizer satisfaction survey.
- On `lt.tournament.cancelled` from `in_progress`: short why-did-you-cancel survey.

## Event volume budget

L&T events are user-driven and bursty. Expected volumes (per 1k MAU):

| Event family                               | Events / day |
| ------------------------------------------ | ------------ |
| Views (detail / bracket / ranking)         | ~1500        |
| Mutations (register, confirm, score, etc.) | ~200         |
| Realtime-driven (match_advanced, etc.)     | ~100         |

Total ~1.8k events / day / 1k MAU. Below the PostHog free tier ceiling.

## Privacy

- No PII in event properties beyond `user_id` (already carried by PostHog).
- Free-text fields (e.g., tournament name) are _not_ sent — only IDs and structured numeric/categorical properties.
- `userRole` is derived at emit time so analyses can segment by role without joining backend data.
