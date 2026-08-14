/**
 * Pool layout preview for pool_knockout tournaments.
 *
 * Mirrors _lt_compute_pool_assignment's sizing (migration 20260810170100) so
 * the organizer is shown the pools they will actually get. That matters because
 * the requested pool size is a target, not a promise: the DB lowers the pool
 * count until every pool holds at least 3, so asking for pools of 3 in a field
 * of 8 comes back as two pools of 4, and a field of 24 at pools of 5 comes back
 * as four of 5 plus one of 4.
 *
 * Keep in step with the SQL. poolLayout.test.ts pins every field size and pool
 * size the format allows against values read out of _lt_compute_pool_assignment.
 */

export type PoolGroup = {
  /** How many pools hold this many entries. */
  count: number;
  size: number;
};

export type PoolLayout = {
  pools: number;
  /** Largest pools first; one entry when every pool is the same size. */
  groups: PoolGroup[];
  /** Entries in the smallest pool, so the floor for the whole field. */
  minPoolSize: number;
  /** Games the least-scheduled entry is guaranteed: smallest pool minus one. */
  guaranteedGames: number;
  /** Total qualifiers across all pools. */
  qualifiers: number;
  /** Next power of two at or above the qualifier count. */
  drawSize: number;
};

/**
 * Returns null when the inputs cannot produce a legal set of pools, which is
 * what tournament_generate_pools would raise INSUFFICIENT_PARTICIPANTS or
 * POOL_SIZING_FAILED for.
 */
export function computePoolLayout(
  fieldSize: number,
  poolSize: number,
  qualifiersPerPool: number
): PoolLayout | null {
  if (!Number.isInteger(fieldSize) || fieldSize < 6) return null;
  if (!Number.isInteger(poolSize) || poolSize < 3 || poolSize > 5) return null;
  if (!Number.isInteger(qualifiersPerPool) || qualifiersPerPool < 1) return null;

  let pools = Math.ceil(fieldSize / poolSize);
  if (Math.floor(fieldSize / pools) < 3) pools = Math.floor(fieldSize / 3);
  if (pools < 1) return null;

  const base = Math.floor(fieldSize / pools);
  const remainder = fieldSize % pools;
  if (base < 3 || base + (remainder > 0 ? 1 : 0) > 5) return null;

  const groups: PoolGroup[] = [];
  if (remainder > 0) groups.push({ count: remainder, size: base + 1 });
  if (pools - remainder > 0) groups.push({ count: pools - remainder, size: base });

  const qualifiers = pools * qualifiersPerPool;
  let drawSize = 2;
  while (drawSize < qualifiers) drawSize *= 2;

  return {
    pools,
    groups,
    minPoolSize: base,
    guaranteedGames: base - 1,
    qualifiers,
    drawSize,
  };
}
