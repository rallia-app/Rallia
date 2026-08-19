# Result share

> How a participant turns a finished tournament into something they can post:
> a per-player result record derived from the bracket, a 9:16 poster rendered
> by the web OG service, a public and indexable tournament page to link to, and
> the surfaces that put the button in front of the player at the one moment
> they care.

This spec extends [tournaments.md](./tournaments.md) (lifecycle),
[ranking.md](./ranking.md) (Points Rallia), and
[notifications.md](./notifications.md) (`tournament_completed`). It reuses the
story-poster pipeline built 2026-08-16 for tournament invites, which is
described inline below rather than in its own spec.

## Problem

A tournament ends and the app says nothing outward. The champion gets a gold
banner inside the app ([`ChampionCard`](../../apps/mobile/src/features/tournaments/components/ChampionCard.tsx));
the other fifteen players get a "Tournoi terminé" push and no artifact. Nothing
leaves the app, so a weekend of real competitive play generates zero organic
reach, and the players most likely to recruit their circle (the ones who just
finished a draw) are handed nothing to recruit with.

Three concrete gaps:

1. **No per-player result exists as a readable record.** The champion is
   derived client-side in `BracketSection` from the final's
   `winner_registration_id`. Everyone else's result (exit round, win-loss,
   pool finish) is only implicit in `tournament_matches`.
2. **No result artifact.** The invite poster
   (`/api/og/invite?format=story`) sells a tournament that has not happened.
   Nothing renders one that has.
3. **Nowhere to link.** `/events` filters to
   `registration_open | registration_closed | in_progress`, so a completed
   tournament has no public page at all, and both `/invite/[code]` and
   `/match/[id]` are `robots: { index: false }`. A result shared into a group
   chat lands the recipient on an install wall or a 404.

## Scope

- Tournaments only. Leagues get a season-recap variant later, on the same
  record shape (see [Open decisions](#open-decisions)).
- Singles first. Doubles is implemented in the record (registrations carry
  `partner_user_id`) but the poster layout for two names is v2.
- Formats: `single_elimination` fully; `pool_knockout` fully, including
  pool-only exits; `double_elimination` degrades to champion / finalist /
  played, matching the ranking award function's existing limitation.
- Free and paid draws alike. Nothing here touches money.

## What already exists and is reused

| Piece                                                           | Reused as                                                                                       |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `apps/web/app/api/og/invite/route.tsx` `tournamentStoryImage()` | Visual language of the poster: glows, court lines, vignette, glass card, coral CTA              |
| `qrDataUri()` (the `qrcode` npm lib, not `qrcode.react`)        | QR on the result poster, same constraint: hooks dispatcher is null in a route handler           |
| `apps/web/lib/og-fonts.ts`                                      | Lazy font loading. Never move these to module scope, that was the SSR "fetch failed" cause      |
| `deriveTournamentCard()`                                        | Sport, dates, location, banner for the result poster's context line                             |
| `TournamentInviteSheet.handleShareStory`                        | Download-then-share mechanics: `File.downloadFileAsync` → `Sharing.shareAsync`, clipboard first |
| `tournament_ranking_points`                                     | Points figure on the poster, joined optionally                                                  |
| `tournament_completed` notification                             | The trigger moment. No new notification type, so the 13-place cost is avoided                   |

The mobile path adds no native dependency, so it stays OTA-safe. As with the
invite poster, **the web route must be on prod before the mobile build ships**,
since the app fetches `rallia.app`.

## The result record

**Built** in `20260816234500_lt_tournament_result_rpc.sql`. One core derivation
and two thin wrappers, because the card and the poster need the same row from
two different callers:

| Function                                    | Caller        | Grant           |
| ------------------------------------------- | ------------- | --------------- |
| `lt_registration_result(p_registration_id)` | internal      | `service_role`  |
| `tournament_my_result(p_tournament_id)`     | mobile card   | `authenticated` |
| `tournament_result_for_share(p_reg_id)`     | the OG poster | `service_role`  |

```
registration_id   uuid
tournament_id     uuid
user_id           uuid
display_name      text      -- the entry's primary player
partner_name      text      -- doubles, else NULL
avatar_url        text      -- profile.profile_picture_url
referral_code     text      -- the sharer's own code, for the poster CTA
stage             text      -- 'knockout' | 'pool' | 'none'
placement         text      -- champion | finalist | semifinal | quarterfinal
                            -- | round_of_16 | round_of_32 | round_of_64 | participated
pool_letter       text      -- pool_knockout pool exits, else NULL
pool_rank         int       -- 1-based finish inside the pool, else NULL
wins              int       -- contested wins; byes and walkovers excluded
losses            int       -- same rule
best_win_name     text      -- best-seeded opponent actually beaten, else NULL
best_win_seed     int       -- so the client can show it only when it is an upset
points            int       -- tournament_ranking_points.points, NULL when unranked
seed_rank         int
field_size        int       -- distinct non-bye entries, main side plus pools
forfeited         bool
```

Derivation rules:

- **Read the bracket, join the ledger.** The placement CASE mirrors
  `award_tournament_ranking_points` exactly, copied from its latest body
  (`20260811230000`), so the card and the circuit can never disagree. Points
  come from the ledger with a `LEFT JOIN` and are simply absent when there is
  no row, which is the common case: the award function deletes every row for a
  tournament whose organizer is not `is_certified_organizer`. A result card
  that read the ledger for placement would therefore be blank for most draws.
- **The ledger has no record, no scalp, no pool finish, no seed.** That is the
  other half of why this is a separate derivation rather than a ledger read.
- **Byes and walkovers never count.** A slot advanced by `player1_is_bye` /
  `player2_is_bye`, or a match whose status is `walkover`, produces neither a
  win nor a loss. Same floor the award function applies to placements.
- **Pool exits get a pool result, not `participated`.** For `pool_knockout`, a
  player who never reached the knockout side gets `stage = 'pool'` with
  `pool_letter` + `pool_rank`. This is the only closure most of the field ever
  receives, which is also why `lt_notify_knockout_published` bothers to send
  it, and the poster promotes it to the headline.
- **Forfeits are keyed on `forfeited_at`, never on status.** Three paths write
  `disqualified`, and only `forfeited_at` distinguishes a walkout from an
  organizer removal. The core returns the row with `forfeited = true` so the
  in-app card can still show it; `tournament_result_for_share` filters it out
  so no poster is ever rendered for a walkout.
- **Withdrawn registrations return no row** from any of the three.

Known gap: `pool_rank` comes from `tournament_pool_standings`, which runs its
own visibility check that `service_role` fails on a **private** draw. The call
is wrapped so the rank is absent rather than fatal, which means a private
tournament's poster falls back to the placement label. Fixing it properly means
splitting that function into an unchecked core and a checking wrapper.

## The poster

**Built**: `apps/web/app/api/og/result/route.tsx`. A sibling rather than
another `format` branch on the invite route: that file is already 1432 lines,
and a result poster is not an invite, it has different inputs, different
caching, and a different CTA.

```
GET /api/og/result?reg=<registration_id>&locale=fr-CA&share=<token>&code=<referral>
```

`code` is optional and only overrides the sharer's own `referral_code`, which
the record already carries.

1080×1920. Content, top to bottom: tournament name; placement lockup (trophy
for the champion, medal otherwise, in a tone that follows the placement);
player row with avatar and seed chip; the record as stat tiles (won / lost, and
Rallia points when the ledger has a row); the best-win line; a context line of
dates, city and draw size; then the shared footer action card.

### Visual language

Redesigned 2026-08-16 against the `result-share-redesign` handoff. The pieces
that carry it:

- **Placement tone.** One `Tone` per placement supplies the hero colour, badge
  ring, halo circle and ghost numeral, so a single lookup keeps the poster
  internally consistent. Champion gold, finalist silver, semi/quarter teal,
  everything else neutral.
- **Italic hero.** Poppins ExtraBold Italic 800, uppercase, 124px, dropping to
  96px past 12 characters. This is the only italic face the OG service loads;
  it is fetched lazily in `lib/og-fonts.ts` alongside the others and must never
  move to module scope.
- **The ghost numeral** bleeding off the right edge is how many players were
  still alive at that round (champion 1, finalist 2, semi 4, quarter 8), or the
  pool rank for a pool exit. Rounds deeper than the quarters get nothing: "16"
  at that scale says less than empty space does.
- **Halo circles** are absolutely positioned on a fixed centre (`BADGE_CX/CY`),
  not derived from the badge's flow position. Changing the heights above the
  badge moves the badge but not the halo, so the two drift apart. Re-render and
  check if you touch anything above the lockup.
- **Skew.** The seed pill and the stat tiles skew `-8`/`-10deg` with their
  contents counter-skewed back to upright. The champion's "won" tile is the one
  solid gold surface on the poster.
- **Confetti** is a fixed array, never randomised: the route has to render the
  same bytes every time or the immutable cache is a lie.

Two content rules that are not obvious from the layout:

- **The headline follows the truth, not the enum.** A pool exit's ledger
  placement is `participated`, which is a deflating word to hand someone as
  their headline. When `stage = 'pool'` the pool finish becomes the hero
  ("3e de la poule B") and the placement label is dropped entirely.
- **The best-win line only fires on an actual upset**: a scalp seeded above the
  sharer, or any seeded scalp when the sharer was unseeded. Otherwise the top
  seed's poster brags about beating the number two, which reads as padding.

The shared frame (backdrop glows, court lines, vignette, accent bar, the logo
eyebrow, the footer CTA card, `qrDataUri`) lives in
`apps/web/app/api/og/_shared/story-frame.tsx`. The result route consumes it
today; **the invite route still holds its own copy** and should be migrated
onto it, or the two posters drift apart within a release.

The QR currently targets the invite landing, since `/events/[id]` does not
exist yet. Retarget it there in rollout step 4.

### Authorization and privacy

The poster is keyed on `registration_id`, an unguessable uuid, and renders
strictly what the in-app bracket already shows to any participant: name,
placement, record. No rating, no email, no fee, no reputation. The route
refuses (404, not 403, to avoid confirming existence) when:

- the tournament is not `completed`,
- the registration is withdrawn or has `forfeited_at` set,
- the uuid does not resolve.

Service-role client, same as the invite route, since RLS would otherwise
require a session the OG renderer does not have.

### Caching

A completed tournament's result is immutable, so unlike the invite poster (1h,
which makes "spots left" lag) this one is
`Cache-Control: public, max-age=31536000, immutable`. The only edge is an
organizer score override after completion, which is rare and repairable by
bumping a `v` query param from the client.

## The public result page

New route `apps/web/app/[locale]/(marketing)/events/[id]/page.tsx`, serving
both live and completed tournaments.

This is the higher-value half of the feature. Story posts are a minority of
actual sharing; most of it happens in iMessage, WhatsApp, and Messenger group
chats, all of which render OG previews and none of which can do anything with
a PNG that has no link behind it. Today the only shareable tournament URL is
`/invite/{code}`, which is `noindex` and install-gated.

Contents: podium, final bracket (read-only, reusing the events directory's
visual language), participant list, and dates. A "S'inscrire" CTA when the
tournament is still open, routing to `/invite/{referralCode}?type=tournament&id=…`
so **referral attribution is unchanged**. Indexable. Its `opengraph-image.tsx`
renders the landscape variant of the result card when a `?reg=` param is
present, so a link shared by a specific player previews with that player's
result.

Two side effects worth naming: it closes the "public indexable tournament page"
fill lever from the 2026-08-16 audit, and it gives `/events` somewhere to send
completed events, which today it silently drops from its
`.in('status', [...])` filter.

## Mobile surfaces

**1. Result card on the Overview tab.** When `status === 'completed'` and the
viewer has a non-withdrawn registration, the top of `OverviewTab` shows their
result. Generalize `ChampionCard` into a placement-aware `ResultCard` (gold for
champion, silver for finalist, muted for the rest) rather than forking a second
card. Keep the `ChampionCard` export as the champion case so existing call
sites in `OverviewTab` and `BracketSection` do not churn. The share button
lives on this card.

**2. Dedicated sheet, `tournament-result-share`.** Registered in
`apps/mobile/src/context/sheets.tsx`. Not folded into `tournament-invite`:
that sheet is about recruiting into an open draw and carries link-reset and
co-organizer affordances that make no sense post-completion. Same precedent as
`tournament-edit`. Contents: poster preview, "Partager en story", "Partager le
lien", "Enregistrer l'image".

**3. The `tournament_completed` notification.** The highest-yield moment, and
it already fans out to every registered player including partners. Add
`resultShare: true` to its payload and deep-link into the tournament with the
result sheet primed. No new notification type, no enum value, no fan-out
change.

Mechanics are lifted from `handleShareStory` verbatim: cache-dir `File`,
`downloadFileAsync`, `Sharing.isAvailableAsync` guard, clipboard-then-toast
(the Instagram link sticker cannot be filled programmatically, so the toast has
to explain that the link is on the clipboard), then `shareAsync`.

New builder beside the existing one in
`packages/shared-services/src/invitation/invitationLinkService.ts`:

```ts
getTournamentResultImageUrl(registrationId, referralCode, locale?, shareToken?)
```

## Copy

Both `en-US.json` and `fr-CA.json`. The poster's own strings live in
`tournamentResultOg.*` (**shipped**); the mobile card and sheet will add
`tournamentDetail.result.*`. Copy rules that bite here:

- "parties" and "games", never "matchs" / "matches". The poster's record tiles
  read "Gagnées" / "Perdues" rather than a sentence, which keeps the noun out
  of the way at poster scale.
- No em dashes anywhere in the poster or the sheet.
- Sport-neutral emoji only (🙌 💪 🔥 ✨ 🎯), never 🎾.
- A loss is never named as one. The non-champion poster leads with the round
  reached and the record, framed as a run, not a defeat. "Quarts de finale,
  3-1" is postable; "Éliminé en quarts" is not.

## Analytics

| Event                         | Properties                                                      |
| ----------------------------- | --------------------------------------------------------------- |
| `lt.tournament.shared`        | Extend `medium` union with `'result_story'` and `'result_link'` |
| `lt.tournament.result_viewed` | `tournamentId`, `placement`, `source` (notification / overview) |
| `lt.tournament.result_page`   | Web: `tournamentId`, `hasReg`, referrer                         |

Funnel to watch: `tournament_completed` push → result sheet opened → shared →
invite landing → registration. The question this feature is being built to
answer is whether non-champions share at all; if `placement != 'champion'`
share rate is under a few percent, the surface is wrong (or the copy is naming
the loss) and the poster investment should stop at the champion.

## Rollout

1. `tournament_my_result` RPC ✅ + hook, `ResultCard` on the Overview tab.
   Ships value with no web dependency: every past participant gets closure
   in-app. The RPC is applied locally only; staging and prod still need it.
2. `/api/og/result` route ✅ + `_shared/story-frame.tsx` ✅ (invite route not
   yet migrated onto it), deployed to prod web. Must land before step 3.
3. `tournament-result-share` sheet + `getTournamentResultImageUrl` +
   notification payload deep-link. OTA-safe.
4. `/events/[id]` public page + its `opengraph-image.tsx`, and widening the
   `/events` status filter to include `completed`.

Steps 1 and 4 each stand alone. Step 3 must not ship before step 2 is live on
prod, since the app fetches `rallia.app` at share time and a 404 there is a
silent failure in the user's hands.

## Open decisions

1. **Points appear on almost no poster.** The certified-organizer gate is
   already live: `award_tournament_ranking_points` deletes the whole ledger for
   any tournament whose organizer is not `is_certified_organizer`, so today
   only Rallia-run draws produce points. The poster shows the tile only when a
   row exists, which is correct but means the circuit is nearly invisible on
   the artifact meant to advertise it. Recommended: leave the behaviour alone
   and treat it as an argument for certifying organizers, not for loosening the
   gate.
2. ~~Whether `pool_knockout` result cards ship before the format reaches
   prod.~~ **Settled:** built, since it is the same query either way. It lies
   dormant until the format ships. The `[TEST-PK]` fixture is what the RPC and
   the poster were verified against.
3. **Doubles poster layout.** Two names, two avatars, and a partner who may
   not want to be posted. Recommended: v2, and when it lands, the poster names
   the pair but only the sharer's referral code is baked in.
4. ~~Forfeited registrations.~~ **Settled:** `tournament_result_for_share`
   filters them out, so no poster exists for a walkout, while the in-app card
   still gets its row flagged `forfeited = true`.
5. **League season recap on the same record shape.** `seasons.final_standings`
   already stores the end state, so a `season_my_result` twin is cheap.
   Recommended: after tournaments prove the share rate.

## Amendments to existing specs

- [tournaments.md](./tournaments.md): completion is no longer terminal for the
  participant-facing surface. A completed tournament keeps a live screen (the
  result card) and gains a public web page.
- [notifications.md](./notifications.md): `tournament_completed` payload gains
  `resultShare`, and its deep-link target changes from the tournament overview
  to the tournament overview with the result sheet primed. No new type.
- [analytics.md](./analytics.md): `lt.tournament.shared` `medium` union widens
  by two values.
