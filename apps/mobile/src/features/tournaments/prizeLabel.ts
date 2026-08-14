/**
 * The prize figure, read correctly.
 *
 * `prize_money_cents` is the CEILING. On a pro-rata event it is only paid out
 * on a full draw and shrinks with the field, so rendering it bare promises
 * money the organizer may not owe. `prize_is_prorated` turns it into
 * "jusqu'à 250 $" / "up to $250".
 *
 * Shared by all three places the figure appears — the discovery card pill, the
 * detail hero pill, and the spec sheet's Bourse row — because a qualifier that
 * shows up in two of the three is worse than none: the unqualified one is what
 * a player quotes back at you.
 */

import { formatPrice } from '@rallia/shared-utils';
import type { TranslationKey } from '../../hooks';

interface PrizeBearing {
  prize_money_cents: number | null;
  prize_is_prorated?: boolean | null;
  currency: string | null;
}

export function prizeAmountLabel(
  tournament: PrizeBearing,
  locale: string,
  t: (k: TranslationKey) => string
): string | null {
  if (!tournament.prize_money_cents || tournament.prize_money_cents <= 0) return null;

  const amount = formatPrice(tournament.prize_money_cents, tournament.currency ?? undefined, {
    locale,
    trimZeroCents: true,
  });

  return tournament.prize_is_prorated
    ? t('tournamentDetail.labels.prizeUpTo').replace('{amount}', amount)
    : amount;
}
