# Refactor: Per-surface suggestion strategies

## Context

The "suggestions" system (suggested matchups, generated server-side) currently surfaces in 5 places: Home Nearby, Public Matches feed, Suggestion Sheet, end-of-onboarding, and the daily digest email. All five use the same data shape (`useMatchSuggestions` → 7-day grid of up to 5/day, opponent-deduped, scored) and the same `useUnifiedMatchFeed` to interleave matches and suggestions per day.

The issue: every surface has different goals, but they all share one shape — a per-day, chronologically-sorted, interleaved feed. We want suggestions **appended** rather than interleaved (real matches always win), and we want each surface to optimize for its own purpose:

Suggestions always fetch over the **full 7-day horizon**. Matches use the same window. The reason we keep mentioning the horizon at all is that today's `getMatchSuggestions` carves the 7 days into per-day buckets capped at 5/day — that bucketing goes away in the new flat top-N flow, but the underlying lookahead window stays at 7 days.

Three logical groups across the five surfaces:

- **Group A (`composeJustForYou` — matches + suggestion-padded to 5)**: Home "Just for you" / "Nearby"; Daily digest (one section per active sport).
- **Group B (`getTopSuggestions` — suggestions only)**: Suggestion sheet (`maxItems: 15`); Post-onboarding step (`maxItems: 5`).
- **Group C (Public Matches — unique)**: matches drive the feed (chronological with score tiebreak, full matches included). Pad with `getTopSuggestions({ maxItems: 30 - matches.length })` only when the initial page returns < 30 matches and there are no more pages. A single light "Suggestions for you" divider sits between the last match and the first suggestion.

| Surface             | Goal                                                | Cap                              | Match window  | Suggestion window | Order         | Full matches |
| ------------------- | --------------------------------------------------- | -------------------------------- | ------------- | ----------------- | ------------- | ------------ |
| Home "Just for you" | "Best 5 things you could play this week"            | exactly 5                        | 7d (existing) | 7d                | score-only    | excluded     |
| Public Matches feed | "Browse what's out there"                           | ≥30, paginates                   | 7d (existing) | 7d                | chronological | **included** |
| Suggestion sheet    | "Show me more matchup ideas"                        | 15                               | n/a           | 7d                | score-only    | n/a          |
| Onboarding final    | "Quick taste of what we found"                      | 5                                | n/a           | 7d                | score-only    | n/a          |
| Daily digest        | "Best 5 things you could play this week, per sport" | 5 per active sport, 1–2 sections | 7d            | 7d                | score-only    | excluded     |

**Home "Just for you" and the daily digest run the same composition logic** — they are conceptually one feature presented in two surfaces. They share:

- Same match window (7 days), same scoring (`scoreNearbyMatch`), same suggestion padding rule (fill matches first, top-up to 5 with `getTopSuggestions`).
- Difference is purely the rendering host: in-app horizontal carousel (Home) vs. per-sport email sections (digest).
- Both go through a shared composer (see §0) so any future change applies everywhere at once.

**Post-onboarding** is intentionally suggestions-only — it's pedagogical, introducing the matchmaking feature to a brand-new user. It uses `getTopSuggestions` directly (top-5 by score) and does **not** run through `composeJustForYou`.

Decisions confirmed with user:

- Signed-in Home title: **"Just for you"** / FR: **"Juste pour vous"**. Signed-out keeps **"Nearby"** / **"À proximité"**.
- Public Matches padding: match-first; suggestions pad once when initial-page total < 30. Past 30, paginate matches normally; only append suggestions when matches genuinely exhaust.
- Suggestion sheet: flat score-ordered list, no day headers.
- Daily digest: 5/section regardless of single vs both sports.

## Approach

Split the data layer along two new primitives:

1. **`getTopSuggestions`** (suggestion service) — flat `SlotSuggestion[]` sorted by score desc, deduped by opponent, with a configurable `maxItems`. Always uses the existing 7-day horizon (so a user with no upcoming-3-days availability still gets later-week suggestions). Reuses the existing RPC + scoring pipeline; just swaps `bucketByDay` for a flat global top-N.
2. **`p_include_full` parameter on `search_public_matches`** — relaxes the SQL-side full-match filter so PublicMatches can show full matches. Default unchanged (`FALSE`), so Home + Digest behavior remains intact. No date-window parameter is needed: every surface uses the existing 7-day default.

Then each of the 5 surfaces stops sharing `useUnifiedMatchFeed` and instead uses the primitive that matches its goal. `useUnifiedMatchFeed` itself goes away once all 5 are migrated (no other callers — verified via grep).

---

## Changes by surface

### 0. Shared data layer

**`packages/shared-services/src/matches/suggestionService.ts`**

- Add `getTopSuggestions(params: GetMatchSuggestionsParams & { maxItems: number }): Promise<SlotSuggestion[]>`. Internally:
  - Reuse Steps 1–4 of `getMatchSuggestions` (RPC → busy slots → triplet expansion → scoring) with the existing 7-day horizon — `DAYS_AHEAD = 7` is correct for every surface.
  - Replace `bucketByDay` with a new `pickTopGlobal(triplets, maxItems)`: dedupe by opponent globally (keep highest-scored slot per opponent), sort by score desc, take `maxItems`.
- Keep `getMatchSuggestions` only if still needed; once no caller remains, delete it. (Verified callers: only `useMatchSuggestions` — which we'll retire.)
- Export `pickTopGlobal` for unit tests; mirror the existing `bucketByDay` test pattern in `suggestionService.test.ts`.

**`packages/shared-hooks/src/useTopSuggestions.ts`** (new file)

- `useTopSuggestions({ playerId, sportId, sportName?, latitude?, longitude?, maxDistanceKm?, maxItems, enabled? })` → `{ suggestions: SlotSuggestion[]; isLoading; isRefetching; refetch }`.
- Mirrors `useMatchSuggestions` shape but flat; same TanStack key strategy (auth vs anon mode + maxItems in the key).
- Re-export from `packages/shared-hooks/src/index.ts`.

**`packages/shared-services/src/matches/matchScoring.ts`** (new file)

- Move the 9-factor `scoreNearbyMatch` body and the `MatchScoringPreferences`/`Scorable` types out of `useMatchRelevanceScore.ts` into this framework-free module so it's importable by both React Native and the Deno digest edge function.
- Re-export from `@rallia/shared-services`.

**`packages/shared-services/src/matches/justForYouComposer.ts`** (new file)

- The shared brain behind Home "Just for you" and the daily digest. Pure async function — no React, no Deno specifics — so both hosts can call it.
- Signature:
  ```ts
  composeJustForYou(input: {
    playerId: string;
    sportId: string;
    sportName?: string;
    latitude: number;
    longitude: number;
    maxDistanceKm: number;
    scoringPreferences: MatchScoringPreferences;
    excludeUserIds?: string[];          // creator/participant exclusion
    matchLimit?: number;                // default 5
  }): Promise<{
    matches: Scorable[];                // top-N by scoreNearbyMatch
    suggestions: SlotSuggestion[];      // padding when matches < limit
  }>
  ```
- Internally:
  1. Call `getNearbyMatches({...})` (or a tiny equivalent helper that the digest can call against `search_public_matches`) for a generous match pool.
  2. Filter user-involved matches via `excludeUserIds`.
  3. Score with `scoreNearbyMatch` and take top `matchLimit` (default 5).
  4. If under cap, call `getTopSuggestions({ maxItems: limit - matches.length })` and return as `suggestions`.
- Both surfaces consume `{matches, suggestions}` and render in their own way (horizontal carousel cards vs. email HTML cards).

**`packages/shared-hooks/src/useMatchRelevanceScore.ts`**

- Becomes a thin wrapper that re-imports the score function from `@rallia/shared-services` and exports two hooks:
  - `useSortedNearbyMatches` (existing — chronological with score tiebreak, used by Public Matches)
  - `useScoreOrderedMatches<T extends Scorable>(matches, preferences): T[]` (new — pure score-desc, used by Home "Just for you")
- Match score (0–100) and suggestion score (~0–1) stay on different scales. No surface interleaves them by score — matches fill first, then suggestions pad the tail in every place.

**SQL migrations**

- New `supabase/migrations/<timestamp>_search_public_matches_include_full.sql`:
  - Drop + recreate `search_public_matches` adding parameter `p_include_full BOOLEAN DEFAULT FALSE`. When true, omit the `joined_count >= capacity` filter. Default behavior unchanged.
  - PublicMatches passes `true`.
  - Add a count-RPC variant if `search_public_matches_count` mirrors the same filter (verify in migration).
- (No second migration — `search_matches_nearby` is unchanged. Home and the digest both use its default 7-day behavior.)

**`packages/shared-services/src/matches/matchService.ts`**

- `searchPublicMatches` (or wherever `search_public_matches` is called): forward optional `includeFull`.
- `getNearbyMatches`: unchanged signature.

**`packages/shared-hooks/src/useNearbyMatches.ts`**

- No signature changes. Home uses the existing 7-day default.

**Removal candidates after migration** (don't delete in same PR — flag for cleanup):

- `useUnifiedMatchFeed` (no callers after Home + PublicMatches migrate)
- `useMatchSuggestions` (no callers after sheet + onboarding + Home + PublicMatches migrate)
- `bucketByDay`, `DAYS_AHEAD`/per-day cap in `suggestionService.ts`
- `get_morning_digest_suggestions` RPC (digest will use `getTopSuggestions` flow via a new RPC, see §5)

---

### 1. Home Nearby section

**File: `apps/mobile/src/screens/Home.tsx`**

Replace the vertical FlatList feed (lines ~683-913) with a horizontal carousel:

- Drop `useNearbyMatches({...limit:20})` + `useMatchSuggestions(...)` + `useUnifiedMatchFeed(...)` + `feed`/`renderFeedItem` chain.
- New **`useJustForYou(...)`** hook in `packages/shared-hooks/src/useJustForYou.ts` — wraps the shared `composeJustForYou` (§0) in a TanStack `useQuery`. Returns `{ matches, suggestions, isLoading, isRefetching, refetch }`. Same hook can later be reused on the web surface if we ever build one.
- Home renders the result as `[...matches, ...suggestions]` (always exactly 5), each shown as a `JustForYouCard` (see below).

- Render via `ScrollView horizontal` (mirror `myMatchesScrollContent` styles) with new card component **`JustForYouCard`** (see below). Always renders exactly 5 cards (skeleton when loading).

- **Section title**:
  - Signed-out: `t('home.soonAndNearby')` (existing key, value "Nearby" / "À proximité").
  - Signed-in: `t('home.justForYou')` — new translation key.
  - Compute via `session?.user?.id ? 'home.justForYou' : 'home.soonAndNearby'`.

- **Empty state**: keep current "no nearby games" copy (rare — only if both pools empty).

- **`JustForYouCard`** (new) at `apps/mobile/src/features/home/components/JustForYouCard.tsx`:
  - Compact horizontally-scrollable card (~280px wide). Discriminates on `kind`. For matches, show sport icon, day+time, facility, spots-left chip. For suggestions, show opponent name/avatar, day+time, facility, "Send invite" CTA (reuse `useSuggestionInviteHandler` from parent).
  - Style based on `MyMatchCard` (already used in horizontal scroll on Home).

- **Translations** (new keys in both `en-US.json` and `fr-CA.json`):
  - `home.justForYou` → "Just for you" / "Juste pour vous"

- Remove the `useEffect` at lines 825-842 that paginates to 30 items — no longer relevant on Home.
- Remove the floating section header concept (it stays static now).

---

### 2. Public Matches feed

**File: `apps/mobile/src/features/matches/screens/PublicMatches.tsx`**

- `usePublicMatches({...})`: pass new option `includeFull: true`. Drop the in-component `filteredMatches.filter` rule that excludes full matches if any (verify).
- Replace `useMatchSuggestions` + `useUnifiedMatchFeed` (lines ~242-301) with:
  - `useTopSuggestions({ maxItems: 30, ... })`.
  - Apply `doesSuggestionPassFilters` (extract from `useUnifiedMatchFeed.ts` into a standalone util `packages/shared-hooks/src/suggestionFilters.ts` since `useUnifiedMatchFeed` is going away) for client-side filter application.
- Build the feed:
  ```
  const feed = useMemo(() => {
    const matchItems = sortedMatches.map(m => ({ kind: 'match', ...}));
    const padCount = Math.max(0, 30 - matchItems.length);
    if (padCount === 0 || hasNextPage) return matchItems; // matches still paginating
    const suggestionItems = filteredSuggestions.slice(0, padCount).map(s => ({ kind: 'suggestion', ...}));
    return [...matchItems, ...suggestionItems];
  }, [sortedMatches, filteredSuggestions, hasNextPage]);
  ```

  - Suggestions only appear once `hasNextPage === false` and matches < 30, OR initial page doesn't reach 30. The "match-first, suggestions pad once at 30" rule from clarifications.
- Drop date-header rows (`feed.kind === 'header'`). The day grouping goes away — flat list, chronological match ordering preserved by `useSortedNearbyMatches`. Suggestions appear in score order at the tail.
- **Frontier separator**: when at least one suggestion is rendered, insert a single light divider row between the last match and the first suggestion (`{ kind: 'frontier' }` in the feed array). The label reads `t('publicMatches.suggestionsFrontier')` — EN: "Suggestions for you" / FR: "Suggestions pour vous", subtle muted-text + 1px hairline rule on either side. New translation key in both locale files. The separator is purely visual; if there are zero suggestions (matches ≥ 30 with more pages, or both pools empty), the row is not rendered.
- Keep `FeedItemCard` for rendering (already supports both `kind`s); consider renaming `UnifiedFeedItem` to `FeedItem` once `useUnifiedMatchFeed` is gone.
- Filter bar still applies; suggestion filters use the extracted helper.

---

### 3. Suggestion Sheet

**File: `apps/mobile/src/components/MatchSuggestionsSheet.tsx`**

- Replace `useMatchSuggestions(...)` + day-flatten loop (lines ~44-121) with `useTopSuggestions({ maxItems: 15, ... })`.
- Drop `flatItems` building, `renderDateHeader`, and per-day section headers — render a flat list of up to 15 `SuggestionCard`s (existing card unchanged), still with stagger animation but capped at 15 instead of 35 (`MAX_ANIMATED = 15`).
- Loading/empty states unchanged.
- Header copy unchanged (`onboarding.suggestions.title` = "Your Top Matches" already fits).

---

### 4. End of onboarding

**File: `apps/mobile/src/features/onboarding/components/wizard/steps/SuggestionsStep.tsx`**

- Currently flattens `days[].suggestions[]` chronologically and slices to 5 (lines 90-99). Replace with the score-ordered top-5 from the data layer — matches are intentionally **not** included here (this surface is pedagogical, introducing the matchmaking feature only).
- The wizard parent (`OnboardingWizard.tsx` line 343) calls `useMatchSuggestions(...)` and passes `days` down. Change it to call `useTopSuggestions({ maxItems: 5 })` and pass `suggestions: SlotSuggestion[]` to `SuggestionsStep`.
- `SuggestionsStep` props change: `days: DaySuggestions[]` → `suggestions: SlotSuggestion[]`. Component body simplifies — no inner flatten loop. Card rendering unchanged (existing `SuggestionCard`).

---

### 5. Daily digest email

**File: `supabase/functions/send-morning-digest/index.ts`**

Restructure feed builder around per-sport sections backed by the shared `composeJustForYou` from §0:

- `MAX_FEED = 6` → `MAX_PER_SECTION = 5`. Drop `MAX_SUGGESTIONS_PER_SPORT` and `MATCHES_FETCH_LIMIT`.
- Per user, pull `MatchScoringPreferences` once (one extra query joining `player` / `player_sport` for the active sport(s) / `player_favorite_facility`). Then for each sport call `composeJustForYou({ playerId: user.userId, sportId, latitude: user.lat, longitude: user.lng, maxDistanceKm: user.maxTravelKm, scoringPreferences, excludeUserIds: [user.userId], matchLimit: 5 })`.
- Each call returns `{ matches, suggestions }` already-sized for one section. Convert to email shapes (`DigestMatch`/`DigestSuggestion`) — same conversion as today, just sourced from the composer instead of the bespoke RPC pipeline.
- Skip user when **all** sections are empty.
- Drop:
  - `getPublicMatchesForUser` — replaced by `composeJustForYou`.
  - `getSuggestionsForUser` — replaced by `composeJustForYou` (calls `getTopSuggestions` internally).
  - `buildFeed` — sections are pre-built per sport; no global merge needed.
  - The cross-sport opponent dedup map — each sport has its own section now and the user can naturally see the same opponent in both if they truly are the best match in both pools.
- **Match scoring in the digest** is the same 9-factor `scoreNearbyMatch` as Home — guaranteed identical because both surfaces share `composeJustForYou`. Today the digest ranks matches chronologically only; this fixes that gap.
- **Suggestion scoring in the digest** is unchanged — `matchup_score` from `getTopSuggestions` (mobile path), which equals `player_compatibility + actionabilityBoost + urgencyBoost + jitter`. Match scores (0–100) and suggestion scores (~0–1) stay on different scales; the composer fills with top-5 matches first then pads with suggestions, so the two pools are never interleaved by score.
- Replace `get_morning_digest_suggestions` RPC with a new `get_top_match_suggestions(p_player_id, p_sport_id, p_limit, p_caller_tz TEXT)` that mirrors the mobile `getTopSuggestions` semantics — same `WITH` pipeline as the existing RPC over the full 7-day horizon, with global score order (no per-day grouping). No horizon parameter — always 7 days, matching the mobile path.
  - New migration: `supabase/migrations/<timestamp>_get_top_match_suggestions_rpc.sql`. Keep `get_morning_digest_suggestions` for now to avoid churn; mark for removal once digest migrates.
  - **Strict-future fix** (carry-over bug from `get_morning_digest_suggestions`): the existing RPC filters with `WHERE (match_date + start_time) > NOW()`, which evaluates a naive `timestamp` against `timestamptz NOW()` and resolves in the **server tz** (UTC on Supabase). A slot at "today 5pm Montreal" looks like `17:00 UTC` and gets rejected at 16:00 Montreal (=20:00 UTC) even though it's actually 1h in the future. Replace with: `WHERE timezone(p_caller_tz, (match_date + start_time)::timestamp) > NOW()`. The edge function passes the user's locale-derived timezone (we already compute `timezoneForLocale(locale)` in the email layout helpers).
  - The mobile-side check in `generateFixedHourSlots` already uses local-timezone `Date`, so no fix needed there — but mirror this guarantee in `pickTopGlobal` unit tests so a regression is caught.

**File: `supabase/functions/send-morning-digest/template.ts`**

- `DigestEmailPayload.feed` → `DigestEmailPayload.sections: { sportName: string; items: DigestFeedItem[] }[]`.
- `renderMorningDigestEmail`: emit a `renderSectionHeading(sportName)` per section (only when `sections.length > 1`); when `sections.length === 1`, use the existing generic heading.
- `renderMatchCard` / `renderSuggestionCard` unchanged.
- Keep CTA button at the bottom.

**Translation file: `supabase/functions/_shared/email-translations.ts`**

- New keys: `digest.sportSection.tennis`, `digest.sportSection.pickleball` (for the per-sport section heading when 2 sections).

---

## Translation deltas

**`packages/shared-translations/src/locales/en-US.json`** + **`fr-CA.json`**

- Add `home.justForYou`:
  - EN: "Just for you"
  - FR: "Juste pour vous"
- Add `publicMatches.suggestionsFrontier`:
  - EN: "Suggestions for you"
  - FR: "Suggestions pour vous"
- (No removals; `home.soonAndNearby` stays for signed-out and any analytics references.)

**`supabase/functions/_shared/email-translations.ts`**

- Add `digest.sportSection.tennis` / `digest.sportSection.pickleball` (used only in dual-sport digests).

---

## Critical files to modify

```
packages/shared-services/src/matches/suggestionService.ts          # +getTopSuggestions, +pickTopGlobal
packages/shared-services/src/matches/suggestionService.test.ts     # +pickTopGlobal tests
packages/shared-services/src/matches/matchService.ts               # +includeFull pass-through
packages/shared-services/src/matches/matchScoring.ts               # NEW (extracted from useMatchRelevanceScore)
packages/shared-hooks/src/useTopSuggestions.ts                     # NEW
packages/shared-hooks/src/useMatchRelevanceScore.ts                # +useScoreOrderedMatches
packages/shared-hooks/src/useNearbyMatches.ts                      # (unchanged signature)
packages/shared-hooks/src/suggestionFilters.ts                     # NEW (extract doesSuggestionPassFilters)
packages/shared-hooks/src/index.ts                                 # +exports

packages/shared-hooks/src/useJustForYou.ts                         # NEW (wraps composeJustForYou)
packages/shared-services/src/matches/justForYouComposer.ts         # NEW (shared composer)
apps/mobile/src/features/home/components/JustForYouCard.tsx        # NEW
apps/mobile/src/screens/Home.tsx                                   # rebuild Nearby section
apps/mobile/src/features/matches/screens/PublicMatches.tsx         # flat feed, includeFull
apps/mobile/src/components/MatchSuggestionsSheet.tsx               # flat top-15
apps/mobile/src/features/onboarding/components/wizard/OnboardingWizard.tsx  # useTopSuggestions
apps/mobile/src/features/onboarding/components/wizard/steps/SuggestionsStep.tsx  # suggestions[] prop

supabase/functions/send-morning-digest/index.ts                    # per-sport sections via composeJustForYou
supabase/functions/send-morning-digest/template.ts                 # sections[] payload
supabase/functions/_shared/email-translations.ts                   # +sportSection keys

supabase/migrations/<ts>_search_public_matches_include_full.sql    # NEW
supabase/migrations/<ts>_get_top_match_suggestions_rpc.sql         # NEW

packages/shared-translations/src/locales/en-US.json                # +home.justForYou
packages/shared-translations/src/locales/fr-CA.json                # +home.justForYou
```

## Files reusable as-is (no changes)

- `apps/mobile/src/components/SuggestionCard.tsx` — used by sheet, onboarding, and the new JustForYouCard.
- `apps/mobile/src/hooks/useSuggestionInviteHandler.ts` — invite/CTA plumbing carries over.
- `packages/shared-hooks/src/useMatchRelevanceScore.ts::useSortedNearbyMatches` — still used by PublicMatches for chronological+tiebreak ordering.

---

## Verification

Run migrations:

```
npx supabase migration up
```

End-to-end checks (mobile, iOS sim is fine):

1. **Home, signed-out**: title reads "Nearby" / "À proximité". Horizontal carousel of 5 cards. All matches within the existing 7-day default window, no full ones, score-ordered. Test by setting `searchRadiusKm = 50` and creating ≥ 8 future matches at varied scores.
2. **Home, signed-in**: title flips to "Just for you" / "Juste pour vous". When < 5 matches exist in the 7-day window, suggestions pad to exactly 5.
3. **Public Matches**: flat feed (no day headers), full matches now visible (badge clearly says "Full" / spots-left = 0), suggestions appear at the tail when match count < 30 with a single light "Suggestions for you" divider above the first suggestion. Pull-to-refresh works. Filters still apply to suggestions.
4. **Suggestion sheet**: open via FAB. Verify exactly 15 cards max, score-ordered, no day separators. Stagger animation still works.
5. **Onboarding final step**: complete onboarding for a brand-new test user. Verify exactly 5 suggestion cards in score order — no real matches mixed in (this surface is suggestions-only by design).
6. **Daily digest** (preview route — `supabase/functions/email-preview/`):
   - Single-sport user: one section, 5 items. Matches and suggestions both span the next 7 days, score-ordered.
   - Dual-sport user: two sections (per sport), 5 items each, score-ordered within each section.
   - Suggestions correctly pad when matches < 5 in either section.
   - **Parity check** — for one test user, render Home "Just for you" and the digest preview side-by-side; the match list and suggestion list should be identical (both call `composeJustForYou` with the same inputs).

Unit tests:

- `suggestionService.test.ts`: add cases for `pickTopGlobal` (opponent dedup, score order, horizon, maxItems boundary).
- Add a test for `useScoreOrderedMatches` to confirm pure-score ordering vs the existing chronological tiebreak.

Manual SQL sanity:

```sql
-- Confirm RPC param defaults preserve existing behavior
SELECT * FROM search_public_matches(...);                 -- same results as before
SELECT * FROM search_public_matches(..., p_include_full => true);  -- now includes full
-- Strict-future regression check for the new top-suggestions RPC.
-- Insert a synthetic player_availability that overlaps "today 5pm Montreal".
-- At 4pm Montreal (20:00 UTC server time) the slot must still be returned.
-- At 6pm Montreal (22:00 UTC) it must NOT.
SELECT * FROM get_top_match_suggestions(
  p_player_id => '...',
  p_sport_id  => '...',
  p_limit => 10,
  p_caller_tz => 'America/Montreal'
);
```

Production checks post-deploy:

- Watch PostHog event `home_just_for_you_impression` (add in JustForYouCard).
- Daily digest cron at 12:00 UTC: confirm `digest_send_log.feed_size` distribution shifts to ≤10 (was ≤6); per-sport breakdown via `feed_size` doesn't capture sections — extend the log row to include `section_count` if observability matters.
