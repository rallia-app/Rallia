/**
 * League season scoring + ranking — reference implementation.
 *
 * Spec: specs/17-leagues-tournaments/ranking.md.
 *
 * As with byRankPairings.ts, this is the testable reference; the authoritative
 * runtime path is the SQL in `recalc_season_ranking` (migration
 * 20260618140000_lt_session_score_bridge.sql), which mirrors `parseScore`,
 * `outcomePoints`, and `rankingCompare`.
 */

export interface RankingRules {
  pointWin: number;
  pointLoss: number;
  pointDraw: number;
  pointNoShow: number;
  pointBye: number;
  pointRetirementWinner: number;
  pointRetirementLoser: number;
  pointWalkoverWinner: number;
  pointWalkoverLoser: number;
  /** Points per GAME won, added on top of the result. 0 = result-only. */
  pointPerGameWon?: number;
}

/** Terminal session-match statuses that award points. */
export type ScoredStatus = 'completed' | 'retired' | 'walkover' | 'draw';

/**
 * Points for one player given the match outcome and whether they won.
 * `cancelled` / `pending` award nothing (handled by the caller).
 */
export function outcomePoints(
  rules: RankingRules,
  status: ScoredStatus,
  isWinner: boolean
): number {
  switch (status) {
    case 'completed':
      return isWinner ? rules.pointWin : rules.pointLoss;
    case 'retired':
      return isWinner ? rules.pointRetirementWinner : rules.pointRetirementLoser;
    case 'walkover':
      return isWinner ? rules.pointWalkoverWinner : rules.pointWalkoverLoser;
    case 'draw':
      return rules.pointDraw;
    default:
      return 0;
  }
}

/**
 * Total points one player takes from one match: the result, plus
 * pointPerGameWon for every game they won. Mirrors the `contrib` CTE in
 * recalc_season_ranking, which adds the same term to its per-side points.
 */
export function matchPoints(
  rules: RankingRules,
  status: ScoredStatus,
  isWinner: boolean,
  gamesWon = 0
): number {
  return outcomePoints(rules, status, isWinner) + (rules.pointPerGameWon ?? 0) * gamesWon;
}

export interface ParsedScore {
  aSets: number;
  bSets: number;
  aGames: number;
  bGames: number;
}

const EMPTY_SCORE: ParsedScore = { aSets: 0, bSets: 0, aGames: 0, bGames: 0 };

/** Min games for a token to count as a completed set (tennis 6 / pickleball 11). */
const SET_COMPLETE_THRESHOLD = 6;

/**
 * Parse a league score string into per-side set/game totals from team A's
 * perspective. Tolerant by design — unrecognized input yields zeroes so the
 * ranking recalc never throws on a hand-entered score.
 *
 * Handles tennis (`6-4, 4-6, 7-6(5)`, super-tb `[10-7]`), pickleball
 * (`11-8 to 11, 11-9 to 11`), and the `RET` / `W/O` / `DEF` / `INT` modifiers.
 */
export function parseScore(score: string | null | undefined): ParsedScore {
  if (!score) return { ...EMPTY_SCORE };

  // Strip tiebreak detail "(5)", super-tb brackets, "to <target>", and modifiers.
  const cleaned = score
    .replace(/\([^)]*\)/g, '')
    .replace(/[[\]]/g, '')
    .replace(/\bto\s+\d+/gi, '')
    .replace(/\b(RET|W\/O|DEF|INT)\b/gi, '')
    .trim();
  if (!cleaned) return { ...EMPTY_SCORE };

  let aSets = 0;
  let bSets = 0;
  let aGames = 0;
  let bGames = 0;

  for (const raw of cleaned.split(/[,\s]+/)) {
    const token = raw.trim();
    if (!token) continue;
    const m = token.match(/^(\d+)-(\d+)$/);
    if (!m) continue;
    const a = Number.parseInt(m[1], 10);
    const b = Number.parseInt(m[2], 10);
    aGames += a;
    bGames += b;
    // A set only counts toward set totals once a side reaches a completed-set
    // threshold (6 in tennis, 11 in pickleball). Partial sets from a
    // retirement (e.g. "2-1 RET") contribute their games but not a set.
    if (Math.max(a, b) >= SET_COMPLETE_THRESHOLD) {
      if (a > b) aSets += 1;
      else if (b > a) bSets += 1;
    }
  }

  return { aSets, bSets, aGames, bGames };
}

export interface RankingRow {
  points: number;
  setsWon: number;
  setsLost: number;
  gamesWon: number;
  gamesLost: number;
  sessionsAttended: number;
  sessionsEligible: number;
  tiebreakSeed: number;
}

function participationPct(r: RankingRow): number {
  return r.sessionsEligible > 0 ? (r.sessionsAttended * 100) / r.sessionsEligible : 0;
}

/**
 * Standings comparison (lower result sorts higher / better rank).
 * Order: total points → set difference → game difference → participation % →
 * deterministic seed. Head-to-head is applied in SQL (needs cross-row match
 * data) and is intentionally omitted from this pairwise comparator.
 */
export function standingsCompare(a: RankingRow, b: RankingRow): number {
  if (a.points !== b.points) return b.points - a.points;

  const aSetDiff = a.setsWon - a.setsLost;
  const bSetDiff = b.setsWon - b.setsLost;
  if (aSetDiff !== bSetDiff) return bSetDiff - aSetDiff;

  const aGameDiff = a.gamesWon - a.gamesLost;
  const bGameDiff = b.gamesWon - b.gamesLost;
  if (aGameDiff !== bGameDiff) return bGameDiff - aGameDiff;

  const aPct = participationPct(a);
  const bPct = participationPct(b);
  if (aPct !== bPct) return bPct - aPct;

  return a.tiebreakSeed < b.tiebreakSeed ? -1 : a.tiebreakSeed > b.tiebreakSeed ? 1 : 0;
}

/**
 * Assign 1-indexed ranks to rows, sorted by rankingCompare. Returns a new array
 * of `{ row, rank }` in ranked order.
 */
export function assignRanks<T extends RankingRow>(
  rows: readonly T[]
): Array<{ row: T; rank: number }> {
  return [...rows].sort(standingsCompare).map((row, i) => ({ row, rank: i + 1 }));
}
