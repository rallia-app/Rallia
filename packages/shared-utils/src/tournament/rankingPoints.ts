/**
 * Circuit Rallia — the headline points value shown on a tournament card and
 * detail screen.
 *
 * There are two numbers, and which one is truthful depends on the event's
 * lifecycle:
 *
 *   - Before the bracket is generated, only a CEILING is knowable — the
 *     champion's points at full capacity (`ranking_points_ceiling`, stamped
 *     server-side from max_participants + min_rating). Shown as "up to N".
 *   - Once the bracket is generated, the event is priced for real: the field
 *     size is fixed and `ranking_multiplier` is stamped. The firm champion
 *     value is `CHAMPION_BASE × ranking_multiplier`. Shown as a plain "N".
 *
 * Both numbers come from the database (see 20260716230100 / 20260716230200);
 * this helper only picks between them and never recomputes scoring rules on the
 * client. `null` means the event awards no ranking points to surface (e.g. a
 * capacity/floor that rounds the ceiling to zero).
 */

/** Points a champion earns at multiplier 1.0 — mirrors lt_champion_base(). */
export const CHAMPION_BASE_POINTS = 500;

export interface TournamentRankingPointsInput {
  /** Stamped at bracket generation; null until then. */
  ranking_multiplier: number | null;
  /** Stamped from capacity + floor; the pre-bracket "up to" value. */
  ranking_points_ceiling: number | null;
}

export interface TournamentRankingHeadline {
  /** Champion points to display. */
  points: number;
  /**
   * true  → projected ceiling ("up to N points"), field not yet fixed.
   * false → firm value, the bracket is set.
   */
  projected: boolean;
}

/**
 * The champion-points headline for a tournament, or null if there's nothing
 * worth showing. `projected` tells the caller whether to prefix "up to".
 */
export function tournamentRankingHeadline(
  t: TournamentRankingPointsInput
): TournamentRankingHeadline | null {
  if (t.ranking_multiplier != null) {
    const points = Math.round(CHAMPION_BASE_POINTS * t.ranking_multiplier);
    return points > 0 ? { points, projected: false } : null;
  }
  if (t.ranking_points_ceiling != null && t.ranking_points_ceiling > 0) {
    return { points: t.ranking_points_ceiling, projected: true };
  }
  return null;
}

/** Placements the award function can assign, best first. */
export type TournamentPlacement =
  | 'champion'
  | 'finalist'
  | 'semifinal'
  | 'quarterfinal'
  | 'round_of_16'
  | 'round_of_32'
  | 'round_of_64'
  | 'participated';

/**
 * Points at multiplier 1.0, mirroring the CASE in award_tournament_ranking_points
 * (migration 20260717160000). Every displayed number is derived from these — the
 * screen must never invent its own scale.
 */
export const PLACEMENT_BASE_POINTS: Record<TournamentPlacement, number> = {
  champion: CHAMPION_BASE_POINTS,
  finalist: 300,
  semifinal: 180,
  quarterfinal: 90,
  round_of_16: 50,
  round_of_32: 30,
  round_of_64: 25,
  participated: 20,
};

/**
 * `minCapacity` is the smallest bracket the rung exists in. The award reads
 * depth off `final_round`, which is the CAPACITY depth (log2 max_participants),
 * not the number of entrants — so an under-filled 32-cap event still pays R16.
 */
const LADDER_ORDER: { placement: TournamentPlacement; minCapacity: number }[] = [
  { placement: 'champion', minCapacity: 2 },
  { placement: 'finalist', minCapacity: 2 },
  { placement: 'semifinal', minCapacity: 4 },
  { placement: 'quarterfinal', minCapacity: 8 },
  { placement: 'round_of_16', minCapacity: 16 },
  { placement: 'round_of_32', minCapacity: 32 },
  { placement: 'round_of_64', minCapacity: 64 },
  { placement: 'participated', minCapacity: 2 },
];

/** Rungs a double-elimination bracket can't resolve yet. */
const DEPTH_PLACEMENTS: TournamentPlacement[] = [
  'semifinal',
  'quarterfinal',
  'round_of_16',
  'round_of_32',
  'round_of_64',
];

export interface TournamentPointsLadderRow {
  placement: TournamentPlacement;
  points: number;
}

export interface TournamentPointsLadder {
  /** true → derived from the capacity ceiling ("up to"); false → firm, bracket set. */
  projected: boolean;
  /** The combined draw x level multiplier the award will price at. */
  multiplier: number;
  rows: TournamentPointsLadderRow[];
}

export interface TournamentPointsLadderInput extends TournamentRankingPointsInput {
  /** Bracket capacity (4…128). Sets how deep the ladder goes. */
  max_participants: number;
  /** Double elimination collapses the middle placements — see below. */
  bracket_type?: string | null;
}

/**
 * Points a player earns per placement, matching the award exactly:
 * `round(base × multiplier / 10) × 10` (dime-grained, per 20260717160000).
 *
 * The multiplier is read from the stamp when the bracket is set, and otherwise
 * recovered from the advertised ceiling — the snap to 0.2 steps makes
 * `ceiling / 500` exact, so this never re-derives pricing rules on the client.
 *
 * Rungs are truncated to the bracket capacity: an 8-draw has no round of 16 to
 * reach, so it must not advertise those points.
 *
 * Double elimination only resolves champion / finalist / participated today, so
 * the middle rungs are omitted rather than promised.
 */
export function tournamentPointsLadder(
  t: TournamentPointsLadderInput
): TournamentPointsLadder | null {
  const headline = tournamentRankingHeadline(t);
  if (!headline) return null;

  const projected = headline.projected;
  const multiplier = projected
    ? headline.points / CHAMPION_BASE_POINTS
    : (t.ranking_multiplier as number);

  const doubleElim = t.bracket_type === 'double_elimination';

  const rows = LADDER_ORDER.filter(
    rung =>
      t.max_participants >= rung.minCapacity &&
      !(doubleElim && DEPTH_PLACEMENTS.includes(rung.placement))
  )
    .map(({ placement }) => ({
      placement,
      points: Math.round((PLACEMENT_BASE_POINTS[placement] * multiplier) / 10) * 10,
    }))
    .filter(row => row.points > 0);

  return rows.length ? { projected, multiplier, rows } : null;
}
