/**
 * BY_RANK match-sheet pairing for league sessions (singles).
 *
 * Spec: specs/17-leagues-tournaments/match-sheet.md §BY_RANK.
 *
 * This is the reference implementation. The authoritative runtime path is the
 * SQL helper `lt_rotate_for_round` + the pairing loop in `session_generate_sheet`
 * (migration 20260618130000_lt_session_sheet_rpcs.sql), which mirrors this file
 * — same as how `lt_seed_positions` mirrors `tournament/seedPositions.ts`.
 *
 * Byes: when the confirmed count is odd, the highest-ranked player sits out.
 * The `session_matches` CHECK requires `cardinality(team_b_user_ids) IN (1, 2)`,
 * so a bye is NOT stored as a row — it is returned here (and derived in the UI)
 * as the unpaired player for that round.
 */

export interface RankedPlayer {
  userId: string;
  /** Season points; higher = better rank. Missing ranking → treat as 0. */
  points: number;
  /** Deterministic tiebreak among equal points; lower sorts first. */
  tiebreakSeed: number;
}

export interface SessionPairing {
  roundNumber: number;
  teamAUserIds: string[];
  teamBUserIds: string[];
}

export interface SessionBye {
  roundNumber: number;
  userId: string;
}

export interface ByRankSheet {
  matches: SessionPairing[];
  byes: SessionBye[];
}

/**
 * Deterministic ranking order: higher points first, ties broken by lower
 * tiebreakSeed, then userId for total stability across TS and SQL.
 */
export function rankingCompare(a: RankedPlayer, b: RankedPlayer): number {
  if (a.points !== b.points) return b.points - a.points;
  if (a.tiebreakSeed !== b.tiebreakSeed) return a.tiebreakSeed < b.tiebreakSeed ? -1 : 1;
  if (a.userId === b.userId) return 0;
  return a.userId < b.userId ? -1 : 1;
}

/**
 * Round-robin rotation: keep the first player fixed and rotate the rest left by
 * (round - 1). After `K - 1` rounds every player has met every other once.
 */
export function rotateForRound<T>(sorted: readonly T[], round: number): T[] {
  if (sorted.length <= 2 || round <= 1) return [...sorted];
  const [head, ...tail] = sorted;
  const shift = (round - 1) % tail.length;
  return [head, ...tail.slice(shift), ...tail.slice(0, shift)];
}

/**
 * BY_RANK pairing for singles: highest plays second-highest, etc. For an odd
 * roster the highest-ranked player byes; the remaining players pair adjacently.
 * Produces pairings for rounds 1..max(1, rounds).
 */
export function byRankPairings(
  players: readonly RankedPlayer[],
  opts: { rounds?: number } = {}
): ByRankSheet {
  const rounds = Math.max(1, Math.trunc(opts.rounds ?? 1));
  const sorted = [...players].sort(rankingCompare);
  const matches: SessionPairing[] = [];
  const byes: SessionBye[] = [];

  for (let round = 1; round <= rounds; round++) {
    const order = rotateForRound(sorted, round);
    let start = 0;
    if (order.length % 2 === 1) {
      byes.push({ roundNumber: round, userId: order[0].userId });
      start = 1;
    }
    for (let i = start; i + 1 < order.length; i += 2) {
      matches.push({
        roundNumber: round,
        teamAUserIds: [order[i].userId],
        teamBUserIds: [order[i + 1].userId],
      });
    }
  }

  return { matches, byes };
}
