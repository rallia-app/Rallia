/**
 * BY_RANK match-sheet pairing for league sessions (singles).
 *
 * Spec: specs/17-leagues-tournaments/match-sheet.md §BY_RANK.
 *
 * This is the reference implementation. The authoritative runtime path is the
 * SQL helper `lt_rotate_for_round` + the pairing loop in `session_generate_sheet`
 * (migration 20260730100000_lt_session_bye_rotation.sql, superseding
 * 20260618130000), which mirrors this file — same as how `lt_seed_positions`
 * mirrors `tournament/seedPositions.ts`.
 *
 * Byes: when the confirmed count is odd, one player sits out per round. The
 * `session_matches` CHECK requires `cardinality(team_b_user_ids) IN (1, 2)`, so
 * a bye is NOT stored as a row — it is returned here (and derived in the UI, and
 * in `recalc_season_ranking`) as the unpaired player for that round.
 *
 * Who byes: the caller supplies `byeQueue`, the roster ordered by fewest byes
 * taken so far this season, then lowest standing. Round R benches `byeQueue[R]`,
 * cycling. SQL builds that queue from prior completed sessions; callers with no
 * history can pass nothing and get reverse-ranking order (weakest sits first),
 * which is the same answer on a season's opening night. The effective queue is
 * always completed to a permutation of the roster (missing members appended in
 * reverse-ranking order), so a partial or stale queue can neither starve one
 * player with every bye nor lose the bye altogether.
 *
 * This replaced "the highest-ranked player byes": combined with the round
 * rotation below (which pins the first entry), that benched the same leader in
 * every round of every session — a 5-player, 3-round night left one member
 * playing nothing at all.
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
 * BY_RANK pairing for singles: highest plays second-highest, etc.
 *
 * Even roster: the top seed is pinned and the tail rotates per round (classic
 * round-robin). Odd roster: one player from `byeQueue` sits out each round and
 * the rest pair adjacently in ranking order.
 *
 * `byeQueue` is the bye priority — fewest byes so far this season first, then
 * lowest standing. Omit it and the weakest confirmed player sits first, which
 * matches SQL on an opening night when nobody has byed yet.
 *
 * Produces pairings for rounds 1..max(1, rounds).
 */
export function byRankPairings(
  players: readonly RankedPlayer[],
  opts: { rounds?: number; byeQueue?: readonly string[] } = {}
): ByRankSheet {
  const rounds = Math.max(1, Math.trunc(opts.rounds ?? 1));
  const sorted = [...players].sort(rankingCompare);
  const matches: SessionPairing[] = [];
  const byes: SessionBye[] = [];

  // Effective queue = caller's priority entries (restricted to the roster, so
  // a stale queue can never bench someone who isn't playing), completed to a
  // full roster permutation in reverse ranking order — the lowest-standing
  // player is benched first. Always covering the roster is what guarantees an
  // odd roster records a bye and a partial queue still rotates.
  const roster = new Set(sorted.map(p => p.userId));
  const provided = (opts.byeQueue ?? []).filter(id => roster.has(id));
  const providedSet = new Set(provided);
  const queue = [
    ...provided,
    ...[...sorted]
      .reverse()
      .map(p => p.userId)
      .filter(id => !providedSet.has(id)),
  ];

  for (let round = 1; round <= rounds; round++) {
    let order: RankedPlayer[];

    if (sorted.length % 2 === 1) {
      const byer = queue[(round - 1) % queue.length];
      byes.push({ roundNumber: round, userId: byer });
      order = sorted.filter(p => p.userId !== byer);
    } else {
      order = rotateForRound(sorted, round);
    }

    for (let i = 0; i + 1 < order.length; i += 2) {
      matches.push({
        roundNumber: round,
        teamAUserIds: [order[i].userId],
        teamBUserIds: [order[i + 1].userId],
      });
    }
  }

  return { matches, byes };
}
