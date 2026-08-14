/**
 * Player-readable summary of a pool_knockout draw: how many pools of what size,
 * who advances and to which round, and the games everyone is guaranteed.
 *
 * Computed rather than written down, because the requested pool size is only a
 * target and the distribution can hand back something else (20 at pools of 5
 * really is pools of 5, so 4 games each, while 16 at pools of 3 splits
 * [4,3,3,3,3] and the floor is 2).
 *
 * Shared by the creation wizard's configuration preview and the detail screen's
 * spec sheet, so an organizer and a registrant read the same sentence.
 */

import { computePoolLayout } from '@rallia/shared-services';

import type { TranslationKey } from '../../hooks';

const POOL_ROUND_KEYS: Record<number, string> = {
  2: 'poolRoundFinal',
  4: 'poolRoundSemis',
  8: 'poolRoundQuarters',
  16: 'poolRoundOf16',
  32: 'poolRoundOf32',
};

export function poolPreviewText(
  fieldSize: number,
  poolSize: number,
  qualifiersPerPool: number,
  isDoubles: boolean,
  t: (k: TranslationKey) => string
): string | null {
  const layout = computePoolLayout(fieldSize, poolSize, qualifiersPerPool);
  if (!layout) return null;

  const key = (k: string) => `tournamentCreation.fields.${k}` as TranslationKey;

  const groups = layout.groups.map(g =>
    (g.count === 1
      ? t(key('poolPreviewGroupOne'))
      : t(key('poolPreviewGroupMany')).replace('{count}', String(g.count))
    ).replace('{size}', String(g.size))
  );

  const one = qualifiersPerPool === 1;
  const template = isDoubles
    ? one
      ? 'poolPreviewTeamsOne'
      : 'poolPreviewTeamsTwo'
    : one
      ? 'poolPreviewOne'
      : 'poolPreviewTwo';

  return t(key(template))
    .replace('{field}', String(fieldSize))
    .replace('{layout}', groups.join(t(key('poolPreviewJoin'))))
    .replace('{round}', t(key(POOL_ROUND_KEYS[layout.drawSize] ?? 'poolRoundOf32')))
    .replace('{games}', String(layout.guaranteedGames));
}
