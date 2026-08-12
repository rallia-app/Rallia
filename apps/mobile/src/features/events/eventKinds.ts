/**
 * The event formats Rallia can run, and what drives each one.
 *
 * An organizer picks a kind up front; everything downstream (which wizard
 * opens, which bracket the server builds) follows from the descriptor. Adding
 * the formats the spec still has queued (day round, box league) means adding a
 * row here plus its engine, not a fourth creation flow.
 *
 * Spec: specs/17-leagues-tournaments/formats/README.md
 */

import type { Ionicons } from '@expo/vector-icons';
import type { Enums } from '@rallia/shared-types';

import type { TranslationKey } from '../../hooks';

export type EventKind = 'knockout' | 'pools_knockout' | 'session_league';

/** Which creation flow and data model runs the format. */
export type EventEngine = 'tournament' | 'league';

export interface EventKindDescriptor {
  kind: EventKind;
  engine: EventEngine;
  /** Preselects the tournament wizard's structure field. Leagues have none. */
  bracketType?: Extract<Enums<'bracket_type'>, 'single_elimination' | 'pool_knockout'>;
  icon: keyof typeof Ionicons.glyphMap;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  /** Decision facts on the picker card, in reading order. */
  factKeys: TranslationKey[];
}

export const EVENT_KINDS: readonly EventKindDescriptor[] = [
  {
    kind: 'knockout',
    engine: 'tournament',
    bracketType: 'single_elimination',
    icon: 'trophy-outline',
    titleKey: 'eventCreation.kinds.knockout.title',
    descriptionKey: 'eventCreation.kinds.knockout.description',
    factKeys: [
      'eventCreation.kinds.knockout.duration',
      'eventCreation.kinds.knockout.guaranteed',
      'eventCreation.kinds.knockout.elimination',
    ],
  },
  {
    kind: 'pools_knockout',
    engine: 'tournament',
    bracketType: 'pool_knockout',
    icon: 'grid-outline',
    titleKey: 'eventCreation.kinds.poolsKnockout.title',
    descriptionKey: 'eventCreation.kinds.poolsKnockout.description',
    factKeys: [
      'eventCreation.kinds.poolsKnockout.duration',
      'eventCreation.kinds.poolsKnockout.guaranteed',
      'eventCreation.kinds.poolsKnockout.elimination',
    ],
  },
  {
    kind: 'session_league',
    engine: 'league',
    icon: 'ribbon-outline',
    titleKey: 'eventCreation.kinds.sessionLeague.title',
    descriptionKey: 'eventCreation.kinds.sessionLeague.description',
    factKeys: [
      'eventCreation.kinds.sessionLeague.duration',
      'eventCreation.kinds.sessionLeague.guaranteed',
      'eventCreation.kinds.sessionLeague.elimination',
    ],
  },
] as const;

/** The kinds the tournament engine runs, for entry points scoped to tournaments. */
export const TOURNAMENT_EVENT_KINDS: EventKind[] = EVENT_KINDS.filter(
  d => d.engine === 'tournament'
).map(d => d.kind);

export function eventKindDescriptor(kind: EventKind): EventKindDescriptor {
  const found = EVENT_KINDS.find(d => d.kind === kind);
  if (!found) throw new Error(`Unknown event kind: ${kind}`);
  return found;
}
