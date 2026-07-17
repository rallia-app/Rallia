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
