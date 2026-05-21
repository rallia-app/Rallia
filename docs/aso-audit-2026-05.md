# ASO Audit: Rallia — Tennis & Pickleball

- **App ID:** 6760482014
- **Storefront audited:** CA (not available in US)
- **Platform:** iOS
- **App URL:** https://apps.apple.com/ca/app/rallia/id6760482014
- **Audit date:** 2026-05-19
- **App age:** ~5 weeks (released 2026-04-13, current v1.1.0 2026-04-24)
- **Method:** Qualitative, sourced from Apple's public iTunes Lookup API and the rendered App Store page (no Appeeky / ASC data available)

> Caveats: The keyword field (100-char hidden bag) and live keyword rankings are not auditable from public data. Icon and individual screenshot creative were not visually inspected — scored from filenames and structure only.

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
Overall ASO Score: ~47/100  (limited — no keyword data)

Title:              8 /10  ████████░░
Subtitle:           3 /10  ███░░░░░░░
Keyword Field:      N/A    (private — see recommendations)
Description:        6.5/10 ███████░░░
Screenshots:        4 /10  ████░░░░░░
Preview Video:      0 /10  ░░░░░░░░░░
Ratings & Reviews:  3.5/10 ████░░░░░░  (5★ but only 3 reviews — volume gates ranking)
Icon:               7 /10  ███████░░░  (not visually inspected)
Keyword Rankings:   N/A    (needs Appeeky/ASC)
Conversion Signals: 3 /10  ███░░░░░░░
```

### Per-factor notes

#### Title (8/10) — `Rallia - Tennis & Pickleball`

- ✓ Two strong primary sport keywords (`Tennis`, `Pickleball`)
- ✓ 28/30 chars — near max usage
- ✓ Natural reading, brand + descriptor pattern
- ✗ No verb / intent qualifier (`Find`, `Play`, `Partner`, `Match`)
- ✗ Padel not represented despite being a stated target sport

#### Subtitle (3/10) — `Find the perfect match`

- ✗ Single biggest ASO miss
- ✗ Wastes 8 of 30 chars on a pun (`match` = tennis match + romantic)
- ✗ Apple's semantic search may associate `match` with dating apps, not sports
- ✗ Zero high-intent secondary keywords (`partner`, `court`, `player`, `doubles`, `singles`, `NTRP`, `DUPR`)
- ✓ No repetition with title

#### Keyword field — N/A

Not visible publicly. Critical because the title already burns `Tennis Pickleball`, so the 100-char field is your last shot at indexing high-intent secondary terms. See §4 for the recommended seed set.

#### Description (6.5/10)

- ~ Hook is OK but verbose; below-the-fold reveal forces tap. Lead with verbs.
- ✓ Clear sectioning with bold headers (FIND GAMES, VERIFIED RANKING, etc.)
- ✓ Good formatting / line breaks
- ✗ No CTA at the end
- ✗ No social proof (reasonable for a 5-week-old app)
- ✗ Padel absent

#### Screenshots (4/10)

- ✗ 5/10 slots used — every empty slot forfeits indexable caption text under Apple's semantic search
- ~ Sequence (Home → Facilities → Players → Chat → Create) doesn't lead with the matchmaking value prop
- ✗ EN only — no fr-CA localized variants
- ? Caption / overlay quality not inspected

#### Preview Video (0/10)

- ✗ No preview video. Acceptable for an indie app this young, but it's a top-3 conversion lever on sports/social apps.

#### Ratings & Reviews (3.5/10)

- ✓ 5.0 ★ perfect stars
- ✗ Only 3 ratings — in Sports + Social Networking, Apple's algorithm needs ~50-100+ before ratings meaningfully weight ranking
- ✗ No visible developer responses (low signal at n=3)

#### Icon (7/10 — placeholder)

Not visually audited. Bundle ID and brand suggest a logo mark; assumed no text (which is correct for small-size legibility).

#### Keyword Rankings — N/A

Needs Appeeky, AppFollow, or similar.

#### Conversion Signals (3/10)

- ✗ No promotional text (free real estate, editable without a new build)
- ~ "What's New" is comprehensive but contains dev-speak (`Upgraded to Expo SDK 55`) that doesn't help conversion
- ✗ No In-App Events
- ? Custom Product Pages unknown

---

## 3. Quick wins (today — free, no resubmit required)

### 3.1 Rewrite the subtitle

Candidates, all ≤30 chars — pick whichever survives keyword volume validation:

| Candidate                       | Chars | Notes                            |
| ------------------------------- | ----- | -------------------------------- |
| `Find a tennis partner nearby`  | 28    | High-intent, clean               |
| `Tennis partners & pickleball`  | 28    | Two sports + role                |
| `Court partner finder near you` | 29    | "Court" + "partner" + "near you" |
| `Play more. Find your match.`   | 27    | Keeps the pun, adds verb         |

### 3.2 Add promotional text (170 chars)

Editable without resubmit. Use it for time-bound messaging — friends & family launch, next seeded city, an upcoming feature. Visible above the description.

### 3.3 Trim "What's New"

Drop `Upgraded to Expo SDK 55 with performance and stability fixes`. Lead with user-visible wins:

- Match QR share to invite players in one tap
- Welcome email after sign-up
- Smoother sign-up flow

### 3.4 Audit the keyword field

Suggested seed set (verify volume before locking):

```
partner,doubles,singles,court,club,padel,racket,racquet,player,rally,NTRP,DUPR,league,match,opponent,find
```

**Rules:**

- No spaces after commas
- Singular forms only (Apple indexes both)
- No `rallia`, `tennis`, `pickleball` — already in title (would be wasted)
- No `app`, `sports` — wasted slots
- Use all 100 chars

---

## 4. High-impact (this week)

### 4.1 Fill the missing 5 screenshot slots

Recommended 10-screenshot narrative (keyword-load every caption — Apple's semantic search indexes the text):

1. **Hook**: "Find a tennis partner nearby" (players map)
2. **Hook**: "Pickleball: singles or doubles" (create match flow)
3. Verified ranking (NTRP / DUPR badge)
4. Facilities + court availability
5. Chat / coordinate the match
6. Communities you can join
7. Player profile / stats
8. Match results & ratings
9. "Tennis. Pickleball. Padel." _(only when padel is shipped)_
10. Social proof / CTA

### 4.2 Rewrite the description's first 2 lines

Currently: `Rallia connects tennis and pickleball players with each other. Whether you're looking for a casual weekend game or competitive matches…`

Try:

> Find a tennis or pickleball partner near you. Verified rankings. Book the court. Play more.

Keep the **FIND GAMES / VERIFIED RANKING / …** sections below the fold.

### 4.3 Decide on padel

Currently a stated target sport but appears in **zero** listing surfaces.

- **(a) Commit:** Drop the hyphen and update title to `Rallia Tennis Pickleball Padel` (30 chars). Add padel-specific screenshot. Add `padel` to keyword field.
- **(b) Defer:** Leave listing as-is until padel matchmaking is actually live in-app.

Indexing for padel before product readiness will hurt reviews. Pick one explicitly.

---

## 5. Strategic (this month)

### 5.1 Localize to fr-CA

You're QC-anchored (Laval IC3 facility integration in recent commits). Each locale gets its own title / subtitle / keyword field / screenshots — currently 100% of the French-speaking TAM sees English copy. **Highest TAM-per-effort move available right now.**

### 5.2 Engineer rating volume, not stars

5.0★ × 3 reviews ≠ a useful ranking signal. Wire `SKStoreReviewRequest` after a positive moment:

- Match completed
- Score submitted
- Opponent rated 4★ or higher

**Never on first launch.** Target ~50-100 reviews to clear Apple's volume threshold for Sports + Social Networking.

### 5.3 Add a 15-30s App Preview video

- 3-second hook: "Find a partner. Book a court. Play."
- No audio required (Apple muted by default)
- Captions baked in
- Top-3 conversion lever for sports/social apps

### 5.4 Plan Custom Product Pages for the F&F seeding flow

The `/play` page that targets specific facilities can route to a CPP with **that facility's** screenshots — boosts conversion on cold-start campaign URLs. Use this for the friends & family pre-launch campaign.

---

## 6. What couldn't be audited (and how to unlock)

| Gap                                       | How to unlock                                                                           |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| Keyword field (100-char hidden bag)       | ASC → App Information → Localizable Information → Keywords                              |
| Current rank for target keywords          | Appeeky (paid, ~$8/mo Indie tier) or AppFollow free tier                                |
| Actual icon visual                        | Visually inspect ASC artwork                                                            |
| Screenshot text overlays / design quality | Visually inspect ASC product page                                                       |
| Current promotional text                  | ASC → App Information (page returned none, but ASC may have one set that didn't render) |

---

## 7. Methodology

Audit driven by the open-source [ASO Skills](https://github.com/Eronred/aso-skills) `aso-audit` skill, installed via `npx skills add eronred/aso-skills`. Skills are symlinked into `.claude/skills/`. Data sourced from:

- `https://itunes.apple.com/lookup?id=6760482014&country=CA`
- `https://apps.apple.com/ca/app/rallia/id6760482014` (server-rendered HTML)

No Appeeky / ASC integration. Re-running this audit with Appeeky access would add: real keyword volume, current rank positions, competitor keyword gaps, and chart position.

---

## 8. Recommended next steps

In order:

1. **Today:** Apply quick wins §3.1 (subtitle) and §3.3 (What's New trim) — these don't require a new build.
2. **This week:** §4.1 (fill 5 screenshot slots) and §4.2 (description hook rewrite).
3. **This week:** Decide on §4.3 (padel commit-or-defer).
4. **This month:** §5.1 (fr-CA localization) — highest TAM unlock.
5. **Concurrent:** §5.2 (rating prompt wiring) — purely product code, no ASC change.

### Related skills to invoke next

- `metadata-optimization` — lock the new title / subtitle / keyword field candidates
- `screenshot-optimization` — design briefs for the 5 missing slots
- `localization` — fr-CA market prioritization + per-country keyword research
- `rating-prompt-strategy` — wire the post-match prompt
- `competitor-tracking` — monitor changes from other tennis/pickleball partner-finder apps

---

**Net:** the listing is healthy for a 5-week-old app, but the **subtitle** and **half-empty screenshot tray** are leaving the most ranking upside on the table. Fix those two plus turn on fr-CA and you've meaningfully changed your indexable footprint without writing any product code.
