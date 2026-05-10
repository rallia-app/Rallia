/**
 * Seed → bracket position mapping for single-elimination tournaments.
 *
 * Spec: specs/17-leagues-tournaments/tournament-bracket.md §Algorithm.
 *
 * The classic "binary placement" algorithm: starting from a single seed,
 * repeatedly double the bracket by appending each level's mirror seed
 * (size + 1 - p) after every existing position. The result for size N is a
 * permutation of [1..N] giving, for each bracket position 1..N (the array
 * index + 1), which seed should occupy it.
 *
 * Examples:
 *   seedPositions(2)  → [1, 2]
 *   seedPositions(4)  → [1, 4, 2, 3]                     // (1v4) (2v3)
 *   seedPositions(8)  → [1, 8, 4, 5, 2, 7, 3, 6]
 *   seedPositions(16) → [1,16,8,9,4,13,5,12,2,15,7,10,3,14,6,11]
 *
 * The result has the property that the top half (positions 1..N/2) and
 * bottom half (positions N/2+1..N) split the seeds so that the top two
 * seeds can only meet in the final, the top four only in the semis, etc.
 */
export function seedPositions(size: number): number[] {
  if (!Number.isInteger(size) || size < 2) {
    throw new Error(`seedPositions: size must be an integer >= 2, got ${size}`);
  }
  if ((size & (size - 1)) !== 0) {
    throw new Error(`seedPositions: size must be a power of 2, got ${size}`);
  }

  let positions: number[] = [1];
  while (positions.length < size) {
    const next: number[] = [];
    const total = positions.length * 2;
    for (const p of positions) {
      next.push(p);
      next.push(total + 1 - p);
    }
    positions = next;
  }
  return positions;
}

/**
 * Given a bracket size and the number of actual participants, returns the
 * indices of the BYE seed slots (1-indexed seed numbers). BYEs are the
 * highest seed numbers (lowest-ranked slots), so seeds (participants+1)..size
 * are byes.
 *
 * Example: bracket size 8, 6 participants → BYE seeds 7, 8.
 */
export function byeSeeds(size: number, participants: number): number[] {
  if (participants > size) {
    throw new Error(`byeSeeds: participants (${participants}) > size (${size})`);
  }
  const out: number[] = [];
  for (let s = participants + 1; s <= size; s++) out.push(s);
  return out;
}
