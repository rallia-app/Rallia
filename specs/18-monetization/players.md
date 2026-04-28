# Rallia Monetization — Players

_One-pager · April 2026_

---

## Thesis

The player is the foundation of the entire monetization stack. Coaches, facilities, brands, and organizers only pay if the player side is alive — so player monetization has two mandates:

1. **Generate real recurring revenue directly** (Rallia Plus).
2. **Never compromise the liquidity of the free tier.**

Plus converts because it pays off against **five specific motivations** players are genuinely willing to pay for in a racket-sports context. Every feature behind the paywall must map cleanly to at least one motivation — and earn its slot against an explicit rubric.

---

## What players will actually pay for — the five buckets

Generic frameworks (efficiency / status / access) cover about half the motivational space for racket sports. The complete set:

| #   | Bucket            | Motivation                                  | Player's inner voice                                    |
| --- | ----------------- | ------------------------------------------- | ------------------------------------------------------- |
| 1   | 🔓 **Access**     | Get matches others can't                    | _"I want to be in the good games before they fill up."_ |
| 2   | ⚡ **Efficiency** | Remove friction from things I'd do anyway   | _"Stop making me chase people for $12."_                |
| 3   | 📈 **Mastery**    | See myself getting better                   | _"Am I actually improving, or just playing more?"_      |
| 4   | 🏅 **Status**     | Be recognized for my level                  | _"I want it public that I'm a legit 4.0."_              |
| 5   | 🛡️ **Trust**      | Know the other side is real before I commit | _"I don't want to drive 30 min to play a sandbagger."_  |

**Mastery and Trust are the under-used buckets most racket-sports apps miss.** Mastery converts the improver (Strava's entire playbook). Trust converts the risk-averse — newcomers, women, travelers, anyone playing outside their home network.

Distinctions worth holding:

- **Mastery vs Status** — internal ("am I getting better?") vs external ("are others seeing me as good?").
- **Status vs Trust** — outbound signal ("I'm legit") vs inbound confidence ("they're legit").
- **Access vs Efficiency** — _more_ supply vs _less friction_ on existing supply.

---

## How we decide what goes in Plus — the rubric

Every candidate feature is evaluated against one strategic filter, three value dimensions, and one scope dimension, then classified by the role it plays in the subscription.

**Strategic filter (pass/fail):**

- **Bucket fit** — maps cleanly to ≥1 bucket. If not → cut.

**Value dimensions (1–5):**

- **WTP** — Willingness-to-pay. Would a reasonable user cite _this specific feature_ as a reason they subscribe?
- **Frequency** — How often it actually gets used.
- **Defensibility** — Hard to replicate with free tools (Calendly, Venmo, Excel)?

**Scope:**

- **Build effort** — S (days), M (weeks), L (months), XL (quarters + infra change).

**Role classification** — every paid product needs all three:

- 🎯 **Conversion** — surfaces at moments of pain, drives signups.
- 🔄 **Retention** — used regularly, keeps subscribers paying.
- 🧲 **Gravity** — creates switching cost (data, history, network, reputation).

A Plus where every feature is 🎯 gets high signup + high churn. A Plus where every feature is 🧲 can't drive signups. **Balance matters more than total feature count.**

---

## Plus v1 — the core feature set

14 features. Every one passes the rubric; together they cover all five buckets and balance across the three roles. Shippable in ~2 focused quarters.

| #   | Feature                                                       | Bucket |  Role  | Build |
| --- | ------------------------------------------------------------- | :----: | :----: | :---: |
| 1   | Early access window (1–2 hr before public)                    |   🔓   |  🎯🔄  |   S   |
| 2   | Unlimited match joins                                         |   🔓   |   🎯   |   S   |
| 3   | High-value match alerts (push)                                |   🔓   |  🎯🔄  |   M   |
| 4   | Advanced filters (skill / surface / time / gender / facility) |   🔓   |   🔄   |   M   |
| 5   | See full roster before joining                                | 🔓 🛡️  |  🎯🔄  |   S   |
| 6   | In-app cost splitting (free for Plus users)                   |   ⚡   |  🎯🔄  |   L   |
| 7   | Recurring match templates                                     |   ⚡   |   🔄   |   M   |
| 8   | Rating trajectory chart                                       |   📈   |  🎯🧲  |   S   |
| 9   | Full performance analytics history                            |   📈   |   🧲   |   S   |
| 10  | Partner chemistry insights                                    |   📈   |   🔄   |   M   |
| 11  | Quarterly improvement report                                  |   📈   |  🔄🧲  |   M   |
| 12  | Verified profile badge                                        | 🏅 🛡️  |   🧲   |   S   |
| 13  | Shareable rating card                                         |   🏅   |   🎯   |   S   |
| 14  | Identity verification + reliability score detail              |   🛡️   | 🎯🔄🧲 |   L   |

**Coverage audit**

- Buckets: 🔓 ×5 · ⚡ ×2 · 📈 ×4 · 🏅 ×2 · 🛡️ ×1 (+3 shared) — all five represented.
- Roles: 🎯 ×7 · 🔄 ×9 · 🧲 ×5 — balanced across signup, retention, and lock-in.
- Build mix: 8 S · 3 M · 3 L — no XL. Realistic for a focused 2-quarter plan.

---

## Plus v2 — after launch proves out

Features that pass the rubric but depend on density, data maturity, or infra not yet built. Ship once Plus has converted and marketplace liquidity supports them.

| Feature                                              | Bucket | Why deferred                                           |
| ---------------------------------------------------- | :----: | ------------------------------------------------------ |
| Auto-fill from waitlist on drop-outs                 |   ⚡   | Needs reliable waitlist signal + host adoption         |
| Auto-split by actual attendance (no-shows don't pay) |   ⚡   | Needs check-in data + payment reconciliation           |
| Smart match suggestions                              | ⚡ 🔓  | Data maturity required for recs to be non-embarrassing |
| Batch messaging to a roster                          |   ⚡   | Host-specific niche                                    |
| Priority waitlist position                           |   🔓   | Low standalone WTP                                     |
| Plus-exclusive match pools                           |   🔓   | Chicken-and-egg on seeding                             |
| Private / invite-only matches                        | ⚡ 🛡️  | Low standalone pull; bundle with host pack later       |
| Weak-area analysis                                   |   📈   | Requires shot-level data you likely don't have         |
| Suggested opponents to level up against              | 📈 🔓  | Needs rated player density per level band              |
| Next-rating milestones                               |   📈   | Depends on rating-model maturity                       |
| Rich profile (photos, playstyle, career stats)       |   🏅   | Low WTP until profile-views matter more                |
| Local leaderboards                                   |   🏅   | Needs density per facility/city                        |
| Milestone badges                                     |   🏅   | Low-impact on its own; bundle with gamification pass   |
| Match-quality feedback score on profiles             |   🛡️   | Needs post-match data volume                           |
| Plus-only matches pool                               | 🛡️ 🔓  | Chicken-and-egg until Plus base is real                |
| Satisfaction guarantee (credit on rating mismatch)   |   🛡️   | Support burden unclear until volume exists             |
| Travel mode (portable reputation)                    | 🛡️ 🔓  | Narrow persona until multi-city footprint is real      |

---

## What we're not doing

Features that failed the rubric on value, defensibility, or both. Documenting these is as important as documenting v1 — it's how you stop them from creeping back in.

| Feature                       | Reason cut                                      |
| ----------------------------- | ----------------------------------------------- |
| Priority invites from hosts   | Too niche; low frequency; low WTP.              |
| "Match like last time" rebook | Minor UX convenience; doesn't move conversion.  |
| Drill library                 | Commoditized (YouTube); XL build for weak lock. |
| Hall-of-Fame profile pages    | Vanity; low-use; ships nothing users will miss. |

### Moved to the free tier

- **Calendar sync** — low WTP but cheap to build, and habit-building for free users. Classic _"give it away to drive eventual conversion"_ move.

---

## Free vs Plus — execution view

Reflects the v1 feature set only. Each Plus feature tagged with its primary bucket(s).

|                                            |      Free      |     Plus     | Bucket |
| ------------------------------------------ | :------------: | :----------: | :----: |
| Browse matches in your area                |       ✅       |      ✅      |   —    |
| Join matches                               |   3 / month    |  Unlimited   |   🔓   |
| Basic recommendations                      |       ✅       |      ✅      |   —    |
| Advanced filters                           |       —        |      ✅      |   🔓   |
| High-value match alerts                    |       —        |      ✅      |   🔓   |
| Early access window (1–2 hr)               |       —        |      ✅      |   🔓   |
| See roster before joining                  |       —        |      ✅      | 🔓 🛡️  |
| Calendar sync                              |       ✅       |      ✅      |   —    |
| Host a match                               |       ✅       |      ✅      |   —    |
| IOU-style manual cost tracking             |       ✅       |      ✅      |   —    |
| In-app cost splitting                      | $0.50 / share  |     Free     |   ⚡   |
| Recurring match templates                  |       —        |      ✅      |   ⚡   |
| Performance analytics                      | Last 5 matches | Full history |   📈   |
| Rating trajectory chart                    |       —        |      ✅      | 📈 🏅  |
| Partner chemistry insights                 |       —        |      ✅      |   📈   |
| Quarterly improvement report               |       —        |      ✅      |   📈   |
| Shareable rating card                      |       —        |      ✅      |   🏅   |
| Verified profile badge + verification flow |       —        |      ✅      | 🏅 🛡️  |
| Reliability score detail on profiles       |    Summary     |     Full     |   🛡️   |

---

## Pricing

| Plan           | Price               | Note                                    |
| -------------- | ------------------- | --------------------------------------- |
| Free           | $0                  | Forever                                 |
| Plus (monthly) | ~$7.99/mo           |                                         |
| Plus (annual)  | ~$59.99/yr          | ~37% off — lock in before spring season |
| Plus Household | ~$11.99/mo · $89/yr | 2 linked accounts                       |

---

## Persona → bucket priority

Plus is one product, but the pitch varies by persona. Onboarding signals (hosting behavior, rating climb, travel patterns, rating level) should route users to the right pitch.

| Persona                           | #1 motivator  | #2 motivator | Lead pitch                             |
| --------------------------------- | ------------- | ------------ | -------------------------------------- |
| The Regular (2–3×/week)           | ⚡ Efficiency | 📈 Mastery   | _"Play more, chase less."_             |
| The Climber (improving seriously) | 📈 Mastery    | 🔓 Access    | _"See your trajectory. Play up."_      |
| The Social Player                 | ⚡ Efficiency | 🛡️ Trust     | _"Run your group without the texts."_  |
| The Newcomer                      | 🛡️ Trust      | 📈 Mastery   | _"Find verified games at your level."_ |
| The Host                          | ⚡ Efficiency | 🏅 Status    | _"Host like a club pro."_              |
| The Traveler                      | 🔓 Access     | 🛡️ Trust     | _"Verified games in any city."_        |

**Implication**: one subscription, six conversion pages. The onboarding flow must be capable of routing.

---

## Conversion design — when to pitch Plus

Plus should surface _at moments of friction or aspiration_, never on a generic pricing page. Each trigger maps to a v1 feature and the bucket it pays off.

| Trigger                               | Pitch                                                  | Bucket |
| ------------------------------------- | ------------------------------------------------------ | ------ |
| Free user hits 3-match monthly cap    | "Go unlimited"                                         | 🔓     |
| Free user views roster-gated match    | "See who's playing before you commit"                  | 🔓 🛡️  |
| Match fills before free user can join | "Plus gets 1-hour early access"                        | 🔓     |
| User rates a match (post-match)       | "See your full rating trajectory"                      | 📈     |
| User hosts 2+ matches in a week       | "Set it up once with recurring templates"              | ⚡     |
| 90 days since signup                  | "Your quarterly improvement report is ready"           | 📈     |
| Partner no-shows or flakes            | "Plus shows full reliability history on every profile" | 🛡️     |
| User hits a rating milestone          | "Share your rating card"                               | 🏅     |
| Gifting holidays                      | "Gift Plus to a playing partner"                       | —      |

Rule: **one clear pitch per moment**. Never stack paywalls in the same flow.

---

## Adjacent player-side revenue streams

Layer on top of Plus without new signup. Each tagged with the bucket it primarily satisfies _for the player_.

| Stream                                                  | Price / rate             | Bucket | Role                                       |
| ------------------------------------------------------- | ------------------------ | ------ | ------------------------------------------ |
| Cost-splitting fee (free users only)                    | $0.50 per share          | ⚡     | Utility + Plus upsell nudge                |
| Expert-verified rating                                  | ~$25 one-time            | 🏅 🛡️  | Status signal + trust infra + revenue beat |
| Gift cards / prepaid Plus credits                       | Face value + float       | —      | Seasonal + corporate gifting               |
| Equipment affiliate (Amazon, Tennis Warehouse, Selkirk) | 3–10% commission         | 📈     | Post-match high-intent moment              |
| Travel / destination play                               | 5–15% partner commission | 🔓     | High-AOV, low-volume                       |
| Match insurance (weather / injury / no-show)            | Partner commission       | 🛡️     | Optional upsell at checkout                |
| Rallia-hosted events                                    | Ticketed entry           | 🏅     | Community ritual + brand surface           |

---

## Target metrics (steady state, year 2–3)

| Metric                               | Target                            |
| ------------------------------------ | --------------------------------- |
| Free → Plus conversion               | 5–8% of monthly active free users |
| Plus annual share (vs monthly)       | ≥ 60% (ARR quality)               |
| Household attach rate                | 15–20% of Plus                    |
| Plus gross churn (monthly)           | < 4%                              |
| Plus blended ARPU                    | ~$72/yr                           |
| Adjacent player-side revenue per MAU | $0.50–$2.00/mo                    |

---

## Guardrails

1. **Core matchmaking stays free forever.** Browsing, rating submission, hosting, joining a few matches — all free. Plus is an accelerator, never a gate.
2. **The splitting fee is a nudge, not revenue.** $0.50 isn't meaningful income — it's a signal. Anyone splitting >5 shares/month should convert.
3. **Free analytics preview is intentional.** Last-5-match visibility is enough to want more. Zero visibility kills upsell.
4. **No ads on the player side.** Ads corrode the premium feel and conflict with the Plus pitch. Monetize via product, not attention.
5. **Keep supply-side hosts free.** If free hosts can't run matches, Plus users have nothing to pay to join.
6. **Pitch the motivation, not the feature.** Every paywall moment maps to a bucket. _"Unlimited joins"_ is a feature; _"Be in the good games before they fill"_ is a motivation. The latter converts.
7. **Every feature earns its paywall slot against one of the five buckets.** If a candidate feature doesn't map cleanly to Access / Efficiency / Mastery / Status / Trust, it's probably free-tier — or not a feature at all.
8. **v1 is a rubric output, not a backlog.** v2 features were deferred because they failed rubric math _today_ — not because they're promised for later. Before promoting any feature into v1, re-run the rubric with current data.
9. **Feature balance > feature count.** Each role (🎯 Conversion / 🔄 Retention / 🧲 Gravity) must stay represented. A "7th Access feature" is a worse addition than a "2nd Gravity feature."

---

## The one-liner

**"Plus pays off the five motivations every racket-sports player has — Access, Efficiency, Mastery, Status, Trust — and converts the most engaged 5–8% of players into ~$72/yr each."**
