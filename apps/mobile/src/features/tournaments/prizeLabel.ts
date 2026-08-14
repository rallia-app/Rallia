/**
 * The prize figure, read correctly — and there are two of them.
 *
 * `prize_money_cents` is the POOL, and on a split grid no single player can
 * ever win it. So which number to show depends on what the surface is asking:
 *
 *   'top'  — what could I win? The champion's cut (prize_top_share_bps), which
 *            is what the unlabelled trophy pill on a card or hero implies.
 *   'pool' — how much is in this event? The whole pool, for the spec sheet's
 *            row that is explicitly labelled "Bourse" / "Prize pool".
 *
 * Both are ceilings when `prize_is_prorated` is set (the pool follows paid
 * entries), so both get the "jusqu'à" / "up to" prefix. The champion's figure
 * derives from the pool rather than being stored separately, so proration
 * flows through to it and the two can never disagree.
 *
 * NULL prize_top_share_bps means winner-takes-all: 'top' and 'pool' coincide,
 * which is how every tournament predating the split grid behaves.
 */

import { formatPrice } from '@rallia/shared-utils';
import type { TranslationKey } from '../../hooks';

interface PrizeBearing {
  prize_money_cents: number | null;
  prize_is_prorated?: boolean | null;
  prize_top_share_bps?: number | null;
  currency: string | null;
}

export function prizeAmountLabel(
  tournament: PrizeBearing,
  locale: string,
  t: (k: TranslationKey) => string,
  share: 'top' | 'pool' = 'top'
): string | null {
  const pool = tournament.prize_money_cents;
  if (!pool || pool <= 0) return null;

  const bps = tournament.prize_top_share_bps;
  // Round to the dollar: a champion's cut of 60% of an odd pool otherwise
  // renders cents the organizer never advertises.
  const cents =
    share === 'pool' || !bps || bps >= 10000 ? pool : Math.round((pool * bps) / 10000 / 100) * 100;

  const amount = formatPrice(cents, tournament.currency ?? undefined, {
    locale,
    trimZeroCents: true,
  });

  return tournament.prize_is_prorated
    ? t('tournamentDetail.labels.prizeUpTo').replace('{amount}', amount)
    : amount;
}
