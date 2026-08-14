/**
 * courtState
 *
 * One place to turn a suggestion's court situation into a chip, so the organizer
 * card and the setup sheet cannot drift apart.
 *
 * The engine used to expose only `court_confirmed`, and everything falsy read as
 * "Souvent libre". That merged two opposite facts: a date the facility's feed has
 * not published yet, where a court may still open, and an hour the feed covers
 * where every court is already taken. `court_state` (migration 20260812270000)
 * separates them.
 */

import type { TranslationKey } from '@rallia/shared-translations';
import type { MatchOrganizerOption } from '@rallia/shared-services';

export type CourtState = 'confirmed' | 'not_published_yet' | 'booked' | 'untracked';

/**
 * Cards snapshotted before court_state existed only knew whether a court was
 * confirmed. An unconfirmed one becomes 'untracked' rather than guessing a
 * reason, so an old card understates instead of making a claim.
 */
export function resolveCourtState(
  option: Pick<MatchOrganizerOption, 'court_confirmed' | 'court_state'>
): CourtState {
  if (option.court_state) return option.court_state;
  return option.court_confirmed ? 'confirmed' : 'untracked';
}

export function courtStateLabel(
  state: CourtState,
  courtCount: number,
  t: (key: TranslationKey) => string
): string {
  switch (state) {
    case 'confirmed':
      return courtCount > 1
        ? t('matchOrganizer.tier.courtsMany').replace('{count}', String(courtCount))
        : courtCount === 1
          ? t('matchOrganizer.tier.courtsOne')
          : t('matchOrganizer.tier.courtAvailable');
    default:
      // Not published yet, fully booked, and untracked all mean the same thing
      // to a player: there is no court here they can count on. They differ only
      // to the ranking, which still penalises a slot we can see is taken.
      return t('matchOrganizer.tier.courtUnknown');
  }
}

/**
 * Ionicons name for the chip. Only a confirmed court gets the court glyph; every
 * unconfirmed reason shares one, matching the single grey chip.
 */
export function courtStateIcon(_state: CourtState): 'help-circle-outline' {
  return 'help-circle-outline';
}
