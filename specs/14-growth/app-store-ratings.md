# App Store Ratings Recovery

Status: proposed · Owner: Mathis · Created 2026-08-17

Goal: make the public star rating reflect the actual satisfaction of the user base, by
raising the volume of genuine ratings instead of leaving the score to self-selecting
detractors.

---

## 1. Diagnosis

The bad reviews are not a sentiment problem. They are a **sampling** problem.

`expo-store-review` is not installed. There is no `SKStoreReviewRequest` /
`AppStore.requestReview` wiring anywhere in `apps/mobile`. Rallia has never asked a single
user for a rating.

That means the only people who have ever rated the app are the ones motivated enough to
navigate to the App Store on their own initiative. That population skews hard negative:
a frustrated user will go out of their way, a satisfied one will not. Every app that
does not prompt ends up with a rating that looks worse than its users feel.

This was already flagged three months ago in [`docs/aso-audit-2026-05.md`](../../docs/aso-audit-2026-05.md):

> "No SKStoreReviewController wiring evident; 3 prompts/year/user budget is being left on the table"

Baseline at that audit: 5.0 stars across 3 ratings. At that sample size a handful of
1-star ratings swings the average by more than a point. The score is not measuring the
product, it is measuring the noise floor.

**So the premise is sound.** If most users are pleased, asking a representative slice of
them will move the average. That is not gaming the system, it is fixing a biased sample.

---

## 2. The bright line

There is a compliant way to do this and a way that gets the listing pulled. The
difference is narrow enough to be worth writing down.

**Apple Developer Code of Conduct 5.6.1** prohibits manipulating reviews with "paid,
incentivized, **filtered**, or fake feedback." Guideline 1.1.7 repeats the ban on false
and manipulated ratings. **Google Play's In-App Review API policy** is more explicit
still: do not ask the user any question about their opinion before or during the review
flow, and do not use a custom UI in place of the system one.

That gives one clean rule:

> **Segment on behavior. Never on sentiment.**

| Allowed                                  | Prohibited                                            |
| ---------------------------------------- | ----------------------------------------------------- |
| Prompt users who completed 3+ games      | Prompt users who answered "yes" to "Enjoying Rallia?" |
| Prompt users active 30+ days             | Prompt users with a high NPS score                    |
| Email the segment that played this month | Email "the users we know love us"                     |
| Ask for an honest review                 | Ask for 5 stars, or suggest what to write             |
| Time the prompt after a win              | Offer credits, badges, or entries for rating          |

Behavioral targeting gets you what you actually want. Users who have completed several
games are, by revealed preference, happy: that correlation is exactly why the tactic
works. The difference is that everyone meeting the behavioral bar gets asked regardless
of how they feel, so the sample stays honest.

Three hard nos, for the record:

- **No pre-prompt gate.** The "Enjoying Rallia? [Yes -> App Store] [No -> Feedback]"
  pattern is common and is explicitly what "filtered" means. Not shipping it.
- **No incentives.** Not credits, not a badge, not a draw entry.
- **No asks to friends, family, or the team.** Those are fake reviews if the reviewer is
  not a genuine user, and Apple correlates device and account signals.

The escape valve for unhappy users is the feedback system that already exists
(`packages/shared-services/src/feedback/userFeedbackService.ts`), surfaced **permanently
in Settings**, available to everyone at all times. That is compliant precisely because it
is not conditional on the review prompt.

---

## 3. What "drowning them" actually costs

The dilution math, so the target is set with open eyes:

```
new_ratings_needed = current_count × (target − current_avg) / (incoming_avg − target)
```

Worked against a plausible current state (20 ratings averaging 3.4; **replace with the
real numbers from App Store Connect**), assuming incoming ratings average 4.7:

| Target | New ratings needed            | % of a ~250-player base |
| ------ | ----------------------------- | ----------------------- |
| 4.0    | 17                            | 7%                      |
| 4.3    | 45                            | 18%                     |
| 4.5    | 110                           | 44%                     |
| 4.7    | impossible (denominator is 0) | n/a                     |

The denominator is the whole story. Every 0.1 of target above roughly 4.3 costs
disproportionately more volume, because you are averaging against a ceiling.

**Recommendation: target 4.3, hard floor 4.0.** The audit notes apps below 3.5 lose
visibility on ~3x more top-10 keywords; the ranking benefit is essentially flat above
4.3. Chasing 4.8 is a vanity target that would need more ratings than Rallia has users.

### Scale reality check

Roughly 250 players today. Honest funnel for in-app prompting alone:

```
250 players
 → ~100 behavior-qualified          (40%)
 →  ~70 prompts actually displayed  (Apple throttles and users disable them)
 →  ~10 ratings                     (10-15% rate in the sheet)
```

**In-app prompting alone yields ~10 ratings from today's base.** That is not enough on
its own, which is why this plan has three tracks rather than one. The prompt engine is
the permanent flywheel that compounds as the user base grows; the outreach campaign and
the review responses are what move the number this quarter.

---

## 4. Track 0: zero-engineering wins (do this week)

**Highest ROI action in the whole plan, and it needs no build.**

Respond to every negative review in App Store Connect. When a developer responds, Apple
notifies the reviewer and offers them a one-tap path to update their review. Reported
update rates run 10-30% for responses that actually solve the problem.

At n=20 averaging 3.4, converting **two** 1-star reviews to 4-star moves the average to
3.7. That is +0.3 from one afternoon of writing, versus needing ~15 new 4.7-star ratings
for the same move.

Response template (adapt per review, never paste verbatim):

1. Thank them, name the specific problem they hit.
2. Say what was actually fixed or when it will be, with a version number if it shipped.
3. Point to the in-app feedback form for follow-up.
4. No defensiveness, no request to change the rating. Asking them to re-rate in a public
   response reads badly and edges toward manipulation.

Also this week, both free and untouched per the audit:

- Fill the 5 empty screenshot slots (captions are indexed as keyword metadata since the
  June 2025 algo update).
- Add promotional text (editable without a build).
- Bump the app description to invite reviewers to mention specific use cases, which feeds
  Apple's WWDC25 LLM-extracted Review Summaries.

---

## 5. Track A: the prompt engine — BUILT 2026-08-17

The permanent fix. Ships once, compounds forever. Implementation notes below
describe what actually landed; it diverges from the original sketch in three
places, each flagged inline.

### Dependency

```bash
npx expo install expo-store-review --workspace=apps/mobile
```

Wraps `SKStoreReviewRequest` / `AppStore.requestReview` on iOS and the Play In-App Review
API on Android. **The system dialog is the entire UI.** No custom sheet, no
`ToastOverlay`, no new `StyleSheet` entries. This is the one feature where the compliant
design and the CLAUDE.md "never hand-roll UI" rule point the same way.

### Architecture

Follows the standard data flow (component -> hook -> service -> Supabase):

| Layer       | File                                                          | Responsibility                        |
| ----------- | ------------------------------------------------------------- | ------------------------------------- |
| Migration   | `supabase/migrations/20260817120000_player_review_prompt.sql` | Prompt log + both RPCs                |
| Service     | `packages/shared-services/src/review/reviewPromptService.ts`  | Wraps the RPCs, never throws          |
| Hook        | `packages/shared-hooks/src/useReviewPrompt.ts`                | Query layer, platform-agnostic        |
| Mobile hook | `apps/mobile/src/hooks/useStoreReviewPrompt.ts`               | Native call, client guards, analytics |

**Divergence 1: four layers, not three.** `expo-store-review` cannot be imported
from `shared-hooks`, because the web app consumes that package and would fail to
build. So the shared hook does the data and a thin mobile-only hook does the
native call. Verified by type-checking both apps.

The table has **explicit GRANTs** (default Data API grants end Oct 30 2026), and
the migration is committed together with regenerated types.

Server-side state rather than AsyncStorage, so the throttle survives reinstall and
device switches, and so the funnel is queryable.

**Divergence 2: a log, not a counter.** A counter plus `window_started_at` gives a
_fixed_ 365-day window that resets on an arbitrary date. A log row per prompt
gives a true rolling window for free, and doubles as the analytics record.

```sql
CREATE TABLE public.player_review_prompt (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    player_id    uuid NOT NULL REFERENCES public.player(id) ON DELETE CASCADE,
    trigger_name text NOT NULL,
    shown_at     timestamptz NOT NULL DEFAULT now()
);
```

RLS: SELECT own rows or admin, and **no write policy at all**. Both RPCs are
`SECURITY DEFINER` and own the table. Verified: a client `UPDATE` against the
table is silently filtered, and one player cannot see another's rows.

### Triggers (behavioral, ranked)

Fire at the moment of completion, never on app launch or mid-task.

1. **Match feedback completed** (LIVE). Fires from `MatchFeedbackWizard` once every
   opponent has been rated. Both the gate and the trigger, deliberately: the moment the
   player crosses the engagement bar is the moment of peak satisfaction.
2. **Streak milestone reached.** Ties into the existing gamification work.
3. **League or tournament result poster shared.** Sharing is itself public advocacy.
4. **`match_filled`** (canonical matchmaking success event) on an auto-match.

**Divergence 4: match feedback replaced score confirmation as the trigger, and the
games-played gate is gone.** Two reasons, both measured on local fixtures:

- _The old gate barely filtered._ 67 players had played at least one game and 65 cleared
  `>= 3 played`. Requiring 3 completed feedback sessions instead cuts the same pool to 33.
  Filling in an optional, effortful, pro-social form three times is real goodwill;
  turning up to three games is closer to mere presence. The old gate was also a lifetime
  count, so three games last year scored the same as three this month.
- _It is a better moment._ Score confirmation can just as easily follow a 6-0 6-0 defeat.
  Finishing the feedback form is reflective and task-complete with nothing left pending.

Score confirmation is **removed**, not demoted. With only two prompts per player per
year, a weaker trigger firing first burns the budget on the lesser moment.

**Counted, never weighted by valence.** The gate is the number of feedback sessions
submitted, never whether they were positive. The sentiment is about the opponent rather
than about Rallia, which genuinely distinguishes it from an "Enjoying Rallia?" gate, but
selecting on it would still mean choosing who to ask by expected positivity and would
skew the sample by mood. It also buys little: only 24 of those 33 players gave 4-5 stars,
so the filter would cost a quarter of the pool to exclude people who mostly rated an
opponent 3 out of 5. The star rating is recorded as an analytics property instead, so
whether it predicts conversion can be settled with data.

### Suppression rules (never prompt)

- Fewer than 3 completed feedback sessions (counted by distinct match).
- Within 14 days of a cancelled game, a no-show, or a disputed score.
- While the user has an **open, unresolved** feedback ticket. Resume once it is resolved.
- Within 90 days of the last prompt, or if 2 have already fired in the trailing 365 days
  (Apple allows 3; one is held in reserve).
- Client-side: web, missing native module, or app backgrounded when the delay elapses.

Still open from the review of these rules: the open-ticket block currently catches
`feature` and `improvement` categories too, which are engagement signals rather than
unhappiness. It should probably narrow to `category = 'bug'`.

One judgment call worth naming: suppressing during an open ticket is _arguably_
sentiment-adjacent. The conservative reading applies here. Suppress only while the ticket
is genuinely open, resume after resolution, and never exclude a user permanently. Nobody
is filtered out of the population, some are only delayed. Both stores' guidance to avoid
prompting during a degraded experience supports this.

### Copy

The system dialog supplies its own copy in the user's locale. **Nothing to translate for
the prompt itself.** i18n work is limited to the Track B outreach strings, which go in
both `en-US.json` and `fr-CA.json` under a new `reviewOutreach` namespace.

---

## 6. Track B: the outreach campaign

Reaches the existing base, which in-app prompting alone cannot cover fast enough.

**Audience:** behavior-qualified only. Completed 3+ games, active in the last 60 days.
Segment defined by a SQL query on match history, not by any satisfaction signal, and the
query is checked into the repo alongside this doc so the criteria are auditable.

**Channel:** email first (higher intent, better formatting), push as a second wave to
non-openers.

**Delivery:** staggered. Per the broadcast self-DoS incident, a full-base push wave
saturates the DB. Batch at ~50/hour.

**Destination:** `https://apps.apple.com/app/id6760482014?action=write-review`, routed
through the existing `/api/go` bouncer for UA-sniffing and attribution.

Draft copy, en-US:

> **Subject:** Ton avis sur Rallia?
>
> You have played 5 games through Rallia. That is the whole point of the thing, so
> thank you.
>
> If you have two minutes, an honest review on the App Store genuinely helps other
> players in the area find us. Good or bad, we read all of them.
>
> [Leave a review]
>
> Something not working? Reply here or use Feedback in Settings, we would rather fix it
> than read about it later.

fr-CA:

> **Objet:** Ton avis sur Rallia?
>
> Ça fait 5 parties que tu joues sur Rallia. C'est exactement pour ça qu'on l'a bâtie,
> so merci.
>
> Si t'as deux minutes, un avis honnête sur l'App Store aide vraiment les autres joueurs
> du coin à nous trouver. Bon ou mauvais, on les lit tous.
>
> [Laisser un avis]
>
> Quelque chose qui marche pas? Réponds-moi ou passe par Commentaires dans les Réglages,
> on aime mieux le régler que de le lire plus tard.

Copy rules applied: "games" / "parties" not "matches", no em dashes, no tennis-ball emoji,
no "Touche pour". Note the ask is for an **honest** review with the negative path offered
in the same breath. That is the compliant construction, and it also converts better,
because it does not read as a favor being extracted.

---

## 7. Decision point: reset the rating?

App Store Connect allows resetting the summary rating when shipping a new version.

|                     | Reset                                                                                         | Do not reset                       |
| ------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------- |
| Starting point      | 0 ratings, clean slate                                                                        | Current average, diluted over time |
| Effort to reach 4.3 | ~15 ratings                                                                                   | ~45 ratings                        |
| Cost                | Shows "no ratings yet" for weeks, hurts conversion; loses the 5-star base and all review text | Slower, but never looks empty      |

**Recommendation: do not reset yet.** Revisit at week 6. Reset is the right call only if
the negative reviews are all tied to a specific version whose problems are demonstrably
fixed, which is a claim to make from the review text rather than from hope. Decide with
data, after Tracks 0 and A have run.

---

## 8. Instrumentation, and the honest test

PostHog events on the prompt engine:

| Event                      | Properties                                                                    |
| -------------------------- | ----------------------------------------------------------------------------- |
| `review_prompt_requested`  | `trigger`, `feedbacks_submitted`, `prompts_in_window`, `opponent_star_rating` |
| `review_prompt_suppressed` | `trigger`, `reason`                                                           |

`opponent_star_rating` is recorded and **never gated on**. It exists to answer "do
happier submitters convert better" with evidence rather than intuition.

**Divergence 3: two events, not three.** A separate `review_prompt_eligible`
would fire and then be immediately followed by `review_prompt_requested` in every
case, so it carried no information. Every check now emits exactly one of the two
above, which makes the funnel a clean partition. `reason` carries both server
causes (`throttled_year`, `throttled_recent`, `not_enough_games`, `open_feedback`,
`recent_bad_experience`) and client ones (`unsupported`, `backgrounded`,
`request_failed`).

Neither store reports whether the user actually rated or what they gave. Conversion is
therefore inferred: `review_prompt_requested` count against the weekly ratings delta in
App Store Connect.

**The metric that matters is the incoming average, tracked weekly.** This is worth
stating plainly, because it is the part of the plan that could change your mind:

- Incoming ratings average **4.5+**: the premise holds. Most users are pleased, the old
  score was a sampling artifact, and this plan simply fixes it. Scale up Track B.
- Incoming ratings average **~3.5 or below**: the bad reviews were not outliers, they
  were early signal. Stop the outreach immediately, since more volume would then be
  actively making the public score worse, and the review text becomes the most valuable
  product feedback available.

Building the checkpoint in costs nothing and means the initiative cannot quietly fail in
the wrong direction.

---

## 9. Timeline

| Week | Track | Work                                                                                                   |
| ---- | ----- | ------------------------------------------------------------------------------------------------------ |
| 1    | 0     | Respond to every existing negative review. Promo text, screenshot captions.                            |
| 1-2  | A     | ~~`expo-store-review`, service, hook, migration, GRANTs, types. Trigger 1 only.~~ **Done 2026-08-17.** |
| 2    | A     | Ship in the next build. Watch `review_prompt_suppressed` reasons.                                      |
| 3    | A     | Add triggers 2-5 once trigger 1 is proven clean.                                                       |
| 3-4  | B     | Segment query, copy through i18n, wave 1 email (staggered).                                            |
| 5    | B     | Wave 2 push to non-openers.                                                                            |
| 6    | -     | Read incoming average. Apply the §8 test. Decide on reset.                                             |

---

## 10. Risks

| Risk                                                      | Mitigation                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Prompt fires after a bad experience and harvests a 1-star | Suppression rules in §5; ship trigger 1 alone first                                  |
| Outreach reads as begging and annoys the base             | One email, one push, hard stop. Honest-review framing, negative path offered         |
| Push wave saturates the DB                                | Batch at ~50/hour per the broadcast self-DoS finding                                 |
| Premise is wrong and volume makes the score worse         | §8 checkpoint at week 6                                                              |
| Compliance                                                | No gate, no incentive, no fake reviews. Behavior-only segmentation, auditable in SQL |

---

## Related

- [`docs/aso-audit-2026-05.md`](../../docs/aso-audit-2026-05.md) - full ASO baseline
- [`specs/14-growth/referral-system.md`](./referral-system.md) - shares the outreach plumbing
- [`specs/16-analytics/philosophy.md`](../16-analytics/philosophy.md) - event conventions
