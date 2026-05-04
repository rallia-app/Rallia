# Player Analytics Feature Plan

> **Status:** Production-ready spec. v3 — verified against the live local schema and the existing Network Pulse implementation. Subscription gating intentionally out of scope; ship the most complete analytics possible to all users.
>
> **Scope:** mobile-first (`apps/mobile`). Web is v2.

## Context

Rallia is a tennis/pickleball app with match creation, set-by-set score tracking, a reputation system, group leaderboards (Network Pulse), and feedback. The app already has rich **group-scoped** analytics in `get_network_pulse` (leaderboards, H2H matrix, rivalries, personal records, form strips, score distribution, set stats, activity heatmap, headline insights). These exist only inside a specific group/community. There is **no personal analytics dashboard** that aggregates across all matches, all groups, and all opponents.

This plan ships that. Every analytics feature is available to every user — no Free/Pro gating in v1.

---

## What data currently exists (verified against live schema)

The plan is built on these tables, **all verified to exist in `supabase/migrations`**:

| Table                 | Relevant fields                                                                                                                                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `match`               | `sport_id`, `match_date`, `start_time`, `end_time`, `format` (`singles`/`doubles`), `player_expectation` (`casual`/`competitive`/`both`), `duration` (`30`/`60`/`90`/`120`/`custom`), `custom_duration_minutes`, `facility_id`, `court_id`, `cancelled_at`, `mutually_cancelled` |
| `match_participant`   | `player_id`, `team_number`, `is_host`, `status`, `match_outcome` (`played`/`mutual_cancel`/`opponent_no_show`), `showed_up`, `was_late`, `star_rating`                                                                                                                           |
| `match_result`        | `winning_team`, `team1_score`, `team2_score`, `is_verified`, `confirmation_deadline`, `disputed`                                                                                                                                                                                 |
| `match_set`           | `set_number`, `team1_score`, `team2_score`                                                                                                                                                                                                                                       |
| `match_feedback`      | `star_rating`, `showed_up`, `was_late`, `comments`                                                                                                                                                                                                                               |
| `player_reputation`   | `reputation_score`, `reputation_tier`, `matches_completed`, `is_public`                                                                                                                                                                                                          |
| `reputation_event`    | `event_type`, `base_impact`, `event_occurred_at`                                                                                                                                                                                                                                 |
| `player_rating_score` | `rating_score_id`, `is_certified`, `badge_status`                                                                                                                                                                                                                                |
| `player_availability` | `day` (`day_enum`), `period` (`period_enum`: `morning`/`afternoon`/`evening`)                                                                                                                                                                                                    |
| `network_member`      | `network_id`, `player_id`, `status`                                                                                                                                                                                                                                              |
| `court`               | `surface_type` (`hard`/`clay`/`grass`/`synthetic`/`carpet`/`concrete`/`asphalt`), `indoor` (boolean)                                                                                                                                                                             |
| `player`              | `privacy_show_stats` (must be respected for opponent stats)                                                                                                                                                                                                                      |

> **Schema corrections applied:**
>
> - `match.player_expectation` values are `casual`/`competitive`/`both`, not "practice".
> - `court.court_type` does not exist — it's `court.indoor` (boolean). "Indoor vs outdoor" comes from this column.
> - `player_availability.day_of_week`/`time_period` do not exist — they're `day` and `period`.
> - Match duration computation must use `COALESCE(custom_duration_minutes, duration::int)`.
> - "Real" played matches must filter on `match_participant.match_outcome = 'played'` AND `match.cancelled_at IS NULL` AND `match.mutually_cancelled IS FALSE`.
> - "Verified" results follow the Pulse RPC convention: `is_verified = true OR confirmation_deadline IS NULL OR now() > confirmation_deadline`. Disputed results (`disputed = true`) MUST be excluded from analytics.

---

## Reuse posture (verified)

The following components already exist at `apps/mobile/src/features/matches/components/leaderboard/` and are designed against `NetworkPulseYourSummary`-shaped props (see `packages/shared-services/src/groups/groupTypes.ts`). They were verified to be **prop-portable** — they take typed data, not a network ID, so swapping the data source from group-pulse to player-pulse needs **no component changes**:

| Component                | Props source                                    | Reuse target               |
| ------------------------ | ----------------------------------------------- | -------------------------- |
| `ActivityHeatmapCard`    | `NetworkPulseHeatmapDay[]`                      | Personal activity heatmap  |
| `ScoreDistributionCard`  | `NetworkPulseScoreDistEntry[]`                  | Play-style fingerprint     |
| `PersonalRecordsCard`    | `NetworkPulsePersonalRecord[]`                  | Personal records list      |
| `SetStatsCard`           | `NetworkPulseSetStats`                          | Set-level stats            |
| `FormStrip` / `FormLine` | `NetworkPulseFormStripEntry[]`                  | Last-5 form strip          |
| `MatchupExtremesCard`    | `NetworkPulseMatchupExtreme`                    | Nemesis / favorite         |
| `RivalryCard`            | `NetworkPulseRivalry`                           | Top rivalry preview        |
| `PowerPairCard`          | `NetworkPulsePowerPair`                         | Best doubles partner       |
| `H2HMatrix`              | `NetworkPulseH2HCell[]` + members               | Cross-group H2H            |
| `ComparisonOverlay`      | full pulse + caller/peer ids                    | Player vs player drilldown |
| `MyStatsCarousel`        | `NetworkPulseYourSummary['stats']` + `daysBack` | Wraps the four cards above |

Reused server type: `NetworkPulseHeadlineInsight` (the `{title_key, title_params, type, primary_player_id?, secondary_player_id?}` shape) is the canonical pattern for `match_insight` (#25) — **the `match_insight` table below is structurally identical so the same renderer works for both**.

Components NOT reused (group-only): `CompeteList`, `LeaderboardRow`, `NewFacesCard`, `UnplayedPairingsCard`, `MomentsList`, `PulseHero`, `YourStoryCard` — they are intrinsically multi-player.

---

## Feature catalogue

All features ship to all users. Numbered for cross-reference; grouped by section.

### A. Personal Performance Dashboard

1. **Match Count Summary** — total / month / week / singles vs doubles.
2. **W/L Record + Win Rate + Current Streak** — overall and within rolling windows.
3. **Reputation Badge** — already on profile; surfaced in stats with "events to next tier" hint computed from `player_reputation.matches_completed` + tier thresholds.
4. **Last 5 Form Strip** — reuses `FormStrip` with personal data.
5. **Monthly Activity Heatmap** — reuses `ActivityHeatmapCard` (GitHub-style).
6. **Total Court Time** — `SUM(COALESCE(custom_duration_minutes, duration::int))` over completed matches; surfaced as "X hours on court this year".
7. **Win Rate Trends Over Time** — rolling 30-day line chart; segmented by `competitive` vs `casual` (and `both` shown as combined).
8. **Set-Level Analytics** — first-set %, third-set %, sets-won %, tiebreak record. Reuses `SetStatsCard`.
9. **Score Distribution / Play-Style Fingerprint** — bar chart of how you tend to win/lose. Reuses `ScoreDistributionCard`.
10. **Personal Records / Milestones** — biggest beat (highest-rated opponent beaten), longest streak, best comeback, most matches in a window. Cross-group lifetime. Reuses `PersonalRecordsCard`.
11. **Reliability Deep Dive** — on-time %, cancellation rate, no-show rate, avg star rating from feedback, trend over time.

### B. Head-to-Head & Opponent Intelligence

12. **H2H Records** — full lifetime record against every opponent. Sortable by most-games / best-record / worst-record / last-played. New table view (no existing component; `H2HMatrix` is for matrix-style, list view is new).
13. **Nemesis & Favorite** — extends `MatchupExtremesCard` to lifetime cross-group scope.
14. **Opponent Scouting** — when viewing another player's profile, show **your H2H against them** + their public stats (gated on `privacy_show_stats`).

### C. Gamification & Achievements

15. **Achievement Badges** — see catalogue below.
16. **XP / Level System** — earn XP for matches, score-logging, feedback, and streak maintenance. Levels with thematic names (`Rally Rookie` → `Court Commander` → `Grand Slam`). Visible progress bar on profile.
17. **Weekly Challenges** — 3 active challenges per week, refresh Sunday 00:00 UTC.

### D. Surface & Venue Performance

18. **Surface / Indoor breakdown** — win-rate by `court.surface_type`, by `court.indoor`. Home-court advantage at most-played `facility_id`. Coverage caveat: only matches with a `court_id` count for surface stats; UI shows the match-count denominator and hides surfaces with <5 matches.

### E. Temporal & Pattern Insights

19. **Best Day/Time Analysis** — when you play most vs when you win most. Bucketed by day-of-week and `period_enum` (morning/afternoon/evening).
20. **Inactivity Impact** — gap-since-previous-match → win-rate correlation. Bucketed: `0–3d`, `4–7d`, `8–14d`, `15+`.
21. **Improvement Trajectory** — `player_rating_score` history + `player_performance_rating` progression. "You've improved X% in the last 3 months". Projected rating if trend continues.
22. **Season Recaps** — monthly and quarterly. "Your Season in Review" card. Total matches, best win, longest streak, new opponents met, total hours on court. Shareable as IG-story image.

### F. Performance Rating Estimation

23. **Estimated Performance Rating** — Glicko-2 algorithm. Compares declared rating vs performance rating ("You're rated 3.5 but performing at 4.0"). Confidence interval shown. Updates after each verified match.
24. **Comeback / Mental Toughness Index** — comeback win % when losing first set, recovery % when down a break in deciding set, "clutch factor" composite. Triggers `Ice Cold` badge at ≥60% comeback rate over 10+ relevant matches.

### G. Post-Match Contextual Insights

25. **Match Insights** — persisted per-match, generated server-side at result-verification time. Renders the same `NetworkPulseHeadlineInsight` shape ("First time you've beaten someone rated above you", "3rd straight win against Marc", "That's your 50th match!"). Aggregated into an "Insights" feed inside `MyStats` and into the existing notifications screen.

### H. Social & Comparative

26. **Rank Among Friends / Networks** — cross-group ranking. "You're #3 across all your groups by win rate (min 10 matches)".
27. **Doubles Partner Analytics** — best/worst partner by win rate together. Reuses `PowerPairCard` shape, lifetime.
28. **Community Comparison** — anonymous percentile rank within zone ("You play more than 80% of players in Montreal"). Built off the existing zone resolution from `derive_zone_from_location`.

---

## Data architecture

### One RPC, one round-trip — `get_player_pulse`

Mirrors the `get_network_pulse` pattern. Single SQL function returns the full personal payload; client renders from one query. Computed server-side because (a) the verified-result filtering rule is non-trivial and lives in SQL today, (b) H2H joins are expensive and shouldn't be re-derived in JS, (c) RLS / `privacy_show_stats` enforcement must be server-side.

```sql
CREATE OR REPLACE FUNCTION public.get_player_pulse(
  p_sport_id    uuid,                 -- required: stats are sport-specific
  p_days_back   int  DEFAULT 90,      -- rolling window for trends/heatmap
  p_lifetime    bool DEFAULT TRUE     -- toggle: lifetime aggregates for records/H2H
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
```

The caller is `auth.uid()`; there is no `p_player_id` argument — players only ever fetch their own pulse via this RPC.

### Response shape (TypeScript)

Lives in a new `packages/shared-services/src/players/playerPulseTypes.ts` so we don't bloat group types. Reuses `NetworkPulse*` types where shapes match.

```ts
import type {
  NetworkPulseHeatmapDay,
  NetworkPulseHeadlineInsight,
  NetworkPulseMatchupExtreme,
  NetworkPulsePersonalRecord,
  NetworkPulseScoreDistEntry,
  NetworkPulseSetStats,
} from '../groups/groupTypes';

export interface PlayerPulse {
  meta: {
    player_id: string;
    sport_id: string;
    days_back: number;
    computed_at: string;
  };

  summary: {
    total_matches: number;
    matches_this_month: number;
    matches_this_week: number;
    singles_count: number;
    doubles_count: number;
    record: { wins: number; losses: number; win_rate_pct: number | null };
    current_streak: { type: 'W' | 'L' | 'none'; length: number };
    last5: ('W' | 'L')[];
    total_court_minutes: number;
    reputation: {
      score: number | null;
      tier: 'unknown' | 'bronze' | 'silver' | 'gold' | 'platinum';
      matches_to_next_tier: number | null;
    };
  };

  trends: {
    win_rate_series: Array<{ date: string; win_rate_pct: number; matches: number }>;
    win_rate_by_expectation: { competitive: number | null; casual: number | null };
    activity_heatmap: NetworkPulseHeatmapDay[];
  };

  set_play: {
    set_stats: NetworkPulseSetStats;
    score_distribution: NetworkPulseScoreDistEntry[];
    comeback_index: {
      first_set_lost_then_won_pct: number | null;
      tiebreak_win_pct: number | null;
      clutch_score: number | null; // composite, 0–100
    };
  };

  records: {
    personal_records: NetworkPulsePersonalRecord[];
    longest_win_streak: { length: number; ended_at: string | null };
    longest_loss_streak: { length: number; ended_at: string | null };
  };

  reliability: {
    // All metrics are about the CALLER's behavior, computed from how OTHER participants
    // logged the caller. See "Reliability metrics — data sources" below for exact rules.
    on_time_pct: number | null; // 100 - was_late% from match_feedback rows where opponent_id = caller
    on_time_denominator: number; // count of feedback rows considered
    cancellation_rate_pct: number | null; // caller's status='cancelled' over total participations
    cancellation_denominator: number;
    no_show_rate_pct: number | null; // count of OTHER participants' match_outcome='opponent_no_show' against caller
    no_show_denominator: number;
    avg_star_rating: number | null; // avg of match_feedback.star_rating where opponent_id = caller
    star_rating_count: number;
  };

  opponents: {
    h2h: Array<{
      opponent_id: string;
      opponent_first_name: string;
      opponent_last_name: string | null;
      opponent_avatar_url: string | null;
      wins: number;
      losses: number;
      last_played_at: string;
    }>;
    matchup_extremes: {
      favorite: NetworkPulseMatchupExtreme | null;
      nemesis: NetworkPulseMatchupExtreme | null;
    };
  };

  venue: {
    surface_breakdown: Array<{ surface: string; matches: number; wins: number }>;
    indoor_outdoor: {
      indoor: { matches: number; wins: number };
      outdoor: { matches: number; wins: number };
    };
    home_facility: {
      facility_id: string;
      name: string;
      matches: number;
      wins: number;
      win_rate_pct: number;
      vs_elsewhere_win_rate_pct: number | null;
    } | null;
  };

  temporal: {
    by_dow: Array<{ dow: number; matches: number; wins: number }>;
    by_period: Array<{
      period: 'morning' | 'afternoon' | 'evening';
      matches: number;
      wins: number;
    }>;
    inactivity_impact: Array<{
      gap_bucket: '0-3d' | '4-7d' | '8-14d' | '15+';
      matches: number;
      wins: number;
    }>;
  };

  doubles_partners: Array<{
    partner_id: string;
    partner_first_name: string;
    matches: number;
    wins: number;
    win_rate_pct: number;
  }>;

  performance_rating: {
    rating: number;
    rating_deviation: number;
    confidence_pct: number; // 0–100
    estimated_level: number | null; // mapped to NTRP/DUPR if possible
    matches_counted: number;
    delta_30d: number | null; // change vs 30d ago
    is_confident: boolean; // matches_counted >= 5 && confidence_pct >= 30
  } | null;
  // Nullability rule: null when matches_counted = 0 (no row yet OR row exists but never participated).
  // Once matches_counted >= 1, the object is returned with is_confident driving UI display.

  social: {
    cross_group_rank: { rank: number; total: number; networks_counted: number } | null;
    zone_percentile: { percentile: number; zone: string } | null;
  };

  headline_insight: NetworkPulseHeadlineInsight | null;

  // Recent unread match_insight rows for the in-screen "Insights" feed.
  // Returned by the same RPC so the dashboard renders from a single round-trip.
  recent_insights: Array<{
    id: string;
    match_id: string;
    insight_type:
      | 'milestone'
      | 'streak'
      | 'first_beat'
      | 'h2h_record'
      | 'personal_best'
      | 'comeback'
      | 'level_up'
      | 'achievement_unlocked';
    title_key: string;
    title_params: Record<string, string | number>;
    is_read: boolean;
    created_at: string;
  }>; // capped at 10 most recent
}
```

### A second RPC for opponent scouting — `get_player_public_stats`

Strict subset of `get_player_pulse`, only what's allowed for **another** player. Marked `SECURITY DEFINER` so it can read across RLS-protected tables, while enforcing privacy in the function body:

```sql
CREATE OR REPLACE FUNCTION public.get_player_public_stats(
  p_player_id uuid,
  p_sport_id  uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
```

Response shape:

```ts
export interface PlayerPublicStats {
  public: boolean; // false if privacy_show_stats = false; client renders private state
  player_id: string;
  sport_id: string;
  summary?: {
    // present iff public = true
    total_matches: number;
    record: { wins: number; losses: number; win_rate_pct: number | null };
    last5: ('W' | 'L')[];
    reputation: { tier: string; score: number | null };
  };
  performance_rating?: {
    // present iff public = true AND is_confident = true
    rating: number;
    confidence_pct: number;
    estimated_level: number | null;
  };
  // ALWAYS returned — caller's own H2H against the target is the caller's data, not the target's.
  caller_h2h: {
    wins: number;
    losses: number;
    last_played_at: string | null;
    last5: ('W' | 'L')[];
  };
}
```

- Always returns `caller_h2h` (caller's own data; not subject to target's privacy).
- `summary` and `performance_rating` only returned when target's `privacy_show_stats = true`.
- NEVER returns: target's nemesis/favorite, partner stats, surface breakdowns, achievements, XP/level, performance rating below `is_confident` threshold, full opponent list, or activity heatmap.

### Caching

- **Server:** `get_player_pulse` is read-only and idempotent. Heatmap is the dominant cost; benchmark first, add `runtime_cache` only if needed (current group pulse runs fine without).
- **Client:** `useQuery` with `staleTime: 5 * 60_000` (5 min) and `gcTime: 30 * 60_000`. Invalidate on:
  - Match-result confirmation (server upserts `match_insight`; client invalidates the player-pulse query key).
  - Achievement unlock notification.
  - Sport switch via `useSport` context.

### Filtering rules (canonical — must match Pulse semantics)

A match is **eligible** when ALL of:

```sql
match.cancelled_at IS NULL
AND match.mutually_cancelled IS FALSE
AND match.sport_id = p_sport_id
AND mp.player_id  = caller_id
AND mp.match_outcome = 'played'
AND EXISTS match_result mr
AND mr.disputed IS NOT TRUE
AND (mr.is_verified IS TRUE
     OR mr.confirmation_deadline IS NULL
     OR now() > mr.confirmation_deadline)
```

Window-bound features further restrict to `match_date >= (current_date - p_days_back)`. Lifetime features (records, H2H, performance rating) ignore the window when `p_lifetime = true`.

### Reliability metrics — data sources

The `match_outcome_enum` is `played / mutual_cancel / opponent_no_show` — there is no `self_no_show` value, because each participant's row records that participant's outcome from their own perspective. So the caller's reliability metrics are derived from **what OTHER participants reported about the caller**:

| Metric                  | Source                                                | Computation                                                                                                                                    |
| ----------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `on_time_pct`           | `match_feedback` where `opponent_id = caller_id`      | `100 * (1 - count(was_late=true) / count(*))`                                                                                                  |
| `cancellation_rate_pct` | `match_participant` where `player_id = caller_id`     | `100 * count(status='cancelled') / count(*)` over total participations in non-`played` matches                                                 |
| `no_show_rate_pct`      | other participants' `match_participant.match_outcome` | `100 * count(opponent_no_show against caller) / count(eligible matches caller was in)`. "Other participants reported the caller as a no-show." |
| `avg_star_rating`       | `match_feedback` where `opponent_id = caller_id`      | `avg(star_rating)`                                                                                                                             |
| `star_rating_count`     | same                                                  | `count(*)`                                                                                                                                     |

UI rule: any metric whose denominator is below 5 is rendered as "—" with a "{n} {ratings/matches} so far" footnote, **not** as 0% / 100%. This prevents misleading reliability scores for new users.

### Timezone handling

`match.match_date` is a `date` and `match.timezone` is a text column carrying the IANA zone of the match. The RPC computes "this week / this month" buckets in **the player's home timezone**, derived from `player.location` → `derive_zone_from_location()` (already implemented), with a fallback to `'America/Toronto'` when unresolvable.

Concretely the RPC accepts an optional override:

```sql
get_player_pulse(p_sport_id, p_days_back, p_lifetime, p_timezone text DEFAULT NULL)
```

If `p_timezone` is NULL, the RPC reads `player.timezone` (to be added — currently inferred from `player.location` via the existing zone helper). Window cutoffs use `(now() AT TIME ZONE coalesce(p_timezone, 'America/Toronto'))::date`. The activity heatmap groups by `(match_date AT TIME ZONE match.timezone)::date` so a 11pm Saturday match in Vancouver shows as Saturday for a Vancouver player and Sunday for a Toronto player viewing across.

---

## Performance rating algorithm — committed: **Glicko-2**

We commit to **Glicko-2** (not ELO). Reasons:

- Returns a confidence interval (`rating_deviation`) — visible to users as "confidence %".
- Models inactivity decay via volatility.
- Multiple open-source implementations exist.

**Implementation:**

- Stored in `player_performance_rating` (one row per `(player_id, sport_id)`).
- Updated **inside the single `compute-match-insights` Edge Function** (see "Triggers & cron" below). There is no separate `update-performance-rating` function — Glicko-2 runs as one step inside the unified post-match pipeline so insights, ratings, achievements, XP, and notifications stay transactionally coherent.
- Per-match step:
  1. Read each participant's current rating row (initialize at 1500/350/0.06 if missing).
  2. For each participant: run one Glicko-2 step against each opponent. In doubles, the opponent rating used is the **average** of the two opponents (documented Glicko adaptation; documented in code comments).
  3. Write back updated `rating`, `rating_deviation`, `volatility`, `confidence_pct = clamp(round(100 - (rating_deviation / 3.5)), 0, 100)`, `estimated_level` (mapped to NTRP/DUPR via the `rating_score` table), `matches_counted` += 1, `last_match_id`.
  4. If the new `estimated_level` crosses a half-step threshold (e.g. 3.5 → 4.0), emit a `level_up` `match_insight` row.

**Score margin:** Glicko-2 treats outcomes as binary (win/loss). Score margin is intentionally ignored — a 6-0 6-0 win and a 7-6 7-6 win move the rating identically. This is deliberate (margin-aware variants exist but invite gaming).

**Cold-start:** `is_confident = matches_counted >= 5 AND confidence_pct >= 30`. Below threshold, UI shows the rating but with a "still learning your level" badge plus the number of matches needed.

**Inactivity decay:** Glicko-2 volatility ramps `rating_deviation` upward with time. We apply this lazily on each match step (no nightly cron), so a player returning after 6 months will see a one-time RD bump on their next match. Acceptable.

---

## New database tables

```sql
-- =============================================================================
-- 1. ACHIEVEMENTS
-- =============================================================================

CREATE TABLE achievement (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text UNIQUE NOT NULL,
  category        text NOT NULL CHECK (category IN ('milestone','streak','social','skill','reliability','venue','partner')),
  -- i18n: client renders title_key/desc_key with title_params from definition.
  title_key       text NOT NULL,        -- e.g. 'myStats.achievements.first_win.title'
  description_key text NOT NULL,        -- e.g. 'myStats.achievements.first_win.desc'
  icon_name       text NOT NULL,        -- Ionicons name
  threshold_value int,                  -- generic numeric threshold (matches, streak, etc.)
  threshold_meta  jsonb DEFAULT '{}',   -- e.g. {"min_matches": 10, "win_rate_pct": 60}
  display_order   int  NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE player_achievement (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  achievement_id uuid NOT NULL REFERENCES achievement(id) ON DELETE CASCADE,
  sport_id       uuid REFERENCES sport(id) ON DELETE CASCADE, -- nullable: some are global, most sport-scoped
  unlocked_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, achievement_id, sport_id)
);
CREATE INDEX idx_player_achievement_player      ON player_achievement(player_id);
CREATE INDEX idx_player_achievement_unlocked_at ON player_achievement(unlocked_at DESC);

-- RLS: players see their own + everyone's are publicly browsable (achievement catalogue is non-sensitive)
ALTER TABLE player_achievement ENABLE ROW LEVEL SECURITY;
CREATE POLICY player_achievement_self_read ON player_achievement
  FOR SELECT TO authenticated USING (true);

-- =============================================================================
-- 2. WEEKLY CHALLENGES
-- =============================================================================

CREATE TABLE challenge (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL,
  category        text NOT NULL CHECK (category IN ('volume','variety','skill','social','reliability')),
  title_key       text NOT NULL,
  description_key text NOT NULL,
  target_value    int NOT NULL,
  xp_reward       int NOT NULL DEFAULT 50,
  active_from     date NOT NULL,
  active_until    date NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_challenge_active_window ON challenge(active_from, active_until);

CREATE TABLE player_challenge_progress (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  challenge_id  uuid NOT NULL REFERENCES challenge(id) ON DELETE CASCADE,
  current_value int  NOT NULL DEFAULT 0,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, challenge_id)
);
CREATE INDEX idx_pcp_player_completed ON player_challenge_progress(player_id, completed_at);

-- =============================================================================
-- 3. XP / LEVEL — additive on player
-- =============================================================================

ALTER TABLE player ADD COLUMN xp_total int NOT NULL DEFAULT 0;
ALTER TABLE player ADD COLUMN level    int NOT NULL DEFAULT 1;

CREATE TABLE player_level (
  level        int PRIMARY KEY,
  xp_required  int NOT NULL,
  name_key     text NOT NULL,        -- e.g. 'myStats.levels.rally_rookie'
  icon_name    text
);

-- =============================================================================
-- 4. PERFORMANCE RATING (Glicko-2)
-- =============================================================================

CREATE TABLE player_performance_rating (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id         uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  sport_id          uuid NOT NULL REFERENCES sport(id) ON DELETE CASCADE,
  rating            decimal(7,2) NOT NULL DEFAULT 1500,
  rating_deviation  decimal(6,2) NOT NULL DEFAULT 350,
  volatility        decimal(8,6) NOT NULL DEFAULT 0.06,
  estimated_level   decimal(3,1),                                   -- NTRP/DUPR-mapped
  confidence_pct    int NOT NULL DEFAULT 0 CHECK (confidence_pct BETWEEN 0 AND 100),
  matches_counted   int NOT NULL DEFAULT 0,
  last_match_id     uuid REFERENCES match(id) ON DELETE SET NULL,
  calculated_at     timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, sport_id)
);
CREATE INDEX idx_ppr_player ON player_performance_rating(player_id);

-- RLS: a player's performance rating is public iff player.privacy_show_stats = true.
ALTER TABLE player_performance_rating ENABLE ROW LEVEL SECURITY;
CREATE POLICY ppr_self_read ON player_performance_rating
  FOR SELECT TO authenticated USING (
    player_id = auth.uid()
    OR EXISTS (SELECT 1 FROM player p WHERE p.id = player_id AND p.privacy_show_stats = true)
  );

-- =============================================================================
-- 5. MATCH INSIGHTS (post-match contextual log)
-- =============================================================================

CREATE TABLE match_insight (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id      uuid NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  player_id     uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  insight_type  text NOT NULL CHECK (insight_type IN (
    'milestone',         -- "your 50th match"
    'streak',            -- "3rd straight win against Marc"
    'first_beat',        -- "first time you've beaten someone rated above you"
    'h2h_record',        -- "you now lead Marc 5-3"
    'personal_best',     -- "longest winning streak: 6"
    'comeback',          -- "won after losing the first set"
    'level_up',          -- estimated rating crossed a level threshold
    'achievement_unlocked'
  )),
  -- mirrors NetworkPulseHeadlineInsight shape so the same renderer works
  title_key     text NOT NULL,
  title_params  jsonb NOT NULL DEFAULT '{}',
  is_read       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, player_id, insight_type)
);
CREATE INDEX idx_match_insight_player_unread ON match_insight(player_id, is_read, created_at DESC);

ALTER TABLE match_insight ENABLE ROW LEVEL SECURITY;
CREATE POLICY match_insight_self ON match_insight
  FOR SELECT TO authenticated USING (player_id = auth.uid());

-- =============================================================================
-- 6. CHALLENGE TEMPLATES (rotation pool for the weekly cron)
-- =============================================================================

CREATE TABLE challenge_template (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text UNIQUE NOT NULL,
  category        text NOT NULL CHECK (category IN ('volume','variety','skill','social','reliability')),
  title_key       text NOT NULL,
  description_key text NOT NULL,
  target_value    int  NOT NULL,
  xp_reward       int  NOT NULL DEFAULT 50,
  -- Filter rules consumed by compute-match-insights to advance progress.
  -- Examples: {"requires_format":"singles"}, {"requires_period":"morning"},
  --           {"requires_tiebreak":true}, {"requires_new_opponent":true}.
  match_filter    jsonb NOT NULL DEFAULT '{}',
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_challenge_template_active ON challenge_template(is_active);

-- =============================================================================
-- 7. ANALYTICS BACKFILL STATE (single-row coordinator for chunked replays)
-- =============================================================================

CREATE TABLE analytics_backfill_state (
  job_name       text PRIMARY KEY,             -- e.g. 'performance_rating', 'match_insights', 'achievements', 'xp'
  status         text NOT NULL CHECK (status IN ('pending','running','completed','failed')) DEFAULT 'pending',
  cursor_value   text,                          -- last-processed match_id or composite cursor
  rows_processed int  NOT NULL DEFAULT 0,
  rows_total     int,                           -- best-effort estimate
  last_error     text,
  started_at     timestamptz,
  finished_at    timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
```

### Match insight `title_key` / `title_params` catalogue

Every insight type has a deterministic `title_key` and parameter schema. The Edge Function emits these; the renderer (shared with `NetworkPulseHeadlineInsight`) interpolates them through `t(title_key, title_params)`.

| `insight_type`            | `title_key`                                                                         | `title_params`                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `milestone`               | `myStats.insights.milestone`                                                        | `{ count: number }` — e.g. "🏆 That's your 50th match!"                                                          |
| `streak`                  | `myStats.insights.streak`                                                           | `{ count: number, opponent?: string }` — "🔥 3rd straight win against Marc" or generic "🔥 4 wins in a row"      |
| `first_beat`              | `myStats.insights.first_beat`                                                       | `{ opponent: string }` — "🎯 First time beating Marc"                                                            |
| `first_beat_higher_rated` | `myStats.insights.first_beat_higher_rated`                                          | `{ opponent: string, opponent_rating: string }` — "🎯 First win over a 4.0-rated player"                         |
| `h2h_record`              | `myStats.insights.h2h_record`                                                       | `{ opponent: string, wins: number, losses: number }` — "📊 You now lead Marc 5-3"                                |
| `personal_best`           | `myStats.insights.personal_best.win_streak` / `loss_streak_broken` / `most_in_week` | varies — "🏅 Longest win streak: 6"                                                                              |
| `comeback`                | `myStats.insights.comeback`                                                         | `{ opponent: string }` — "🌅 Comeback win against Sarah"                                                         |
| `level_up`                | `myStats.insights.level_up_rating`                                                  | `{ from_level: string, to_level: string }` — "⬆️ Performance level: 3.5 → 4.0"                                   |
| `achievement_unlocked`    | `myStats.insights.achievement_unlocked`                                             | `{ achievement_slug: string, achievement_title_key: string }` — renderer reads the achievement's own `title_key` |

The renderer is a single component `MatchInsightRow` at `apps/mobile/src/features/myStats/components/MatchInsightRow.tsx` that switches on `insight_type` for the lead emoji/icon and applies `t(title_key, title_params)` for the body. It's shared between the in-screen insights feed, the Notifications screen, and the post-match success screen.

### `notification_type_enum` additions

Each `ALTER TYPE ... ADD VALUE` must be in a **separate, non-transactional migration** per Postgres's requirement — split into 5 migrations:

```sql
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'achievement_unlocked';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'level_up';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'challenge_completed';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'season_recap_ready';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'match_insight_ready';
```

### Triggers & cron

| Event                                                                  | Mechanism                                                    | Action                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `match_result.is_verified` flips to `true`                             | Postgres `AFTER UPDATE` trigger                              | Invokes the `compute-match-insights` Edge Function via `pg_net`, passing `match_id`                                                                                                                                                                                                                       |
| Match passes its `confirmation_deadline` without explicit verification | **Sweeper cron only** (no DB event fires when "time passes") | The `pg_cron` sweeper below catches these                                                                                                                                                                                                                                                                 |
| `compute-match-insights` runs                                          | Edge Function — see ordering below                           | One unified pipeline per match                                                                                                                                                                                                                                                                            |
| Sweeper — every 15 min                                                 | `pg_cron`                                                    | Find verified-or-deadline-passed matches with `verified_at < now() - interval '1 hour'` AND missing **either** a `match_insight` row OR a `player_performance_rating.last_match_id` advance for any participant. Re-invoke `compute-match-insights`. The Edge Function is idempotent so re-runs are safe. |
| Weekly Sunday 00:00 UTC                                                | `pg_cron`                                                    | Pick 3 active templates from `challenge_template`, insert into `challenge` with `active_from = today`, `active_until = today + 7 days`, soft-delete previous week's expired challenges                                                                                                                    |
| Monthly 1st of month 06:00 UTC                                         | `pg_cron`                                                    | Invoke `render-season-recap` Edge Function for each active player; push `season_recap_ready` notification                                                                                                                                                                                                 |

`pg_cron` is already used (`morning_digest`); Edge Functions are already used (`revenuecat-webhook`, `welcome_email`). No new infra.

#### `compute-match-insights` order of operations (canonical)

The order matters because later steps depend on earlier ones. Implementation MUST follow this exact sequence inside a single Edge Function invocation (idempotent on retry):

For the `match_id` passed in:

1. **Load match context** — match row, participants, sets, results, prior `match_insight` rows for early-exit if already complete.
2. **For each participant in the match, in parallel:**
   1. **Compute non-derived insights** — `milestone` (Nth match), `streak` (current run), `first_beat` (vs higher-rated opponent), `h2h_record` (new lead vs opponent), `personal_best` (longest streak hit), `comeback` (won after losing first set). Upsert with `INSERT ... ON CONFLICT (match_id, player_id, insight_type) DO NOTHING`.
   2. **Run Glicko-2 update** — per algorithm above. Updates `player_performance_rating`. Emit `level_up` `match_insight` row if half-step threshold crossed.
   3. **Evaluate achievements** — run achievement evaluator (lifetime stats query). For each new unlock: `INSERT INTO player_achievement` + `INSERT INTO match_insight (insight_type='achievement_unlocked')`. Sport-scoped achievements use this match's `sport_id`.
   4. **Award XP** — base 50 XP for verified match + bonus XP for: new opponent (+20), score logger (+10), feedback submitter (+10), 7-day streak maintained (+30), achievements unlocked in step 2.3 (sum of their `xp_reward`), challenges completed (next step). Update `player.xp_total`.
   5. **Recompute level** — derived from `xp_total` against `player_level` thresholds. If level increased, update `player.level` and emit a level-up notification (the rating-based `level_up` insight from step 2.2 is distinct: that's the _rating tier_, this is the _XP level_).
   6. **Advance challenge progress** — for each currently-active row in `player_challenge_progress`, check this match against `challenge_template.match_filter`. Increment `current_value`; if reached `target_value`, set `completed_at = now()` and award `xp_reward` (re-loops back to step 2.4 internally so XP is consistent — but bounded to one XP recompute per match per challenge).
3. **Batch notifications per participant** — collect all events from steps 2.1–2.6 into a single push: "You finished a match — see what you achieved →". Deep-link target: `MyStats` insights section. Multiple insights/unlocks in one match = one push.

Rationale: rating must update before achievements (so `giant_killer` knows the latest), achievements must update before XP (so unlock XP is awarded in the same step), XP before level (level is derived from total), challenges last (some can only be evaluated once the match's full event vector is known).

### Backfill strategy

On migration deploy:

1. Backfill `player_performance_rating` by replaying historical matches in chronological order (Edge Function batch job, run once). Checkpoints in a `analytics_backfill_state` row so it's restartable.
2. Backfill `match_insight` for the **last 30 days only** — older matches get no insights, since the value is in "you just hit a milestone".
3. Backfill `player_achievement` by running the achievement evaluator over each player's lifetime stats once.
4. XP backfill: award retroactive XP for completed matches at the standard rate, capped at level 5 to leave room for engagement.

A migration file (`20260504_xxxx_player_analytics_backfill.sql`) calls the Edge Function via `pg_net` after the schema migrations land.

---

## Achievement catalogue (v1 — seeded)

`Scope` column: **per-sport** = `player_achievement.sport_id` is set; one row per sport unlocked (a tennis `streak_5` and a pickleball `streak_5` are independent unlocks). **Global** = `sport_id IS NULL`; one row per player.

| Slug                                                                  | Category    | Scope     | Threshold                                                                  |
| --------------------------------------------------------------------- | ----------- | --------- | -------------------------------------------------------------------------- |
| `first_win`                                                           | milestone   | per-sport | 1 win                                                                      |
| `streak_5`                                                            | streak      | per-sport | 5 wins in a row                                                            |
| `streak_10`                                                           | streak      | per-sport | 10 wins in a row                                                           |
| `clutch_player`                                                       | skill       | per-sport | ≥60% 3rd-set win rate over ≥10 matches                                     |
| `marathon_50`                                                         | milestone   | per-sport | 50 matches played                                                          |
| `marathon_100`                                                        | milestone   | per-sport | 100 matches played                                                         |
| `marathon_250`                                                        | milestone   | per-sport | 250 matches played                                                         |
| `five_star_player`                                                    | reliability | global    | avg star rating ≥4.8 over ≥10 ratings (cross-sport — reputation is global) |
| `social_butterfly`                                                    | social      | global    | 20 unique opponents (cross-sport)                                          |
| `globe_trotter`                                                       | venue       | global    | 10 distinct facilities (cross-sport)                                       |
| `consistency_king`                                                    | reliability | global    | played every week for 4 consecutive weeks (any sport)                      |
| `singles_specialist`                                                  | skill       | per-sport | ≥80% of matches in singles, ≥20 matches                                    |
| `doubles_specialist`                                                  | skill       | per-sport | ≥80% of matches in doubles, ≥20 matches                                    |
| `giant_killer`                                                        | skill       | per-sport | beat someone with declared rating ≥0.5 above yours                         |
| `ice_cold`                                                            | skill       | per-sport | ≥60% comeback rate over ≥10 first-set-loss matches                         |
| `platinum_rep`                                                        | reliability | global    | reach platinum reputation tier (reputation is global)                      |
| `surface_master_hard` / `_clay` / `_grass` / `_synthetic` / `_carpet` | venue       | per-sport | 20 matches on a single surface                                             |
| `home_court_hero`                                                     | venue       | per-sport | ≥70% win rate at most-played facility, ≥15 matches                         |
| `partner_chemistry`                                                   | partner     | per-sport | ≥75% win rate with same doubles partner over ≥10 matches                   |

The achievement-grid UI **filters by the currently-selected sport** for per-sport achievements (so toggling sports flips a tennis-only badge between unlocked/locked) and always shows global achievements with their unlocked state. The grid header indicates the filter (e.g. "TENNIS · 9 OF 14" + "GLOBAL · 3 OF 5").

All seeded via a new `seed_achievements.sql` chained from the migration.

---

## XP economy (v1)

**Scope decision: XP and level are GLOBAL across sports.** A tennis match and a pickleball match both feed the same `player.xp_total`. Rationale: levels are a meta-engagement loop ("how active are you on Rallia overall"), not a skill measure. Per-sport skill is captured separately by `player_performance_rating` and per-sport achievements.

| Action                                      | XP                                                |
| ------------------------------------------- | ------------------------------------------------- |
| Match completed (verified)                  | 50                                                |
| Played a brand-new opponent                 | +20                                               |
| Logged the score yourself (first to submit) | +10                                               |
| Submitted feedback for an opponent          | +10                                               |
| Maintained a 7-day playing streak           | +30 (one-time per streak; resets on 7+ idle days) |
| Achievement unlocked                        | varies (10–500) — see seed file                   |
| Weekly challenge completed                  | `challenge.xp_reward`                             |

Levels 1–10 calibrated so a regular player (~3 matches/week) reaches level ~7 in 6 months. Tunable in `player_level` table.

> Disambiguation: the term "level" is used in two places — (a) **player level** (XP-driven, global, in `player.level`) and (b) **estimated rating level** (Glicko-2-driven, per-sport, in `player_performance_rating.estimated_level`). The `level_up` `match_insight` type fires on (b) — rating-tier crossings — not (a). XP-level changes are surfaced via the `level_up` notification but no `match_insight` row (since it's not a _match_ phenomenon, it's an XP threshold).

---

## Weekly challenge rotation (v1 templates)

A `challenge_template` table stores templates the cron rotates through:

| Slug                | Target                                | XP  |
| ------------------- | ------------------------------------- | --- |
| `play_3_this_week`  | 3 matches in week                     | 100 |
| `win_2_tiebreaks`   | 2 tiebreak wins                       | 100 |
| `play_new_opponent` | 1 match vs someone you haven't played | 75  |
| `play_new_facility` | 1 match at a new facility             | 75  |
| `5_star_week`       | get a 5-star feedback                 | 50  |
| `comeback_kid`      | win 1 match after losing first set    | 100 |
| `singles_focus`     | play 2 singles matches                | 75  |
| `doubles_focus`     | play 2 doubles matches                | 75  |
| `morning_grinder`   | play a morning match                  | 50  |
| `evening_warrior`   | play an evening match                 | 50  |

The Sunday cron picks 3 templates that are not currently active and inserts them with `active_from = today`, `active_until = today + 7 days`.

---

## UX & navigation

### Where it lives in the mobile app

The app currently has **5 bottom tabs**: Home, Courts, Actions (sheet trigger), Community, Chat. Adding a 6th tab is poor UX. Three accepted placements:

**Plan A (committed):** "My Stats" lives **inside `UserProfile`** as a top-of-screen pinned section (above sport cards) AND has a deep-link entry from the Home screen via a "Your week in stats →" hero card. A new dedicated screen `MyStats` is pushed from `UserProfile` for the full dashboard. No tab bar change.

**Plan B (alt):** Replace the `Actions` center button with a "Stats" tab and move the Actions sheet to a Home-screen FAB. Higher effort, more disruption.

**Plan C (alt):** Add a 6th tab. Rejected — bar gets cramped.

### `MyStats` screen layout

A vertically-scrolling `ScrollView` (matching `UserProfile`'s `SafeAreaView` + `ScrollView` shell exactly — see "Visual style & design system adherence" below). Every numbered block below is **one `section`** (the `View style={styles.section}` pattern from `UserProfile`) with an uppercase muted-grey `sectionTitle` header and a `radiusPixels.xl` rounded card body. Inside cards we mix `compactRow`, `verticalField`, and `horizontalFieldsContainer` patterns from `UserProfile` — no new layouts.

| #   | Section title (uppercase)       | Inside the card                                                                             | Reused component / pattern                                                                  |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 0   | (sticky header — not a section) | Sport selector chip + period toggle (`30d` / `90d` / `Lifetime`)                            | Same chip pattern as `activeBadge` in `UserProfile`                                         |
| 1   | THIS PERIOD                     | W/L pill, win-rate %, current streak chip, `last5` dots, total court time, reputation badge | `compactRow` for K/V pairs; `RatingBadge`/`ReputationBadge` already imported                |
| 2   | INSIGHTS · {count} NEW          | Vertical list of last 5 unread `match_insight` rows                                         | Reuses the `NetworkPulseHeadlineInsight` renderer pattern; `verticalField` per row          |
| 3   | TRENDS                          | Win-rate line chart + monthly heatmap                                                       | New chart component (Victory Native or Skia); `ActivityHeatmapCard` for the heatmap         |
| 4   | SET & SCORE PLAY                | Horizontal `ScrollView` of stat tiles                                                       | `SetStatsCard` + `ScoreDistributionCard` + new ComebackIndexCard, all wrapped in `StatCard` |
| 5   | RECORDS                         | Tile carousel                                                                               | `PersonalRecordsCard` (already exists)                                                      |
| 6   | RELIABILITY                     | 4-stat grid + tiny sparkline                                                                | `horizontalFieldsContainer` → 2×2 grid; sparkline tile                                      |
| 7   | OPPONENTS                       | `MatchupExtremesCard` + top-10 H2H list                                                     | Existing `MatchupExtremesCard`; H2H rows are `compactRow`s with avatar                      |
| 8   | WHERE YOU PLAY                  | Surface chips + indoor/outdoor split + home-facility block                                  | Surface chips reuse `activeBadge` style; home-facility uses `verticalField`                 |
| 9   | WHEN YOU PLAY                   | DOW × period mini heatmap + inactivity bar chart                                            | New components, but tile dimensions match `StatCard`                                        |
| 10  | DOUBLES PARTNERS                | `PowerPairCard`-style top 3 list                                                            | Existing `PowerPairCard`                                                                    |
| 11  | PERFORMANCE RATING              | Big number + confidence bar + delta chip + "playing at X" copy                              | `verticalField` for the copy; confidence bar is a styled `View` with `colors.primary` fill  |
| 12  | ACHIEVEMENTS · {n} OF {total}   | Grid (3 per row) of unlocked tiles first, locked greyed; "Show all →" footer                | Each tile = `StatCard` variant (`radiusPixels.lg`, hairline border)                         |
| 13  | ACTIVE CHALLENGES               | 3 vertical cards with progress bar                                                          | Section card body; bar = styled `View` with `colors.primary`                                |
| 14  | LEVEL · {level title}           | Level name + XP bar + "{n} XP to next level"                                                | `verticalField` + bar                                                                       |
| 15  | YOUR RANK                       | Cross-group rank + zone percentile                                                          | `compactRow` pair                                                                           |

Empty states **per section** use the `noDataText` italic-muted-centred pattern. The sport-toggle and period-toggle in the sticky header reuse the active/inactive pill pattern from the sport cards on `UserProfile` (`activeBadge` + `inactiveBadge` styles) so the visual language is consistent.

Bottom of screen: `<View style={{ height: 40 }} />` — same spacer as `UserProfile`.

### Screen-level empty state (zero matches)

When `summary.total_matches === 0`, **none of the sections above render**. Instead the entire scrollable area is replaced with a single hero block (still inside the standard `SafeAreaView` shell so the navigation header stays consistent):

```
┌─────────────────────────────────────────────┐
│              📊                             │
│       Your stats start here                 │
│                                             │
│   Play and log your first match to start    │
│   tracking your game.                       │
│                                             │
│   [  Find a match  ]                        │
│   [  Log a past match  ]                    │
└─────────────────────────────────────────────┘
```

Implementation: a new `MyStatsEmptyState.tsx` component at `apps/mobile/src/features/myStats/components/`. Uses `Ionicons name="stats-chart-outline"` size 56 `colors.textMuted`, `Text size="xl" weight="bold"` for the headline, two `Button` components (primary + secondary) wired to `Actions` sheet (`new-match`) and `add-played-match` sheet respectively.

Once the player has ≥1 match, the dashboard renders sections normally; sections with insufficient data hide individually using `noDataText` rather than appearing empty.

### Sport-toggle visibility

If the player has only one active sport (`useSport().userSports.length === 1`), the sport toggle in the sticky header is hidden and the period toggle expands to fill its space. When a player activates a second sport (via `SportProfile`), the toggle appears on next render.

### i18n namespace

The existing top-level `analytics` namespace is for **organization-admin analytics** (court utilization, revenue, bookings). It is NOT for player analytics. Add a new top-level namespace:

```json
{
  "myStats": {
    "title": "My Stats",
    "header": { "sport": "Sport", "period": { "30d": "30 days", "90d": "90 days", "lifetime": "Lifetime" } },
    "summary": { ... },
    "trends": { ... },
    "setPlay": { ... },
    "records": { ... },
    "reliability": { ... },
    "opponents": { ... },
    "venue": { ... },
    "temporal": { ... },
    "doublesPartners": { ... },
    "performanceRating": { ... },
    "achievements": { ... },
    "challenges": { ... },
    "levels": { ... },
    "social": { ... },
    "insights": { ... }
  }
}
```

Both `en-US.json` and `fr-CA.json` get the new keys.

> **Reuse policy for existing leaderboard cards' i18n keys:** the reused components (`SetStatsCard`, `ScoreDistributionCard`, `PersonalRecordsCard`, `ActivityHeatmapCard`, `MatchupExtremesCard`, etc.) already reference keys under `groups.leaderboard.myStats.*`. We **do not rename them** — they keep working exactly as today inside the group leaderboard. The new `myStats.*` namespace is for new analytics-only components (`MyStatsEmptyState`, `MatchInsightRow`, performance-rating block, achievement grid, etc.). Long-term, we may consolidate; that's a follow-up tech-debt task, not a launch blocker.

### Notification table integration

All new analytics events flow through the existing `notification` table. Each notification carries:

| Field                    | Value                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `user_id`                | recipient `profile.id` (= `player.id`)                                              |
| `notification_type`      | one of the new enum values                                                          |
| `title_key` / `body_key` | i18n keys under `myStats.notifications.*`                                           |
| `params` (jsonb)         | matches the `match_insight.title_params` shape for that event type                  |
| `entity_type`            | `'match_insight'`, `'player_achievement'`, `'player'` (for level_up / season_recap) |
| `entity_id`              | the `match_insight.id`, `player_achievement.id`, or `player.id`                     |
| `deep_link`              | `'rallia://my-stats?insight={id}'` for in-screen drill-in                           |

The mobile app's existing notification handler already routes `deep_link` URLs through `Linking.openURL`. The deep-link routes to be added to `AppNavigator`'s linking config:

```
rallia://my-stats                        → MyStats (default landing)
rallia://my-stats?insight={id}           → MyStats, scroll to Insights, mark insight as read
rallia://my-stats?achievement={slug}     → MyStats, open AchievementDetail
rallia://my-stats?recap={period}         → SeasonRecap screen for that period
```

### Push behaviour & batching

- Per-match: collect all of step-2's events (insights + unlocks + level_up + challenge completions) and emit **one push** per participant: "You finished a match — see what you achieved →".
- For level_up (XP): one push, separate from match push.
- For season_recap_ready: one push on the 1st of the month (cron-triggered, timezone-aware).
- Toast on next foreground: existing pattern.
- Animated celebration sheet on first read: triggered only for `achievement_unlocked` notifications, only the first time the player opens the app after unlock(s); shows confetti + badge zoom; `mediumHaptic()`.

### Season recap shareability

A new edge function `render-season-recap`:

1. Reads the player's stats for the period (calling `get_player_pulse` with `p_lifetime = false` and a tighter window).
2. POSTs to a new App Router route in `apps/web` at `app/api/og/season-recap/route.tsx` which uses `ImageResponse` from `next/og` to render an IG-story-formatted (1080×1920) PNG.
3. Streams the PNG into Supabase Storage at `recaps/{player_id}/{sport_id}/{period}.png` (e.g. `recaps/abc/tennis-id/2026-04.png`).
4. Returns the public URL to the client; client uses React Native's `Share` API to post to Instagram Stories / iMessage.

**Storage bucket migration** (one-time):

```sql
-- in a migration file
INSERT INTO storage.buckets (id, name, public)
VALUES ('recaps', 'recaps', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY recaps_self_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'recaps' AND (storage.foldername(name))[1] = auth.uid()::text);
```

**Retention:** recaps older than 13 months are deleted by a monthly `pg_cron` cleanup. Keeping the most recent 12 monthly + 4 quarterly = ~16 PNGs per player. Negligible storage at expected scale.

---

## Visual style & design system adherence

All new analytics UI **must** use `@rallia/design-system` tokens and mirror the patterns already in `apps/mobile/src/screens/UserProfile.tsx` and the existing leaderboard cards under `apps/mobile/src/features/matches/components/leaderboard/`. No raw hex colors, no raw pixel values for spacing/radius/font-size, no custom card styles — every property comes from a token.

### Imports & hooks (canonical, every analytics screen/component)

```ts
import { Text, Skeleton, SkeletonAvatar, useToast } from '@rallia/shared-components';
import {
  spacingPixels,
  radiusPixels,
  fontSizePixels,
  fontWeightNumeric,
  primary,
  neutral,
  status,
} from '@rallia/design-system';
import { useThemeStyles, useTranslation, type TranslationKey } from '../hooks';
import { Ionicons } from '@expo/vector-icons';
import { SheetManager } from 'react-native-actions-sheet';
import { lightHaptic, mediumHaptic } from '@rallia/shared-utils';
```

`useThemeStyles()` returns `{ colors, isDark }`. **Never read raw color tokens directly** in components — always go through `colors.*` so dark mode works automatically.

### Screen container pattern

Match `UserProfile`:

```tsx
<SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
  <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
    {/* sections */}
    <View style={{ height: 40 }} /> {/* bottom spacing */}
  </ScrollView>
</SafeAreaView>
```

```ts
const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1 },
});
```

### Section pattern

Every analytics block on `MyStats` follows the **section + section-header + card** layout from `UserProfile`. This is non-negotiable — it's the visual rhythm of the existing screen.

```tsx
<View style={styles.section}>
  <View style={styles.sectionHeader}>
    <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
      {t('myStats.sections.summary')} {/* uppercase via styles.sectionTitle */}
    </Text>
    {/* Pick the right trailing affordance based on action type:
        - Drill into another screen → chevron-forward, colors.textMuted
        - Open an edit sheet         → create-outline,  colors.primary
        - Decorative-only / no tap   → omit entirely (matches UserProfile sport cards) */}
    {actionType === 'drill' && (
      <TouchableOpacity style={styles.editIconButton} onPress={onPress}>
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </TouchableOpacity>
    )}
    {actionType === 'edit' && (
      <TouchableOpacity style={styles.editIconButton} onPress={onPress}>
        <Ionicons name="create-outline" size={20} color={colors.primary} />
      </TouchableOpacity>
    )}
  </View>

  <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
    {/* content */}
  </View>
</View>
```

Section-level styles, **copy verbatim from `UserProfile.tsx`**:

```ts
section: {
  marginTop: spacingPixels[5],
  paddingHorizontal: spacingPixels[4],
},
sectionHeader: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: spacingPixels[3],
},
sectionTitle: {
  fontSize: fontSizePixels.xs,
  fontWeight: fontWeightNumeric.bold,
  letterSpacing: 0.5,
  textTransform: 'uppercase',
},
editIconButton: {
  padding: spacingPixels[1],
},
card: {
  borderRadius: radiusPixels.xl,
  padding: spacingPixels[4],
  borderWidth: 1,
},
```

> The section title uses `colors.textMuted` (uppercase, xs, bold, tracking 0.5). The card uses `colors.card` background + `colors.border` 1-px border + `radiusPixels.xl` radius.

### Card variants

There are **two** card sizes already established in the codebase. Pick the right one per use:

| Variant                       | Source                     | When to use                                                            | Key tokens                                                                                                                                                        |
| ----------------------------- | -------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **Section card** (full-width) | `UserProfile.styles.card`  | Default. Every section's primary content.                              | `radiusPixels.xl`, `padding: spacingPixels[4]`, `borderWidth: 1`, `colors.card`, `colors.border`                                                                  |
| **Stat card** (carousel tile) | `leaderboard/StatCard.tsx` | Horizontal scroll inside a section (e.g. record tiles, surface chips). | `radiusPixels.lg`, `paddingVertical/Horizontal: spacingPixels[3]`, `borderWidth: StyleSheet.hairlineWidth`, `colors.cardBackground`, `colors.border`, `width: 220 | 240`, `minHeight: 130` |

The reused leaderboard cards (`SetStatsCard`, `ScoreDistributionCard`, `PersonalRecordsCard`, `ActivityHeatmapCard`) already wrap themselves in `StatCard` — drop them inside a horizontal `ScrollView` (the existing `MyStatsCarousel` pattern) and they will look correct without modification.

### Row patterns inside cards

Three row layouts already exist; pick the closest match instead of inventing a fourth:

1. **`compactRow`** — label left, value right, with `divider` between rows. Use for key-value lists (e.g. "Total matches: 47").

   ```ts
   compactRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacingPixels[2.5] },
   label:      { fontSize: fontSizePixels.sm, flexShrink: 0, marginRight: spacingPixels[3] },
   value:      { fontSize: fontSizePixels.sm, fontWeight: fontWeightNumeric.medium, flex: 1, textAlign: 'right' },
   divider:    { height: 1 /* backgroundColor: colors.border inline */ },
   ```

2. **`verticalField`** — label above value (label muted xs, value base). Use for narrative content (e.g. "Diagnostic: Down 8% on win rate from last period").

   ```ts
   verticalField: { marginBottom: spacingPixels[4] },
   fieldLabel:    { fontSize: fontSizePixels.xs,  marginBottom: spacingPixels[1.5], fontWeight: fontWeightNumeric.medium },
   fieldValue:    { fontSize: fontSizePixels.base, lineHeight: fontSizePixels.base * 1.375 },
   ```

3. **`horizontalFieldsContainer`** — two `halfField`s side-by-side via `flex: 1` + `gap: spacingPixels[4]`. Use for paired stats (e.g. "Wins | Losses").

### Profile snapshot card (entry point on `UserProfile`)

The "My Stats snapshot" pinned at the top of `UserProfile` (the entry point) goes **between the profile-header block and the `ProfileCompletionChecklist`**. It uses the same section pattern but the card is tappable as a whole:

```tsx
<View style={styles.section}>
  <View style={styles.sectionHeader}>
    <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
      {t('myStats.snapshot.heading')}
    </Text>
  </View>

  <TouchableOpacity
    activeOpacity={0.7}
    onPress={() => {
      void lightHaptic();
      navigation.navigate('MyStats');
    }}
    style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
  >
    {/* W/L pill, streak chip, last5 dots, court-time, chevron-forward */}
  </TouchableOpacity>
</View>
```

The chevron mirrors the sport-card pattern from `UserProfile`:

```tsx
<Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
```

### Loading state — Skeleton, not ActivityIndicator

The existing screens use `Skeleton` and `SkeletonAvatar` from `@rallia/shared-components`, never an opaque spinner inside content. Match this exactly:

```tsx
const skeletonBg = isDark ? '#262626' : '#E1E9EE';
const skeletonHighlight = isDark ? '#404040' : '#F2F8FC';

<Skeleton
  width="100%"
  height={44}
  borderRadius={8}
  backgroundColor={skeletonBg}
  highlightColor={skeletonHighlight}
/>;
```

Each section in `MyStats` has its own skeleton state showing the _shape_ of the loaded content (e.g. the summary block skeleton has 3 stat-pill placeholders).

### Empty state inside a section

When a section has no data (e.g. zero doubles partners), use the same italic muted text pattern from `UserProfile.styles.noDataText`:

```ts
noDataText: {
  fontSize: fontSizePixels.sm,
  fontStyle: 'italic',
  textAlign: 'center',
  paddingVertical: spacingPixels[5],
},
```

Never show "0%" placeholders or empty charts.

### Badges and pills

Active/inactive/neutral pills follow the sport-card badge convention from `UserProfile`:

```ts
activeBadge: {
  paddingHorizontal: spacingPixels[2.5],
  paddingVertical:   spacingPixels[1],
  borderRadius:      radiusPixels.xl,
  backgroundColor:   isDark ? primary[900] : primary[100],
},
activeBadgeText: {
  fontSize:   fontSizePixels.xs,
  fontWeight: fontWeightNumeric.semibold,
  color:      isDark ? primary[100] : primary[600],
},
```

Reuse exactly for: "Win streak 3", "+100 XP", "Level 5", surface chips, win/loss pills. Use `status.success` / `status.error` from the design system for W/L color coding (greens/reds), not raw hex.

### Color usage rules

| Purpose                                           | Token                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| Screen background                                 | `colors.background`                                                      |
| Card background                                   | `colors.card` (full-width) or `colors.cardBackground` (StatCard variant) |
| Card border                                       | `colors.border`                                                          |
| Primary text                                      | `colors.text`                                                            |
| Secondary text / labels                           | `colors.textMuted`                                                       |
| Brand accent (chevrons, edit icons, primary CTAs) | `colors.primary`                                                         |
| Brand accent foreground                           | `colors.primaryForeground`                                               |
| Win indicators                                    | `status.success.*`                                                       |
| Loss indicators                                   | `status.error.*`                                                         |
| Disabled / inactive surface                       | `colors.inputBackground`                                                 |

**No raw hex** in any new file (the only exception is the skeleton bg/highlight pair, which already lives as raw hex in `UserProfile`).

### Typography

Use the `<Text>` component from `@rallia/shared-components` with `size` and `weight` props for any inline text (consistent with `StatCard.tsx`, `MyStatsCarousel.tsx`):

```tsx
<Text size="xs"   weight="semibold" style={{ color: colors.textMuted }}>{title}</Text>
<Text size="base" weight="bold"     style={{ color: colors.text }}>{value}</Text>
<Text size="lg"   weight="bold"     style={{ color: colors.text }}>{sectionLabel}</Text>
```

Section headers use the `sectionTitle` style above (raw `style={{ fontSize: fontSizePixels.xs, ... }}`) for the uppercase letter-spaced look that already differentiates sections in `UserProfile`. **Don't introduce a new heading scale.**

### Iconography

Use `@expo/vector-icons` Ionicons exclusively (matches the entire app):

| Use                  | Icon                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------- |
| Section drill-in     | `chevron-forward` size 20 `colors.textMuted`                                            |
| Edit / open sheet    | `create-outline` size 20 `colors.primary`                                               |
| Achievement unlocked | `trophy-outline`                                                                        |
| Streak               | `flame-outline`                                                                         |
| Comeback             | `sunny-outline`                                                                         |
| Speed / fastest      | `flash-outline`                                                                         |
| Information          | `information-circle-outline`                                                            |
| Empty state hero     | matches existing patterns: `trophy-outline`, `stats-chart-outline`, `bar-chart-outline` |

The achievement icon mapping continues the `PersonalRecordsCard.ICON_BY_TYPE` convention.

### Tour integration (CopilotStep)

`UserProfile` wraps key sections in `CopilotStep` + `WalkthroughableView` for the first-run guided tour. New analytics sections that warrant a tour step (recommend: My Stats snapshot card, performance rating, achievements grid) follow the same pattern with new `order` values that don't collide with the existing `20`/`21`/`22` from `UserProfile`:

```tsx
<CopilotStep text={t('tour.profileScreen.myStats.description')} order={23} name="profile_my_stats">
  <WalkthroughableView style={styles.section}>{/* … */}</WalkthroughableView>
</CopilotStep>
```

### Sheets, not modals

Anywhere the analytics flow needs an interactive overlay (e.g. "filter H2H by surface", "share recap"), use `SheetManager.show('sheet-name', { payload: { ... } })` from `react-native-actions-sheet` — the established pattern across `UserProfile`, sport setup, and feedback. **Don't introduce a new modal library.**

### Haptics

Match the existing convention:

- `lightHaptic()` on tap-to-open (snapshot card, drill-in chevrons, insight rows).
- `mediumHaptic()` on celebratory events (achievement unlock sheet shown, level-up animation start).

### Spacing rhythm — exact values used

Only use these `spacingPixels` keys to stay aligned with `UserProfile`: `[1]`, `[1.5]`, `[2]`, `[2.5]`, `[3]`, `[4]`, `[5]`, `[6]`, `[14]`, `[20]`. Don't introduce new spacing increments.

### Radius — only three values

`radiusPixels.lg` for stat-card tiles, `radiusPixels.xl` for full-width section cards, `radiusPixels.full` for avatars and circular badges. Nothing else.

### Web (apps/web)

Out of scope for v1. When v2 ships, it will reuse the **same design tokens** through Tailwind via `tailwindPreset` from `@rallia/design-system/config/tailwind.preset` — no separate token system. The Tailwind class equivalents (`bg-card`, `border-border`, `text-muted-foreground`, `rounded-xl`, `p-4`, `mt-5`) map 1-to-1 to the React Native section/card patterns above.

### Style adherence checklist

Every new analytics file (component or screen) must pass this before merge:

- [ ] Imports `spacingPixels`, `radiusPixels`, `fontSizePixels`, `fontWeightNumeric` from `@rallia/design-system`.
- [ ] Uses `useThemeStyles()` and reads colors only via `colors.*`.
- [ ] Section blocks use the exact `section` / `sectionHeader` / `sectionTitle` / `card` styles from `UserProfile.tsx` (copy them into a shared `styles/profileSection.ts` so we don't duplicate).
- [ ] No raw hex colors except the documented skeleton bg/highlight pair.
- [ ] No raw pixel values for spacing or radius.
- [ ] Loading state uses `Skeleton` / `SkeletonAvatar`, never `ActivityIndicator`.
- [ ] Empty state uses `noDataText` italic-centered convention.
- [ ] Tappable cards trigger `lightHaptic()` on press.
- [ ] All copy goes through `t(key)` from `useTranslation()`.
- [ ] Icons are Ionicons; no other icon library.

### Recommended shared style module

To prevent drift, **create one new file** `apps/mobile/src/features/myStats/styles.ts` that exports the canonical section/card/row styles:

```ts
export const profileSectionStyles = StyleSheet.create({
  section: { marginTop: spacingPixels[5], paddingHorizontal: spacingPixels[4] },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacingPixels[3],
  },
  sectionTitle: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.bold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  card: { borderRadius: radiusPixels.xl, padding: spacingPixels[4], borderWidth: 1 },
  compactRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacingPixels[2.5],
  },
  divider: { height: 1 },
  verticalField: { marginBottom: spacingPixels[4] },
  fieldLabel: {
    fontSize: fontSizePixels.xs,
    marginBottom: spacingPixels[1.5],
    fontWeight: fontWeightNumeric.medium,
  },
  fieldValue: { fontSize: fontSizePixels.base },
  noDataText: {
    fontSize: fontSizePixels.sm,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: spacingPixels[5],
  },
});
```

Every new analytics component imports and applies these. (Long-term, this should also be refactored _into_ `UserProfile.tsx` so the source of truth is shared — note this as follow-up tech debt.)

---

## Telemetry (PostHog)

| Event                         | Properties                                                         |
| ----------------------------- | ------------------------------------------------------------------ |
| `mystats_view`                | `sport`, `period`, `entry_point` (home_card / profile / deep_link) |
| `mystats_section_view`        | `section` (one of the 16 sections above)                           |
| `mystats_h2h_open`            | `opponent_id`                                                      |
| `mystats_compare_with_player` | `peer_id`                                                          |
| `match_insight_view`          | `insight_type`                                                     |
| `match_insight_dismiss`       | `insight_type`                                                     |
| `achievement_unlocked`        | `slug`, `sport_id`                                                 |
| `level_up`                    | `from_level`, `to_level`                                           |
| `challenge_completed`         | `slug`                                                             |
| `season_recap_view`           | `period` (month / quarter)                                         |
| `season_recap_share`          | `period`, `channel` (ig_story / imessage / other)                  |
| `performance_rating_view`     | `is_confident`, `confidence_pct_bucket`                            |

A PostHog dashboard pinned to the launch funnel: section view rates, achievement unlock rate, recap share rate, retention impact.

---

## Phased implementation (revised, with effort estimates)

> Estimates are person-days for a single full-stack engineer.

### Phase 0 — Foundations (≈ 2 days)

- Add 5 separate migrations for `notification_type_enum`.
- Add `myStats` i18n namespace (en-US + fr-CA).
- Stub `MyStats` screen + nav wiring from `UserProfile` + Home hero card slot.
- Create `packages/shared-services/src/players/playerPulseTypes.ts` and `playerPulseService.ts`.
- Create `usePlayerPulse` hook in `packages/shared-hooks`.

### Phase 1 — Core RPC and dashboard (≈ 6 days)

- Implement `get_player_pulse` returning the **summary, trends, set_play, records, reliability, opponents, venue, temporal, doubles_partners, social, headline_insight** branches. Performance rating + insights branches stubbed.
- Wire `MyStats` screen sections 1–11 (everything except performance rating, achievements, challenges, levels).
- SQL fixture tests on the RPC.
- Component tests on `MyStats`.

### Phase 2 — Insights & Achievements (≈ 5 days)

- `match_insight` table + trigger + `compute-match-insights` Edge Function (insights branch).
- Achievement catalogue seeded; achievement evaluator inside the Edge Function.
- Notifications wired: `achievement_unlocked`, `match_insight_ready`.
- "Insights" section + "Achievements" grid in `MyStats`.

### Phase 3 — XP, Levels, Challenges (≈ 4 days)

- XP/level columns, `player_level` and `challenge_template` tables.
- Weekly-challenge cron + rotation logic.
- XP/level computation inside `compute-match-insights`.
- "Active challenges" + "Level / XP" sections in `MyStats`.

### Phase 4 — Performance Rating (≈ 5 days)

- `player_performance_rating` table.
- Glicko-2 implementation in Edge Function `update-performance-rating`.
- Rating section in `MyStats`.
- Backfill job (chronological replay).

### Phase 5 — Recaps & Polish (≈ 4 days)

- Season-recap edge function + share flow.
- `get_player_public_stats` for opponent profile pages.
- Performance pass (RPC EXPLAIN, indexes, cache evaluation).
- Visual QA across iPhone SE → 16 Pro Max + Android.

**Total: ≈ 26 days for the full feature set across 5 phases.** Phase 1 alone ships a fully usable analytics dashboard at ≈ 8 days.

---

## Risks & mitigations

| Risk                                                          |     Likelihood      | Mitigation                                                                                                                                                                   |
| ------------------------------------------------------------- | :-----------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Performance-rating estimates feel wrong / damage trust        |        High         | Hide rating until `matches_counted ≥ 5 AND confidence_pct ≥ 30`. Show confidence visibly. Beta-flag for first month.                                                         |
| H2H data is noisy with mostly 1-game matchups                 |         Med         | UI groups "1 game played" into a separate section; "rivals" requires ≥3 games.                                                                                               |
| `compute-match-insights` Edge Function fails silently         |         Med         | Wrap in try/catch, log to PostHog `match_insight_compute_failed`, sweeper cron re-processes verified matches >1h old with no insights.                                       |
| Surface breakdown is sparse (~20% of matches have `court_id`) |        High         | UI shows the match-count denominator; surfaces with <5 matches are hidden behind "play more matches at varied surfaces" copy.                                                |
| Achievement spam (multiple unlocks per match)                 |         Low         | `compute-match-insights` batches into one push notification per match.                                                                                                       |
| Backfill timeout at production scale                          | Low (current scale) | Edge Function batches 200 matches with checkpointing in `analytics_backfill_state`.                                                                                          |
| Glicko-2 doubles adaptation under-performs                    |         Med         | Code path has a feature flag to fall back to "best opponent rating" approach. Can A/B vs ELO later.                                                                          |
| Privacy leak via opponent stats                               |  High if violated   | `get_player_public_stats` enforces `privacy_show_stats`; integration test covers; policy explicitly excludes nemesis/partner info.                                           |
| RPC slow at scale                                             |         Med         | Benchmark against synthetic 10k-match player; add indexes on `match_participant(player_id, match_outcome)` and `match(sport_id, match_date)`; add `runtime_cache` if needed. |
| Sport-switching jank in `MyStats`                             |         Low         | React Query keys include `sport_id` so each sport caches independently; transition between sports uses the cached previous render until new data arrives.                    |

---

## Production readiness checklist

### Schema & data

- [ ] All 5 new tables created with proper FKs, ON DELETE rules, indexes.
- [ ] `notification_type_enum` extensions in 5 separate migrations.
- [ ] RLS enabled on `match_insight`, `player_performance_rating`, `player_achievement`.
- [ ] `seed_achievements.sql` and `seed_player_levels.sql` and `seed_challenge_templates.sql` committed.
- [ ] Indexes added to support `get_player_pulse`: `match_participant(player_id, match_outcome)`, `match(sport_id, match_date)`, `match_set(match_result_id, set_number)`, `match_feedback(opponent_id)` if not already present.

### Server

- [ ] `get_player_pulse` RPC unit-tested with fixture matches.
- [ ] `get_player_public_stats` RPC has integration test for `privacy_show_stats = false` returning `{ public: false }`.
- [ ] `compute-match-insights` Edge Function deployed; idempotent; wrapped in error logging.
- [ ] Sweeper cron checks every match with `is_verified = true AND verified_at < now() - interval '1 hour' AND not present in match_insight`.
- [ ] Glicko-2 implementation has unit tests against the Glickman 2013 paper test cases.
- [ ] Backfill function checkpoints and is restartable.

### Client

- [ ] `usePlayerPulse` shared hook with React Query keys registered in a central registry.
- [ ] `MyStats` screen renders correctly for: zero-match user, 1–4 match user, 50+ match user.
- [ ] Sport-switch and period-toggle update the dashboard within 200ms (cached) / 1.5s (fetch).
- [ ] Achievement-unlock celebration sheet animates correctly on iOS and Android.
- [ ] Season-recap share button triggers native share sheet.
- [ ] All copy keys present in both `en-US.json` and `fr-CA.json` (French reviewed by a French-Canadian speaker).

### Telemetry

- [ ] All 12 PostHog events emitted with correct properties.
- [ ] PostHog dashboard pinned for launch funnel.

### Testing

- [ ] Jest unit tests for: streak computation, win-rate computation, set-stats computation, Glicko-2 step, achievement evaluator.
- [ ] SQL function tests: feed fixture matches, assert RPC returns expected shape.
- [ ] E2E (manual or Detox): user with 5 fixture matches navigates through every section of `MyStats` without errors.
- [ ] Manual QA matrix: iOS / Android, various match counts, English / French.

### Privacy

- [ ] `privacy_show_stats` respected in `get_player_public_stats` and in `player_performance_rating` RLS.
- [ ] Achievement list is treated as public (catalogue-style) — no private PII.

### Rollout

- [ ] Internal team dogfooding for 1 week before public release.
- [ ] Monitor `match_insight_compute_failed`, RPC p95 latency, and section-view drop-off after launch.
- [ ] Rollback plan: drop the `MyStats` deep link from Home; data layer remains running.

---

## Decisions log

| Decision                                                                 | Rationale                                                                                                                   |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Single `get_player_pulse` RPC                                            | Mirrors the established `get_network_pulse` pattern; one round-trip; clean React Query key                                  |
| Glicko-2 over ELO                                                        | Confidence interval is required; volatility models inactivity well; widely implemented                                      |
| All features available to everyone                                       | Per current product direction; no Free/Pro split in v1                                                                      |
| Mobile-first, web v2                                                     | Stats engagement is mobile-native; team capacity                                                                            |
| `MyStats` reached via `UserProfile` + Home hero, not a new tab           | Tab bar is already at 5; reuses the natural "my profile" entry                                                              |
| New `myStats` i18n namespace, not `analytics`                            | `analytics` is org-admin scope; mixing player + org under one key is confusing                                              |
| Insights persisted, not computed live                                    | Allows batching, offline reads, push notifications, avoids re-running expensive milestone detection on every dashboard load |
| Achievement evaluator runs server-side in same Edge Function as insights | Single source of truth, transactional with insight + XP updates                                                             |
| Sport selection via `useSport` context, not screen-local toggle          | Consistent with rest of app; cross-screen state                                                                             |
| Lifetime + windowed in same RPC via `p_lifetime` flag                    | Avoids two RPCs; window applies to trends/heatmap, lifetime to records/H2H                                                  |

---

## Open questions (must resolve before Phase 1)

1. **Sport selection inside `MyStats`:** confirm `useSport` is the right context. (Search shows it's used in `AppNavigator.tsx`, `UserProfile.tsx`, and elsewhere — should be safe to reuse.)
2. **PostHog event naming:** confirm we follow the existing taxonomy in `apps/mobile/src/services/analytics.ts` (camel_snake_case vs snake_case).
3. **Doubles H2H semantics:** for `opponents.h2h`, "an opponent" in doubles means each individual on the other team (not the pairing). Confirmed as default; flag if you want pairings instead.
4. **`@vercel/og` for season recaps:** confirm we want server-rendered images via `apps/web` (already on Vercel) vs. client-side via `react-native-view-shot`. Recommend server-side for consistent results across devices.
5. **Inactivity decay for performance rating:** Glicko-2 supports volatility-based decay; we apply it on every match step. Acceptable that a player who hasn't played in 6 months sees their rating shift on next match.

---

## Appendix: existing components used (verified file paths)

All under `apps/mobile/src/features/matches/components/leaderboard/`:

- `ActivityHeatmapCard.tsx`
- `ScoreDistributionCard.tsx`
- `PersonalRecordsCard.tsx`
- `SetStatsCard.tsx`
- `FormStrip.tsx` / `FormLine.tsx`
- `RivalryCard.tsx`
- `PowerPairCard.tsx`
- `H2HMatrix.tsx`
- `MatchupExtremesCard.tsx`
- `ComparisonOverlay.tsx`
- `MyStatsCarousel.tsx` (already wraps the four stat cards)

Server types to reuse, all in `packages/shared-services/src/groups/groupTypes.ts`:

- `NetworkPulseHeadlineInsight`
- `NetworkPulseHeatmapDay`
- `NetworkPulsePersonalRecord`
- `NetworkPulseSetStats`
- `NetworkPulseScoreDistEntry`
- `NetworkPulseMatchupExtreme`
- `NetworkPulsePowerPair`
- `NetworkPulseRivalry`
- `NetworkPulseH2HCell`

Hook to mirror: `useNetworkPulse` in `packages/shared-hooks/src/useGroups.ts` — copy the pattern for `usePlayerPulse`.
