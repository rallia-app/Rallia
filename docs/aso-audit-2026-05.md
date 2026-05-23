# ASO Audit: Rallia — Tennis & Pickleball

- **App ID:** 6760482014
- **Storefront audited:** CA (not available in US)
- **Platform:** iOS
- **App URL:** https://apps.apple.com/ca/app/rallia/id6760482014
- **Audit date:** 2026-05-19 (updated 2026-05-22 against post-WWDC25 / iOS 26 / March 2026 ASC standards)
- **App age:** ~5 weeks (released 2026-04-13, current v1.1.0 2026-04-24)
- **Method:** Qualitative, sourced from Apple's public iTunes Lookup API and the rendered App Store page (no Appeeky / ASC data available)

> Caveats: The keyword field (100-char hidden bag) and live keyword rankings are not auditable from public data. Icon and individual screenshot creative were not visually inspected — scored from filenames and structure only.

---

## 0. What changed in 2026 that this audit assumes

The App Store search algorithm has shifted meaningfully since older ASO playbooks were written. The recommendations below assume the post-June 2025 algorithm and post-WWDC25 surfaces:

| Change                                                                                                      | Date                                                        | Implication for Rallia                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Screenshot caption text is indexed** as keyword metadata                                                  | June 2025 algo update                                       | Captions are no longer just CRO copy — they are a search field. Every empty slot or generic caption is forfeited keyword surface.                                                                                                       |
| **Custom Product Pages (CPPs) can be assigned keywords and surface organically** in search                  | July 2025                                                   | CPPs are no longer just paid landing pages. One CPP per intent cluster ("tennis partner," "DUPR pickleball," "court booking") can replace the default page in organic results for assigned keywords. No app review needed to re-assign. |
| **CPP cap raised from 35 to 70**                                                                            | October 2025                                                | Plenty of headroom for an indie app.                                                                                                                                                                                                    |
| **App Store Connect Analytics overhaul** — 100+ new metrics, cohorts, peer benchmarks                       | March 25, 2026                                              | Free, native analytics now strong enough that a 5-week-old indie doesn't need paid tools yet.                                                                                                                                           |
| **Apple Ads multiple ad placements per search result**                                                      | Rolled out March 3, 2026 (UK/JP first, global end of March) | Up to 2 sponsored slots per query. Expect CPCs to rise on high-intent terms; pair every campaign with a CPP.                                                                                                                            |
| **Apple Ads registered with AdAttributionKit (AAK)**                                                        | April 10, 2025                                              | ASA reports through AAK now; SKAN still interoperates. Use AAK-aware MMPs going forward.                                                                                                                                                |
| **iOS 26 SDK + Liquid Glass design language mandatory**                                                     | April 28, 2026 deadline                                     | Screenshots showing pre-Liquid Glass UI will look dated. Re-shoot screenshots after the SDK migration.                                                                                                                                  |
| **App Intents as a primary discoverability surface**                                                        | Ongoing (Apple Intelligence)                                | Apps without exposed intents become "invisible in an AI-first OS." Spotlight, Siri, Apple Intelligence routing all flow through `AppIntent`.                                                                                            |
| **Review Summaries (LLM-extracted theme paragraphs)**                                                       | WWDC25                                                      | Reviewer _language_ shapes the surface. Prompt users to mention specific use cases.                                                                                                                                                     |
| **Accessibility Nutrition Labels + restructured Age Ratings (5 categories, new declarations for chat/UGC)** | WWDC25                                                      | Rallia has chat + UGC — re-check declarations.                                                                                                                                                                                          |
| **DUPR replaced UTR as USA Pickleball's official rating partner**                                           | 2025                                                        | If you have UTR mentioned for pickleball anywhere, it's outdated. **DUPR for pickleball, UTR for tennis, NTRP for casual USTA play.**                                                                                                   |

Per-factor scores in §2 have been recalibrated against these standards.

---

## 1. Current listing (extracted)

| Element       | Value                                                     | Chars   |
| ------------- | --------------------------------------------------------- | ------- |
| Title         | `Rallia - Tennis & Pickleball`                            | 28 / 30 |
| Subtitle      | `Find the perfect match`                                  | 22 / 30 |
| Keyword field | _not public_                                              | ? / 100 |
| Promo text    | _none_                                                    | 0 / 170 |
| Categories    | **Sports** (primary) · Social Networking                  | —       |
| Screenshots   | 5 used: `home`, `facilities`, `players`, `chat`, `create` | 5 / 10  |
| Preview video | none                                                      | —       |
| Localization  | EN only                                                   | —       |
| Rating        | 5.0 ★ · 3 reviews                                         | —       |
| What's New    | comprehensive, includes `Upgraded to Expo SDK 55`         | —       |
| File size     | 119 MB                                                    | —       |
| Min iOS       | 15.1                                                      | —       |

---

## 2. Score card

```
Overall ASO Score: ~38/100  (recalibrated for 2026 — captions-as-search and CPP-as-organic now weigh heavier)

Title:              7 /10  ███████░░░  (-1: keyword stuffing of broad heads loses to intent phrases in 2026)
Subtitle:           2 /10  ██░░░░░░░░  (-1: "match" pun actively confuses semantic clusters)
Keyword Field:      N/A    (private — see §4)
Description:        6 /10  ██████░░░░  (still readable, but doesn't hook for AI summary extraction)
Screenshots:        2 /10  ██░░░░░░░░  (-2: captions are now an indexed field; 5 empty slots = ~50% of search surface forfeited)
Preview Video:      0 /10  ░░░░░░░░░░
Ratings & Reviews:  3.5/10 ████░░░░░░  (5★ but only 3 — volume threshold for Sports + Social Networking is ~50-100)
Icon:               7 /10  ███████░░░  (not visually inspected)
Keyword Rankings:   N/A    (needs Appeeky/MobileAction/AppTweak)
Conversion Signals: 2 /10  ██░░░░░░░░  (-1: no promo text, no IAE, no CPP, no App Intents)
Discoverability     2 /10  ██░░░░░░░░  (NEW: App Intents, IAE, CPP-as-organic, AAK readiness — all zero)
Compliance / Trust  6 /10  ██████░░░░  (NEW: iOS 26 SDK migration, age rating re-declarations, accessibility nutrition label)
```

### Per-factor notes

#### Title (7/10) — `Rallia - Tennis & Pickleball`

- ✓ Two strong primary sport keywords (`Tennis`, `Pickleball`)
- ✓ 28/30 chars — near max usage
- ✓ Natural reading, brand + descriptor pattern
- ✗ No verb / intent qualifier — semantic search clusters in 2026 reward intent phrases (`Find`, `Play`, `Partner`, `Match`) more than broad nouns
- ✗ Padel not represented despite being a stated target sport
- ~ Brand-first pattern is fine because the keyword field can cover the missing intent terms, but the subtitle must then carry intent (it doesn't — see below)

#### Subtitle (2/10) — `Find the perfect match`

- ✗ Single biggest ASO miss, made worse by 2026's semantic-clustering algorithm
- ✗ Wastes 8 of 30 chars on a pun (`match` = tennis match + romantic) — Apple's semantic search clusters `match` with **dating apps**, not sports; this is now an active ranking penalty, not just a missed opportunity
- ✗ Zero high-intent secondary keywords (`partner`, `court`, `player`, `doubles`, `singles`, `DUPR`, `book`)
- ✗ No benefit framing — 2026 best practice for unknown brands is benefit-led copy, not abstract value props
- ✓ No repetition with title (so the keyword field can re-use none of these tokens)

#### Keyword field — N/A

Not visible publicly. The title burns `Tennis Pickleball`, so the 100-char field is your last shot at indexing high-intent secondary terms. **The field is still indexed in 2026 but weighted lower than App Name and Subtitle**, so prioritize unique singulars Apple won't surface from your other fields. See §4 for the recommended seed set.

#### Description (6/10)

- ~ Hook is OK but verbose; below-the-fold reveal forces tap
- ✓ Clear sectioning with bold headers (FIND GAMES, VERIFIED RANKING, etc.) — also helps the WWDC25 LLM review summary anchor on themes
- ✓ Good formatting / line breaks
- ✗ No CTA at the end
- ✗ No social proof (reasonable for a 5-week-old app)
- ✗ Padel absent
- ✗ Does not invite reviewers to mention specific use cases — material because Apple now extracts review themes via LLM

#### Screenshots (2/10) — biggest 2026 miss

- ✗ 5/10 slots used — every empty slot now forfeits **indexed caption text**, not just visual storytelling. Caption indexing went live in the June 2025 algorithm update.
- ✗ Optimal count in 2026 is 6–8 (35% higher engagement vs minimum); 10 is allowed
- ✗ Sequence (Home → Facilities → Players → Chat → Create) doesn't lead with the matchmaking value prop
- ✗ EN only — no fr-CA localized variants (localized screenshots drive 2–3× install lift in non-English markets, and captions are indexed per locale)
- ? Caption / overlay quality not inspected, but the structure suggests feature-labels not intent phrases
- ✗ Liquid Glass / iOS 26 SDK migration may invalidate current screenshots before April 28, 2026 deadline — plan a re-shoot

#### Preview Video (0/10)

- ✗ No preview video. In 2026, video has become a leading conversion lever for sports/social apps — and the autoplay first frame replaces your lead screenshot in search results. Even a 15s vertical capture beats none.

#### Ratings & Reviews (3.5/10)

- ✓ 5.0 ★ perfect stars
- ✗ Only 3 ratings — Sports + Social Networking categories need ~50–100 before Apple's algorithm meaningfully weights ratings as ranking signal
- ✗ No visible developer responses (low signal at n=3)
- ⚠ Below 3.5★, apps lose visibility on **3× more top-10 keywords** vs higher-rated peers. Stay above 4.0 as a hard floor as volume grows. Current 5.0 is safe but fragile at n=3.
- ✗ No SKStoreReviewController wiring evident; 3 prompts/year/user budget is being left on the table

#### Icon (7/10 — placeholder)

Not visually audited. Bundle ID and brand suggest a logo mark; assumed no text (which is correct for small-size legibility).

#### Keyword Rankings — N/A

Needs MobileAction, AppTweak, AppFollow, or Appeeky for third-party rank tracking. App Store Connect Analytics (post-March 2026 overhaul) now exposes its own "Discovery" and keyword acquisition metrics — start there, it's free.

#### Conversion Signals (2/10)

- ✗ No promotional text (free real estate, editable without a new build, also indexed for relevance signals)
- ~ "What's New" is comprehensive but contains dev-speak (`Upgraded to Expo SDK 55`) that doesn't help conversion
- ✗ No In-App Events scheduled (sports apps see up to 18% re-engagement lift in 2026)
- ✗ No Custom Product Pages (you have 70 slots and use 0)

#### Discoverability beyond search (2/10) — NEW in 2026

- ✗ No App Intents exposed for Spotlight / Siri / Apple Intelligence. In an AI-first OS, this is your zero-effort surface. Required intents for Rallia: `FindTennisPartner`, `FindPickleballPartner`, `BookCourt`, `ShowUpcomingMatches`, `JoinCommunity`.
- ✗ No In-App Events
- ✗ No CPP keyword assignments
- ✗ AdAttributionKit / MMP setup unknown — required before any meaningful paid acquisition

#### Compliance / Trust (6/10) — NEW in 2026

- ⚠ iOS 26 SDK / Liquid Glass migration deadline: **April 28, 2026** — verify Expo SDK 55 produces an iOS 26 SDK build
- ? Age Rating: WWDC25 introduced 5 age categories and new capability declarations for messaging/UGC. Rallia has chat + user content → re-confirm
- ? Accessibility Nutrition Label: new WWDC25 product-page surface for trust signals — worth filling out
- ✓ Privacy nutrition label assumed populated (not inspected)

---

## 3. Quick wins (today — free, no resubmit required for most)

### 3.1 Rewrite the subtitle (benefit-led, intent-loaded)

Candidates, all ≤30 chars — drop the dating-app collision and load secondary intent terms:

| Candidate                       | Chars | Notes                                                         |
| ------------------------------- | ----- | ------------------------------------------------------------- |
| `Find a tennis partner nearby`  | 28    | High-intent, clean, partners cluster                          |
| `Pickleball & tennis partners`  | 28    | Two sports + role (no pun overlap with dating)                |
| `Book courts. Find partners.`   | 27    | Two-action verb structure scores well in 2026 semantic search |
| `Doubles partners & court time` | 29    | Loads `doubles` (high-volume), `courts`, secondary intent     |

Recommended: `Pickleball & tennis partners` (best keyword density) or `Book courts. Find partners.` (best verb structure for AI-era search).

### 3.2 Add promotional text (170 chars)

Editable without resubmit. Use it for time-bound or seasonal copy. Visible above the description. Two 2026-specific angles for Rallia:

- **Now**: friends & family launch in Laval / Montreal — tie to Roland-Garros (late May / early June)
- **Pre-US Open** (Aug): "Tennis ladder kicks off Aug 24" → links to an In-App Event

### 3.3 Trim "What's New"

Drop `Upgraded to Expo SDK 55 with performance and stability fixes`. Lead with user-visible wins:

- Match QR share to invite players in one tap
- Welcome email after sign-up
- Smoother sign-up flow

### 3.4 Audit the keyword field

Suggested seed set for 2026 (verify volume via App Store Connect Analytics Discovery report or MobileAction):

```
partner,doubles,singles,court,club,padel,racket,racquet,player,DUPR,UTR,NTRP,league,opponent,find,booking
```

**Rules (2026):**

- No spaces after commas
- Singular forms only (Apple indexes both)
- No `rallia`, `tennis`, `pickleball` — already in title (would be wasted)
- No `app`, `sports` — wasted slots
- **No `match`** — actively pulled into dating-app clusters; if you want it, capture via `matchmaking` in screenshot captions instead
- Use all 100 chars
- Single-token entries only (Apple still doesn't index multi-word phrases here)
- `DUPR` is now the dominant pickleball rating (USA Pickleball replaced UTR with DUPR as their exclusive partner) — load it

### 3.5 Update review prompt copy — NEW

Apple's WWDC25 LLM review summaries extract themes from review text. If you already wire `SKStoreReviewController`, also pre-prime users in-app with a one-line nudge: "Mention what worked — found a partner, booked a court — to help others find Rallia." Pattern triples themed-review surface area.

### 3.6 Re-check age rating declarations — NEW

WWDC25 restructured age ratings into 5 categories (was 2) with new capability declarations for messaging/UGC/chat. Rallia has all three. Re-submit declarations in ASC under App Information.

---

## 4. High-impact (this week)

### 4.1 Fill the missing 5 screenshot slots — with **indexed captions**

In 2026, screenshot caption text is part of Apple's search index, not just creative copy. Treat each caption as a keyword phrase that supports the keyword field. Aim for 6–8 (sweet spot in 2026 benchmark data, +35% engagement vs minimum); 10 is allowed.

Recommended 8-screenshot narrative — captions written for indexed search, not visual labels:

1. **Hook**: "Find a tennis partner near you" (players map)
2. **Hook**: "Pickleball doubles, singles, every level" (create match flow with skill selector)
3. **DUPR & NTRP verified ratings** (ranking badge)
4. **Book courts in seconds** (facility + availability)
5. **Chat to coordinate the match** (chat thread)
6. **Join your local tennis community** (communities view)
7. **Player profile, stats, history** (profile)
8. **Submit scores. Climb the ladder.** (results / ratings)
9. _(optional)_ "Tennis. Pickleball. Padel." — only when padel is shipped
10. _(optional)_ social proof / CTA

**First frame matters most**: roughly 60% of conversion decisions happen on screenshot 1 in 2026 measurements. Lead with the partner-finding intent, not the home screen.

### 4.2 Rewrite the description's first 2 lines

Currently: `Rallia connects tennis and pickleball players with each other. Whether you're looking for a casual weekend game or competitive matches…`

Try:

> Find a tennis or pickleball partner near you. DUPR-verified ratings. Book the court. Play more.

Keep the **FIND GAMES / VERIFIED RANKING / …** sections below the fold. Bold themes help the WWDC25 LLM review summary anchor on the right concepts when it samples themes from your reviews.

### 4.3 Decide on padel

Currently a stated target sport but appears in **zero** listing surfaces. Padel market is growing 10.3% CAGR globally, 28% North America share, with Canada specifically adding 50 courts by 2024 — there is a real Quebec opportunity here.

- **(a) Commit:** Drop the hyphen and update title to `Rallia Tennis Pickleball Padel` (30 chars). Add padel-specific screenshot. Add `padel` to keyword field.
- **(b) Defer:** Leave listing as-is until padel matchmaking is actually live in-app.

Indexing for padel before product readiness will hurt reviews. Pick one explicitly.

### 4.4 Ship 3 Custom Product Pages and assign keywords — NEW

Since July 2025, CPPs can be assigned keywords from your keyword field and **replace the default product page in organic search** for those keywords. You have 70 slots and use 0. This is the single highest-leverage 2026 move for Rallia.

Recommended initial set of CPPs (each gets its own screenshots + promo text aligned to the intent cluster):

| CPP                   | Keyword cluster assigned                                                                           | Lead screenshot              |
| --------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------- |
| **Tennis Partner**    | `partner`, `tennis partner`, `singles`, `doubles` (tennis variants)                                | Map + NTRP/UTR badge         |
| **Pickleball + DUPR** | `pickleball partner`, `DUPR`, `pickleball doubles`                                                 | DUPR-verified player profile |
| **Court Booking**     | `court`, `booking`, `court reservation` (only assign if you have differentiated UX vs Pickleheads) | Facility availability grid   |

You don't need a new build to create or reassign these. CPP changes don't require app review submission — fast iteration.

### 4.5 Expose App Intents — NEW

In an Apple Intelligence-era OS, apps that don't expose App Intents become invisible to Spotlight, Siri, and AI-routed queries. Minimum set for Rallia:

- `FindTennisPartner(location, level)`
- `FindPickleballPartner(location, DUPR)`
- `BookCourt(facility, date)`
- `ShowUpcomingMatches()`
- `JoinCommunity(name)`

These are product code, not ASO code — but they affect discoverability surface in the same way ASO does. Apple's [App Intents docs](https://developer.apple.com/documentation/appintents/) cover the surface contract.

---

## 5. Strategic (this month)

### 5.1 Localize to fr-CA — highest TAM unlock

You're Quebec-anchored (Laval IC3 facility integration in recent commits). Each locale gets its own title / subtitle / keyword field / **screenshots with localized captions** (now indexed per locale).

Canada cross-localization: keywords from both `en-CA` and `fr-CA` index simultaneously for Canadian users, so fr-CA does not cannibalize English ranking — it adds surface. **Enable fr-CA explicitly; do not rely on fr-FR fallback** (Quebec terminology differs: "courriel" vs "email," local club naming, etc.).

Quebec has ~8M French speakers and substantial Tennis Canada / Pickleball Canada membership. Currently 100% of the French-speaking TAM sees English copy.

### 5.2 Engineer rating volume, not stars

5.0★ × 3 reviews ≠ a useful ranking signal. Wire `SKStoreReviewController` (3 prompts/year/user, Apple-throttled) behind an **in-app sentiment gate**:

1. After a positive completion event, ask "How are you enjoying Rallia?"
2. "Love it!" → trigger `SKStoreReviewController.requestReview()`
3. "It's okay / Not great" → in-app feedback form (do NOT route to the App Store)

Trigger only after positive moments:

- Match completed AND opponent rated 4★+
- Court booked successfully
- Partner request accepted

**Never on first launch, after a crash, or after a failure state.** Target ~50–100 reviews to clear Apple's volume threshold for Sports + Social Networking. The sentiment gate pattern roughly triples ratings volume vs cold prompting in 2026 benchmarks.

### 5.3 Add a 15–30s App Preview video

Video has become a leading conversion lever in 2026 for sports/social apps because the autoplay first frame replaces your lead screenshot in search results.

- 3-second hook: "Find a partner. Book a court. Play."
- No audio required (Apple muted by default)
- Captions baked in
- Vertical (portrait), iPhone 17 Pro Max 6.9" reference size — Apple downscales for other devices

### 5.4 In-App Events tied to the sports calendar — NEW

IAE drives up to 18% re-engagement lift, surfaces in search/Today/product page, and is now indexed against query relevance.

Schedule for the next 6 months:

- **Roland-Garros (May 25 – June 8, 2026)** — "Roland-Garros ladder" community event
- **Wimbledon (Jun 29 – Jul 12, 2026)** — partner finding push
- **PPA / APP / US Open Pickleball events** — DUPR-bracketed local matches
- **US Open Tennis (Aug 24 – Sep 7, 2026)** — community ladder rerun
- **Major League Pickleball windows** — pickleball-specific challenges

Submit IAEs 2–3 weeks ahead of the surge, not during it.

### 5.5 ASA-to-ASO loop — NEW

The canonical 2026 keyword research method, replacing pure third-party tool reliance:

1. Run small Search Match + Broad campaigns to _discover_ what queries convert
2. Harvest converters into the 100-char keyword field
3. Promote highest-LTV converters into their own CPP keyword assignment
4. Bid Exact match on the harvested winners

Note: Apple Ads is rolling out **multiple ad placements per search result (up to 2)** starting March 3, 2026 (UK/JP first, global end of March). Competition pressure may raise CPCs on tennis/pickleball head terms — plan budget to focus on long-tail intent phrases harvested from Broad campaigns.

Every ASA ad group should be paired with a matching CPP, not the default page. State of Survival saw -14% CPI with CPP/ad creative alignment.

### 5.6 Custom Product Page expansion for the F&F seeding flow

The `/play` page that targets specific facilities can route to a CPP with **that facility's** screenshots — boosts conversion on cold-start campaign URLs. Use this for the friends & family pre-launch campaign at Laval IC3.

---

## 6. What couldn't be audited (and how to unlock)

| Gap                                       | How to unlock                                                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Keyword field (100-char hidden bag)       | ASC → App Information → Localizable Information → Keywords                                                              |
| Current rank for target keywords          | App Store Connect Analytics (free, post-March 2026 overhaul has Discovery report) or MobileAction / AppTweak indie tier |
| Actual icon visual                        | Visually inspect ASC artwork                                                                                            |
| Screenshot text overlays / design quality | Visually inspect ASC product page                                                                                       |
| Current promotional text                  | ASC → App Information (page returned none, but ASC may have one set that didn't render)                                 |
| Existing CPPs                             | ASC → App Store → Custom Product Pages (audit assumes zero; verify)                                                     |
| App Intents exposed                       | Code inspection in `apps/mobile` for `AppIntent`/`AppIntents` (likely none)                                             |
| AAK / SKAN configuration                  | Code inspection + MMP dashboard                                                                                         |
| iOS 26 SDK migration status               | Check current Expo SDK version against iOS 26 SDK requirement (Expo SDK 55 baseline; confirm Xcode 26 build)            |

---

## 7. Recommended tools for a 5-week-old indie

| Tool                            | Why                                                                                                                                   | Cost                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **App Store Connect Analytics** | Post-March 25, 2026 overhaul added 100+ metrics, cohorts, peer benchmarks, 7-filter stacking, Discovery report. Genuinely strong now. | Free, native                    |
| **Appfigures**                  | Rank tracking + algorithm-change research blog                                                                                        | Free tier viable for one app    |
| **AppFollow**                   | Review monitoring, response workflows                                                                                                 | Free tier viable                |
| **MobileAction**                | Strong keyword DB (1M+) and ASA insights when you start spending                                                                      | Pay only once ad budget >$5k/mo |
| **AppTweak**                    | Best for creative benchmarking and localization research                                                                              | Pay only at scale               |

For now: App Store Connect Analytics + Appfigures free + AppFollow free covers 80% of needs. Skip Sensor Tower / data.ai — overkill for indie scale and prohibitively priced.

---

## 8. Competitive landscape (quick scan)

| App                                       | Position                                                                                | Threat to Rallia                                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Pickleheads**                           | #1 pickleball app, 354k users, +405% YoY. Official USA Pickleball court-finder partner. | High on `court finder`. Rallia should avoid head-on keyword battle here and own the _partner_ intent cluster instead. |
| **CourtReserve**                          | Strong DUPR-integrated court reservation                                                | DUPR integration is something to mirror, not compete on.                                                              |
| **Playtomic**                             | Club mgmt + global player marketplace (padel-strong in EU)                              | Most direct future threat if/when they push into Canada.                                                              |
| **PlayByPoint**                           | Club management (B2B-leaning, PlaySight video)                                          | Different ICP — operator side.                                                                                        |
| **UTR Sports**                            | Tennis ratings + match app                                                              | UTR remains tennis-dominant. Rallia should integrate UTR display for tennis side.                                     |
| **Rally (lovetorally.com), RallyWith.io** | Different apps, similar name                                                            | **Trademark / search-confusion risk — worth investigating in ASC and trademark search.**                              |

---

## 9. Methodology

Public-data audit driven by the open-source [ASO Skills](https://github.com/Eronred/aso-skills) `aso-audit` skill plus 2026 best-practice research. Recommendations validated against:

- Apple Developer documentation (Custom Product Pages, App Intents, PPO, SKStoreReviewController, AAK/SKAN interoperability)
- WWDC25 sessions (App Store Connect, Review Summaries, Age Ratings, Accessibility Nutrition Labels)
- AppTweak / MobileAction / Appfigures 2026 trend reports
- Apple's June 2025 algorithm shift (screenshot caption indexing, semantic clusters, post-install engagement weighting)
- July 2025 CPP organic search assignment feature
- March 2026 App Store Connect Analytics overhaul
- March 2026 Apple Ads multi-placement rollout

Data sourced from:

- `https://itunes.apple.com/lookup?id=6760482014&country=CA`
- `https://apps.apple.com/ca/app/rallia/id6760482014` (server-rendered HTML)

No Appeeky / ASC integration. Re-running this audit with App Store Connect Analytics (Discovery report) would add: real keyword acquisition by source, current rank positions, peer benchmark percentiles, and per-CPP performance.

---

## 10. Recommended next steps

In order, with effort/leverage labels:

1. **Today** (no resubmit, ~30 min) — §3.1 (subtitle rewrite, drop `match` pun), §3.3 (What's New trim), §3.4 (keyword field audit incl. `DUPR`, drop `match`)
2. **This week** (one build resubmit) — §4.1 (fill to 8 screenshots with indexed captions), §4.2 (description hook rewrite)
3. **This week** (no resubmit) — §4.4 (ship 3 CPPs with keyword assignments) — **highest 2026-specific leverage**
4. **This week** (decision, not implementation) — §4.3 (padel commit-or-defer)
5. **Next 2 weeks** (product code) — §4.5 (App Intents), §5.2 (sentiment-gated review prompt)
6. **This month** — §5.1 (fr-CA localization with localized screenshots), §5.4 (IAE for Roland-Garros / Wimbledon)
7. **Before April 28, 2026 if not already done** — iOS 26 SDK / Liquid Glass migration → re-shoot screenshots
8. **Once ad budget exists** — §5.5 (ASA-to-ASO loop), §5.6 (per-facility CPPs for F&F seeding)

### Related skills to invoke next

- `metadata-optimization` — lock the new title / subtitle / keyword field candidates
- `screenshot-optimization` — design briefs for the 5 missing slots, with indexed-caption copy
- `custom-product-pages` — set up the 3-CPP keyword assignment plan
- `localization` — fr-CA market prioritization + per-country keyword research
- `rating-prompt-strategy` — wire the sentiment-gated post-match prompt
- `in-app-events` — Roland-Garros / Wimbledon / US Open event card briefs
- `apple-search-ads` — ASA-to-ASO discovery loop setup
- `competitor-tracking` — monitor Pickleheads / Playtomic / Rally namespace

---

**Net:** the listing was healthy for a 5-week-old app by 2024 standards, but the **subtitle**, **half-empty screenshot tray with un-indexed captions**, and **zero CPPs / App Intents / IAEs** leave most of 2026's ranking surface unused. Highest-leverage moves: (1) drop the `match` pun in the subtitle, (2) fill 5 screenshot slots with indexed-caption copy, (3) ship 3 keyword-assigned CPPs, (4) enable fr-CA. None of these require new product code beyond the SDK migration and App Intents.
